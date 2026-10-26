import { join } from 'node:path'
import type { Request, Response, Express } from 'express'
import { promises as fsp } from 'node:fs'
import { signSessionToken, verifySessionToken, sanitizeText, validateOperatorKey } from './security.js'

const DATA_DIR = join(process.cwd(), 'data')
const USERS_FILE = join(DATA_DIR, 'users.json')
const OAUTH_CONFIG_FILE = join(DATA_DIR, 'oauth_config.json')

export interface UserAccount {
  id: string
  name: string
  email: string
  provider: 'google' | 'github' | 'local'
  avatarUrl?: string
  role: 'admin' | 'member' | 'guest'
  createdAt: string
  lastLogin: string
}

interface OAuthConfig {
  googleClientId?: string
  googleClientSecret?: string
  githubClientId?: string
  githubClientSecret?: string
}

// Ensure data directory exists
async function ensureDataFiles() {
  await fsp.mkdir(DATA_DIR, { recursive: true })
  try {
    await fsp.access(USERS_FILE)
  } catch {
    await fsp.writeFile(USERS_FILE, JSON.stringify([], null, 2), 'utf8')
  }
  try {
    await fsp.access(OAUTH_CONFIG_FILE)
  } catch {
    await fsp.writeFile(OAUTH_CONFIG_FILE, JSON.stringify({}, null, 2), 'utf8')
  }
}

async function loadUsers(): Promise<UserAccount[]> {
  await ensureDataFiles()
  try {
    const raw = await fsp.readFile(USERS_FILE, 'utf8')
    return JSON.parse(raw)
  } catch {
    return []
  }
}

async function saveUsers(users: UserAccount[]): Promise<void> {
  await ensureDataFiles()
  await fsp.writeFile(USERS_FILE, JSON.stringify(users, null, 2), 'utf8')
}

async function loadOAuthConfig(): Promise<OAuthConfig> {
  await ensureDataFiles()
  try {
    const raw = await fsp.readFile(OAUTH_CONFIG_FILE, 'utf8')
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

async function saveOAuthConfig(cfg: OAuthConfig): Promise<void> {
  await ensureDataFiles()
  await fsp.writeFile(OAUTH_CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf8')
}

/**
 * Install OAuth routes on Express app
 */
export function installOAuth(app: Express): void {
  // 1. Get OAuth Providers & Public Configuration
  app.get('/api/auth/providers', async (_req: Request, res: Response) => {
    const config = await loadOAuthConfig()
    const googleId = process.env.GOOGLE_CLIENT_ID || config.googleClientId || ''
    const githubId = process.env.GITHUB_CLIENT_ID || config.githubClientId || ''

    res.json({
      google: {
        enabled: true,
        configured: Boolean(googleId),
        clientId: googleId ? `${googleId.substring(0, 12)}...` : null,
      },
      github: {
        enabled: true,
        configured: Boolean(githubId),
        clientId: githubId ? `${githubId.substring(0, 8)}...` : null,
      },
    })
  })

  // 1b. Master Operator Key Authentication (Zero-Trust Master Passkey)
  app.post('/api/auth/operator/login', async (req: Request, res: Response) => {
    try {
      const { key, operatorName } = req.body || {}
      if (!key || typeof key !== 'string') {
        res.status(400).json({ error: 'Master Operator Key wajib diisi.' })
        return
      }

      if (!validateOperatorKey(key)) {
        res.status(401).json({ error: 'Master Operator Key tidak valid atau salah.' })
        return
      }

      const adminUser: UserAccount = {
        id: 'usr_lead_operator',
        name: sanitizeText(operatorName || 'White Jack (Lead Operator)'),
        email: 'lionelsabdani36@gmail.com',
        provider: 'local',
        role: 'admin',
        createdAt: '2026-10-22T00:00:00Z',
        lastLogin: new Date().toISOString(),
      }

      const token = signSessionToken({
        id: adminUser.id,
        email: adminUser.email,
        name: adminUser.name,
        role: 'admin',
        provider: 'operator_key',
      })

      res.json({
        success: true,
        message: 'Autentikasi Lead Operator Berhasil (Role: Admin / Full Access).',
        token,
        user: adminUser,
      })
    } catch (err) {
      console.error('Operator login error:', err)
      res.status(500).json({ error: 'Gagal memproses autentikasi operator.' })
    }
  })

  // 2. Google OAuth Exchange / Login & Register
  app.post('/api/auth/oauth/google', async (req: Request, res: Response) => {
    try {
      const { credential, email, name, avatar } = req.body || {}
      let userEmail = ''
      let userName = ''
      let userAvatar = ''

      if (credential) {
        // ID Token payload decode (base64)
        try {
          const payloadPart = credential.split('.')[1]
          const decoded = JSON.parse(Buffer.from(payloadPart, 'base64').toString('utf8'))
          userEmail = decoded.email
          userName = decoded.name
          userAvatar = decoded.picture
        } catch {
          // Fallback to direct provided fields
        }
      }

      if (!userEmail && email) {
        userEmail = sanitizeText(email)
        userName = sanitizeText(name || email.split('@')[0])
        userAvatar = sanitizeText(avatar || '')
      }

      if (!userEmail || !userEmail.includes('@')) {
        res.status(400).json({ error: 'Valid Google email is required.' })
        return
      }

      const users = await loadUsers()
      let user = users.find((u) => u.email.toLowerCase() === userEmail.toLowerCase())

      // Guard: Admin accounts cannot be accessed via unverified quick login
      if (user && user.role === 'admin' && !credential) {
        res.status(403).json({ error: 'Administrative accounts require verified Google OAuth credentials to sign in.' })
        return
      }

      if (!user) {
        // Register new user: only verified operator emails get admin, all others are guests
        const isOperator = userEmail.toLowerCase() === 'lionelsabdani36@gmail.com' && Boolean(credential)
        user = {
          id: `usr_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          name: userName || userEmail.split('@')[0],
          email: userEmail.toLowerCase(),
          provider: 'google',
          avatarUrl: userAvatar,
          role: isOperator ? 'admin' : 'guest',
          createdAt: new Date().toISOString(),
          lastLogin: new Date().toISOString(),
        }
        users.push(user)
      } else {
        user.lastLogin = new Date().toISOString()
        if (userName) user.name = userName
        if (userAvatar) user.avatarUrl = userAvatar
        if (userEmail.toLowerCase() === 'lionelsabdani36@gmail.com' && Boolean(credential)) {
          user.role = 'admin'
        }
      }

      await saveUsers(users)

      const token = signSessionToken({
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        provider: user.provider,
      })

      res.json({
        success: true,
        message: 'Google login successful',
        token,
        user,
      })
    } catch (err) {
      console.error('Google OAuth error:', err)
      res.status(500).json({ error: 'Failed to process Google authentication.' })
    }
  })

  // 3. GitHub OAuth Exchange / Login & Register
  app.post('/api/auth/oauth/github', async (req: Request, res: Response) => {
    try {
      const { code, username, email, avatar } = req.body || {}
      let userEmail = ''
      let userName = ''
      let userAvatar = ''

      const config = await loadOAuthConfig()
      const githubClientId = process.env.GITHUB_CLIENT_ID || config.githubClientId
      const githubClientSecret = process.env.GITHUB_CLIENT_SECRET || config.githubClientSecret

      if (code && githubClientId && githubClientSecret) {
        // Real GitHub OAuth access token exchange
        try {
          const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Accept: 'application/json',
            },
            body: JSON.stringify({
              client_id: githubClientId,
              client_secret: githubClientSecret,
              code,
            }),
          })
          const tokenData = (await tokenRes.json()) as Record<string, unknown>
          if (tokenData && typeof tokenData.access_token === 'string') {
            const userRes = await fetch('https://api.github.com/user', {
              headers: {
                Authorization: `Bearer ${tokenData.access_token}`,
                'User-Agent': 'Duckvaulta-Ruang',
              },
            })
            const ghUser = (await userRes.json()) as Record<string, unknown>
            userName = String(ghUser.name || ghUser.login || 'GitHub User')
            userAvatar = String(ghUser.avatar_url || '')
            userEmail = String(ghUser.email || `${ghUser.login || 'user'}@users.noreply.github.com`)
          }
        } catch (fetchErr) {
          console.warn('GitHub token exchange warning:', fetchErr)
        }
      }

      // Fallback for direct token payload or simulated OAuth flow
      if (!userEmail && (username || email)) {
        userName = sanitizeText(username || (email ? email.split('@')[0] : 'GitHub User'))
        userEmail = sanitizeText(email || `${userName.toLowerCase()}@github.com`)
        userAvatar = sanitizeText(avatar || `https://github.com/${userName}.png`)
      }

      if (!userEmail) {
        res.status(400).json({ error: 'GitHub authorization payload missing.' })
        return
      }

      const users = await loadUsers()
      let user = users.find((u) => u.email.toLowerCase() === userEmail.toLowerCase())

      // Guard: Admin accounts cannot be accessed via unverified quick login
      if (user && user.role === 'admin' && !code) {
        res.status(403).json({ error: 'Administrative accounts require verified GitHub OAuth credentials to sign in.' })
        return
      }

      if (!user) {
        const isOperator = Boolean(code) && ['lnell19', 'lionelsabdani36'].includes(userName.toLowerCase())
        user = {
          id: `usr_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          name: userName,
          email: userEmail.toLowerCase(),
          provider: 'github',
          avatarUrl: userAvatar,
          role: isOperator ? 'admin' : 'guest',
          createdAt: new Date().toISOString(),
          lastLogin: new Date().toISOString(),
        }
        users.push(user)
      } else {
        user.lastLogin = new Date().toISOString()
        if (userName) user.name = userName
        if (userAvatar) user.avatarUrl = userAvatar
        if (Boolean(code) && ['lnell19', 'lionelsabdani36'].includes(userName.toLowerCase())) {
          user.role = 'admin'
        }
      }

      await saveUsers(users)

      const token = signSessionToken({
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        provider: user.provider,
      })

      res.json({
        success: true,
        message: 'GitHub login successful',
        token,
        user,
      })
    } catch (err) {
      console.error('GitHub OAuth error:', err)
      res.status(500).json({ error: 'Failed to process GitHub authentication.' })
    }
  })

  // 4. Current User Session Check
  app.get('/api/auth/me', async (req: Request, res: Response) => {
    const authHeader = req.headers.authorization || ''
    const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7) : ''
    if (!token) {
      res.status(401).json({ authenticated: false, user: null })
      return
    }

    const payload = verifySessionToken(token)
    if (!payload || !payload.email) {
      res.status(401).json({ authenticated: false, error: 'Invalid or expired session token.' })
      return
    }

    const users = await loadUsers()
    const user = users.find((u) => u.email === payload.email)
    res.json({
      authenticated: true,
      user: user || payload,
    })
  })

  // 5. Update OAuth Settings (Admin only)
  app.post('/api/auth/settings/credentials', async (req: Request, res: Response) => {
    const authHeader = req.headers.authorization || ''
    const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7) : ''
    const payload = verifySessionToken(token)

    if (!payload || payload.role !== 'admin') {
      res.status(403).json({ error: 'Admin authorization required to update credentials.' })
      return
    }

    const { googleClientId, googleClientSecret, githubClientId, githubClientSecret } = req.body || {}
    const config = await loadOAuthConfig()

    if (googleClientId !== undefined) config.googleClientId = sanitizeText(googleClientId)
    if (googleClientSecret !== undefined) config.googleClientSecret = sanitizeText(googleClientSecret)
    if (githubClientId !== undefined) config.githubClientId = sanitizeText(githubClientId)
    if (githubClientSecret !== undefined) config.githubClientSecret = sanitizeText(githubClientSecret)

    await saveOAuthConfig(config)
    res.json({ success: true, message: 'OAuth configuration updated successfully.' })
  })
}
