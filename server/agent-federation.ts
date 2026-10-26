import { join } from 'node:path'
import { promises as fsp } from 'node:fs'
import type { Request, Response, Express } from 'express'
import {
  generateSecureKey,
  sanitizeText,
  isSafeIdentifier,
  isSafeWebhookUrl,
  safeCompare,
  isBufferSpam,
  signWebhookPayload,
  resolveAndValidateHost,
  authenticateRequest,
} from './security.js'

const DATA_DIR = join(process.cwd(), 'data')
const FEDERATED_AGENTS_FILE = join(DATA_DIR, 'federated_agents.json')
const INVITES_FILE = join(DATA_DIR, 'agent_invites.json')
const AGENT_TASKS_FILE = join(DATA_DIR, 'agent_tasks_queue.json')

const RESERVED_AGENT_NAMES = [
  'leader',
  'trend-hunter',
  'fullstack-dev',
  'qa-engineer',
  'security-engineer',
  'admin',
  'administrator',
  'system',
  'root',
  'opencode',
]

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

  // If agent has configured webhook URL, fire notification asynchronously (with SSRF protection & HMAC signature)
  if (agent.endpointUrl && isSafeWebhookUrl(agent.endpointUrl)) {
    try {
      const parsedUrl = new URL(agent.endpointUrl)
      resolveAndValidateHost(parsedUrl.hostname).then((safeHost) => {
        if (!safeHost) {
          console.warn(`[SSRF_BLOCKED] Webhook host ${parsedUrl.hostname} resolved to restricted/private IP.`)
          return
        }

        const payload = JSON.stringify({
          event: 'task_assigned',
          task: queueEntry,
          timestamp: new Date().toISOString(),
        })
        const signature = signWebhookPayload(payload, agent.apiKey)

        fetch(agent.endpointUrl!, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Duckvaulta-Agent-Key': agent.apiKey,
            'X-Duckvaulta-Signature': signature,
            'X-Duckvaulta-Timestamp': new Date().toISOString(),
            'User-Agent': 'Duckvaulta-Company-Federation',
          },
          body: payload,
        }).catch((err) => console.warn(`Webhook dispatch warning for agent ${agent.name}:`, err.message))
      }).catch((err) => console.warn(`DNS resolution error for ${parsedUrl.hostname}:`, err.message))
    } catch (err) {
      console.warn(`Webhook dispatch error for agent ${agent.name}:`, err)
    }
  }

  return true
}

export function installAgentFederation(app: Express): void {
  // 1. Generate Invite Token for Friend's Agent
  app.post('/api/company/agents/invite', async (req: Request, res: Response) => {
    try {
      const auth = authenticateRequest(req)
      if (!auth.authenticated || !auth.user) {
        res.status(401).json({ error: 'Autentikasi diperlukan untuk membuat kunci undangan.' })
        return
      }

      const session = auth.user

      // STRICT RBAC: Only operators and admins can create invite keys
      if (session.role !== 'admin' && session.role !== 'operator') {
        res.status(403).json({
          error: 'Akses Ditolak: Hanya Operator atau Admin terverifikasi yang memiliki izin untuk membuat kunci undangan agen baru.',
          code: 'OPERATOR_ROLE_REQUIRED',
        })
        return
      }

      const { label = 'Friend Agent Invite', maxUses = 1, daysValid = 7 } = req.body || {}
      const spamCheck = isBufferSpam(String(label))
      if (spamCheck.spam) {
        res.status(400).json({ error: `Label: ${spamCheck.reason}` })
        return
      }

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
    const auth = authenticateRequest(req)
    if (!auth.authenticated || !auth.user) {
      res.status(401).json({ error: 'Authentication required.' })
      return
    }

    const session = auth.user
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

      const nameSpam = isBufferSpam(cleanName)
      if (nameSpam.spam) {
        res.status(400).json({ error: `Nama agen: ${nameSpam.reason}` })
        return
      }

      const descSpam = isBufferSpam(cleanDesc)
      if (descSpam.spam) {
        res.status(400).json({ error: `Deskripsi: ${descSpam.reason}` })
        return
      }

      const normalizedName = cleanName.toLowerCase().replace(/[\s_\-]+/g, '-')
      if (RESERVED_AGENT_NAMES.includes(normalizedName)) {
        res.status(400).json({ error: 'Reserved identifier. Guest agents cannot use internal agent names.' })
        return
      }

      if (cleanEndpoint) {
        if (!isSafeWebhookUrl(cleanEndpoint)) {
          res.status(400).json({ error: 'Invalid or forbidden webhook URL. Localhost and private network targets are blocked.' })
          return
        }
        try {
          const parsed = new URL(cleanEndpoint)
          const safeHost = await resolveAndValidateHost(parsed.hostname)
          if (!safeHost) {
            res.status(400).json({ error: 'Invalid or forbidden webhook target: host resolves to private/restricted IP.' })
            return
          }
        } catch {
          res.status(400).json({ error: 'Invalid webhook URL.' })
          return
        }
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
      { id: 'leader', name: 'David (Tech Lead)', role: 'Chief Engineering Orchestrator & System Architect', division: 'Management', type: 'internal', status: 'online', color: '#00d2ff' },
      { id: 'product-manager', name: 'Product Manager (PM)', role: 'Pecah Ide, User Stories & Feature Scoping', division: 'Product', type: 'internal', status: 'online', color: '#38bdf8' },
      { id: 'trend-hunter', name: 'Charlie (Business Analyst)', role: 'Market Intelligence, Business Requirements & Recon', division: 'Product', type: 'internal', status: 'online', color: '#10b981' },
      { id: 'designer', name: 'UI/UX Designer', role: 'Mobile/Web Wireframing & Design Tokens', division: 'Design', type: 'internal', status: 'online', color: '#c084fc' },
      { id: 'fullstack-dev', name: 'Alex (Backend & Fullstack)', role: 'High-Performance API & Database Engineering', division: 'Engineering', type: 'internal', status: 'online', color: '#0284c7' },
      { id: 'mobile-dev', name: 'Web & Mobile Developer', role: 'Modern Web (React, Vite, WebGL) & Cross-Platform Mobile Apps', division: 'Engineering', type: 'internal', status: 'online', color: '#06b6d4' },
      { id: 'devops-engineer', name: 'DevOps & Cloud Engineer', role: 'Reverse Proxy, Sandbox Daemons & CI/CD', division: 'Engineering', type: 'internal', status: 'online', color: '#eab308' },
      { id: 'qa-engineer', name: 'Julius (QA Automation)', role: 'Bug Hunting, Test Suites & Boundary Regression', division: 'Quality & Defense', type: 'internal', status: 'online', color: '#f59e0b' },
      { id: 'security-engineer', name: 'Athena (Cyber Defense)', role: 'Penetration Testing, Exploit Audit & RBAC Hardening', division: 'Quality & Defense', type: 'internal', status: 'online', color: '#ef4444' },
      { id: 'guru', name: 'Judith (Technical Writer)', role: 'Documentation Lead, Technical SOP & Mentorship', division: 'Quality & Defense', type: 'internal', status: 'online', color: '#a855f7' },
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

  // 7. Ping / Health-Check a Federated Agent Webhook (with SSRF Defense & HMAC signature)
  app.post('/api/company/agents/:agentId/ping', async (req: Request, res: Response) => {
    try {
      const { agentId } = req.params
      const agents = await loadFederatedAgents()
      const agent = agents.find((a) => a.id === agentId)

      if (!agent) {
        res.status(404).json({ error: 'Agent tidak ditemukan.' })
        return
      }

      if (!agent.endpointUrl) {
        res.json({ success: true, reachable: false, message: 'Agent tidak memiliki endpoint webhook (Poll-only mode).' })
        return
      }

      if (!isSafeWebhookUrl(agent.endpointUrl)) {
        res.status(400).json({
          success: false,
          reachable: false,
          error: 'SSRF_BLOCKED',
          message: 'Endpoint webhook diblokir oleh sistem proteksi SSRF (target internal/loopback/privat dilarang).',
        })
        return
      }

      const parsedUrl = new URL(agent.endpointUrl)
      const safeHost = await resolveAndValidateHost(parsedUrl.hostname)
      if (!safeHost) {
        res.status(400).json({
          success: false,
          reachable: false,
          error: 'SSRF_DNS_BLOCKED',
          message: 'Host webhook menyelesaikan ke alamat IP privat/internal (DNS Rebinding dicegah).',
        })
        return
      }

      const t0 = Date.now()
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 5000)

      const pingBody = JSON.stringify({
        event: 'ping_health_check',
        timestamp: new Date().toISOString(),
      })
      const signature = signWebhookPayload(pingBody, agent.apiKey)

      try {
        const pingRes = await fetch(agent.endpointUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Duckvaulta-Agent-Key': agent.apiKey,
            'X-Duckvaulta-Signature': signature,
            'X-Duckvaulta-Timestamp': new Date().toISOString(),
            'User-Agent': 'Duckvaulta-Federation-Ping',
          },
          body: pingBody,
          signal: controller.signal,
        })
        clearTimeout(timeoutId)
        const latencyMs = Date.now() - t0

        if (pingRes.ok) {
          agent.status = 'active'
          agent.lastSeenAt = new Date().toISOString()
          await saveFederatedAgents(agents)
          res.json({
            success: true,
            reachable: true,
            latencyMs,
            statusCode: pingRes.status,
            message: `Webhook responsif (${latencyMs}ms)`,
          })
        } else {
          res.json({
            success: true,
            reachable: false,
            latencyMs,
            statusCode: pingRes.status,
            message: `Webhook mengembalikan status ${pingRes.status}`,
          })
        }
      } catch (err: unknown) {
        clearTimeout(timeoutId)
        const msg = err instanceof Error ? err.message : 'Timeout / Unreachable'
        res.json({
          success: true,
          reachable: false,
          error: msg,
          message: 'Webhook tidak dapat dijangkau.',
        })
      }
    } catch {
      res.status(500).json({ error: 'Gagal mengeksekusi ping agen.' })
    }
  })

  // 8. Revoke / Remove a Federated Agent (Admin Only)
  app.delete('/api/company/agents/:agentId', async (req: Request, res: Response) => {
    try {
      const auth = authenticateRequest(req)
      if (!auth.authenticated || !auth.user || (auth.user.role !== 'admin' && auth.user.role !== 'operator')) {
        res.status(403).json({ error: 'Hanya Operator atau Admin yang berhak mencabut agen.' })
        return
      }

      const { agentId } = req.params
      let agents = await loadFederatedAgents()
      const target = agents.find((a) => a.id === agentId)
      if (!target) {
        res.status(404).json({ error: 'Agent tidak ditemukan.' })
        return
      }

      agents = agents.filter((a) => a.id !== agentId)
      await saveFederatedAgents(agents)

      res.json({
        success: true,
        message: `Agent ${target.name} berhasil dicabut dari roster federasi.`,
      })
    } catch {
      res.status(500).json({ error: 'Gagal mencabut agen.' })
    }
  })
}
