import { join } from 'node:path'
import { promises as fsp } from 'node:fs'
import type { Request, Response, Express } from 'express'
import { generateSecureKey, sanitizeText, isSafeIdentifier, verifySessionToken, isSafeWebhookUrl, safeCompare } from './security.js'

const DATA_DIR = join(process.cwd(), 'data')
const FEDERATED_AGENTS_FILE = join(DATA_DIR, 'federated_agents.json')
const INVITES_FILE = join(DATA_DIR, 'agent_invites.json')
const AGENT_TASKS_FILE = join(DATA_DIR, 'agent_tasks_queue.json')

export interface FederatedAgent {
  id: string
  name: string
  owner: string
  description: string
  capabilities: string[]
  endpointUrl?: string
  avatarColor: string
  apiKey: string
  status: 'active' | 'busy' | 'offline'
  tasksCompleted: number
  joinedAt: string
  lastSeenAt: string
}

export interface AgentInvite {
  key: string
  creatorEmail: string
  label: string
  maxUses: number
  usesLeft: number
  expiresAt: string
  createdAt: string
}

export interface AgentQueuedTask {
  taskId: string
  agentId: string
  title: string
  description: string
  priority: string
  creator: string
  status: 'queued' | 'acknowledged' | 'completed'
  result?: string
  createdAt: string
  completedAt?: string
}

async function ensureDataFiles() {
  await fsp.mkdir(DATA_DIR, { recursive: true })
  try {
    await fsp.access(FEDERATED_AGENTS_FILE)
  } catch {
    await fsp.writeFile(FEDERATED_AGENTS_FILE, JSON.stringify([], null, 2), 'utf8')
  }
  try {
    await fsp.access(INVITES_FILE)
  } catch {
    await fsp.writeFile(INVITES_FILE, JSON.stringify([], null, 2), 'utf8')
  }
  try {
    await fsp.access(AGENT_TASKS_FILE)
  } catch {
    await fsp.writeFile(AGENT_TASKS_FILE, JSON.stringify([], null, 2), 'utf8')
  }
}

export async function loadFederatedAgents(): Promise<FederatedAgent[]> {
  await ensureDataFiles()
  try {
    return JSON.parse(await fsp.readFile(FEDERATED_AGENTS_FILE, 'utf8'))
  } catch {
    return []
  }
}

async function saveFederatedAgents(agents: FederatedAgent[]): Promise<void> {
  await ensureDataFiles()
  await fsp.writeFile(FEDERATED_AGENTS_FILE, JSON.stringify(agents, null, 2), 'utf8')
}

async function loadInvites(): Promise<AgentInvite[]> {
  await ensureDataFiles()
  try {
    return JSON.parse(await fsp.readFile(INVITES_FILE, 'utf8'))
  } catch {
    return []
  }
}

async function saveInvites(invites: AgentInvite[]): Promise<void> {
  await ensureDataFiles()
  await fsp.writeFile(INVITES_FILE, JSON.stringify(invites, null, 2), 'utf8')
}

async function loadAgentTasks(): Promise<AgentQueuedTask[]> {
  await ensureDataFiles()
  try {
    return JSON.parse(await fsp.readFile(AGENT_TASKS_FILE, 'utf8'))
  } catch {
    return []
  }
}

async function saveAgentTasks(tasks: AgentQueuedTask[]): Promise<void> {
  await ensureDataFiles()
  await fsp.writeFile(AGENT_TASKS_FILE, JSON.stringify(tasks, null, 2), 'utf8')
}

/**
 * Dispatch task to an external friend agent (queue + optional webhook trigger)
 */
export async function dispatchTaskToFederatedAgent(agentIdentifier: string, taskInfo: {
  taskId: string
  title: string
  description: string
  priority: string
  creator: string
}): Promise<boolean> {
  const agents = await loadFederatedAgents()
  const agent = agents.find(
    (a) => a.id.toLowerCase() === agentIdentifier.toLowerCase() || a.name.toLowerCase() === agentIdentifier.toLowerCase()
  )

  if (!agent) return false

  const queuedTasks = await loadAgentTasks()
  const queueEntry: AgentQueuedTask = {
    taskId: taskInfo.taskId,
    agentId: agent.id,
    title: taskInfo.title,
    description: taskInfo.description,
    priority: taskInfo.priority,
    creator: taskInfo.creator,
    status: 'queued',
    createdAt: new Date().toISOString(),
  }

  queuedTasks.push(queueEntry)
  await saveAgentTasks(queuedTasks)

  // If agent has configured webhook URL, fire notification asynchronously (with SSRF protection)
  if (agent.endpointUrl && isSafeWebhookUrl(agent.endpointUrl)) {
    fetch(agent.endpointUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Duckvaulta-Agent-Key': agent.apiKey,
        'User-Agent': 'Duckvaulta-Company-Federation',
      },
      body: JSON.stringify({
        event: 'task_assigned',
        task: queueEntry,
      }),
    }).catch((err) => console.warn(`Webhook dispatch warning for agent ${agent.name}:`, err.message))
  }

  return true
}

export function installAgentFederation(app: Express): void {
  // 1. Generate Invite Token for Friend's Agent
  app.post('/api/company/agents/invite', async (req: Request, res: Response) => {
    try {
      const authHeader = req.headers.authorization || ''
      const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7) : ''
      const session = verifySessionToken(token)

      if (!session || !session.email) {
        res.status(401).json({ error: 'Authentication required to generate agent invitation keys.' })
        return
      }

      const { label = 'Friend Agent Invite', maxUses = 1, daysValid = 7 } = req.body || {}
      const safeMaxUses = Math.min(20, Math.max(1, Number(maxUses) || 1))
      const safeDaysValid = Math.min(30, Math.max(1, Number(daysValid) || 1))
      const inviteKey = `dck_inv_${generateSecureKey(16)}`
      const expiresAt = new Date(Date.now() + safeDaysValid * 86400_000).toISOString()

      const newInvite: AgentInvite = {
        key: inviteKey,
        creatorEmail: String(session.email),
        label: sanitizeText(label),
        maxUses: safeMaxUses,
        usesLeft: safeMaxUses,
        expiresAt,
        createdAt: new Date().toISOString(),
      }

      const invites = await loadInvites()
      invites.unshift(newInvite)
      await saveInvites(invites)

      res.json({
        success: true,
        message: 'Agent invitation key created successfully.',
        invite: newInvite,
        joinUrl: `https://aicompany.duckvaulta.ai.id/join?key=${inviteKey}`,
      })
    } catch (err) {
      console.error('Invite generation error:', err)
      res.status(500).json({ error: 'Failed to generate agent invitation key.' })
    }
  })

  // 2. List Active Invites
  app.get('/api/company/agents/invites', async (req: Request, res: Response) => {
    const authHeader = req.headers.authorization || ''
    const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7) : ''
    const session = verifySessionToken(token)

    if (!session || !session.email) {
      res.status(401).json({ error: 'Authentication required.' })
      return
    }

    const invites = await loadInvites()
    const now = Date.now()
    const activeInvites = invites.filter((inv) => new Date(inv.expiresAt).getTime() > now && inv.usesLeft > 0)
    const filteredInvites = session.role === 'admin'
      ? activeInvites
      : activeInvites.filter((inv) => inv.creatorEmail === session.email)

    res.json({
      total: filteredInvites.length,
      invites: filteredInvites,
    })
  })

  // 3. Friend's Agent Join Endpoint (Federation Handshake)
  app.post('/api/company/agents/join', async (req: Request, res: Response) => {
    try {
      const {
        inviteKey,
        agentName,
        ownerName,
        description = 'External AI Agent',
        capabilities = [],
        endpointUrl = '',
        avatarColor = '#38bdf8',
      } = req.body || {}

      if (!inviteKey || !agentName) {
        res.status(400).json({ error: 'inviteKey and agentName are required.' })
        return
      }

      const cleanName = sanitizeText(agentName)
      const cleanOwner = sanitizeText(ownerName || 'Friend')
      const cleanDesc = sanitizeText(description)
      const cleanEndpoint = sanitizeText(endpointUrl)
      const cleanColor = /^#[0-9a-fA-F]{6}$/.test(avatarColor) ? avatarColor : '#38bdf8'

      if (!isSafeIdentifier(cleanName)) {
        res.status(400).json({ error: 'Agent name must be alphanumeric.' })
        return
      }

      if (cleanEndpoint && !isSafeWebhookUrl(cleanEndpoint)) {
        res.status(400).json({ error: 'Invalid or forbidden webhook URL. Localhost and private network targets are blocked.' })
        return
      }

      // Validate Invite Key
      const invites = await loadInvites()
      const invite = invites.find((inv) => inv.key === inviteKey)

      if (!invite) {
        res.status(403).json({ error: 'Invalid invitation key.' })
        return
      }

      if (invite.usesLeft <= 0 || new Date(invite.expiresAt).getTime() < Date.now()) {
        res.status(403).json({ error: 'This invitation key has expired or reached maximum uses.' })
        return
      }

      // Deduct usage
      invite.usesLeft -= 1
      await saveInvites(invites)

      const agentId = `ext_${cleanName.toLowerCase().replace(/[^a-z0-9]/g, '_')}_${Math.random().toString(36).substring(2, 6)}`
      const agentApiKey = `dck_agt_${generateSecureKey(24)}`

      const newAgent: FederatedAgent = {
        id: agentId,
        name: cleanName,
        owner: cleanOwner,
        description: cleanDesc,
        capabilities: Array.isArray(capabilities) ? capabilities.map((c) => sanitizeText(c)).slice(0, 10) : ['general_task'],
        endpointUrl: cleanEndpoint || undefined,
        avatarColor: cleanColor,
        apiKey: agentApiKey,
        status: 'active',
        tasksCompleted: 0,
        joinedAt: new Date().toISOString(),
        lastSeenAt: new Date().toISOString(),
      }

      const agents = await loadFederatedAgents()
      agents.push(newAgent)
      await saveFederatedAgents(agents)

      res.json({
        success: true,
        message: `Welcome to Duckvaulta AI Company, Agent ${cleanName}! You are now an active member.`,
        agent: {
          id: newAgent.id,
          name: newAgent.name,
          owner: newAgent.owner,
          status: newAgent.status,
          joinedAt: newAgent.joinedAt,
        },
        credentials: {
          agentId: newAgent.id,
          apiKey: agentApiKey,
          taskPollingUrl: `/api/company/agents/${newAgent.id}/tasks`,
        },
      })
    } catch (err) {
      console.error('Agent join error:', err)
      res.status(500).json({ error: 'Failed to process agent registration.' })
    }
  })

  // 4. Combined Company Roster (Internal 5 agents + Joined Friend Agents)
  app.get('/api/company/agents/roster', async (_req: Request, res: Response) => {
    const federated = await loadFederatedAgents()

    const internalCrew = [
      { id: 'leader', name: 'Leader', role: 'Orchestrator & Chief Agent', type: 'internal', status: 'online', color: '#00d2ff' },
      { id: 'trend-hunter', name: 'Trend Hunter', role: 'Market Intelligence & Research', type: 'internal', status: 'online', color: '#10b981' },
      { id: 'fullstack-dev', name: 'Fullstack Dev', role: 'Software & Web Engineering', type: 'internal', status: 'online', color: '#38bdf8' },
      { id: 'qa-engineer', name: 'QA Engineer', role: 'Quality & Ergonomics Assurance', type: 'internal', status: 'online', color: '#f59e0b' },
      { id: 'security-engineer', name: 'Security Engineer', role: 'Cyber Defense & Vulnerability Guard', type: 'internal', status: 'online', color: '#ef4444' },
    ]

    const federatedCrew = federated.map((agt) => ({
      id: agt.id,
      name: agt.name,
      role: agt.description,
      owner: agt.owner,
      type: 'federated_guest',
      status: agt.status,
      color: agt.avatarColor,
      capabilities: agt.capabilities,
      joinedAt: agt.joinedAt,
      tasksCompleted: agt.tasksCompleted,
    }))

    res.json({
      total: internalCrew.length + federatedCrew.length,
      internalCount: internalCrew.length,
      federatedCount: federatedCrew.length,
      roster: [...internalCrew, ...federatedCrew],
    })
  })

  // 5. Friend Agent Task Inbox (Poll for assigned tasks)
  app.get('/api/company/agents/:agentId/tasks', async (req: Request, res: Response) => {
    const { agentId } = req.params
    const authKey = req.headers['x-agent-key'] || (req.headers.authorization || '').replace('Bearer ', '')

    const agents = await loadFederatedAgents()
    const agent = agents.find((a) => a.id === agentId)

    if (!agent || !safeCompare(agent.apiKey, String(authKey))) {
      res.status(401).json({ error: 'Invalid agent credentials.' })
      return
    }

    agent.lastSeenAt = new Date().toISOString()
    await saveFederatedAgents(agents)

    const allTasks = await loadAgentTasks()
    const agentTasks = allTasks.filter((t) => t.agentId === agentId && t.status === 'queued')

    res.json({
      agent: agent.name,
      pendingTasks: agentTasks,
    })
  })

  // 6. Friend Agent Task Completion Callback
  app.post('/api/company/agents/:agentId/tasks/:taskId/complete', async (req: Request, res: Response) => {
    const { agentId, taskId } = req.params
    const authKey = req.headers['x-agent-key'] || (req.headers.authorization || '').replace('Bearer ', '')

    const agents = await loadFederatedAgents()
    const agent = agents.find((a) => a.id === agentId)

    if (!agent || !safeCompare(agent.apiKey, String(authKey))) {
      res.status(401).json({ error: 'Invalid agent credentials.' })
      return
    }

    const { result, status = 'completed' } = req.body || {}
    const allTasks = await loadAgentTasks()
    const task = allTasks.find((t) => t.taskId === taskId && t.agentId === agentId)

    if (!task) {
      res.status(404).json({ error: 'Task not found in queue.' })
      return
    }

    task.status = status === 'completed' ? 'completed' : 'acknowledged'
    task.result = sanitizeText(result || 'Task completed successfully.')
    task.completedAt = new Date().toISOString()

    agent.tasksCompleted += 1
    agent.lastSeenAt = new Date().toISOString()

    await saveAgentTasks(allTasks)
    await saveFederatedAgents(agents)

    res.json({
      success: true,
      message: `Task ${taskId} completed by agent ${agent.name}.`,
      task,
    })
  })
}
