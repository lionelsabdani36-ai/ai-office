import { describe, it, expect } from 'vitest'
import {
  isSafeWebhookUrl,
  safeCompare,
  sanitizeText,
  signSessionToken,
  verifySessionToken,
  validateOperatorKey,
  checkOperatorLoginRateLimit,
  recordOperatorLoginFailure,
  recordOperatorLoginSuccess,
  authenticateRequest,
  isBufferSpam,
  isValidTaskContent,
  isValidInstructionContent,
  signWebhookPayload,
} from './security.js'

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

    it('blocks IPv6-mapped IPv4 bypass vectors and IPv6 local/private subnets', () => {
      expect(isSafeWebhookUrl('http://[::ffff:127.0.0.1]:8080/')).toBe(false)
      expect(isSafeWebhookUrl('http://[::ffff:7f00:1]:8080/')).toBe(false)
      expect(isSafeWebhookUrl('http://[::ffff:10.0.0.1]:8080/')).toBe(false)
      expect(isSafeWebhookUrl('http://[fe80::1]:8080/')).toBe(false)
      expect(isSafeWebhookUrl('http://[fd00::1]:8080/')).toBe(false)
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

    it('neutralizes classic inline script execution vector <script>alert(1)</script>', () => {
      const scriptPayload = '<script>alert(1)</script>'
      const cleanedScript = sanitizeText(scriptPayload)
      expect(cleanedScript).toBe('&lt;script&gt;alert(1)&lt;/script&gt;')
      expect(cleanedScript).not.toContain('<script>')
      expect(cleanedScript).not.toContain('</script>')
      expect(cleanedScript).not.toContain('<')
      expect(cleanedScript).not.toContain('>')

      const upperCaseScript = '<SCRIPT>alert(1)</SCRIPT>'
      const cleanedUpper = sanitizeText(upperCaseScript)
      expect(cleanedUpper).toBe('&lt;SCRIPT&gt;alert(1)&lt;/SCRIPT&gt;')
      expect(cleanedUpper).not.toContain('<SCRIPT>')
      expect(cleanedUpper).not.toContain('</SCRIPT>')
    })

    it('neutralizes SVG onload and embedded event vectors', () => {
      const svgPayload = "<svg/onload=alert('SVG_XSS')>"
      const cleanedSvg = sanitizeText(svgPayload)
      expect(cleanedSvg).toBe("&lt;svg/onload=alert(&#39;SVG_XSS&#39;)&gt;")
      expect(cleanedSvg).not.toContain('<svg')
      expect(cleanedSvg).not.toContain('>')

      // Task t_194b72d8 specific compact probe vector: <svg/onload=alert(1)>
      const compactSvg = '<svg/onload=alert(1)>'
      const cleanedCompact = sanitizeText(compactSvg)
      expect(cleanedCompact).toBe('&lt;svg/onload=alert(1)&gt;')
      expect(cleanedCompact).not.toContain('<svg')
      expect(cleanedCompact).not.toContain('>')

      const upperCompact = '<SVG/ONLOAD=ALERT(1)>'
      const cleanedUpperCompact = sanitizeText(upperCompact)
      expect(cleanedUpperCompact).toBe('&lt;SVG/ONLOAD=ALERT(1)&gt;')
      expect(cleanedUpperCompact).not.toContain('<SVG')

      const spacedSvg = '<svg onload="alert(1)">'
      const cleanedSpaced = sanitizeText(spacedSvg)
      expect(cleanedSpaced).toBe('&lt;svg onload=&quot;alert(1)&quot;&gt;')

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

    it('neutralizes attribute breakout event handler injection vectors (onmouseover)', () => {
      // Task t_c91019bb payload: " onmouseover="alert(1)
      const mouseoverPayload = `" onmouseover="alert(1)`
      const cleanedMouseover = sanitizeText(mouseoverPayload)
      expect(cleanedMouseover).toBe('&quot; onmouseover=&quot;alert(1)')
      expect(cleanedMouseover).not.toContain('"')
      expect(cleanedMouseover).not.toContain("'")

      // Single-quote variant
      const singleQuotePayload = `' onmouseover='alert(1)`
      const cleanedSingle = sanitizeText(singleQuotePayload)
      expect(cleanedSingle).toBe('&#39; onmouseover=&#39;alert(1)')
      expect(cleanedSingle).not.toContain("'")
      expect(cleanedSingle).not.toContain('"')

      // Completed attribute breakout variant: x" onmouseover="alert('XSS')" foo="
      const completedBreakout = `x" onmouseover="alert('XSS')" foo="`
      const cleanedCompleted = sanitizeText(completedBreakout)
      expect(cleanedCompleted).toBe(`x&quot; onmouseover=&quot;alert(&#39;XSS&#39;)&quot; foo=&quot;`)
      expect(cleanedCompleted).not.toContain('"')
      expect(cleanedCompleted).not.toContain("'")
    })

    it('neutralizes single-quote attribute breakout event handler injection vectors (onclick)', () => {
      // Task t_3d970905 payload: ' onclick='alert(1)
      const onclickPayload = `' onclick='alert(1)`
      const cleanedOnclick = sanitizeText(onclickPayload)
      expect(cleanedOnclick).toBe('&#39; onclick=&#39;alert(1)')
      expect(cleanedOnclick).not.toContain("'")
      expect(cleanedOnclick).not.toContain('"')

      // Double-quote inside single-quote variant: ' onclick="alert(1)"
      const doubleInsideSingle = `' onclick="alert(1)"`
      const cleanedDouble = sanitizeText(doubleInsideSingle)
      expect(cleanedDouble).toBe('&#39; onclick=&quot;alert(1)&quot;')
      expect(cleanedDouble).not.toContain("'")
      expect(cleanedDouble).not.toContain('"')

      // Unquoted variant: ' onclick=alert(1)//
      const unquotedVariant = `' onclick=alert(1)//`
      const cleanedUnquoted = sanitizeText(unquotedVariant)
      expect(cleanedUnquoted).toBe('&#39; onclick=alert(1)//')
      expect(cleanedUnquoted).not.toContain("'")

      // Full breakout and closure: x' onclick='alert(1)' foo='
      const fullBreakout = `x' onclick='alert(1)' foo='`
      const cleanedFull = sanitizeText(fullBreakout)
      expect(cleanedFull).toBe('x&#39; onclick=&#39;alert(1)&#39; foo=&#39;')
      expect(cleanedFull).not.toContain("'")
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

    it('neutralizes nested and malformed script tag vectors <<SCRIPT>alert("XSS");//<</SCRIPT>', () => {
      const nestedPayload = '<<SCRIPT>alert("XSS");//<</SCRIPT>'
      const cleanedNested = sanitizeText(nestedPayload)
      expect(cleanedNested).toBe('&lt;&lt;SCRIPT&gt;alert(&quot;XSS&quot;);//&lt;&lt;/SCRIPT&gt;')
      expect(cleanedNested).not.toContain('<')
      expect(cleanedNested).not.toContain('>')
      expect(cleanedNested).not.toContain('"')
      expect(cleanedNested).not.toContain('<SCRIPT>')
      expect(cleanedNested).not.toContain('</SCRIPT>')
      expect(cleanedNested).toContain('&lt;&lt;SCRIPT&gt;')
      expect(cleanedNested).toContain('&lt;&lt;/SCRIPT&gt;')

      const lowerNested = '<<script>alert("XSS");//<</script>'
      const cleanedLower = sanitizeText(lowerNested)
      expect(cleanedLower).toBe('&lt;&lt;script&gt;alert(&quot;XSS&quot;);//&lt;&lt;/script&gt;')
      expect(cleanedLower).not.toContain('<')
      expect(cleanedLower).not.toContain('>')

      const recursiveNested = '<scr<script>ipt>alert(1)</script>'
      const cleanedRecursive = sanitizeText(recursiveNested)
      expect(cleanedRecursive).toBe('&lt;scr&lt;script&gt;ipt&gt;alert(1)&lt;/script&gt;')
      expect(cleanedRecursive).not.toContain('<')
      expect(cleanedRecursive).not.toContain('>')
    })

    it('neutralizes multi-vector combination payloads (task t_0ba3d7d3)', () => {
      // Title payload: Probe XSS <script>alert('QA_XSS')</script><svg onload=alert(1)>
      const titlePayload = "Probe XSS <script>alert('QA_XSS')</script><svg onload=alert(1)>"
      const cleanedTitle = sanitizeText(titlePayload)
      expect(cleanedTitle).toBe("Probe XSS &lt;script&gt;alert(&#39;QA_XSS&#39;)&lt;/script&gt;&lt;svg onload=alert(1)&gt;")
      expect(cleanedTitle).not.toContain('<script>')
      expect(cleanedTitle).not.toContain('</script>')
      expect(cleanedTitle).not.toContain('<svg')
      expect(cleanedTitle).not.toContain('<')
      expect(cleanedTitle).not.toContain('>')
      expect(cleanedTitle).not.toContain("'")

      // Body payload: Description with <img src=x onerror=alert(2)> tags
      const bodyPayload = "Description with <img src=x onerror=alert(2)> tags"
      const cleanedBody = sanitizeText(bodyPayload)
      expect(cleanedBody).toBe("Description with &lt;img src=x onerror=alert(2)&gt; tags")
      expect(cleanedBody).not.toContain('<img')
      expect(cleanedBody).not.toContain('<')
      expect(cleanedBody).not.toContain('>')

      // Combined case-insensitive / uppercase variants
      const upperPayload = "Probe XSS <SCRIPT>alert('QA_XSS')</SCRIPT><SVG ONLOAD=alert(1)><IMG SRC=X ONERROR=alert(2)>"
      const cleanedUpper = sanitizeText(upperPayload)
      expect(cleanedUpper).toBe("Probe XSS &lt;SCRIPT&gt;alert(&#39;QA_XSS&#39;)&lt;/SCRIPT&gt;&lt;SVG ONLOAD=alert(1)&gt;&lt;IMG SRC=X ONERROR=alert(2)&gt;")
      expect(cleanedUpper).not.toContain('<SCRIPT')
      expect(cleanedUpper).not.toContain('<SVG')
      expect(cleanedUpper).not.toContain('<IMG')
    })

    it('neutralizes combined multi-vector direct instruction probes <script>alert(\'INSTRUCT_XSS\')</script><svg onload=alert(\'SVG\')>', () => {
      // Task t_0d13b6f6 primary vector
      const combinedPayload = "<script>alert('INSTRUCT_XSS')</script><svg onload=alert('SVG')>"
      const cleanedCombined = sanitizeText(combinedPayload)
      expect(cleanedCombined).toBe("&lt;script&gt;alert(&#39;INSTRUCT_XSS&#39;)&lt;/script&gt;&lt;svg onload=alert(&#39;SVG&#39;)&gt;")
      expect(cleanedCombined).not.toContain('<script>')
      expect(cleanedCombined).not.toContain('</script>')
      expect(cleanedCombined).not.toContain('<svg')
      expect(cleanedCombined).not.toContain('<')
      expect(cleanedCombined).not.toContain('>')
      expect(cleanedCombined).not.toContain("'")

      // Quoted attribute variant
      const quotedVariant = '<script>alert("INSTRUCT_XSS")</script><svg onload="alert(\'SVG\')">'
      const cleanedQuoted = sanitizeText(quotedVariant)
      expect(cleanedQuoted).toBe('&lt;script&gt;alert(&quot;INSTRUCT_XSS&quot;)&lt;/script&gt;&lt;svg onload=&quot;alert(&#39;SVG&#39;)&quot;&gt;')
      expect(cleanedQuoted).not.toContain('"')
      expect(cleanedQuoted).not.toContain('<')
      expect(cleanedQuoted).not.toContain('>')

      // Case-variation variant
      const caseVariant = '<SCRIPT>alert(\'INSTRUCT_XSS\')</SCRIPT><SVG ONLOAD=alert(\'SVG\')>'
      const cleanedCase = sanitizeText(caseVariant)
      expect(cleanedCase).toBe('&lt;SCRIPT&gt;alert(&#39;INSTRUCT_XSS&#39;)&lt;/SCRIPT&gt;&lt;SVG ONLOAD=alert(&#39;SVG&#39;)&gt;')
      expect(cleanedCase).not.toContain('<')
      expect(cleanedCase).not.toContain('>')
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

  describe('Advanced SSRF Bypass Defense', () => {
    it('blocks alternative numeric representations of loopback (decimal integer, hex, octal)', () => {
      // 2130706433 = 127.0.0.1 in decimal integer
      expect(isSafeWebhookUrl('http://2130706433/webhook')).toBe(false)
      // 0x7f000001 = 127.0.0.1 in hex
      expect(isSafeWebhookUrl('http://0x7f000001/webhook')).toBe(false)
      // 0177.0.0.1 = 127.0.0.1 in octal
      expect(isSafeWebhookUrl('http://0177.0.0.1/webhook')).toBe(false)
      // 127.1 = 127.0.0.1 shortened
      expect(isSafeWebhookUrl('http://127.1/api')).toBe(false)
    })

    it('blocks the entire 127.0.0.0/8 loopback block', () => {
      expect(isSafeWebhookUrl('http://127.0.0.2:8080/')).toBe(false)
      expect(isSafeWebhookUrl('http://127.1.2.3/')).toBe(false)
      expect(isSafeWebhookUrl('http://127.255.255.254/')).toBe(false)
    })

    it('blocks carrier-grade NAT 100.64.0.0/10 and current-network 0.0.0.0/8', () => {
      expect(isSafeWebhookUrl('http://100.64.0.1/status')).toBe(false)
      expect(isSafeWebhookUrl('http://100.127.255.255/webhook')).toBe(false)
      expect(isSafeWebhookUrl('http://0.0.0.0/')).toBe(false)
      expect(isSafeWebhookUrl('http://0.1.2.3/')).toBe(false)
    })

    it('blocks wildcard DNS rebinding domains', () => {
      expect(isSafeWebhookUrl('http://127.0.0.1.nip.io/webhook')).toBe(false)
      expect(isSafeWebhookUrl('http://test.sslip.io/')).toBe(false)
      expect(isSafeWebhookUrl('http://app.localtest.me/')).toBe(false)
      expect(isSafeWebhookUrl('http://sub.lvh.me/')).toBe(false)
    })

    it('blocks sensitive internal ports', () => {
      // Sensitive internal services: SSH, SMTP, Ruang (3001), Auth (3002), Ollama (11434), Hermes (20128)
      expect(isSafeWebhookUrl('http://example.com:22/')).toBe(false)
      expect(isSafeWebhookUrl('http://example.com:3001/')).toBe(false)
      expect(isSafeWebhookUrl('http://example.com:3002/')).toBe(false)
      expect(isSafeWebhookUrl('http://example.com:11434/')).toBe(false)
      expect(isSafeWebhookUrl('http://example.com:20128/')).toBe(false)
      expect(isSafeWebhookUrl('http://example.com:6379/')).toBe(false)
    })

    it('blocks URLs with embedded credentials and dangerous schemes', () => {
      expect(isSafeWebhookUrl('http://admin:pass@example.com/')).toBe(false)
      expect(isSafeWebhookUrl('gopher://127.0.0.1:6379/')).toBe(false)
      expect(isSafeWebhookUrl('file:///etc/passwd')).toBe(false)
      expect(isSafeWebhookUrl('ftp://example.com/')).toBe(false)
    })
  })

  describe('Operator Key Validation & Progressive Lockout', () => {
    it('validates operator key safely from persistent file and rejects wrong keys', () => {
      // Wrong keys
      expect(validateOperatorKey('')).toBe(false)
      expect(validateOperatorKey('short')).toBe(false)
      expect(validateOperatorKey('wrong-invalid-key-attempt')).toBe(false)
      expect(validateOperatorKey('1234567')).toBe(false)
    })

    it('throttles failed operator login attempts and activates progressive lockout', () => {
      const testIp = '198.51.100.55' // RFC 5737 test IP
      expect(checkOperatorLoginRateLimit(testIp).allowed).toBe(true)

      // Simulate 5 failed attempts
      for (let i = 0; i < 5; i++) {
        recordOperatorLoginFailure(testIp)
      }

      // 6th attempt should be locked out
      const locked = checkOperatorLoginRateLimit(testIp)
      expect(locked.allowed).toBe(false)
      expect(locked.retryAfterMs).toBeGreaterThan(0)

      // Reset on success
      recordOperatorLoginSuccess(testIp)
      expect(checkOperatorLoginRateLimit(testIp).allowed).toBe(true)
    })
  })

  describe('Strict RBAC & AuthenticateRequest', () => {
    it('authenticates valid signed bearer token correctly', () => {
      const token = signSessionToken({
        id: 'usr_admin',
        email: 'operator@duckvaulta.ai.id',
        name: 'Lead Operator',
        role: 'admin',
        provider: 'operator_key',
      })

      const mockReq = {
        headers: {
          authorization: `Bearer ${token}`,
        },
      } as any

      const auth = authenticateRequest(mockReq)
      expect(auth.authenticated).toBe(true)
      expect(auth.user?.role).toBe('admin')
      expect(auth.user?.email).toBe('operator@duckvaulta.ai.id')
    })

    it('rejects unauthenticated or tampered request', () => {
      const mockReqNoAuth = { headers: {} } as any
      expect(authenticateRequest(mockReqNoAuth).authenticated).toBe(false)

      const mockReqBadSig = {
        headers: {
          authorization: 'Bearer bad.token.here',
        },
      } as any
      expect(authenticateRequest(mockReqBadSig).authenticated).toBe(false)
    })
  })

  describe('Buffer Spam & Repetition Filtering', () => {
    it('rejects single-character flooding (>= 10 consecutive identical chars)', () => {
      const flood = 'Normal prefix aaaaaaaaaa suffix'
      expect(isBufferSpam(flood).spam).toBe(true)
      expect(isValidTaskContent('Clean Title', flood).valid).toBe(false)
      expect(isValidInstructionContent(flood).valid).toBe(false)
    })

    it('rejects cyclic 2-character repeating patterns (e.g. ababababab)', () => {
      const cyclic2 = 'abababababab'
      expect(isBufferSpam(cyclic2).spam).toBe(true)
      expect(isValidTaskContent('Task', cyclic2).valid).toBe(false)
    })

    it('rejects cyclic 3-character repeating patterns (e.g. abcabcabcabc)', () => {
      const cyclic3 = 'abcabcabcabc'
      expect(isBufferSpam(cyclic3).spam).toBe(true)
    })

    it('rejects cyclic 4-8 character phrase repetitions (e.g. spam_spam_spam_)', () => {
      const phraseSpam = 'spam_spam_spam_'
      expect(isBufferSpam(phraseSpam).spam).toBe(true)
    })

    it('rejects ASCII control characters and null byte injection vectors', () => {
      expect(isBufferSpam('Attack\x00Payload').spam).toBe(true)
      expect(isBufferSpam('Attack\x07Beep').spam).toBe(true)
      expect(isBufferSpam('Attack\x1bEscape').spam).toBe(true)
    })

    it('rejects zero-width and invisible unicode character floods', () => {
      const zeroWidthFlood = 'Text\u200B\u200C\u200DHidden'
      expect(isBufferSpam(zeroWidthFlood).spam).toBe(true)
    })

    it('rejects excessive newline and whitespace flooding', () => {
      const newlineFlood = 'Line 1\n\n\n\n\nLine 2'
      expect(isBufferSpam(newlineFlood).spam).toBe(true)
      const spaceFlood = 'Word' + ' '.repeat(30) + 'Word'
      expect(isBufferSpam(spaceFlood).spam).toBe(true)
    })

    it('rejects low-entropy repetitive fuzzing strings', () => {
      const lowEntropy = '0101010101010101010101010101010101010101'
      expect(isBufferSpam(lowEntropy).spam).toBe(true)
    })

    it('allows valid human sentences and technical tasks without false positives', () => {
      const validTitle = 'Implementasi Audit Keamanan & Hardening Port'
      const validDesc = 'Lakukan validasi zero-trust perimeter pada port internal 3001, 4173, dan 11434. Pastikan enkripsi TLS aktif dan cert valid.'
      const validInstruct = 'Jalankan verifikasi port hardening dan laporkan hasilnya.'

      expect(isValidTaskContent(validTitle, validDesc).valid).toBe(true)
      expect(isValidInstructionContent(validInstruct).valid).toBe(true)
    })
  })

  describe('Webhook HMAC Signature Generation', () => {
    it('generates consistent sha256 HMAC signatures', () => {
      const payload = JSON.stringify({ event: 'ping', test: true })
      const key = 'secret-agent-key-12345'
      const sig1 = signWebhookPayload(payload, key)
      const sig2 = signWebhookPayload(payload, key)

      expect(sig1).toBe(sig2)
      expect(sig1.startsWith('sha256=')).toBe(true)
      expect(sig1.length).toBe(7 + 64)
    })
  })
})
