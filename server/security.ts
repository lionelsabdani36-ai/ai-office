import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { lookup } from 'node:dns/promises'
import type { Request, Response, NextFunction } from 'express'

// Dynamic cryptographic secret for HMAC signing (derived from env or securely generated on disk)
function resolveHmacSecret(): string {
  if (process.env.COMPANY_SECURITY_SECRET) return process.env.COMPANY_SECURITY_SECRET
  if (process.env.RUANG_SECRET) return process.env.RUANG_SECRET

  const secretDir = join(process.cwd(), 'data')
  const secretPath = join(secretDir, '.company_hmac_secret')
  try {
    if (existsSync(secretPath)) {
      const secret = readFileSync(secretPath, 'utf8').trim()
      if (secret.length >= 32) return secret
    }
    const generated = randomBytes(48).toString('hex')
    mkdirSync(secretDir, { recursive: true })
    writeFileSync(secretPath, generated, { mode: 0o600 })
    return generated
  } catch {
    return randomBytes(48).toString('hex')
  }
}

const HMAC_SECRET = resolveHmacSecret()

// In-memory sliding window rate limiter
interface RateLimitBucket {
  count: number
  resetTime: number
}
const ipBuckets = new Map<string, RateLimitBucket>()

/**
 * Sliding window rate limiter middleware
 * Limits requests to maxRequests per windowMs
 */
export function rateLimiter(maxRequests = 60, windowMs = 60_000) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const ip = req.ip || req.socket.remoteAddress || '127.0.0.1'
    const isLoopback = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1'
    const effectiveLimit = isLoopback ? Math.max(maxRequests * 10, 1000) : maxRequests
    const now = Date.now()

    const bucket = ipBuckets.get(ip)
    if (!bucket || now > bucket.resetTime) {
      ipBuckets.set(ip, { count: 1, resetTime: now + windowMs })
      return next()
    }

    if (bucket.count >= effectiveLimit) {
      res.status(429).json({
        error: 'Too many requests. Rate limit exceeded, please wait a moment.',
        retryAfterMs: bucket.resetTime - now,
      })
      return
    }

    bucket.count += 1
    next()
  }
}

// Dedicated Progressive Throttling for Operator Key Login (Anti-Brute-Force)
interface LoginAttemptRecord {
  failures: number
  lockedUntil: number
}
const operatorLoginAttempts = new Map<string, LoginAttemptRecord>()

export function checkOperatorLoginRateLimit(ip: string, now = Date.now()): { allowed: boolean; retryAfterMs?: number } {
  const isLoopback = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1'
  const record = operatorLoginAttempts.get(ip)
  if (!record) return { allowed: true }

  if (record.lockedUntil > now) {
    return { allowed: false, retryAfterMs: record.lockedUntil - now }
  }

  // Soft limit: allow retry if lockout window expired
  if (now > record.lockedUntil && record.lockedUntil > 0) {
    record.failures = Math.max(0, record.failures - 2)
    record.lockedUntil = 0
  }

  const maxFree = isLoopback ? 30 : 5
  if (record.failures >= maxFree) {
    const lockDuration = Math.min(300_000, 1000 * 2 ** (record.failures - maxFree + 1))
    record.lockedUntil = now + lockDuration
    return { allowed: false, retryAfterMs: lockDuration }
  }

  return { allowed: true }
}

export function recordOperatorLoginFailure(ip: string, now = Date.now()): void {
  const record = operatorLoginAttempts.get(ip) || { failures: 0, lockedUntil: 0 }
  record.failures += 1
  const isLoopback = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1'
  const maxFree = isLoopback ? 30 : 5

  if (record.failures >= maxFree) {
    const lockDuration = Math.min(300_000, 1000 * 2 ** (record.failures - maxFree + 1))
    record.lockedUntil = now + lockDuration
  }
  operatorLoginAttempts.set(ip, record)
}

export function recordOperatorLoginSuccess(ip: string): void {
  operatorLoginAttempts.delete(ip)
}

/**
 * Input sanitization to prevent XSS, HTML injection, and command injection
 */
export function sanitizeText(input: unknown): string {
  if (typeof input !== 'string') return ''
  return input
    .replace(/[&<>"']/g, (m) => {
      switch (m) {
        case '&': return '&amp;'
        case '<': return '&lt;'
        case '>': return '&gt;'
        case '"': return '&quot;'
        case "'": return '&#39;'
        default: return m
      }
    })
    .trim()
}

/**
 * Strict alphanumeric and safe identifier check
 */
export function isSafeIdentifier(str: string): boolean {
  return /^[a-zA-Z0-9_\-\.\s]{1,100}$/.test(str)
}

/**
 * Timing-safe string comparison to prevent timing attacks.
 * Hashes inputs with HMAC-SHA256 to ensure constant-length buffers,
 * completely neutralizing length-leakage timing channels.
 */
export function safeCompare(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false
  try {
    const hashA = createHmac('sha256', HMAC_SECRET).update(a).digest()
    const hashB = createHmac('sha256', HMAC_SECRET).update(b).digest()
    return timingSafeEqual(hashA, hashB)
  } catch {
    return false
  }
}

/**
 * Sign session token payload
 */
export function signSessionToken(payload: Record<string, unknown>): string {
  const data = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + 86400_000 })).toString('base64url')
  const hmac = createHmac('sha256', HMAC_SECRET).update(data).digest('base64url')
  return `${data}.${hmac}`
}

/**
 * Verify and decode session token payload
 */
export function verifySessionToken(token: string): Record<string, unknown> | null {
  if (!token || typeof token !== 'string') return null
  const parts = token.split('.')
  if (parts.length !== 2) return null

  const [data, signature] = parts
  const expectedHmac = createHmac('sha256', HMAC_SECRET).update(data).digest('base64url')

  if (!safeCompare(signature, expectedHmac)) return null

  try {
    const parsed = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'))
    if (typeof parsed.exp === 'number' && Date.now() > parsed.exp) {
      return null // Expired
    }
    return parsed
  } catch {
    return null
  }
}

/**
 * Generate cryptographically secure random token (hex)
 */
export function generateSecureKey(bytes = 32): string {
  return randomBytes(bytes).toString('hex')
}

// Sensitive internal service ports that must NEVER be reachable via webhook/SSRF
const BLOCKED_PORTS = new Set([
  21, 22, 23, 25, 53, 69, 110, 143, 3001, 3002, 4173, 6379, 8000, 8080, 8443, 8500, 9200, 11434, 20128, 27017, 3306, 5432, 2375, 2379,
])
// Note: standard webhooks on 80/443 or unlisted non-sensitive ports are permitted.
// If port 80 or 443, it's explicitly safe.
function isBlockedPort(port: number): boolean {
  if (port === 80 || port === 443) return false
  return BLOCKED_PORTS.has(port)
}

// Known DNS rebinding wildcards and internal TLDs
const BLOCKED_REBIND_DOMAINS = [
  'nip.io', 'sslip.io', 'traefik.me', 'localtest.me', 'lvh.me', 'vcap.me', 'fwh.is', 'customer.vps.local',
]
const BLOCKED_INTERNAL_TLDS = [
  '.internal', '.local', '.lan', '.home', '.corp', '.intra', '.test', '.example', '.invalid',
]

/**
 * Parse any IPv4 representation (dotted-decimal, decimal integer, hexadecimal, octal, abbreviated)
 * Returns 32-bit unsigned integer or null if not a valid IPv4 address.
 */
function parseIPv4(hostname: string): number | null {
  const trimmed = hostname.trim().toLowerCase()
  if (!trimmed) return null

  // Pure decimal integer (e.g. 2130706433 -> 127.0.0.1)
  if (/^\d+$/.test(trimmed)) {
    const val = Number(trimmed)
    if (val >= 0 && val <= 0xffffffff) return val >>> 0
    return null
  }

  // Pure hex integer (e.g. 0x7f000001 -> 127.0.0.1)
  if (/^0x[0-9a-f]+$/i.test(trimmed)) {
    const val = parseInt(trimmed, 16)
    if (val >= 0 && val <= 0xffffffff) return val >>> 0
    return null
  }

  // Dotted notation (1 to 4 parts)
  const parts = trimmed.split('.')
  if (parts.length >= 1 && parts.length <= 4) {
    const nums: number[] = []
    for (const p of parts) {
      let n: number
      if (/^0x[0-9a-f]+$/i.test(p)) {
        n = parseInt(p, 16)
      } else if (/^0[0-7]+$/.test(p)) {
        n = parseInt(p, 8)
      } else if (/^\d+$/.test(p)) {
        n = parseInt(p, 10)
      } else {
        return null
      }
      if (isNaN(n) || n < 0) return null
      nums.push(n)
    }

    if (nums.length === 4) {
      if (nums.some((n) => n > 255)) return null
      return ((nums[0] << 24) | (nums[1] << 16) | (nums[2] << 8) | nums[3]) >>> 0
    }
    if (nums.length === 1) {
      if (nums[0] > 0xffffffff) return null
      return nums[0] >>> 0
    }
    if (nums.length === 2) {
      if (nums[0] > 255 || nums[1] > 0xffffff) return null
      return ((nums[0] << 24) | nums[1]) >>> 0
    }
    if (nums.length === 3) {
      if (nums[0] > 255 || nums[1] > 255 || nums[2] > 0xffff) return null
      return ((nums[0] << 24) | (nums[1] << 16) | nums[2]) >>> 0
    }
  }

  return null
}

/**
 * Check if a 32-bit IPv4 integer belongs to any private, loopback, link-local, or reserved ranges.
 */
function isBlockedIPv4Int(ip: number): boolean {
  const b0 = (ip >>> 24) & 0xff
  const b1 = (ip >>> 16) & 0xff
  const b2 = (ip >>> 8) & 0xff

  // 0.0.0.0/8 (Current network / "this host")
  if (b0 === 0) return true
  // 10.0.0.0/8 (RFC 1918 Private)
  if (b0 === 10) return true
  // 100.64.0.0/10 (RFC 6598 Carrier-Grade NAT / Cloud Shared)
  if (b0 === 100 && (b1 & 0xc0) === 64) return true
  // 127.0.0.0/8 (RFC 1122 Loopback - ENTIRE 127.x.x.x subnet)
  if (b0 === 127) return true
  // 169.254.0.0/16 (RFC 3927 Link-Local / AWS/GCP Metadata 169.254.169.254)
  if (b0 === 169 && b1 === 254) return true
  // 172.16.0.0/12 (RFC 1918 Private: 172.16.0.0 - 172.31.255.255)
  if (b0 === 172 && b1 >= 16 && b1 <= 31) return true
  // 192.0.0.0/24 (RFC 6890 IETF Protocol Assignments)
  if (b0 === 192 && b1 === 0 && b2 === 0) return true
  // 192.0.2.0/24 (RFC 5737 TEST-NET-1)
  if (b0 === 192 && b1 === 0 && b2 === 2) return true
  // 192.168.0.0/16 (RFC 1918 Private)
  if (b0 === 192 && b1 === 168) return true
  // 198.18.0.0/15 (RFC 2544 Benchmark Testing: 198.18.0.0 - 198.19.255.255)
  if (b0 === 198 && (b1 === 18 || b1 === 19)) return true
  // 198.51.100.0/24 (RFC 5737 TEST-NET-2)
  if (b0 === 198 && b1 === 51 && b2 === 100) return true
  // 203.0.113.0/24 (RFC 5737 TEST-NET-3)
  if (b0 === 203 && b1 === 0 && b2 === 113) return true
  // 224.0.0.0/4 (Multicast) & 240.0.0.0/4 (Reserved / Broadcast 255.255.255.255)
  if (b0 >= 224) return true

  return false
}

/**
 * SSRF validation: Disallows loopback, private ranges, link-local, non-http(s) protocols,
 * DNS rebinding wildcards, cloud metadata endpoints, and internal service ports.
 */
export function isSafeWebhookUrl(urlStr: string): boolean {
  if (!urlStr || typeof urlStr !== 'string') return false
  try {
    const parsed = new URL(urlStr)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false

    // Disallow userinfo (e.g. http://user:pass@host/)
    if (parsed.username || parsed.password) return false

    // Check port
    const port = parsed.port ? Number(parsed.port) : (parsed.protocol === 'https:' ? 443 : 80)
    if (isNaN(port) || isBlockedPort(port)) {
      return false
    }

    const rawHost = parsed.hostname.toLowerCase()
    const hostname = rawHost.replace(/^\[|\]$/g, '').trim()
    if (!hostname || hostname.length > 253) return false

    // Disallow localhost and loopbacks
    if (
      hostname === 'localhost' ||
      hostname === 'loopback' ||
      hostname === 'ip6-localhost' ||
      hostname === 'ip6-loopback' ||
      hostname === 'metadata' ||
      hostname === 'metadata.google.internal' ||
      hostname === 'instance-data'
    ) {
      return false
    }

    // Disallow internal TLDs
    if (BLOCKED_INTERNAL_TLDS.some((tld) => hostname.endsWith(tld))) {
      return false
    }

    // Disallow DNS rebinding wildcard domains
    if (BLOCKED_REBIND_DOMAINS.some((d) => hostname === d || hostname.endsWith(`.${d}`))) {
      return false
    }

    // Check IPv6 loopback / unspecified
    if (
      hostname === '::1' ||
      hostname === '::' ||
      hostname === '0:0:0:0:0:0:0:1' ||
      hostname === '0:0:0:0:0:0:0:0'
    ) {
      return false
    }

    // Check IPv6-mapped IPv4 addresses (::ffff:x.x.x.x or ::ffff:hex:hex)
    if (hostname.startsWith('::ffff:') || hostname.startsWith('0:0:0:0:0:ffff:')) {
      const rest = hostname.replace(/^(::ffff:|0:0:0:0:0:ffff:)/i, '')
      const parsedRest = parseIPv4(rest)
      if (parsedRest !== null) {
        if (isBlockedIPv4Int(parsedRest)) return false
      } else {
        // Hexadecimal IPv6-mapped part e.g. ::ffff:7f00:1
        const hexParts = rest.split(':')
        if (hexParts.length === 2) {
          const hi = parseInt(hexParts[0], 16)
          const lo = parseInt(hexParts[1], 16)
          if (!isNaN(hi) && !isNaN(lo)) {
            const mappedIp = ((hi << 16) | lo) >>> 0
            if (isBlockedIPv4Int(mappedIp)) return false
          }
        }
        return false // fail-closed for unparseable IPv6-mapped IPv4
      }
    }

    // Disallow IPv6 unique local addresses (fc00::/7 -> fc00 to fdff)
    if (/^f[cd][0-9a-f]{2}:/i.test(hostname) || hostname.startsWith('fc') || hostname.startsWith('fd')) {
      return false
    }

    // Disallow IPv6 link-local addresses (fe80::/10 -> fe80 to febf)
    if (/^fe[89ab][0-9a-f]:/i.test(hostname) || hostname.startsWith('fe80:')) {
      return false
    }

    // Disallow IPv6 multicast addresses (ff00::/8)
    if (/^ff[0-9a-f]{2}:/i.test(hostname)) {
      return false
    }

    // Disallow link-local / cloud metadata (169.254.x.x)
    if (hostname.startsWith('169.254.')) return false

    // Parse and validate any IPv4 representation (dotted, decimal int, hex, octal, shortened)
    const ipv4Int = parseIPv4(hostname)
    if (ipv4Int !== null) {
      if (isBlockedIPv4Int(ipv4Int)) return false
    }

    return true
  } catch {
    return false
  }
}

/**
 * DNS-level anti-rebinding verification.
 * Resolves hostname to its IP address and ensures it does not resolve to an internal/private address.
 */
export async function resolveAndValidateHost(hostname: string): Promise<boolean> {
  try {
    const rawHost = hostname.replace(/^\[|\]$/g, '').trim().toLowerCase()
    // If it's already an IP, isSafeWebhookUrl handled it
    const ipv4Int = parseIPv4(rawHost)
    if (ipv4Int !== null) {
      return !isBlockedIPv4Int(ipv4Int)
    }

    const { address } = await lookup(rawHost, { all: false })
    if (!address) return false

    const resolvedIpv4 = parseIPv4(address)
    if (resolvedIpv4 !== null) {
      return !isBlockedIPv4Int(resolvedIpv4)
    }

    // IPv6 checks for resolved address
    const cleanAddr = address.toLowerCase()
    if (
      cleanAddr === '::1' ||
      cleanAddr === '::' ||
      cleanAddr.startsWith('fe80:') ||
      cleanAddr.startsWith('fc') ||
      cleanAddr.startsWith('fd')
    ) {
      return false
    }

    return true
  } catch {
    return false
  }
}

/**
 * Sign an outbound webhook payload with HMAC-SHA256
 */
export function signWebhookPayload(payload: string, key?: string): string {
  const secret = key || HMAC_SECRET
  const hmac = createHmac('sha256', secret).update(payload).digest('hex')
  return `sha256=${hmac}`
}

/**
 * Validate Operator Master Passkey against env and persistent files.
 */
export function validateOperatorKey(providedKey: string): boolean {
  if (!providedKey || typeof providedKey !== 'string') return false
  const trimmed = providedKey.trim()
  if (trimmed.length < 8) return false

  const envKey = process.env.OPERATOR_MASTER_KEY || process.env.DUCKVAULTA_MASTER_KEY
  if (envKey && safeCompare(trimmed, envKey.trim())) {
    return true
  }

  const keyFiles = [
    join(process.cwd(), 'data', '.master_operator_key'),
    join(process.cwd(), '.master_operator_key'),
    join(process.env.HOME || '/home/lionelsabdani36', 'data', '.master_operator_key'),
    '/home/lionelsabdani36/ruang/data/.master_operator_key',
  ]

  for (const f of keyFiles) {
    try {
      if (existsSync(f)) {
        const stored = readFileSync(f, 'utf8').trim()
        if (stored.length >= 8 && safeCompare(trimmed, stored)) {
          return true
        }
      }
    } catch {}
  }
  return false
}

export interface AuthenticatedUser {
  id: string
  email: string
  name: string
  role: 'admin' | 'operator' | 'member' | 'guest'
  provider: string
}

/**
 * Unified request authentication: accepts Bearer session token, Direct Operator Key,
 * or X-Operator-Key header.
 */
export function authenticateRequest(req: Request): {
  authenticated: boolean
  user?: AuthenticatedUser
  error?: string
} {
  const operatorHeader = req.headers['x-operator-key']
  if (typeof operatorHeader === 'string' && validateOperatorKey(operatorHeader)) {
    return {
      authenticated: true,
      user: {
        id: 'usr_lead_operator',
        name: 'White Jack (Lead Operator)',
        email: 'lionelsabdani36@gmail.com',
        role: 'admin',
        provider: 'operator_key',
      },
    }
  }

  const authHeader = req.headers.authorization || ''
  if (authHeader.startsWith('Bearer ')) {
    const rawToken = authHeader.substring(7).trim()

    // Support direct operator key in Bearer header
    if (validateOperatorKey(rawToken)) {
      return {
        authenticated: true,
        user: {
          id: 'usr_lead_operator',
          name: 'White Jack (Lead Operator)',
          email: 'lionelsabdani36@gmail.com',
          role: 'admin',
          provider: 'operator_key',
        },
      }
    }

    const payload = verifySessionToken(rawToken)
    if (payload && payload.email) {
      return {
        authenticated: true,
        user: {
          id: String(payload.id || 'usr_unknown'),
          email: String(payload.email),
          name: String(payload.name || payload.email),
          role: (['admin', 'operator', 'member', 'guest'].includes(String(payload.role))
            ? payload.role
            : 'guest') as 'admin' | 'operator' | 'member' | 'guest',
          provider: String(payload.provider || 'local'),
        },
      }
    }
  }

  return { authenticated: false, error: 'Sesi autentikasi tidak valid atau telah kedaluwarsa.' }
}

/**
 * Buffer spam detection engine.
 * Catches repetitive characters, cyclic patterns, control character injections,
 * excessive newlines/spaces, and low-entropy fuzzing vectors.
 */
export function isBufferSpam(text: string): { spam: boolean; reason?: string } {
  if (typeof text !== 'string') return { spam: false }

  // 1. Reject ASCII control characters and null bytes (excluding standard tabs and newlines)
  if (/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(text)) {
    return { spam: true, reason: 'Input mengandung karakter kontrol atau null byte yang tidak diizinkan.' }
  }

  // 2. Reject zero-width / invisible unicode spam
  if (/[\u200B-\u200F\uFEFF\u202A-\u202E\u2060-\u206F]{3,}/.test(text)) {
    return { spam: true, reason: 'Input terdeteksi mengandung spam karakter tak kasat mata (zero-width flood).' }
  }

  // 3. Reject single character repeated 10 or more times consecutively
  if (/(.)\1{9,}/.test(text)) {
    return { spam: true, reason: 'Input terdeteksi sebagai spam pengulangan karakter berlebihan.' }
  }

  // 4. Reject multi-character cyclic patterns
  // 2-character pattern repeated >= 5 times (e.g. ababababab)
  if (/(.{2})\1{4,}/.test(text)) {
    return { spam: true, reason: 'Input terdeteksi mengandung pola pengulangan siklik (buffer pattern flood).' }
  }
  // 3-character pattern repeated >= 4 times (e.g. abcabcabcabc)
  if (/(.{3})\1{3,}/.test(text)) {
    return { spam: true, reason: 'Input terdeteksi mengandung pola pengulangan siklik (buffer pattern flood).' }
  }
  // 4 to 8 character pattern repeated >= 3 times (e.g. spam_spam_spam_)
  if (/(.{4,8})\1{2,}/.test(text)) {
    return { spam: true, reason: 'Input terdeteksi mengandung pengulangan frasa/buffer berlebihan.' }
  }

  // 5. Reject excessive newline flooding (>= 4 consecutive newlines) or space flooding (>= 25 consecutive spaces)
  if (/(\r?\n){4,}/.test(text) || /[ \t]{25,}/.test(text)) {
    return { spam: true, reason: 'Input mengandung spasi atau baris kosong berlebihan (whitespace flooding).' }
  }

  // 6. Low entropy / repetitive fuzzing check for longer strings
  const stripped = text.replace(/\s+/g, '')
  if (stripped.length >= 30) {
    const uniqueChars = new Set(stripped).size
    if (uniqueChars < 3) {
      return { spam: true, reason: 'Input terdeteksi memiliki entropi terlalu rendah (repetitive fuzzing payload).' }
    }
  }

  return { spam: false }
}

/**
 * Validates task title and description against spam, buffer repetition, and character bounds.
 */
export function isValidTaskContent(title: unknown, description: unknown): { valid: boolean; reason?: string } {
  if (typeof title !== 'string' || title.trim().length < 3) {
    return { valid: false, reason: 'Judul tugas minimal 3 karakter.' }
  }
  if (title.length > 120) {
    return { valid: false, reason: 'Judul tugas maksimal 120 karakter.' }
  }
  if (typeof description !== 'string' || description.trim().length < 5) {
    return { valid: false, reason: 'Deskripsi tugas minimal 5 karakter.' }
  }
  if (description.length > 1500) {
    return { valid: false, reason: 'Deskripsi tugas maksimal 1500 karakter.' }
  }

  const titleSpam = isBufferSpam(title)
  if (titleSpam.spam) {
    return { valid: false, reason: `Judul: ${titleSpam.reason}` }
  }

  const descSpam = isBufferSpam(description)
  if (descSpam.spam) {
    return { valid: false, reason: `Deskripsi: ${descSpam.reason}` }
  }

  return { valid: true }
}

/**
 * Validates direct instruction against spam, buffer repetition, and character bounds.
 */
export function isValidInstructionContent(instruction: unknown): { valid: boolean; reason?: string } {
  if (typeof instruction !== 'string' || instruction.trim().length < 2) {
    return { valid: false, reason: 'Teks instruksi minimal 2 karakter.' }
  }
  if (instruction.length > 1000) {
    return { valid: false, reason: 'Teks instruksi maksimal 1000 karakter.' }
  }

  const spam = isBufferSpam(instruction)
  if (spam.spam) {
    return { valid: false, reason: `Instruksi: ${spam.reason}` }
  }

  return { valid: true }
}
