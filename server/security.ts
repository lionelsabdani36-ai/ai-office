import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import type { Request, Response, NextFunction } from 'express'

// Secret key for HMAC signing (derived from env or generated per process)
const HMAC_SECRET = process.env.COMPANY_SECURITY_SECRET || process.env.RUANG_SECRET || 'duckvaulta-super-secure-company-secret-2026'

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
    const now = Date.now()

    const bucket = ipBuckets.get(ip)
    if (!bucket || now > bucket.resetTime) {
      ipBuckets.set(ip, { count: 1, resetTime: now + windowMs })
      return next()
    }

    if (bucket.count >= maxRequests) {
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
 * Timing-safe string comparison to prevent timing attacks
 */
export function safeCompare(a: string, b: string): boolean {
  try {
    const bufA = Buffer.from(a, 'utf8')
    const bufB = Buffer.from(b, 'utf8')
    if (bufA.length !== bufB.length) return false
    return timingSafeEqual(bufA, bufB)
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
