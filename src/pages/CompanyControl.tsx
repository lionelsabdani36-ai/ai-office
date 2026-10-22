import { useEffect, useState } from 'react'

interface UserProfile {
  id: string
  name: string
  email: string
  provider: string
  avatarUrl?: string
  role: string
}

interface AgentRosterItem {
  id: string
  name: string
  role: string
  owner?: string
  type: string
  status: string
  color: string
  capabilities?: string[]
  tasksCompleted?: number
}

interface DispatchedTaskItem {
  id: string
  title: string
  description: string
  assignee: string
  priority: string
  creatorName: string
  status: string
  createdAt: string
}

export function CompanyControl() {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('duckvaulta_company_token'))
  const [user, setUser] = useState<UserProfile | null>(null)
  const [roster, setRoster] = useState<AgentRosterItem[]>([])
  const [tasks, setTasks] = useState<DispatchedTaskItem[]>([])
  
  // Login Form States
  const [loginEmail, setLoginEmail] = useState('')
  const [loginName, setLoginName] = useState('')
  const [authStatus, setAuthStatus] = useState('')

  // Task Creation States
  const [taskTitle, setTaskTitle] = useState('')
  const [taskDesc, setTaskDesc] = useState('')
  const [taskAssignee, setTaskAssignee] = useState('leader')
  const [taskPriority, setTaskPriority] = useState('normal')
  const [taskStatus, setTaskStatus] = useState('')

  // Instruction States
  const [instructAgent, setInstructAgent] = useState('leader')
  const [instructionText, setInstructionText] = useState('')
  const [instructStatus, setInstructStatus] = useState('')

  // Invite & Join States
  const [inviteLabel, setInviteLabel] = useState('Undangan Agent Sahabat')
  const [inviteUses, setInviteUses] = useState(1)
  const [generatedInviteUrl, setGeneratedInviteUrl] = useState('')
  const [inviteStatus, setInviteStatus] = useState('')

  // Manual Join Form for Friend's Agent
  const [joinInviteKey, setJoinInviteKey] = useState('')
  const [joinAgentName, setJoinAgentName] = useState('')
  const [joinOwnerName, setJoinOwnerName] = useState('')
  const [joinDesc, setJoinDesc] = useState('')
  const [joinWebhook, setJoinWebhook] = useState('')
  const [joinColor, setJoinColor] = useState('#38bdf8')
  const [joinStatus, setJoinStatus] = useState('')

  // Check current session
  useEffect(() => {
    if (!token) return
    fetch('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((d) => {
        if (d.authenticated) setUser(d.user)
        else {
          localStorage.removeItem('duckvaulta_company_token')
          setToken(null)
          setUser(null)
        }
      })
      .catch(() => {})
  }, [token])

  // Load roster and task history
  const reloadData = () => {
    fetch('/api/company/agents/roster')
      .then((r) => r.json())
      .then((d) => setRoster(d.roster || []))
      .catch(() => {})

    fetch('/api/company/tasks/history')
      .then((r) => r.json())
      .then((d) => setTasks(d.tasks || []))
      .catch(() => {})
  }

  useEffect(() => {
    reloadData()
  }, [])

  // Handle Google / GitHub Login
  const handleOAuthLogin = async (provider: 'google' | 'github') => {
    setAuthStatus(`Menghubungkan ke ${provider}...`)
    try {
      const email = loginEmail || `${provider}.user@duckvaulta.ai.id`
      const name = loginName || (provider === 'google' ? 'Google Operator' : 'GitHub Developer')

      const res = await fetch(`/api/auth/oauth/${provider}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, name }),
      })
      const data = await res.json()
      if (data.success && data.token) {
        localStorage.setItem('duckvaulta_company_token', data.token)
        setToken(data.token)
        setUser(data.user)
        setAuthStatus(`✓ Berhasil masuk sebagai ${data.user.name} (${data.user.role})`)
      } else {
        setAuthStatus(`Gagal masuk: ${data.error || 'Terjadi kesalahan'}`)
      }
    } catch {
      setAuthStatus('Koneksi ke server autentikasi gagal.')
    }
  }

  const handleLogout = () => {
    localStorage.removeItem('duckvaulta_company_token')
    setToken(null)
    setUser(null)
    setAuthStatus('')
  }

  // Handle Task Creation
  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!token) {
      alert('Harap login terlebih dahulu.')
      return
    }
    setTaskStatus('Mengirimkan task ke tim...')
    try {
      const res = await fetch('/api/company/tasks/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          title: taskTitle,
          description: taskDesc,
          assignee: taskAssignee,
          priority: taskPriority,
        }),
      })
      const data = await res.json()
      if (data.success) {
        setTaskStatus(`✓ ${data.message}`)
        setTaskTitle('')
        setTaskDesc('')
        reloadData()
      } else {
        setTaskStatus(`Gagal: ${data.error || 'Unknown error'}`)
      }
    } catch {
      setTaskStatus('Gagal mengirimkan task ke server.')
    }
  }

  // Handle Direct Instruction
  const handleSendInstruction = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!token) {
      alert('Harap login terlebih dahulu.')
      return
    }
    setInstructStatus('Mengirim instruksi...')
    try {
      const res = await fetch('/api/company/instruct', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          agent: instructAgent,
          instruction: instructionText,
        }),
      })
      const data = await res.json()
      if (data.success) {
        setInstructStatus(`✓ ${data.message}`)
        setInstructionText('')
      } else {
        setInstructStatus(`Gagal: ${data.error}`)
      }
    } catch {
      setInstructStatus('Gagal menghubungi agen.')
    }
  }

  // Handle Generate Invite Key
  const handleGenerateInvite = async () => {
    if (!token) {
      alert('Harap login terlebih dahulu.')
      return
    }
    setInviteStatus('Membuat kunci undangan...')
    try {
      const res = await fetch('/api/company/agents/invite', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ label: inviteLabel, maxUses: inviteUses, daysValid: 14 }),
      })
      const data = await res.json()
      if (data.success) {
        setGeneratedInviteUrl(data.invite.key)
        setInviteStatus(`✓ Kunci Undangan dibuat: ${data.invite.key}`)
      } else {
        setInviteStatus(`Gagal: ${data.error}`)
      }
    } catch {
      setInviteStatus('Gagal membuat undangan.')
    }
  }

  // Handle Friend Agent Join
  const handleJoinAgent = async (e: React.FormEvent) => {
    e.preventDefault()
    setJoinStatus('Mendaftarkan agen sahabat...')
    try {
      const res = await fetch('/api/company/agents/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          inviteKey: joinInviteKey,
          agentName: joinAgentName,
          ownerName: joinOwnerName,
          description: joinDesc || 'Specialist AI Agent',
          endpointUrl: joinWebhook,
          avatarColor: joinColor,
        }),
      })
      const data = await res.json()
      if (data.success) {
        setJoinStatus(`✓ Sukses! Agen ${data.agent.name} resmi bergabung dengan Duckvaulta AI Company.`)
        setJoinInviteKey('')
        setJoinAgentName('')
        setJoinOwnerName('')
        setJoinDesc('')
        setJoinWebhook('')
        reloadData()
      } else {
        setJoinStatus(`Gagal bergabung: ${data.error}`)
      }
    } catch {
      setJoinStatus('Gagal menghubungi endpoint registrasi federasi.')
    }
  }

  return (
    <div style={{ padding: '24px 20px', maxWidth: '1200px', margin: '0 auto' }}>
      {/* Top Header & Security Banner */}
      <div style={{ background: '#0a1120', border: '1px solid rgba(0, 210, 255, 0.25)', borderRadius: '12px', padding: '20px', marginBottom: '24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <span style={{ fontFamily: 'monospace', fontSize: '0.75rem', color: '#00d2ff', textTransform: 'uppercase' }}>
            ● MISSION CONTROL &amp; AGENT FEDERATION
          </span>
          <h1 style={{ fontSize: '1.6rem', fontWeight: 800, margin: '4px 0' }}>AI Company Command Center</h1>
          <p style={{ color: '#94a3b8', fontSize: '0.88rem' }}>
            Otentikasi OAuth terenkripsi, delegasi tugas instan dari web, dan portal federasi agen eksternal.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <span style={{ fontSize: '0.75rem', fontFamily: 'monospace', background: 'rgba(16, 185, 129, 0.1)', color: '#10b981', border: '1px solid #10b981', padding: '4px 10px', borderRadius: '6px' }}>
            🛡️ RATE LIMIT: 120/MIN
          </span>
          <span style={{ fontSize: '0.75rem', fontFamily: 'monospace', background: 'rgba(56, 189, 248, 0.1)', color: '#38bdf8', border: '1px solid #38bdf8', padding: '4px 10px', borderRadius: '6px' }}>
            🔒 HMAC-SHA256 TOKENS
          </span>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '24px' }}>
        
        {/* SECTION 1: OAUTH LOGIN & PROFILE */}
        <div style={{ background: '#0d172a', border: '1px solid rgba(255, 255, 255, 0.08)', borderRadius: '12px', padding: '22px' }}>
          <h2 style={{ fontSize: '1.2rem', fontWeight: 700, marginBottom: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span>🔑</span> 1. Autentikasi Pengguna (OAuth)
          </h2>

          {!user ? (
            <div>
              <p style={{ color: '#94a3b8', fontSize: '0.85rem', marginBottom: '14px' }}>
                Masuk menggunakan akun terverifikasi untuk mengelola tugas dan mengundang agen rekan:
              </p>
              <div style={{ marginBottom: '12px' }}>
                <input
                  type="email"
                  placeholder="Email (cth: kamu@gmail.com)"
                  value={loginEmail}
                  onChange={(e) => setLoginEmail(e.target.value)}
                  style={{ width: '100%', padding: '10px 12px', background: '#0a1120', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '6px', color: '#fff', fontSize: '0.9rem', marginBottom: '8px', boxSizing: 'border-box' }}
                />
                <input
                  type="text"
                  placeholder="Nama Lengkap / Username"
                  value={loginName}
                  onChange={(e) => setLoginName(e.target.value)}
                  style={{ width: '100%', padding: '10px 12px', background: '#0a1120', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '6px', color: '#fff', fontSize: '0.9rem', boxSizing: 'border-box' }}
                />
              </div>

              <div style={{ display: 'flex', gap: '10px' }}>
                <button
                  type="button"
                  onClick={() => handleOAuthLogin('google')}
                  style={{ flex: 1, padding: '10px', background: '#ea4335', color: '#fff', border: 'none', borderRadius: '6px', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
                >
                  <span>G</span> Masuk Google
                </button>
                <button
                  type="button"
                  onClick={() => handleOAuthLogin('github')}
                  style={{ flex: 1, padding: '10px', background: '#24292e', color: '#fff', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '6px', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
                >
                  <span>🐙</span> Masuk GitHub
                </button>
              </div>

              {authStatus && (
                <div style={{ marginTop: '12px', fontSize: '0.82rem', color: authStatus.startsWith('✓') ? '#10b981' : '#f43f5e', fontFamily: 'monospace' }}>
                  {authStatus}
                </div>
              )}
            </div>
          ) : (
            <div style={{ background: '#0a1120', padding: '16px', borderRadius: '8px', border: '1px solid rgba(0, 210, 255, 0.2)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
                <div style={{ width: '42px', height: '42px', borderRadius: '50%', background: '#00d2ff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, color: '#040812' }}>
                  {user.name.charAt(0).toUpperCase()}
                </div>
                <div>
                  <div style={{ fontWeight: 700, fontSize: '1rem' }}>{user.name}</div>
                  <div style={{ fontSize: '0.78rem', color: '#94a3b8', fontFamily: 'monospace' }}>{user.email}</div>
                </div>
                <span style={{ marginLeft: 'auto', fontSize: '0.72rem', background: 'rgba(0, 210, 255, 0.15)', color: '#00d2ff', padding: '2px 8px', borderRadius: '4px', textTransform: 'uppercase', fontFamily: 'monospace' }}>
                  {user.role}
                </span>
              </div>
              <button
                type="button"
                onClick={handleLogout}
                style={{ width: '100%', padding: '8px', background: 'transparent', border: '1px solid rgba(244, 63, 94, 0.4)', color: '#f43f5e', borderRadius: '6px', fontSize: '0.85rem', cursor: 'pointer', fontWeight: 600 }}
              >
                Sign Out (Keluar)
              </button>
            </div>
          )}
        </div>

        {/* SECTION 2: DISPATCH TASK & INSTRUCTION */}
        <div style={{ background: '#0d172a', border: '1px solid rgba(255, 255, 255, 0.08)', borderRadius: '12px', padding: '22px' }}>
          <h2 style={{ fontSize: '1.2rem', fontWeight: 700, marginBottom: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span>📝</span> 2. Beri Task &amp; Instruksi dari Web
          </h2>

          <form onSubmit={handleCreateTask}>
            <div style={{ marginBottom: '10px' }}>
              <input
                type="text"
                placeholder="Judul Tugas (Task Title)..."
                value={taskTitle}
                onChange={(e) => setTaskTitle(e.target.value)}
                required
                style={{ width: '100%', padding: '10px', background: '#0a1120', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '6px', color: '#fff', fontSize: '0.88rem', boxSizing: 'border-box' }}
              />
            </div>
            <div style={{ marginBottom: '10px' }}>
              <textarea
                placeholder="Rincian deskripsi tugas & instruksi teknis..."
                value={taskDesc}
                onChange={(e) => setTaskDesc(e.target.value)}
                required
                rows={2}
                style={{ width: '100%', padding: '10px', background: '#0a1120', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '6px', color: '#fff', fontSize: '0.85rem', boxSizing: 'border-box' }}
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '12px' }}>
              <div>
                <label style={{ fontSize: '0.75rem', color: '#94a3b8', display: 'block', marginBottom: '4px' }}>Target Agen</label>
                <select
                  value={taskAssignee}
                  onChange={(e) => setTaskAssignee(e.target.value)}
                  style={{ width: '100%', padding: '8px', background: '#0a1120', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '6px', color: '#fff', fontSize: '0.85rem' }}
                >
                  <optgroup label="Internal AI Team">
                    <option value="leader">Leader (Chief Agent)</option>
                    <option value="trend-hunter">trend-hunter (Intelligence)</option>
                    <option value="fullstack-dev">fullstack-dev (Engineering)</option>
                    <option value="qa-engineer">qa-engineer (Quality &amp; UX)</option>
                    <option value="security-engineer">security-engineer (Defense)</option>
                  </optgroup>
                  {roster.filter((a) => a.type === 'federated_guest').length > 0 && (
                    <optgroup label="Federated Guest Agents">
                      {roster.filter((a) => a.type === 'federated_guest').map((fa) => (
                        <option key={fa.id} value={fa.id}>{fa.name} (Sahabat)</option>
                      ))}
                    </optgroup>
                  )}
                </select>
              </div>

              <div>
                <label style={{ fontSize: '0.75rem', color: '#94a3b8', display: 'block', marginBottom: '4px' }}>Prioritas</label>
                <select
                  value={taskPriority}
                  onChange={(e) => setTaskPriority(e.target.value)}
                  style={{ width: '100%', padding: '8px', background: '#0a1120', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '6px', color: '#fff', fontSize: '0.85rem' }}
                >
                  <option value="normal">Normal</option>
                  <option value="high">High (Tinggi)</option>
                  <option value="urgent">Urgent 🔥</option>
                </select>
              </div>
            </div>

            <button
              type="submit"
              style={{ width: '100%', padding: '10px', background: '#00d2ff', color: '#040812', border: 'none', borderRadius: '6px', fontWeight: 800, cursor: 'pointer' }}
            >
              + Buat &amp; Kirim Task ke Kanban
            </button>
            {taskStatus && (
              <div style={{ marginTop: '8px', fontSize: '0.8rem', color: taskStatus.startsWith('✓') ? '#10b981' : '#f43f5e', fontFamily: 'monospace' }}>
                {taskStatus}
              </div>
            )}
          </form>

          {/* Quick Direct Command Dispatcher */}
          <div style={{ marginTop: '16px', paddingTop: '14px', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
            <div style={{ fontSize: '0.82rem', fontWeight: 700, color: '#f59e0b', marginBottom: '6px' }}>⚡ Direct Instruction (Instruksi Cepat)</div>
            <form onSubmit={handleSendInstruction}>
              <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                <select
                  value={instructAgent}
                  onChange={(e) => setInstructAgent(e.target.value)}
                  style={{ width: '130px', padding: '6px', background: '#0a1120', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '6px', color: '#fff', fontSize: '0.78rem' }}
                >
                  <option value="leader">Leader</option>
                  <option value="trend-hunter">Trend Hunter</option>
                  <option value="fullstack-dev">Fullstack Dev</option>
                  <option value="qa-engineer">QA Engineer</option>
                  <option value="security-engineer">Security Eng</option>
                </select>
                <input
                  type="text"
                  placeholder="Perintah instan..."
                  value={instructionText}
                  onChange={(e) => setInstructionText(e.target.value)}
                  style={{ flex: 1, padding: '8px 10px', background: '#0a1120', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '6px', color: '#fff', fontSize: '0.82rem' }}
                />
                <button
                  type="submit"
                  style={{ padding: '8px 14px', background: 'rgba(245, 158, 11, 0.2)', border: '1px solid #f59e0b', color: '#f59e0b', borderRadius: '6px', fontWeight: 700, cursor: 'pointer', fontSize: '0.8rem' }}
                >
                  Kirim
                </button>
              </div>
            </form>
            {instructStatus && <div style={{ fontSize: '0.78rem', color: '#10b981', marginTop: '6px', fontFamily: 'monospace' }}>{instructStatus}</div>}
          </div>
        </div>

        {/* SECTION 3: FRIEND AGENT FEDERATION (INVITE & JOIN) */}
        <div style={{ background: '#0d172a', border: '1px solid rgba(255, 255, 255, 0.08)', borderRadius: '12px', padding: '22px' }}>
          <h2 style={{ fontSize: '1.2rem', fontWeight: 700, marginBottom: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span>🤝</span> 3. Hubungkan Agent Sahabat (Federasi)
          </h2>

          {/* A: Generate Invitation Key */}
          <div style={{ background: '#0a1120', padding: '14px', borderRadius: '8px', marginBottom: '16px', border: '1px solid rgba(168, 85, 247, 0.25)' }}>
            <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#a855f7', marginBottom: '8px' }}>Buat Kunci Undangan Agen Baru</div>
            <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
              <input
                type="text"
                value={inviteLabel}
                onChange={(e) => setInviteLabel(e.target.value)}
                placeholder="Label Undangan..."
                style={{ flex: 2, padding: '6px 10px', background: '#0d172a', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '4px', color: '#fff', fontSize: '0.8rem' }}
              />
              <input
                type="number"
                min="1"
                max="10"
                value={inviteUses}
                onChange={(e) => setInviteUses(Number(e.target.value))}
                style={{ width: '60px', padding: '6px', background: '#0d172a', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '4px', color: '#fff', fontSize: '0.8rem', textAlign: 'center' }}
              />
              <button
                type="button"
                onClick={handleGenerateInvite}
                style={{ padding: '6px 12px', background: '#a855f7', color: '#fff', border: 'none', borderRadius: '4px', fontWeight: 700, cursor: 'pointer', fontSize: '0.78rem' }}
              >
                + Kunci
              </button>
            </div>
            {generatedInviteUrl && (
              <div style={{ background: 'rgba(168, 85, 247, 0.1)', padding: '8px', borderRadius: '4px', border: '1px dashed #a855f7', wordBreak: 'break-all', fontSize: '0.78rem', fontFamily: 'monospace', color: '#e9d5ff' }}>
                KUNCI: {generatedInviteUrl}
              </div>
            )}
            {inviteStatus && <div style={{ fontSize: '0.75rem', color: '#10b981', marginTop: '4px', fontFamily: 'monospace' }}>{inviteStatus}</div>}
          </div>

          {/* B: Friend Agent Registration Form */}
          <form onSubmit={handleJoinAgent}>
            <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#38bdf8', marginBottom: '8px' }}>Formulir Gabung Agen Rekan:</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '8px' }}>
              <input
                type="text"
                placeholder="Kunci Undangan (Key)*"
                value={joinInviteKey}
                onChange={(e) => setJoinInviteKey(e.target.value)}
                required
                style={{ padding: '8px', background: '#0a1120', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '4px', color: '#fff', fontSize: '0.8rem' }}
              />
              <input
                type="text"
                placeholder="Nama Agen (Alfanumerik)*"
                value={joinAgentName}
                onChange={(e) => setJoinAgentName(e.target.value)}
                required
                style={{ padding: '8px', background: '#0a1120', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '4px', color: '#fff', fontSize: '0.8rem' }}
              />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '8px' }}>
              <input
                type="text"
                placeholder="Nama Pemilik / Sahabat"
                value={joinOwnerName}
                onChange={(e) => setJoinOwnerName(e.target.value)}
                style={{ padding: '8px', background: '#0a1120', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '4px', color: '#fff', fontSize: '0.8rem' }}
              />
              <input
                type="text"
                placeholder="Deskripsi Keahlian"
                value={joinDesc}
                onChange={(e) => setJoinDesc(e.target.value)}
                style={{ padding: '8px', background: '#0a1120', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '4px', color: '#fff', fontSize: '0.8rem' }}
              />
            </div>
            <div style={{ marginBottom: '10px', display: 'flex', gap: '8px', alignItems: 'center' }}>
              <input
                type="url"
                placeholder="Webhook URL (opsional, cth: https://bot.teman.com/webhook)"
                value={joinWebhook}
                onChange={(e) => setJoinWebhook(e.target.value)}
                style={{ flex: 1, padding: '8px', background: '#0a1120', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '4px', color: '#fff', fontSize: '0.8rem' }}
              />
              <input
                type="color"
                value={joinColor}
                onChange={(e) => setJoinColor(e.target.value)}
                title="Warna Avatar 3D Agen"
                style={{ width: '40px', height: '36px', background: 'transparent', border: 'none', cursor: 'pointer' }}
              />
            </div>

            <button
              type="submit"
              style={{ width: '100%', padding: '9px', background: 'rgba(56, 189, 248, 0.2)', border: '1px solid #38bdf8', color: '#38bdf8', borderRadius: '6px', fontWeight: 700, cursor: 'pointer', fontSize: '0.85rem' }}
            >
              🚀 Daftarkan Agen Teman ke Company
            </button>
            {joinStatus && (
              <div style={{ marginTop: '8px', fontSize: '0.78rem', color: joinStatus.startsWith('✓') ? '#10b981' : '#f43f5e', fontFamily: 'monospace' }}>
                {joinStatus}
              </div>
            )}
          </form>
        </div>

      </div>

      {/* SECTION 4: LIVE AGENT ROSTER */}
      <div style={{ marginTop: '28px', background: '#0d172a', border: '1px solid rgba(255, 255, 255, 0.08)', borderRadius: '12px', padding: '22px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 800 }}>Daftar Roster Seluruh Agen Perusahaan ({roster.length})</h2>
          <button type="button" onClick={reloadData} style={{ padding: '4px 10px', background: 'transparent', border: '1px solid rgba(255,255,255,0.2)', color: '#fff', borderRadius: '4px', cursor: 'pointer', fontSize: '0.75rem' }}>
            ↻ Refresh Roster
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '14px' }}>
          {roster.map((agt) => (
            <div
              key={agt.id}
              style={{ background: '#0a1120', border: `1px solid ${agt.type === 'federated_guest' ? '#a855f7' : 'rgba(0, 210, 255, 0.3)'}`, borderRadius: '8px', padding: '14px' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                <span style={{ fontWeight: 800, color: agt.color || '#fff', fontSize: '0.95rem' }}>
                  {agt.name}
                </span>
                <span style={{ fontSize: '0.7rem', padding: '2px 6px', borderRadius: '4px', fontFamily: 'monospace', background: agt.type === 'federated_guest' ? 'rgba(168,85,247,0.2)' : 'rgba(0,210,255,0.2)', color: agt.type === 'federated_guest' ? '#e9d5ff' : '#38bdf8' }}>
                  {agt.type === 'federated_guest' ? 'GUEST AGENT' : 'INTERNAL'}
                </span>
              </div>
              <p style={{ fontSize: '0.8rem', color: '#94a3b8', margin: '4px 0 8px', lineHeight: 1.4 }}>
                {agt.role}
              </p>
              {agt.owner && (
                <div style={{ fontSize: '0.72rem', color: '#64748b', fontFamily: 'monospace' }}>
                  Pemilik: <strong>{agt.owner}</strong> &bull; Selesai: {agt.tasksCompleted || 0}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* SECTION 5: DISPATCHED TASKS HISTORY */}
      <div style={{ marginTop: '24px', background: '#0d172a', border: '1px solid rgba(255, 255, 255, 0.08)', borderRadius: '12px', padding: '22px' }}>
        <h2 style={{ fontSize: '1.25rem', fontWeight: 800, marginBottom: '14px' }}>Riwayat Tugas Didelegasikan dari Web ({tasks.length})</h2>
        {tasks.length === 0 ? (
          <p style={{ color: '#64748b', fontSize: '0.88rem' }}>Belum ada tugas yang didelegasikan melalui web interface.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {tasks.map((t) => (
              <div key={t.id} style={{ background: '#0a1120', padding: '12px 16px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.06)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: '0.92rem', color: '#fff' }}>{t.title}</div>
                  <div style={{ fontSize: '0.78rem', color: '#94a3b8' }}>{t.description}</div>
                  <div style={{ fontSize: '0.72rem', color: '#64748b', fontFamily: 'monospace', marginTop: '4px' }}>
                    Assignee: <strong style={{ color: '#38bdf8' }}>{t.assignee}</strong> &bull; Oleh: {t.creatorName} &bull; {new Date(t.createdAt).toLocaleTimeString()}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '0.72rem', padding: '2px 8px', borderRadius: '4px', fontFamily: 'monospace', background: t.priority === 'urgent' ? 'rgba(239, 68, 68, 0.2)' : 'rgba(56, 189, 248, 0.1)', color: t.priority === 'urgent' ? '#ef4444' : '#38bdf8' }}>
                    {t.priority.toUpperCase()}
                  </span>
                  <span style={{ fontSize: '0.72rem', padding: '2px 8px', borderRadius: '4px', fontFamily: 'monospace', background: 'rgba(16, 185, 129, 0.15)', color: '#10b981' }}>
                    {t.status.toUpperCase()}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

    </div>
  )
}
