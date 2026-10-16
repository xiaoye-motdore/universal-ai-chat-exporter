#!/usr/bin/env node
/**
 * Static security validator. Run after every build (`npm run audit:security`).
 *
 * It fails the build when the source or the shipped bookmarklet:
 *   - performs network requests anywhere except src/core/net.js
 *   - uses any API that can load or evaluate remote code
 *   - touches cookies, web storage, IndexedDB, beacons, sockets or extension APIs
 *   - uses an HTML-string sink (innerHTML, DOMParser, document.write, ...)
 *   - contains any absolute http(s) URL that is not on the allow-list (empty)
 *   - does not decode back to the committed minified bundle, byte for byte
 *   - does not match the committed SHA-256
 * The report is written to dist/security-report.json.
 */
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

// Patterns that must never appear in the runtime bundle (and in src/, except where noted).
const FORBIDDEN = [
  { re: /\beval\s*\(/, why: 'eval' },
  { re: /new\s+Function\s*\(/, why: 'Function constructor' },
  { re: /\bimportScripts\s*\(/, why: 'importScripts' },
  { re: /\bimport\s*\(/, why: 'dynamic import' },
  { re: /\bXMLHttpRequest\b/, why: 'XMLHttpRequest' },
  { re: /\bWebSocket\b/, why: 'WebSocket' },
  { re: /\bEventSource\b/, why: 'EventSource' },
  { re: /\bsendBeacon\b/, why: 'navigator.sendBeacon' },
  { re: /\bdocument\s*\.\s*cookie\b/, why: 'document.cookie' },
  { re: /\blocalStorage\b/, why: 'localStorage' },
  { re: /\bsessionStorage\b/, why: 'sessionStorage' },
  { re: /\bindexedDB\b/, why: 'indexedDB' },
  { re: /\bcaches\s*\./, why: 'Cache API' },
  { re: /\bserviceWorker\b/, why: 'service worker' },
  { re: /\binnerHTML\b/, why: 'innerHTML' },
  { re: /\bouterHTML\b/, why: 'outerHTML' },
  { re: /\binsertAdjacentHTML\b/, why: 'insertAdjacentHTML' },
  { re: /\bDOMParser\b/, why: 'DOMParser' },
  { re: /\bdocument\s*\.\s*write(ln)?\s*\(/, why: 'document.write' },
  { re: /createElement\s*\(\s*["'`]script["'`]\s*\)/, why: 'script element creation' },
  { re: /createElement\s*\(\s*["'`]iframe["'`]\s*\)/, why: 'iframe creation' },
  { re: /\bchrome\s*\.\s*(runtime|storage|tabs)\b/, why: 'extension API' },
  { re: /\bbrowser\s*\.\s*(runtime|storage|tabs)\b/, why: 'extension API' },
  { re: /\bsetTimeout\s*\(\s*["'`]/, why: 'string setTimeout' },
  { re: /\bsetInterval\s*\(\s*["'`]/, why: 'string setInterval' },
  { re: /\bnavigator\s*\.\s*(geolocation|mediaDevices|credentials|usb|bluetooth)\b/, why: 'unrelated device/credential API' },
  { re: /\bwindow\s*\.\s*open\s*\(/, why: 'window.open' },
  { re: /\blocation\s*\.\s*(href\s*=[^=]|assign\s*\(|replace\s*\()/, why: 'navigation' },
]
const FETCH_RE = /\bfetch\s*\(/
const URL_RE = /https?:\/\/[^\s"'`)<>]+/g
const ALLOWED_URLS = [] // intentionally empty: the bundle must not know any remote address

function listFiles(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...listFiles(p))
    else if (p.endsWith('.js')) out.push(p)
  }
  return out
}

const findings = []
const checks = []
const check = (name, ok, detail) => {
  checks.push({ name, ok, detail: detail || '' })
  if (!ok) findings.push(`${name}${detail ? `: ${detail}` : ''}`)
}

// ---- 1. source files -------------------------------------------------------
const srcFiles = listFiles(resolve(root, 'src')).filter((f) => !f.includes(`${join('src', 'security')}${process.platform === 'win32' ? '\\' : '/'}`))
for (const file of srcFiles) {
  const rel = relative(root, file)
  const text = readFileSync(file, 'utf8')
  const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '') // ignore comments
  for (const f of FORBIDDEN) check(`src forbidden API (${f.why})`, !f.re.test(code), rel)
  if (rel !== join('src', 'core', 'net.js')) check('src fetch outside net.js', !FETCH_RE.test(code), rel)
  const urls = (code.match(URL_RE) || []).filter((u) => !ALLOWED_URLS.includes(u))
  check('src absolute URL', urls.length === 0, urls.length ? `${rel}: ${urls.join(', ')}` : rel)
}
check('src: fetch confined to net.js', srcFiles.some((f) => relative(root, f) === join('src', 'core', 'net.js') && FETCH_RE.test(readFileSync(f, 'utf8'))), 'net.js must own the only fetch call')
const netSource = readFileSync(resolve(root, 'src/core/net.js'), 'utf8')
check('net.js enforces same origin', /url\.origin !== origin/.test(netSource))
check('net.js enforces path allow-list', /allowedPaths\.some/.test(netSource))
check('net.js refuses redirects', /redirect:\s*'error'/.test(netSource))
check('net.js uses same-origin credentials only', /credentials:\s*'same-origin'/.test(netSource) && !/credentials:\s*'include'/.test(netSource))

// ---- 2. dist ---------------------------------------------------------------
const distDir = resolve(root, 'dist')
const bmPath = join(distDir, 'ai-chat-export.bookmarklet.js')
const minPath = join(distDir, 'ai-chat-export.min.js')
const shaPath = join(distDir, 'ai-chat-export.bookmarklet.sha256')
check('dist present', existsSync(bmPath) && existsSync(minPath) && existsSync(shaPath))
if (existsSync(bmPath) && existsSync(minPath)) {
  const bookmarklet = readFileSync(bmPath, 'utf8')
  const min = readFileSync(minPath, 'utf8').trim()
  check('bookmarklet has javascript: prefix', bookmarklet.startsWith('javascript:'))
  let decoded = ''
  try {
    decoded = decodeURI(bookmarklet.slice('javascript:'.length))
    check('bookmarklet decodes', true)
  } catch (e) {
    check('bookmarklet decodes', false, e.message)
  }
  check('bookmarklet == void + minified bundle', decoded === `void ${min}`, 'the shipped URL must be exactly the audited bundle')
  const sha = createHash('sha256').update(bookmarklet).digest('hex')
  const committed = existsSync(shaPath) ? readFileSync(shaPath, 'utf8').split(/\s+/)[0] : ''
  check('bookmarklet sha256 matches dist/*.sha256', sha === committed, sha)
  for (const f of FORBIDDEN) check(`dist forbidden API (${f.why})`, !f.re.test(min))
  const urls = (min.match(URL_RE) || []).filter((u) => !ALLOWED_URLS.includes(u))
  check('dist contains no absolute URLs', urls.length === 0, urls.join(', '))
  const fetchCount = (min.match(/\bfetch\s*\(/g) || []).length
  check('dist has exactly one fetch call site', fetchCount === 1, `found ${fetchCount}`)
  check('dist uses no cookies/storage', !/cookie|localStorage|sessionStorage|indexedDB/.test(min))
  check('dist size within limit', Buffer.byteLength(bookmarklet) <= 64 * 1024, `${Buffer.byteLength(bookmarklet)} bytes`)
  const installPath = resolve(root, 'install.html')
  if (existsSync(installPath)) {
    const install = readFileSync(installPath, 'utf8')
    const escaped = bookmarklet.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
    check('install.html embeds the exact bookmarklet', install.includes(`href="${escaped}"`))
    const installUrls = (install.replace(/href="javascript:[^"]*"/g, '').match(URL_RE) || []).filter((u) => !/^https?:\/\/(chatgpt\.com|chat\.openai\.com|claude\.ai|gemini\.google\.com)(\/|$)/.test(u))
    check('install.html loads nothing remote', !/<(script|link|img|iframe)[^>]+(src|href)=["']https?:/i.test(install), installUrls.join(', '))
  }
}

const report = { ok: findings.length === 0, checks: checks.length, failed: findings.length, findings, details: checks }
writeFileSync(join(distDir, 'security-report.json'), JSON.stringify(report, null, 2) + '\n')
for (const c of checks) if (!c.ok) console.log(`FAIL  ${c.name}  ${c.detail}`)
console.log(`${report.ok ? 'PASS' : 'FAIL'}: ${checks.length - findings.length}/${checks.length} security checks passed (dist/security-report.json)`)
process.exit(report.ok ? 0 : 1)
