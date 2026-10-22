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

    it('neutralizes anchor javascript protocol and link injection vectors', () => {
      const anchorPayload = `<a href="javascript:alert('LINK')">Click</a>`
      const cleanedAnchor = sanitizeText(anchorPayload)
      expect(cleanedAnchor).toBe('&lt;a href=&quot;javascript:alert(&#39;LINK&#39;)&quot;&gt;Click&lt;/a&gt;')
      expect(cleanedAnchor).not.toContain('<a')
      expect(cleanedAnchor).not.toContain('</a>')
      expect(cleanedAnchor).not.toContain('<')
      expect(cleanedAnchor).not.toContain('>')

      const upperCasePayload = `<A HREF="JAVASCRIPT:alert('UPPER')">CLICK</A>`
      const cleanedUpper = sanitizeText(upperCasePayload)
      expect(cleanedUpper).toBe('&lt;A HREF=&quot;JAVASCRIPT:alert(&#39;UPPER&#39;)&quot;&gt;CLICK&lt;/A&gt;')
      expect(cleanedUpper).not.toContain('<A')
      expect(cleanedUpper).not.toContain('</A>')

      const unquotedPayload = `<a href=javascript:alert('UNQUOTED')>Click</a>`
      const cleanedUnquoted = sanitizeText(unquotedPayload)
      expect(cleanedUnquoted).toBe('&lt;a href=javascript:alert(&#39;UNQUOTED&#39;)&gt;Click&lt;/a&gt;')
      expect(cleanedUnquoted).not.toContain('<a')
      expect(cleanedUnquoted).not.toContain('</a>')
    })

    it('neutralizes polyglot XSS vectors targeting multiple element contexts', () => {
      const polyglotPayload = "javascript:/*--></title></style></textarea></noscript>--><script>alert('POLYGLOT')</script>"
      const cleanedPolyglot = sanitizeText(polyglotPayload)
      expect(cleanedPolyglot).toBe("javascript:/*--&gt;&lt;/title&gt;&lt;/style&gt;&lt;/textarea&gt;&lt;/noscript&gt;--&gt;&lt;script&gt;alert(&#39;POLYGLOT&#39;)&lt;/script&gt;")
      expect(cleanedPolyglot).not.toContain('</title>')
      expect(cleanedPolyglot).not.toContain('</style>')
      expect(cleanedPolyglot).not.toContain('</textarea>')
      expect(cleanedPolyglot).not.toContain('</noscript>')
      expect(cleanedPolyglot).not.toContain('<script>')
      expect(cleanedPolyglot).not.toContain('</script>')
      expect(cleanedPolyglot).not.toContain('>')
      expect(cleanedPolyglot).not.toContain('<')
    })
    it('neutralizes details ontoggle and HTML5 collapsible event vectors', () => {
      const detailsPayload = "<details open ontoggle=alert('DETAILS')>"
      const cleanedDetails = sanitizeText(detailsPayload)
      expect(cleanedDetails).toBe("&lt;details open ontoggle=alert(&#39;DETAILS&#39;)&gt;")
      expect(cleanedDetails).not.toContain('<details')
      expect(cleanedDetails).not.toContain('<')
      expect(cleanedDetails).not.toContain('>')
      expect(cleanedDetails).toContain('&lt;details open ontoggle=alert(&#39;DETAILS&#39;)&gt;')

      const detailsNested = "<details open ontoggle=\"alert(document.cookie)\"><summary>Click</summary></details>"
      const cleanedNested = sanitizeText(detailsNested)
      expect(cleanedNested).toBe("&lt;details open ontoggle=&quot;alert(document.cookie)&quot;&gt;&lt;summary&gt;Click&lt;/summary&gt;&lt;/details&gt;")
      expect(cleanedNested).not.toContain('<details')
      expect(cleanedNested).not.toContain('</details>')
      expect(cleanedNested).not.toContain('<summary>')
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
