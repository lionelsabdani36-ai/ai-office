import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { join } from 'node:path'
import { promises as fsp } from 'node:fs'
import type { Request, Response, Express } from 'express'
import { verifySessionToken, sanitizeText, isSafeIdentifier } from './security.js'
import { dispatchTaskToFederatedAgent } from './agent-federation.js'

const execFileAsync = promisify(execFile)
const DATA_DIR = join(process.cwd(), 'data')
const TASKS_LOG_FILE = join(DATA_DIR, 'dispatched_tasks.json')
const INSTRUCTIONS_LOG_FILE = join(DATA_DIR, 'instructions_log.json')

export interface DispatchedTask {
  id: string
  title: string
  description: string
  assignee: string
  priority: 'normal' | 'high' | 'urgent'
  creatorEmail: string
  creatorName: string
  status: 'pending' | 'in_progress' | 'completed' | 'failed'
  externalAgent: boolean
  kanbanId?: string
  result?: string
  createdAt: string
  completedAt?: string
}

export interface DispatchedInstruction {
  id: string
  agent: string
  instruction: string
  creatorEmail: string
  creatorName: string
  status: 'sent' | 'executed' | 'acknowledged'
  timestamp: string
}

async function ensureDataFiles() {
  await fsp.mkdir(DATA_DIR, { recursive: true })
  try {
    await fsp.access(TASKS_LOG_FILE)
  } catch {
    await fsp.writeFile(TASKS_LOG_FILE, JSON.stringify([], null, 2), 'utf8')
  }
  try {
    await fsp.access(INSTRUCTIONS_LOG_FILE)
  } catch {
    await fsp.writeFile(INSTRUCTIONS_LOG_FILE, JSON.stringify([], null, 2), 'utf8')
  }
}

async function loadDispatchedTasks(): Promise<DispatchedTask[]> {
  await ensureDataFiles()
  try {
    return JSON.parse(await fsp.readFile(TASKS_LOG_FILE, 'utf8'))
  } catch {
    return []
  }
}

async function saveDispatchedTasks(tasks: DispatchedTask[]): Promise<void> {
  await ensureDataFiles()
  await fsp.writeFile(TASKS_LOG_FILE, JSON.stringify(tasks, null, 2), 'utf8')
}

async function loadInstructions(): Promise<DispatchedInstruction[]> {
  await ensureDataFiles()
  try {
    return JSON.parse(await fsp.readFile(INSTRUCTIONS_LOG_FILE, 'utf8'))
  } catch {
    return []
  }
}

async function saveInstructions(list: DispatchedInstruction[]): Promise<void> {
  await ensureDataFiles()
  await fsp.writeFile(INSTRUCTIONS_LOG_FILE, JSON.stringify(list, null, 2), 'utf8')
}

const INTERNAL_AGENTS = ['leader', 'trend-hunter', 'fullstack-dev', 'qa-engineer', 'security-engineer']

export function installTaskDispatcher(app: Express): void {
  // 1. Create and Dispatch Task from Web UI
  app.post('/api/company/tasks/create', async (req: Request, res: Response) => {
    try {
      const authHeader = req.headers.authorization || ''
      const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7) : ''
      const session = verifySessionToken(token)

      if (!session || !session.email) {
        res.status(401).json({ error: 'Authentication required to create tasks.' })
        return
      }

      const { title, description, assignee, priority = 'normal' } = req.body || {}

      if (!title || !description || !assignee) {
        res.status(400).json({ error: 'Title, description, and assignee are required fields.' })
        return
      }

      const cleanTitle = sanitizeText(title)
      const cleanDesc = sanitizeText(description)
      const cleanAssignee = sanitizeText(assignee).toLowerCase()
      const cleanPriority = ['normal', 'high', 'urgent'].includes(priority) ? priority : 'normal'

      if (!isSafeIdentifier(cleanAssignee)) {
        res.status(400).json({ error: 'Invalid assignee identifier.' })
        return
      }

      const taskId = `task_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`
      const isInternal = INTERNAL_AGENTS.includes(cleanAssignee)
      let kanbanTaskId: string | undefined

      if (isInternal) {
        // Dispatch to internal Hermes Kanban using safe execFile without shell interpolation
        try {
          const { stdout } = await execFileAsync('hermes', [
            'kanban',
            'create',
            '--assignee',
            cleanAssignee,
            '--body',
            `${cleanDesc} (Requested via Web by ${session.name || session.email})`,
            cleanTitle,
          ], { timeout: 15000 })

          const match = stdout.match(/Created\s+(t_[a-z0-9]+)/i)
          if (match) kanbanTaskId = match[1]
        } catch (execErr) {
          console.warn('Hermes kanban exec warning (internal task recorded):', execErr)
        }
      } else {
        // Dispatch to federated friend agent
        await dispatchTaskToFederatedAgent(cleanAssignee, {
          taskId,
          title: cleanTitle,
          description: cleanDesc,
          priority: cleanPriority,
          creator: String(session.name || session.email),
        })
      }

      const task: DispatchedTask = {
        id: taskId,
        title: cleanTitle,
        description: cleanDesc,
        assignee: cleanAssignee,
        priority: cleanPriority as 'normal' | 'high' | 'urgent',
        creatorEmail: String(session.email),
        creatorName: String(session.name || session.email),
        status: 'pending',
        externalAgent: !isInternal,
        kanbanId: kanbanTaskId,
        createdAt: new Date().toISOString(),
      }

      const tasks = await loadDispatchedTasks()
      tasks.unshift(task)
      await saveDispatchedTasks(tasks)

      res.json({
        success: true,
        message: isInternal
          ? `Task assigned to internal agent ${cleanAssignee} successfully.`
          : `Task dispatched to external agent ${cleanAssignee}.`,
        task,
      })
    } catch (err) {
      console.error('Task creation error:', err)
      res.status(500).json({ error: 'Failed to create and dispatch task.' })
    }
  })

  // 2. Direct Instruction Dispatcher
  app.post('/api/company/instruct', async (req: Request, res: Response) => {
    try {
      const authHeader = req.headers.authorization || ''
      const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7) : ''
      const session = verifySessionToken(token)

      if (!session || !session.email) {
        res.status(401).json({ error: 'Authentication required to dispatch instructions.' })
        return
      }

      const { agent, instruction } = req.body || {}
      if (!agent || !instruction) {
        res.status(400).json({ error: 'Agent name and instruction text are required.' })
        return
      }

      const cleanAgent = sanitizeText(agent).toLowerCase()
      const cleanInstruction = sanitizeText(instruction)

      const entry: DispatchedInstruction = {
        id: `inst_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        agent: cleanAgent,
        instruction: cleanInstruction,
        creatorEmail: String(session.email),
        creatorName: String(session.name || session.email),
        status: 'sent',
        timestamp: new Date().toISOString(),
      }

      const list = await loadInstructions()
      list.unshift(entry)
      await saveInstructions(list)

      // If internal, also register as priority Kanban task
      if (INTERNAL_AGENTS.includes(cleanAgent)) {
        try {
          await execFileAsync('hermes', [
            'kanban',
            'create',
            '--assignee',
            cleanAgent,
            '--body',
            cleanInstruction,
            `[Direct Web Instruction] ${cleanInstruction.substring(0, 45)}...`,
          ], { timeout: 15000 })
        } catch {
          // Non-blocking
        }
      }

      res.json({
        success: true,
        message: `Instruction successfully dispatched to agent ${cleanAgent}.`,
        instruction: entry,
      })
    } catch (err) {
      console.error('Instruction dispatch error:', err)
      res.status(500).json({ error: 'Failed to dispatch instruction.' })
    }
  })

  // 3. Get Dispatched Tasks History
  app.get('/api/company/tasks/history', async (_req: Request, res: Response) => {
    const tasks = await loadDispatchedTasks()
    res.json({
      total: tasks.length,
      tasks: tasks.slice(0, 50),
    })
  })

  // 4. Get Instructions History
  app.get('/api/company/instructions/history', async (_req: Request, res: Response) => {
    const list = await loadInstructions()
    res.json({
      total: list.length,
      instructions: list.slice(0, 50),
    })
  })
}
