import { describe, it, expect } from 'vitest'
import { isSafeWebhookUrl, safeCompare, sanitizeText, signSessionToken, verifySessionToken } from './security.js'

describe('Security Hardening & Cyber Defense Verification', () => {
  describe('SSRF Protection (isSafeWebhookUrl)', () => {
    it('blocks localhost and loopbacks', () => {
      expect(isSafeWebhookUrl('http://localhost:3001/api')).toBe(false)
      expect(isSafeWebhookUrl('http://127.0.0.1:11434/api/generate')).toBe(false)
      expect(isSafeWebhookUrl('http://127.0.0.1:20128/v1')).toBe(false)
      expect(isSafeWebhookUrl('http://0.0.0.0:80/')).toBe(false)
      expect(isSafeWebhookUrl('http://[::1]:8080/')).toBe(false)
    })

    it('blocks cloud metadata link-local endpoints', () => {
      expect(isSafeWebhookUrl('http://169.254.169.254/latest/meta-data/')).toBe(false)
      expect(isSafeWebhookUrl('http://169.254.169.254/computeMetadata/v1/')).toBe(false)
    })

    it('blocks RFC1918 private IPv4 subnets', () => {
      expect(isSafeWebhookUrl('http://10.0.0.5/webhook')).toBe(false)
      expect(isSafeWebhookUrl('http://192.168.1.100/status')).toBe(false)
      expect(isSafeWebhookUrl('http://172.20.0.2/api')).toBe(false)
    })

    it('blocks internal non-routable domains', () => {
      expect(isSafeWebhookUrl('http://cluster.internal/webhook')).toBe(false)
      expect(isSafeWebhookUrl('http://service.local/api')).toBe(false)
      expect(isSafeWebhookUrl('http://router.lan/admin')).toBe(false)
    })

    it('allows valid public external HTTPS endpoints', () => {
      expect(isSafeWebhookUrl('https://webhook.kawan-agent.io/duckvaulta-receiver')).toBe(true)
      expect(isSafeWebhookUrl('https://api.external-agent.com/v1/task')).toBe(true)
    })
  })

  describe('Timing-Safe Comparison (safeCompare)', () => {
    it('validates matching strings correctly', () => {
      expect(safeCompare('dck_agt_secretkey123', 'dck_agt_secretkey123')).toBe(true)
    })

    it('rejects non-matching strings safely', () => {
      expect(safeCompare('dck_agt_secretkey123', 'dck_agt_secretkey999')).toBe(false)
      expect(safeCompare('dck_agt_secretkey123', 'short')).toBe(false)
      expect(safeCompare('', 'non-empty')).toBe(false)
    })
  })

  describe('Input Sanitization & XSS Defense (sanitizeText)', () => {
    it('escapes dangerous XSS payloads', () => {
      const payload = "<script>alert('XSS_ATTACK_VECTOR')</script><img src=x onerror=alert(1)>"
      const cleaned = sanitizeText(payload)
      expect(cleaned).not.toContain('<script>')
      expect(cleaned).not.toContain('</script>')
      expect(cleaned).not.toContain('<img')
      expect(cleaned).toContain('&lt;script&gt;')
      expect(cleaned).toContain('&lt;img src=x onerror=alert(1)&gt;')
    })

    it('neutralizes SVG onload and embedded event vectors', () => {
      const svgPayload = "<svg/onload=alert('SVG_XSS')>"
      const cleanedSvg = sanitizeText(svgPayload)
      expect(cleanedSvg).toBe("&lt;svg/onload=alert(&#39;SVG_XSS&#39;)&gt;")
      expect(cleanedSvg).not.toContain('<svg')
      expect(cleanedSvg).not.toContain('>')

      const complexSvg = `<svg><script>alert('SVG_SCRIPT')</script><animate onbegin=alert(1) attributeName=x dur=1s></svg>`
      const cleanedComplex = sanitizeText(complexSvg)
      expect(cleanedComplex).not.toContain('<svg>')
      expect(cleanedComplex).not.toContain('<script>')
      expect(cleanedComplex).not.toContain('<animate')
      expect(cleanedComplex).toContain('&lt;svg&gt;&lt;script&gt;')
    })

    it('neutralizes attribute breakout vectors', () => {
      const breakoutPayload = `"><svg/onload=alert(document.cookie)>`
      const cleanedBreakout = sanitizeText(breakoutPayload)
      expect(cleanedBreakout).toBe('&quot;&gt;&lt;svg/onload=alert(document.cookie)&gt;')
    })

    it('neutralizes iframe javascript protocol and srcdoc injection vectors', () => {
      const iframeJsPayload = `<iframe src="javascript:alert('IFRAME')"></iframe>`
      const cleanedIframeJs = sanitizeText(iframeJsPayload)
      expect(cleanedIframeJs).toBe('&lt;iframe src=&quot;javascript:alert(&#39;IFRAME&#39;)&quot;&gt;&lt;/iframe&gt;')
      expect(cleanedIframeJs).not.toContain('<iframe')
      expect(cleanedIframeJs).not.toContain('</iframe>')

      const iframeSrcdocPayload = `<iframe srcdoc="<script>alert('IFRAME_SRCDOC')</script>"></iframe>`
      const cleanedIframeSrcdoc = sanitizeText(iframeSrcdocPayload)
      expect(cleanedIframeSrcdoc).toBe('&lt;iframe srcdoc=&quot;&lt;script&gt;alert(&#39;IFRAME_SRCDOC&#39;)&lt;/script&gt;&quot;&gt;&lt;/iframe&gt;')
      expect(cleanedIframeSrcdoc).not.toContain('<iframe')
      expect(cleanedIframeSrcdoc).not.toContain('<script')

      const caseVariant = `<IFRAME SRC="javascript:alert('XSS')"></IFRAME>`
      const cleanedCase = sanitizeText(caseVariant)
      expect(cleanedCase).toBe('&lt;IFRAME SRC=&quot;javascript:alert(&#39;XSS&#39;)&quot;&gt;&lt;/IFRAME&gt;')
      expect(cleanedCase).not.toContain('<IFRAME')
    })
  })

  describe('Cryptographic Session Tokens & Offline Forgery Immunity', () => {
    it('signs and verifies valid sessions', () => {
      const token = signSessionToken({
        id: 'usr_test_1',
        email: 'analyst@duckvaulta.ai.id',
        role: 'member',
      })
      const verified = verifySessionToken(token)
      expect(verified).not.toBeNull()
      expect(verified?.email).toBe('analyst@duckvaulta.ai.id')
      expect(verified?.role).toBe('member')
    })

    it('rejects tampered tokens', () => {
      const token = signSessionToken({
        id: 'usr_test_1',
        email: 'analyst@duckvaulta.ai.id',
        role: 'member',
      })
      const [payload, sig] = token.split('.')
      // Tamper role from member to admin
      const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
      decoded.role = 'admin'
      const tamperedPayload = Buffer.from(JSON.stringify(decoded)).toString('base64url')
      const tamperedToken = `${tamperedPayload}.${sig}`

      expect(verifySessionToken(tamperedToken)).toBeNull()
    })

    it('rejects tokens forged with the old hardcoded static string', () => {
      const oldStaticSecret = 'duckvaulta-super-secure-company-secret-2026'
      const crypto = require('node:crypto')
      const payload = Buffer.from(JSON.stringify({
        id: 'forged',
        email: 'attacker@evil.com',
        role: 'admin',
        exp: Date.now() + 86400000,
      })).toString('base64url')
      const oldSig = crypto.createHmac('sha256', oldStaticSecret).update(payload).digest('base64url')
      const forgedToken = `${payload}.${oldSig}`

      expect(verifySessionToken(forgedToken)).toBeNull()
    })
  })
})
