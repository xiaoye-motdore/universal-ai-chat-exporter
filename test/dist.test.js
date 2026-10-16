/**
 * End-to-end: decodes dist/ai-chat-export.bookmarklet.js and executes it inside a
 * jsdom page under simulated Trusted Types enforcement (innerHTML and DOMParser
 * throw, as on chatgpt.com / gemini.google.com). Verifies the panel, the download
 * and that only same-origin requests are made.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { JSDOM } from 'jsdom'

const raw = readFileSync(new URL('../dist/ai-chat-export.bookmarklet.js', import.meta.url), 'utf8')
const code = decodeURI(raw.replace(/^javascript:/, ''))

const CONV = '11111111-2222-3333-4444-555555555555'
const ORG = 'aaaaaaaa-0000-0000-0000-000000000000'

function hardenedPage(html, url, fetch) {
  const dom = new JSDOM(html, { url, runScripts: 'outside-only', pretendToBeVisual: true })
  const w = dom.window
  const requests = []
  w.fetch = async (href, init) => {
    requests.push(href)
    return fetch(href, init)
  }
  const downloads = []
  const RealBlob = w.Blob
  w.Blob = class extends RealBlob {
    constructor(parts, opts) {
      super(parts, opts)
      this.__text = parts.join('')
    }
  }
  w.URL.createObjectURL = (blob) => {
    downloads.push(blob)
    return 'blob:fake'
  }
  w.URL.revokeObjectURL = () => {}
  w.HTMLAnchorElement.prototype.click = function () {
    downloads.push({ href: this.href, download: this.download })
  }
  const desc = Object.getOwnPropertyDescriptor(w.Element.prototype, 'innerHTML')
  Object.defineProperty(w.Element.prototype, 'innerHTML', {
    get: desc.get,
    set() {
      throw new TypeError('innerHTML blocked by Trusted Types (simulated)')
    },
    configurable: true,
  })
  w.DOMParser.prototype.parseFromString = () => {
    throw new TypeError('DOMParser blocked by Trusted Types (simulated)')
  }
  return { dom, w, requests, downloads }
}

const flush = () => new Promise((r) => setTimeout(r, 30))

test('bookmarklet prefix and decodability', () => {
  assert.ok(raw.startsWith('javascript:void%20'))
  assert.ok(code.startsWith('void (') || code.startsWith('void ('))
  assert.ok(!/[\n\t]/.test(raw), 'encoded URL contains no raw whitespace')
})

test('runs on claude.ai under Trusted Types, exports via API, downloads markdown', async () => {
  const claudeFetch = async (href) => {
    const u = new URL(href)
    if (u.pathname === '/api/organizations') return { ok: true, status: 200, json: async () => [{ uuid: ORG }] }
    if (u.pathname === `/api/organizations/${ORG}/chat_conversations/${CONV}`) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          name: 'E2E chat',
          current_leaf_message_uuid: 'a1',
          chat_messages: [
            { uuid: 'u1', parent_message_uuid: null, sender: 'human', created_at: '2026-10-01T10:00:00Z', content: [{ type: 'text', text: 'Hi <b>there</b>' }] },
            { uuid: 'a1', parent_message_uuid: 'u1', sender: 'assistant', created_at: '2026-10-01T10:00:05Z', content: [{ type: 'text', text: 'Hello! ```js\nx\n```' }] },
          ],
        }),
      }
    }
    return { ok: false, status: 404 }
  }
  const { w, requests, downloads } = hardenedPage('<!doctype html><html><head></head><body><p>page</p></body></html>', `https://claude.ai/chat/${CONV}`, claudeFetch)
  w.eval(code)
  await flush()
  const panel = w.document.getElementById('uace-panel')
  assert.ok(panel, 'panel rendered')
  assert.ok(panel.textContent.includes('2 messages'), panel.textContent)
  assert.ok(requests.every((r) => r.startsWith('https://claude.ai/')))
  const buttons = Array.from(panel.querySelectorAll('button.uace-btn')).map((b) => b.textContent)
  assert.deepEqual(buttons, ['Markdown', 'JSON', 'HTML'])
  panel.querySelectorAll('button.uace-btn')[0].click()
  await flush()
  const blob = downloads.find((d) => typeof d.__text === 'string')
  const link = downloads.find((d) => d.download)
  assert.ok(blob && link)
  assert.ok(/^claude-\d{4}-\d{2}-\d{2}-E2E-chat\.md$/.test(link.download), link.download)
  const text = blob.__text
  assert.ok(text.includes('# E2E chat') && text.includes('Hi <b>there</b>') && text.includes('Hello!'))
  assert.ok(!w.document.body.textContent.includes('Export failed'))
})

test('unsupported site shows a clear message and makes no requests', async () => {
  const { w, requests } = hardenedPage('<!doctype html><html><body></body></html>', 'https://example.com/chat', async () => ({ ok: false, status: 500 }))
  w.eval(code)
  await flush()
  const panel = w.document.getElementById('uace-panel')
  assert.ok(panel.textContent.includes('not supported'))
  assert.ok(panel.textContent.includes('ChatGPT, Claude, Gemini, Grok, Perplexity, Microsoft Copilot'))
  assert.equal(requests.length, 0)
})

test('planned platform (DeepSeek) is detected and reported as not implemented', async () => {
  const { w, requests } = hardenedPage('<!doctype html><html><body></body></html>', 'https://chat.deepseek.com/a/chat/s/x', async () => ({ ok: false }))
  w.eval(code)
  await flush()
  assert.ok(w.document.getElementById('uace-panel').textContent.includes('DeepSeek detected'))
  assert.equal(requests.length, 0)
})

test('runs on grok.com under Trusted Types: API path, two same-origin requests, markdown download', async () => {
  const CID = '12345678-1234-4123-8123-123456789abc'
  const grokFetch = async (href, init) => {
    const u = new URL(href)
    if (u.pathname === `/rest/app-chat/conversations/${CID}/response-node`) return { ok: true, status: 200, json: async () => ({ responseNodes: [{ responseId: 'u1', sender: 'human' }, { responseId: 'a1', sender: 'ASSISTANT', parentResponseId: 'u1' }] }) }
    if (u.pathname === `/rest/app-chat/conversations/${CID}/load-responses` && init.method === 'POST') {
      return { ok: true, status: 200, json: async () => ({ responses: [{ responseId: 'u1', message: 'Hi Grok', sender: 'human', createTime: '2026-10-01T10:00:00Z' }, { responseId: 'a1', message: 'Hello!', sender: 'ASSISTANT', createTime: '2026-10-01T10:00:05Z', parentResponseId: 'u1' }] }) }
    }
    return { ok: false, status: 404 }
  }
  const { w, requests, downloads } = hardenedPage('<!doctype html><html><head><title>Greeting - Grok</title></head><body></body></html>', `https://grok.com/c/${CID}`, grokFetch)
  w.eval(code)
  await flush()
  const panel = w.document.getElementById('uace-panel')
  assert.ok(panel.textContent.includes('2 messages') && panel.textContent.includes('source: API'), panel.textContent)
  assert.deepEqual(requests.map((r) => new URL(r).pathname), [`/rest/app-chat/conversations/${CID}/response-node`, `/rest/app-chat/conversations/${CID}/load-responses`])
  panel.querySelectorAll('button.uace-btn')[0].click()
  await flush()
  const link = downloads.find((d) => d.download)
  assert.ok(/^grok-\d{4}-\d{2}-\d{2}-Greeting\.md$/.test(link.download), link.download)
  assert.ok(downloads.find((d) => typeof d.__text === 'string').__text.includes('Hi Grok'))
})

test('bookmarklet is idempotent: a second click replaces the panel', async () => {
  const { w } = hardenedPage('<!doctype html><html><body></body></html>', 'https://chatgpt.com/', async () => ({ ok: false }))
  w.eval(code)
  w.eval(code)
  await flush()
  assert.equal(w.document.querySelectorAll('#uace-panel').length, 1)
  assert.ok(w.document.getElementById('uace-panel').textContent.includes('Open a conversation first'))
})
