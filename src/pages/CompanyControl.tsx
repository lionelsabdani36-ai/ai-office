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

function decodeEntities(str: string): string {
  if (!str) return ''
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}

export function CompanyControl() {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('duckvaulta_company_token'))
  const [user, setUser] = useState<UserProfile | null>(null)
  const [roster, setRoster] = useState<AgentRosterItem[]>([])
  const [tasks, setTasks] = useState<DispatchedTaskItem[]>([])

  // Auth Mode: 'operator_key' | 'github' | 'google'
  const [authMode, setAuthMode] = useState<'operator_key' | 'github' | 'google'>('operator_key')
  const [operatorKeyInput, setOperatorKeyInput] = useState('')
  const [operatorNameInput, setOperatorNameInput] = useState('White Jack (Lead Operator)')
  const [authStatus, setAuthStatus] = useState('')
  const [showKey, setShowKey] = useState(false)

  // Task Creation States
  const [taskTitle, setTaskTitle] = useState('')
  const [taskDesc, setTaskDesc] = useState('')
  const [taskAssignee, setTaskAssignee] = useState('leader')
  const [taskPriority, setTaskPriority] = useState('normal')
  const [taskStatus, setTaskStatus] = useState('')

  // Direct Instruction States
  const [instructAgent, setInstructAgent] = useState('leader')
  const [instructionText, setInstructionText] = useState('')
  const [instructStatus, setInstructStatus] = useState('')

  // Invite & Join States
  const [inviteLabel, setInviteLabel] = useState('Undangan Agent Sahabat')
  const [inviteUses, setInviteUses] = useState(1)
  const [generatedInviteUrl, setGeneratedInviteUrl] = useState('')
  const [inviteStatus, setInviteStatus] = useState('')
  const [copiedKey, setCopiedKey] = useState(false)

  // Manual Join Form for Friend's Agent
  const [joinInviteKey, setJoinInviteKey] = useState('')
  const [joinAgentName, setJoinAgentName] = useState('')
  const [joinOwnerName, setJoinOwnerName] = useState('')
  const [joinDesc, setJoinDesc] = useState('')
  const [joinWebhook, setJoinWebhook] = useState('')
  const [joinColor, setJoinColor] = useState('#00d2ff')
  const [joinStatus, setJoinStatus] = useState('')

  // Federated agent ping state
  const [pingStatusMap, setPingStatusMap] = useState<Record<string, string>>({})

  const isOperator = user?.role === 'admin' || user?.role === 'operator'

  // Check current session
  useEffect(() => {
    if (!token) {
      setUser(null)
      return
    }
    fetch('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((d) => {
        if (d.authenticated && d.user) {
          setUser(d.user)
        } else {
          localStorage.removeItem('duckvaulta_company_token')
          setToken(null)
          setUser(null)
        }
      })
      .catch(() => {
        setUser(null)
      })
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

  // Handle Master Operator Key Login
  const handleOperatorKeyLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!operatorKeyInput.trim()) {
      setAuthStatus('Harap masukkan Master Operator Key.')
      return
    }
    setAuthStatus('Memverifikasi Master Operator Key...')
    try {
      const res = await fetch('/api/auth/operator/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key: operatorKeyInput.trim(),
          operatorName: operatorNameInput.trim() || 'White Jack (Lead Operator)',
        }),
      })
      const data = await res.json()
      if (data.success && data.token) {
        localStorage.setItem('duckvaulta_company_token', data.token)
        setToken(data.token)
        setUser(data.user)
        setOperatorKeyInput('')
        setAuthStatus('Autentikasi Operator Berhasil: Akses Penuh Diaktifkan.')
      } else {
        setAuthStatus(`Gagal: ${data.error || 'Kunci operator tidak valid.'}`)
      }
    } catch {
      setAuthStatus('Koneksi ke gateway autentikasi gagal.')
    }
  }

  // Handle Logout
  const handleLogout = () => {
    localStorage.removeItem('duckvaulta_company_token')
    setToken(null)
    setUser(null)
    setAuthStatus('Sesi operator telah ditutup.')
  }

  // Handle Task Creation
  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!isOperator) {
      alert('Akses Ditolak: Hanya Operator atau Admin terverifikasi yang dapat membuat tugas.')
      return
    }
    setTaskStatus('Memvalidasi & mengirimkan task ke tim...')
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
        setTaskStatus('Tugas berhasil didelegasikan dan dicatat di Kanban.')
        setTaskTitle('')
        setTaskDesc('')
        reloadData()
      } else {
        setTaskStatus(`Gagal: ${data.error || 'Terjadi kesalahan sistem'}`)
      }
    } catch {
      setTaskStatus('Gagal menghubungi task dispatcher server.')
    }
  }

  // Handle Direct Instruction
  const handleSendInstruction = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!isOperator) {
      alert('Akses Ditolak: Hanya Operator atau Admin yang dapat mengirim instruksi langsung.')
      return
    }
    setInstructStatus('Mengirim instruksi ke agen...')
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
        setInstructStatus(`Instruksi terkirim ke agen ${instructAgent}.`)
        setInstructionText('')
      } else {
        setInstructStatus(`Gagal: ${data.error}`)
      }
    } catch {
      setInstructStatus('Gagal mengirimkan instruksi ke server.')
    }
  }

  // Handle Generate Invite Key
  const handleGenerateInvite = async () => {
    if (!isOperator) {
      alert('Hanya Operator yang dapat membuat kunci undangan federasi.')
      return
    }
    setInviteStatus('Membuat kunci undangan aman...')
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
        setInviteStatus(`Kunci Undangan aktif: ${data.invite.key}`)
      } else {
        setInviteStatus(`Gagal: ${data.error}`)
      }
    } catch {
      setInviteStatus('Gagal membuat undangan.')
    }
  }

  const copyInviteKey = () => {
    if (!generatedInviteUrl) return
    navigator.clipboard.writeText(generatedInviteUrl).then(() => {
      setCopiedKey(true)
      setTimeout(() => setCopiedKey(false), 2000)
    })
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
          description: joinDesc,
          webhookUrl: joinWebhook,
          color: joinColor,
        }),
      })
      const data = await res.json()
      if (data.success) {
        setJoinStatus(`Berhasil bergabung: ${data.agent.name} aktif di roster!`)
        setJoinInviteKey('')
        setJoinAgentName('')
        setJoinDesc('')
        setJoinWebhook('')
        reloadData()
      } else {
        setJoinStatus(`Gagal: ${data.error}`)
      }
    } catch {
      setJoinStatus('Gagal menghubungi endpoint pendaftaran agen.')
    }
  }

  // Ping Federated Agent Webhook
  const handlePingAgent = async (agentId: string) => {
    setPingStatusMap((prev) => ({ ...prev, [agentId]: 'Pinging...' }))
    try {
      const res = await fetch(`/api/company/agents/${agentId}/ping`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token || ''}` },
      })
      const d = await res.json()
      if (d.success) {
        setPingStatusMap((prev) => ({
          ...prev,
          [agentId]: d.reachable ? `OK (${d.latencyMs}ms)` : `Gagal: ${d.message || 'Offline'}`,
        }))
        reloadData()
      } else {
        setPingStatusMap((prev) => ({ ...prev, [agentId]: `Error: ${d.error}` }))
      }
    } catch {
      setPingStatusMap((prev) => ({ ...prev, [agentId]: 'Unreachable' }))
    }
  }

  // Revoke Federated Agent
  const handleRevokeAgent = async (agentId: string, agentName: string) => {
    if (!isOperator) {
      alert('Hanya Operator/Admin yang dapat mencabut agen.')
      return
    }
    if (!confirm(`Cabut agen ${agentName} dari jaringan federasi?`)) return
    try {
      const res = await fetch(`/api/company/agents/${agentId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      const d = await res.json()
      if (d.success) {
        alert(d.message)
        reloadData()
      } else {
        alert(`Gagal: ${d.error}`)
      }
    } catch {
      alert('Gagal menghubungi server.')
    }
  }

  return (
    <div style={{ padding: '24px 0', maxWidth: '1440px', margin: '0 auto' }}>
      
      {/* Top Banner & Security Status */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '16px', marginBottom: '24px', paddingBottom: '20px', borderBottom: '1px solid rgba(255, 255, 255, 0.08)' }}>
        <div>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '4px 12px', borderRadius: '16px', background: isOperator ? 'rgba(16, 185, 129, 0.1)' : 'rgba(0, 210, 255, 0.08)', border: isOperator ? '1px solid rgba(16, 185, 129, 0.3)' : '1px solid rgba(0, 210, 255, 0.28)', color: isOperator ? '#10b981' : '#00d2ff', fontSize: '0.72rem', fontFamily: 'monospace', fontWeight: 600, letterSpacing: '0.06em', marginBottom: '10px' }}>
            <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: isOperator ? '#10b981' : '#00d2ff', boxShadow: isOperator ? '0 0 8px #10b981' : '0 0 8px #00d2ff' }} />
            {isOperator ? 'OPERATOR MODE AKTIF (AKSES PENUH)' : 'MODE BACA (GUEST READ-ONLY)'}
          </div>
          <h1 style={{ fontSize: '2rem', fontWeight: 800, color: '#ffffff', letterSpacing: '-0.02em', margin: 0, marginBottom: '6px' }}>
            AI Company Command Center
          </h1>
          <p style={{ color: '#94a3b8', fontSize: '0.92rem', margin: 0, maxWidth: '640px', lineHeight: 1.55 }}>
            {isOperator
              ? 'Sesi operator terverifikasi: delegasi tugas ke tim AI, eksekusi instruksi langsung, dan manajemen federasi agen.'
              : 'Mode tamu: Anda dapat melihat status dan riwayat tugas. Masukkan Master Operator Key untuk membuka kontrol delegasi.'}
          </p>
        </div>

        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '0.74rem', fontFamily: 'monospace', background: 'rgba(16, 185, 129, 0.08)', color: '#10b981', border: '1px solid rgba(16, 185, 129, 0.25)', padding: '6px 12px', borderRadius: '6px', fontWeight: 600 }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
            RBAC: STRICT OPERATOR GATE
          </div>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '0.74rem', fontFamily: 'monospace', background: 'rgba(0, 210, 255, 0.08)', color: '#00d2ff', border: '1px solid rgba(0, 210, 255, 0.25)', padding: '6px 12px', borderRadius: '6px', fontWeight: 600 }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
            HMAC-SHA256 SESSION
          </div>
        </div>
      </div>

      {/* 3 Main Action Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: '24px', marginBottom: '32px' }}>
        
        {/* CARD 1: OPERATOR AUTHENTICATION */}
        <div style={{ background: '#0a1122', border: isOperator ? '1px solid rgba(16, 185, 129, 0.4)' : '1px solid rgba(255, 255, 255, 0.08)', borderRadius: '12px', padding: '24px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', boxShadow: '0 8px 24px rgba(0, 0, 0, 0.3)' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' }}>
              <div style={{ width: '36px', height: '36px', borderRadius: '8px', background: isOperator ? 'rgba(16, 185, 129, 0.15)' : 'rgba(0, 210, 255, 0.1)', border: isOperator ? '1px solid rgba(16, 185, 129, 0.35)' : '1px solid rgba(0, 210, 255, 0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: isOperator ? '#10b981' : '#00d2ff' }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6M15.5 7.5l3 3M18.5 4.5l3 3"/></svg>
              </div>
              <h2 style={{ fontSize: '1.15rem', fontWeight: 700, color: '#ffffff', margin: 0 }}>
                1. Autentikasi Operator
              </h2>
            </div>

            {!user || !isOperator ? (
              <div>
                {/* Auth Mode Tabs */}
                <div style={{ display: 'flex', gap: '6px', marginBottom: '14px', borderBottom: '1px solid rgba(255, 255, 255, 0.08)', paddingBottom: '4px' }}>
                  <button
                    type="button"
                    onClick={() => setAuthMode('operator_key')}
                    style={{ background: 'transparent', border: 'none', borderBottom: authMode === 'operator_key' ? '2px solid #00d2ff' : '2px solid transparent', color: authMode === 'operator_key' ? '#00d2ff' : '#94a3b8', padding: '6px 10px', fontSize: '0.78rem', fontFamily: 'monospace', fontWeight: 600, cursor: 'pointer' }}
                  >
                    Operator Passkey
                  </button>
                  <button
                    type="button"
                    onClick={() => setAuthMode('github')}
                    style={{ background: 'transparent', border: 'none', borderBottom: authMode === 'github' ? '2px solid #00d2ff' : '2px solid transparent', color: authMode === 'github' ? '#00d2ff' : '#94a3b8', padding: '6px 10px', fontSize: '0.78rem', fontFamily: 'monospace', fontWeight: 600, cursor: 'pointer' }}
                  >
                    GitHub OAuth
                  </button>
                  <button
                    type="button"
                    onClick={() => setAuthMode('google')}
                    style={{ background: 'transparent', border: 'none', borderBottom: authMode === 'google' ? '2px solid #00d2ff' : '2px solid transparent', color: authMode === 'google' ? '#00d2ff' : '#94a3b8', padding: '6px 10px', fontSize: '0.78rem', fontFamily: 'monospace', fontWeight: 600, cursor: 'pointer' }}
                  >
                    Google OAuth
                  </button>
                </div>

                {authMode === 'operator_key' && (
                  <form onSubmit={handleOperatorKeyLogin}>
                    <p style={{ color: '#94a3b8', fontSize: '0.82rem', marginBottom: '12px', lineHeight: 1.5 }}>
                      Masukkan Master Operator Key untuk mengaktifkan izin penuh delegasi task:
                    </p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '14px' }}>
                      <div style={{ position: 'relative' }}>
                        <input
                          type={showKey ? 'text' : 'password'}
                          placeholder="Master Operator Key..."
                          value={operatorKeyInput}
                          onChange={(e) => setOperatorKeyInput(e.target.value)}
                          required
                          style={{ width: '100%', minHeight: '44px', padding: '10px 42px 10px 14px', background: '#060913', border: '1px solid rgba(255, 255, 255, 0.12)', borderRadius: '6px', color: '#ffffff', fontSize: '0.88rem', boxSizing: 'border-box' }}
                        />
                        <button
                          type="button"
                          onClick={() => setShowKey(!showKey)}
                          style={{ position: 'absolute', right: '10px', top: '10px', background: 'transparent', border: 'none', color: '#8092a8', cursor: 'pointer', fontSize: '0.75rem', fontFamily: 'monospace' }}
                        >
                          {showKey ? 'SEMBUNYIKAN' : 'LIHAT'}
                        </button>
                      </div>
                      <input
                        type="text"
                        placeholder="Nama Identitas Operator"
                        value={operatorNameInput}
                        onChange={(e) => setOperatorNameInput(e.target.value)}
                        style={{ width: '100%', minHeight: '44px', padding: '10px 14px', background: '#060913', border: '1px solid rgba(255, 255, 255, 0.12)', borderRadius: '6px', color: '#ffffff', fontSize: '0.88rem', boxSizing: 'border-box' }}
                      />
                    </div>
                    <button
                      type="submit"
                      style={{ width: '100%', minHeight: '44px', padding: '10px', background: '#00d2ff', color: '#060913', border: 'none', borderRadius: '6px', fontWeight: 800, fontSize: '0.88rem', cursor: 'pointer', transition: 'all 0.2s' }}
                    >
                      Masuk sebagai Lead Operator
                    </button>
                  </form>
                )}

                {authMode === 'github' && (
                  <div>
                    <p style={{ color: '#94a3b8', fontSize: '0.82rem', marginBottom: '14px', lineHeight: 1.5 }}>
                      Otentikasi aman menggunakan akun GitHub terdaftar. Akun tim resmi (lnell19) otomatis memperoleh status Administrator.
                    </p>
                    <a
                      href="/api/auth/oauth/github?redirect=https://aicompany.duckvaulta.ai.id/#/dispatch-team"
                      style={{ width: '100%', minHeight: '44px', padding: '10px', background: '#1f242c', color: '#ffffff', border: '1px solid rgba(255, 255, 255, 0.2)', borderRadius: '6px', fontWeight: 700, fontSize: '0.85rem', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', textDecoration: 'none', boxSizing: 'border-box' }}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/></svg>
                      Lanjutkan dengan GitHub
                    </a>
                  </div>
                )}

                {authMode === 'google' && (
                  <div>
                    <p style={{ color: '#94a3b8', fontSize: '0.82rem', marginBottom: '14px', lineHeight: 1.5 }}>
                      Otentikasi aman menggunakan akun Google terverifikasi. Akun pemilik (lionelsabdani36@gmail.com) memperoleh status Operator.
                    </p>
                    <a
                      href="/api/auth/oauth/google?redirect=https://aicompany.duckvaulta.ai.id/#/dispatch-team"
                      style={{ width: '100%', minHeight: '44px', padding: '10px', background: '#ea4335', color: '#ffffff', border: 'none', borderRadius: '6px', fontWeight: 700, fontSize: '0.85rem', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', textDecoration: 'none', boxSizing: 'border-box' }}
                    >
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M12.48 10.92v3.28h7.84c-.24 1.84-.853 3.187-1.787 4.133-1.147 1.147-2.933 2.4-6.053 2.4-4.827 0-8.6-3.893-8.6-8.72s3.773-8.72 8.6-8.72c2.6 0 4.507 1.027 5.907 2.347l2.307-2.307C18.747 1.44 16.133 0 12.48 0 5.867 0 .307 5.387.307 12s5.56 12 12.173 12c3.573 0 6.267-1.173 8.373-3.36 2.16-2.16 2.84-5.213 2.84-7.667 0-.76-.053-1.467-.173-2.053H12.48z"/></svg>
                      Lanjutkan dengan Google
                    </a>
                  </div>
                )}

                {authStatus && (
                  <div style={{ marginTop: '12px', fontSize: '0.8rem', color: authStatus.includes('Berhasil') ? '#10b981' : '#f87171', fontFamily: 'monospace', padding: '8px 10px', borderRadius: '4px', background: 'rgba(255, 255, 255, 0.03)' }}>
                    {authStatus}
                  </div>
                )}
              </div>
            ) : (
              <div style={{ background: '#060913', padding: '18px', borderRadius: '8px', border: '1px solid rgba(16, 185, 129, 0.35)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '14px' }}>
                  <div style={{ width: '44px', height: '44px', borderRadius: '8px', background: '#10b981', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, color: '#060913', fontSize: '1.1rem' }}>
                    {user.name.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '0.98rem', color: '#ffffff' }}>{user.name}</div>
                    <div style={{ fontSize: '0.78rem', color: '#94a3b8', fontFamily: 'monospace' }}>{user.email}</div>
                  </div>
                  <span style={{ marginLeft: 'auto', fontSize: '0.7rem', background: 'rgba(16, 185, 129, 0.15)', color: '#10b981', padding: '3px 8px', borderRadius: '4px', textTransform: 'uppercase', fontFamily: 'monospace', fontWeight: 600, border: '1px solid rgba(16, 185, 129, 0.35)' }}>
                    {user.role}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={handleLogout}
                  style={{ width: '100%', minHeight: '40px', padding: '8px', background: 'transparent', border: '1px solid rgba(244, 63, 94, 0.4)', color: '#f87171', borderRadius: '6px', fontSize: '0.82rem', cursor: 'pointer', fontWeight: 600, transition: 'all 0.2s' }}
                >
                  Sign Out (Keluar Sesi)
                </button>
              </div>
            )}
          </div>
          <div style={{ marginTop: '16px', paddingTop: '12px', borderTop: '1px solid rgba(255, 255, 255, 0.06)', fontSize: '0.74rem', color: isOperator ? '#10b981' : '#8092a8', fontFamily: 'monospace' }}>
            STATUS: {isOperator ? 'OPERATOR TERVERIFIKASI (AKSES PENUH)' : 'MODE BACA (GUEST)'}
          </div>
        </div>

        {/* CARD 2: DISPATCH TASK & INSTRUCTION */}
        <div style={{ background: '#0a1122', border: '1px solid rgba(255, 255, 255, 0.08)', borderRadius: '12px', padding: '24px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', boxShadow: '0 8px 24px rgba(0, 0, 0, 0.3)' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' }}>
              <div style={{ width: '36px', height: '36px', borderRadius: '8px', background: 'rgba(0, 210, 255, 0.1)', border: '1px solid rgba(0, 210, 255, 0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#00d2ff' }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/></svg>
              </div>
              <h2 style={{ fontSize: '1.15rem', fontWeight: 700, color: '#ffffff', margin: 0 }}>
                2. Delegasikan Tugas &amp; Instruksi
              </h2>
            </div>

            {!isOperator ? (
              <div style={{ background: 'rgba(239, 68, 68, 0.08)', border: '1px solid rgba(239, 68, 68, 0.25)', borderRadius: '8px', padding: '16px', marginBottom: '16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#f87171', fontWeight: 700, fontSize: '0.85rem', marginBottom: '6px' }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                  Akses Delegasi Terkunci
                </div>
                <p style={{ color: '#94a3b8', fontSize: '0.8rem', lineHeight: 1.5, margin: 0 }}>
                  Hanya Operator atau Administrator terverifikasi yang diizinkan untuk mendelegasikan tugas ke tim AI. Masukkan Master Operator Key di Card 1 untuk membuka akses.
                </p>
              </div>
            ) : null}

            <form onSubmit={handleCreateTask}>
              <div style={{ marginBottom: '10px' }}>
                <input
                  type="text"
                  placeholder="Judul Tugas (3-120 karakter)..."
                  value={taskTitle}
                  onChange={(e) => setTaskTitle(e.target.value)}
                  disabled={!isOperator}
                  maxLength={120}
                  required
                  style={{ width: '100%', minHeight: '44px', padding: '10px 14px', background: '#060913', border: '1px solid rgba(255, 255, 255, 0.12)', borderRadius: '6px', color: '#ffffff', fontSize: '0.88rem', boxSizing: 'border-box', opacity: !isOperator ? 0.6 : 1 }}
                />
              </div>
              <div style={{ marginBottom: '10px' }}>
                <textarea
                  placeholder="Rincian deskripsi tugas & instruksi teknis (5-1500 karakter)..."
                  value={taskDesc}
                  onChange={(e) => setTaskDesc(e.target.value)}
                  disabled={!isOperator}
                  maxLength={1500}
                  required
                  rows={2}
                  style={{ width: '100%', padding: '10px 14px', background: '#060913', border: '1px solid rgba(255, 255, 255, 0.12)', borderRadius: '6px', color: '#ffffff', fontSize: '0.85rem', boxSizing: 'border-box', minHeight: '60px', opacity: !isOperator ? 0.6 : 1 }}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '14px' }}>
                <div>
                  <label style={{ fontSize: '0.74rem', color: '#94a3b8', display: 'block', marginBottom: '4px', fontFamily: 'monospace' }}>TARGET AGEN</label>
                  <select
                    value={taskAssignee}
                    onChange={(e) => setTaskAssignee(e.target.value)}
                    disabled={!isOperator}
                    style={{ width: '100%', minHeight: '40px', padding: '6px 10px', background: '#060913', border: '1px solid rgba(255, 255, 255, 0.12)', borderRadius: '6px', color: '#ffffff', fontSize: '0.82rem', opacity: !isOperator ? 0.6 : 1 }}
                  >
                    <optgroup label="Internal AI Team (Nyawit)">
                      <option value="leader">David (Chief Agent)</option>
                      <option value="trend-hunter">Charlie (Intelligence)</option>
                      <option value="fullstack-dev">Alex (Engineering)</option>
                      <option value="qa-engineer">Julius (Quality &amp; UX)</option>
                      <option value="security-engineer">Athena (Defense)</option>
                      <option value="guru">Judith (Guru &amp; Knowledge)</option>
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
                  <label style={{ fontSize: '0.74rem', color: '#94a3b8', display: 'block', marginBottom: '4px', fontFamily: 'monospace' }}>PRIORITAS</label>
                  <select
                    value={taskPriority}
                    onChange={(e) => setTaskPriority(e.target.value)}
                    disabled={!isOperator}
                    style={{ width: '100%', minHeight: '40px', padding: '6px 10px', background: '#060913', border: '1px solid rgba(255, 255, 255, 0.12)', borderRadius: '6px', color: '#ffffff', fontSize: '0.82rem', opacity: !isOperator ? 0.6 : 1 }}
                  >
                    <option value="normal">Normal</option>
                    <option value="high">High (Tinggi)</option>
                    <option value="urgent">Urgent</option>
                  </select>
                </div>
              </div>

              <button
                type="submit"
                disabled={!isOperator}
                style={{ width: '100%', minHeight: '44px', padding: '10px', background: isOperator ? '#00d2ff' : 'rgba(255, 255, 255, 0.1)', color: isOperator ? '#060913' : '#8092a8', border: 'none', borderRadius: '6px', fontWeight: 800, fontSize: '0.85rem', cursor: isOperator ? 'pointer' : 'not-allowed', transition: 'all 0.2s ease' }}
              >
                Kirim Task ke Kanban Board
              </button>
              {taskStatus && (
                <div style={{ marginTop: '8px', fontSize: '0.8rem', color: taskStatus.startsWith('Gagal') ? '#f87171' : '#10b981', fontFamily: 'monospace', padding: '4px 8px' }}>
                  {taskStatus}
                </div>
              )}
            </form>
          </div>

          {/* Quick Direct Command Dispatcher */}
          <div style={{ marginTop: '16px', paddingTop: '14px', borderTop: '1px solid rgba(255, 255, 255, 0.08)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.78rem', fontWeight: 700, color: '#f59e0b', marginBottom: '8px', fontFamily: 'monospace' }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
              DIRECT INSTRUCTION (INSTAN)
            </div>
            <form onSubmit={handleSendInstruction}>
              <div style={{ display: 'flex', gap: '8px' }}>
                <select
                  value={instructAgent}
                  onChange={(e) => setInstructAgent(e.target.value)}
                  disabled={!isOperator}
                  style={{ width: '115px', minHeight: '38px', padding: '6px 8px', background: '#060913', border: '1px solid rgba(255, 255, 255, 0.12)', borderRadius: '6px', color: '#ffffff', fontSize: '0.78rem', opacity: !isOperator ? 0.6 : 1 }}
                >
                  <option value="leader">David</option>
                  <option value="trend-hunter">Charlie</option>
                  <option value="fullstack-dev">Alex</option>
                  <option value="qa-engineer">Julius</option>
                  <option value="security-engineer">Athena</option>
                  <option value="guru">Judith</option>
                </select>
                <input
                  type="text"
                  placeholder="Instruksi langsung..."
                  value={instructionText}
                  onChange={(e) => setInstructionText(e.target.value)}
                  disabled={!isOperator}
                  style={{ flex: 1, minHeight: '38px', padding: '6px 10px', background: '#060913', border: '1px solid rgba(255, 255, 255, 0.12)', borderRadius: '6px', color: '#ffffff', fontSize: '0.8rem', opacity: !isOperator ? 0.6 : 1 }}
                />
                <button
                  type="submit"
                  disabled={!isOperator}
                  style={{ minHeight: '38px', padding: '0 14px', background: isOperator ? 'rgba(245, 158, 11, 0.15)' : 'rgba(255,255,255,0.05)', border: isOperator ? '1px solid #f59e0b' : '1px solid rgba(255,255,255,0.1)', color: isOperator ? '#f59e0b' : '#8092a8', borderRadius: '6px', fontWeight: 700, cursor: isOperator ? 'pointer' : 'not-allowed', fontSize: '0.78rem' }}
                >
                  Kirim
                </button>
              </div>
            </form>
            {instructStatus && <div style={{ fontSize: '0.75rem', color: instructStatus.startsWith('Gagal') ? '#f87171' : '#10b981', marginTop: '6px', fontFamily: 'monospace' }}>{instructStatus}</div>}
          </div>
        </div>

        {/* CARD 3: FRIEND AGENT FEDERATION */}
        <div style={{ background: '#0a1122', border: '1px solid rgba(255, 255, 255, 0.08)', borderRadius: '12px', padding: '24px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', boxShadow: '0 8px 24px rgba(0, 0, 0, 0.3)' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' }}>
              <div style={{ width: '36px', height: '36px', borderRadius: '8px', background: 'rgba(0, 210, 255, 0.1)', border: '1px solid rgba(0, 210, 255, 0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#00d2ff' }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>
              </div>
              <h2 style={{ fontSize: '1.15rem', fontWeight: 700, color: '#ffffff', margin: 0 }}>
                3. Hubungkan Agent Sahabat
              </h2>
            </div>

            {/* A: Generate Invitation Key */}
            <div style={{ background: '#060913', padding: '14px', borderRadius: '8px', marginBottom: '16px', border: '1px solid rgba(0, 210, 255, 0.2)' }}>
              <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#00d2ff', marginBottom: '8px', fontFamily: 'monospace' }}>BUAT KUNCI UNDANGAN FEDERASI</div>
              <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                <input
                  type="text"
                  value={inviteLabel}
                  onChange={(e) => setInviteLabel(e.target.value)}
                  placeholder="Label Undangan..."
                  disabled={!isOperator}
                  style={{ flex: 2, minHeight: '38px', padding: '6px 10px', background: '#0a1122', border: '1px solid rgba(255, 255, 255, 0.12)', borderRadius: '4px', color: '#ffffff', fontSize: '0.8rem', opacity: !isOperator ? 0.6 : 1 }}
                />
                <input
                  type="number"
                  min="1"
                  max="10"
                  value={inviteUses}
                  onChange={(e) => setInviteUses(Number(e.target.value))}
                  disabled={!isOperator}
                  style={{ width: '56px', minHeight: '38px', padding: '6px', background: '#0a1122', border: '1px solid rgba(255, 255, 255, 0.12)', borderRadius: '4px', color: '#ffffff', fontSize: '0.8rem', textAlign: 'center', opacity: !isOperator ? 0.6 : 1 }}
                />
                <button
                  type="button"
                  onClick={handleGenerateInvite}
                  disabled={!isOperator}
                  style={{ minHeight: '38px', padding: '0 12px', background: isOperator ? '#00d2ff' : 'rgba(255, 255, 255, 0.1)', color: isOperator ? '#060913' : '#8092a8', border: 'none', borderRadius: '4px', fontWeight: 700, cursor: isOperator ? 'pointer' : 'not-allowed', fontSize: '0.78rem' }}
                >
                  Generate
                </button>
              </div>
              {generatedInviteUrl && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(0, 210, 255, 0.08)', padding: '8px 10px', borderRadius: '4px', border: '1px dashed #00d2ff', wordBreak: 'break-all', fontSize: '0.74rem', fontFamily: 'monospace', color: '#ffffff' }}>
                  <span>KUNCI: {generatedInviteUrl}</span>
                  <button type="button" onClick={copyInviteKey} style={{ background: 'transparent', border: 'none', color: '#00d2ff', cursor: 'pointer', fontWeight: 700, marginLeft: '8px' }}>
                    {copiedKey ? 'Tersalin' : 'Salin'}
                  </button>
                </div>
              )}
              {inviteStatus && <div style={{ fontSize: '0.75rem', color: inviteStatus.startsWith('Gagal') ? '#f87171' : '#10b981', marginTop: '4px', fontFamily: 'monospace' }}>{inviteStatus}</div>}
            </div>

            {/* B: Friend Agent Registration Form */}
            <form onSubmit={handleJoinAgent}>
              <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#38bdf8', marginBottom: '8px', fontFamily: 'monospace' }}>DAFTARKAN AGEN REKAN:</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '8px' }}>
                <input
                  type="text"
                  placeholder="Kunci Undangan*"
                  value={joinInviteKey}
                  onChange={(e) => setJoinInviteKey(e.target.value)}
                  required
                  style={{ minHeight: '38px', padding: '8px', background: '#060913', border: '1px solid rgba(255, 255, 255, 0.12)', borderRadius: '4px', color: '#ffffff', fontSize: '0.8rem' }}
                />
                <input
                  type="text"
                  placeholder="Nama Agen*"
                  value={joinAgentName}
                  onChange={(e) => setJoinAgentName(e.target.value)}
                  required
                  style={{ minHeight: '38px', padding: '8px', background: '#060913', border: '1px solid rgba(255, 255, 255, 0.12)', borderRadius: '4px', color: '#ffffff', fontSize: '0.8rem' }}
                />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '8px' }}>
                <input
                  type="text"
                  placeholder="Pemilik / Operator"
                  value={joinOwnerName}
                  onChange={(e) => setJoinOwnerName(e.target.value)}
                  style={{ minHeight: '38px', padding: '8px', background: '#060913', border: '1px solid rgba(255, 255, 255, 0.12)', borderRadius: '4px', color: '#ffffff', fontSize: '0.8rem' }}
                />
                <input
                  type="text"
                  placeholder="Deskripsi Keahlian"
                  value={joinDesc}
                  onChange={(e) => setJoinDesc(e.target.value)}
                  style={{ minHeight: '38px', padding: '8px', background: '#060913', border: '1px solid rgba(255, 255, 255, 0.12)', borderRadius: '4px', color: '#ffffff', fontSize: '0.8rem' }}
                />
              </div>
              <div style={{ marginBottom: '10px', display: 'flex', gap: '8px', alignItems: 'center' }}>
                <input
                  type="url"
                  placeholder="Webhook URL (opsional, cth: https://bot.teman.com/webhook)"
                  value={joinWebhook}
                  onChange={(e) => setJoinWebhook(e.target.value)}
                  style={{ flex: 1, minHeight: '38px', padding: '8px', background: '#060913', border: '1px solid rgba(255, 255, 255, 0.12)', borderRadius: '4px', color: '#ffffff', fontSize: '0.8rem' }}
                />
                <input
                  type="color"
                  value={joinColor}
                  onChange={(e) => setJoinColor(e.target.value)}
                  title="Warna Avatar 3D Agen"
                  style={{ width: '40px', height: '38px', background: 'transparent', border: 'none', cursor: 'pointer' }}
                />
              </div>

              <button
                type="submit"
                style={{ width: '100%', minHeight: '42px', padding: '8px', background: 'rgba(0, 210, 255, 0.15)', border: '1px solid #00d2ff', color: '#00d2ff', borderRadius: '6px', fontWeight: 700, cursor: 'pointer', fontSize: '0.82rem', transition: 'all 0.2s' }}
              >
                Daftarkan Agen Rekan ke Kompi
              </button>
              {joinStatus && (
                <div style={{ marginTop: '8px', fontSize: '0.78rem', color: joinStatus.startsWith('Gagal') ? '#f87171' : '#10b981', fontFamily: 'monospace' }}>
                  {joinStatus}
                </div>
              )}
            </form>
          </div>
          <div style={{ marginTop: '16px', paddingTop: '12px', borderTop: '1px solid rgba(255, 255, 255, 0.06)', fontSize: '0.74rem', color: '#8092a8', fontFamily: 'monospace' }}>
            PROTOKOL: WEBHOOK SIGNED HMAC &amp; SSRF DEFENSE
          </div>
        </div>

      </div>

      {/* SECTION 4: LIVE AGENT ROSTER */}
      <div style={{ background: '#0a1122', border: '1px solid rgba(255, 255, 255, 0.08)', borderRadius: '12px', padding: '24px', marginBottom: '28px', boxShadow: '0 8px 24px rgba(0, 0, 0, 0.3)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px', flexWrap: 'wrap', gap: '10px' }}>
          <div>
            <div style={{ fontSize: '0.72rem', fontFamily: 'monospace', color: '#00d2ff', fontWeight: 600, letterSpacing: '0.06em' }}>ENTERPRISE ROSTER MATRIX</div>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 800, color: '#ffffff', margin: '4px 0 0 0' }}>
              Roster Seluruh Agen Kompi ({roster.length})
            </h2>
          </div>
          <button type="button" onClick={reloadData} style={{ minHeight: '36px', padding: '6px 14px', background: 'rgba(255, 255, 255, 0.05)', border: '1px solid rgba(255, 255, 255, 0.15)', color: '#ffffff', borderRadius: '6px', cursor: 'pointer', fontSize: '0.76rem', fontFamily: 'monospace', fontWeight: 600 }}>
            Sinkronkan Roster
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px' }}>
          {roster.map((agt) => (
            <div
              key={agt.id}
              style={{ background: '#060913', border: `1px solid ${agt.type === 'federated_guest' ? 'rgba(168, 85, 247, 0.4)' : 'rgba(0, 210, 255, 0.25)'}`, borderRadius: '8px', padding: '16px', position: 'relative' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                <span style={{ fontWeight: 800, color: agt.color || '#ffffff', fontSize: '0.98rem' }}>
                  {agt.name}
                </span>
                <span style={{ fontSize: '0.68rem', padding: '3px 8px', borderRadius: '4px', fontFamily: 'monospace', fontWeight: 600, background: agt.type === 'federated_guest' ? 'rgba(168, 85, 247, 0.15)' : 'rgba(0, 210, 255, 0.12)', color: agt.type === 'federated_guest' ? '#c084fc' : '#00d2ff', border: `1px solid ${agt.type === 'federated_guest' ? 'rgba(168, 85, 247, 0.3)' : 'rgba(0, 210, 255, 0.3)'}` }}>
                  {agt.type === 'federated_guest' ? 'GUEST AGENT' : 'INTERNAL'}
                </span>
              </div>
              <p style={{ fontSize: '0.82rem', color: '#94a3b8', margin: '4px 0 10px', lineHeight: 1.5 }}>
                {agt.role}
              </p>
              {agt.owner && (
                <div style={{ fontSize: '0.72rem', color: '#8092a8', fontFamily: 'monospace', borderTop: '1px solid rgba(255, 255, 255, 0.06)', paddingTop: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '6px' }}>
                  <span>Pemilik: <strong style={{ color: '#ffffff' }}>{agt.owner}</strong></span>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <button
                      type="button"
                      onClick={() => handlePingAgent(agt.id)}
                      style={{ padding: '3px 8px', background: 'rgba(0, 210, 255, 0.12)', border: '1px solid rgba(0, 210, 255, 0.3)', color: '#00d2ff', borderRadius: '4px', cursor: 'pointer', fontSize: '0.7rem' }}
                    >
                      {pingStatusMap[agt.id] || 'Ping Webhook'}
                    </button>
                    {isOperator && (
                      <button
                        type="button"
                        onClick={() => handleRevokeAgent(agt.id, agt.name)}
                        style={{ padding: '3px 8px', background: 'rgba(239, 68, 68, 0.12)', border: '1px solid rgba(239, 68, 68, 0.3)', color: '#f87171', borderRadius: '4px', cursor: 'pointer', fontSize: '0.7rem' }}
                      >
                        Cabut
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* SECTION 5: DISPATCHED TASKS HISTORY */}
      <div style={{ background: '#0a1122', border: '1px solid rgba(255, 255, 255, 0.08)', borderRadius: '12px', padding: '24px', boxShadow: '0 8px 24px rgba(0, 0, 0, 0.3)' }}>
        <div style={{ fontSize: '0.72rem', fontFamily: 'monospace', color: '#f59e0b', fontWeight: 600, letterSpacing: '0.06em' }}>AUDIT &amp; TASK DISPATCH TRAIL</div>
        <h2 style={{ fontSize: '1.25rem', fontWeight: 800, color: '#ffffff', margin: '4px 0 16px 0' }}>
          Riwayat Tugas Didelegasikan dari Web ({tasks.length})
        </h2>
        
        {tasks.length === 0 ? (
          <p style={{ color: '#8092a8', fontSize: '0.88rem', margin: 0 }}>Belum ada tugas yang didelegasikan melalui web interface.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {tasks.map((t) => (
              <div
                key={t.id}
                style={{
                  background: '#060913',
                  padding: '16px 20px',
                  borderRadius: '8px',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                  gap: '16px',
                  minWidth: 0,
                  overflow: 'hidden',
                  boxShadow: '0 2px 8px rgba(0, 0, 0, 0.25)',
                }}
              >
                <div style={{ minWidth: 0, flex: 1, overflowWrap: 'anywhere', wordBreak: 'break-word' }}>
                  <div style={{ fontWeight: 700, fontSize: '0.94rem', color: '#ffffff', marginBottom: '4px', overflowWrap: 'anywhere', wordBreak: 'break-word' }}>
                    {decodeEntities(t.title)}
                  </div>
                  <div style={{ fontSize: '0.82rem', color: '#94a3b8', lineHeight: 1.5, overflowWrap: 'anywhere', wordBreak: 'break-word' }}>
                    {decodeEntities(t.description)}
                  </div>
                  <div style={{ fontSize: '0.72rem', color: '#8092a8', fontFamily: 'monospace', marginTop: '8px' }}>
                    Assignee: <strong style={{ color: '#00d2ff' }}>{t.assignee}</strong> &bull; Pembuat: {t.creatorName} &bull; {new Date(t.createdAt).toLocaleTimeString()}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                  <span style={{ fontSize: '0.7rem', padding: '3px 8px', borderRadius: '4px', fontFamily: 'monospace', fontWeight: 600, background: t.priority === 'urgent' ? 'rgba(239, 68, 68, 0.15)' : 'rgba(0, 210, 255, 0.1)', color: t.priority === 'urgent' ? '#f87171' : '#00d2ff', border: `1px solid ${t.priority === 'urgent' ? 'rgba(239, 68, 68, 0.3)' : 'rgba(0, 210, 255, 0.25)'}` }}>
                    {t.priority.toUpperCase()}
                  </span>
                  <span style={{ fontSize: '0.7rem', padding: '3px 8px', borderRadius: '4px', fontFamily: 'monospace', fontWeight: 600, background: 'rgba(16, 185, 129, 0.12)', color: '#10b981', border: '1px solid rgba(16, 185, 129, 0.25)' }}>
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
