// Agents are whatever Hermes profiles the machine reports (plus OpenCode), so nothing here is
// tied to particular names: each agent's look is derived from its id.

export interface AgentLook {
  hair: string
  skin: string
  shirt: string
  pants: string
  tie?: string
  hat?: 'hardhat' | 'cap' | 'fedora'
  hatColor?: string
  glasses?: 'sunglasses' | 'spectacles'
  headphones?: boolean
  badge?: 'padlock' | 'star'
}

const CUSTOM_LOOKS: Record<string, Partial<AgentLook>> = {
  // Athena (Security-Engineer): Secret Agent / Cyber Defense
  // Voxel style: Black shades, crisp white shirt with sharp red tie, black trousers, gold security padlock
  'security-engineer': {
    hair: '#11151c',
    skin: '#e9b57d',
    shirt: '#ffffff',
    pants: '#0f172a',
    tie: '#dc2626',
    glasses: 'sunglasses',
    badge: 'padlock',
  },
  // Alex (Fullstack-Dev): Lead Software & Web Engineer
  // Voxel style: Peaked developer cap, cyan tech shirt, developer headphones
  'fullstack-dev': {
    hair: '#3b2a20',
    skin: '#f1c9a0',
    shirt: '#0284c7',
    pants: '#1e293b',
    hat: 'cap',
    hatColor: '#0369a1',
    headphones: true,
  },
  // Julius (QA-Engineer): Quality & Safety Inspector
  // Voxel style: Safety yellow hardhat, emerald inspect polo, inspector spectacles
  'qa-engineer': {
    hair: '#4a3b2f',
    skin: '#e9b57d',
    shirt: '#059669',
    pants: '#334155',
    hat: 'hardhat',
    hatColor: '#f59e0b',
    glasses: 'spectacles',
  },
  // David (Leader / default): Chief Mission Controller
  // Voxel style: Midnight navy commander blazer, gold tie, command shades
  'leader': {
    hair: '#11151c',
    skin: '#e9b57d',
    shirt: '#0a0f1d',
    pants: '#070a14',
    tie: '#f59e0b',
    glasses: 'sunglasses',
  },
  'default': {
    hair: '#11151c',
    skin: '#e9b57d',
    shirt: '#0a0f1d',
    pants: '#070a14',
    tie: '#f59e0b',
    glasses: 'sunglasses',
  },
  // Charlie (Trend-Hunter): Intelligence Scout
  // Voxel style: Orange explorer peaked cap, amber shirt
  'trend-hunter': {
    hair: '#8b5a2b',
    skin: '#f1c9a0',
    shirt: '#ea580c',
    pants: '#1c1917',
    hat: 'cap',
    hatColor: '#ea580c',
  },
  // Judith (Guru): Master Mentor & Education Lead
  // Voxel style: Scholar spectacles, deep violet academic robe
  'guru': {
    hair: '#64748b',
    skin: '#f1c9a0',
    shirt: '#6d28d9',
    pants: '#1e1b4b',
    glasses: 'spectacles',
  },
}

const HAIR = ['#1d293c', '#b54b45', '#6a4d8d', '#3b2a20', '#c9a24a', '#2f4f3a', '#8b5a2b', '#11151c']
const SKIN = ['#e9b57d', '#c98e5a', '#f1c9a0', '#a8714a', '#dca06e']
const SHIRT = ['#e6b34e', '#70bdcb', '#93ca67', '#e76f51', '#8f7ae6', '#f4a3b4', '#4f9c7a', '#d9534f', '#5a8dee', '#c7a17a']
const PANTS = ['#36475d', '#374052', '#344349', '#4a3b2f', '#2f3a44', '#3d2f4a']

/** A small stable hash (FNV-1a) so an agent keeps the same look on every device. */
export function hashName(name: string): number {
  let hash = 2166136261
  for (let index = 0; index < name.length; index += 1) {
    hash ^= name.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

export function agentLook(id: string): AgentLook {
  const custom = CUSTOM_LOOKS[id.toLowerCase()]
  const hash = hashName(id)
  const fallback: AgentLook = {
    hair: HAIR[hash % HAIR.length],
    skin: SKIN[(hash >>> 4) % SKIN.length],
    shirt: SHIRT[(hash >>> 8) % SHIRT.length],
    pants: PANTS[(hash >>> 12) % PANTS.length],
  }
  return { ...fallback, ...custom }
}
