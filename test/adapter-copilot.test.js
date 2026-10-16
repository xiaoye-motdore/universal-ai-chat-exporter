import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { page, mockFetch } from './helpers.js'
import adapter from '../src/adapters/copilot.js'
import { extractConversation } from '../src/core/run.js'

const ID = 'Ab12cD34eF56gH78'
const URL_ = `https://copilot.microsoft.com/chats/${ID}`
const html = readFileSync(new URL('./fixtures/copilot-dom.html', import.meta.url), 'utf8')

// Newest first, as the API answers; author as a string or as { type }.
const history = {
  results: [
    { id: 'm4', author: { type: 'ai' }, createdAt: '2026-10-02T09:03:00Z', content: [{ type: 'chainOfThought', text: 'SECRET' }, { type: 'text', text: 'Enjoy your trip.' }] },
    { id: 'm3', author: 'human', createdAt: '2026-10-02T09:02:00Z', content: [{ type: 'text', text: 'Thanks!' }] },
    { id: 'm2', author: 'ai', createdAt: '2026-10-02T09:01:00Z', content: [{ type: 'text', text: 'Here is a plan:' }, { type: 'text', text: '## Saturday\n\n- Alfama' }] },
    { id: 'm1', author: 'human', createdAt: '2026-10-02T09:00:00Z', content: [{ type: 'text', text: 'Suggest a weekend plan in Lisbon.' }] },
    { id: 'sys', author: 'system', content: [{ type: 'text', text: 'hidden' }] },
  ],
}

test('API path: history reversed to chronological, text parts joined, title from sidebar', async () => {
  const p = page(html, URL_)
  const log = []
  const fetch = mockFetch({ [`/c/api/conversations/${ID}/history?api-version=2`]: history }, log)
  const conv = await extractConversation(adapter, { location: p.location, document: p.document, fetch })
  assert.equal(log.length, 1)
  assert.ok(log[0].url.startsWith('https://copilot.microsoft.com/c/api/conversations/'))
  assert.equal(conv.source.method, 'api')
  assert.equal(conv.title, 'Weekend plans')
  assert.deepEqual(conv.messages.map((m) => m.id), ['m1', 'm2', 'm3', 'm4'])
  assert.deepEqual(conv.messages.map((m) => m.role), ['user', 'assistant', 'user', 'assistant'])
  assert.equal(conv.messages[1].content[0].markdown, 'Here is a plan:\n\n## Saturday\n\n- Alfama')
  assert.equal(conv.messages[3].content[0].markdown, 'Enjoy your trip.')
  assert.equal(conv.createdAt, '2026-10-02T09:00:00.000Z')
  assert.equal(conv.updatedAt, '2026-10-02T09:03:00.000Z')
  assert.ok(!JSON.stringify(conv).includes('SECRET') && !JSON.stringify(conv).includes('hidden'))
})

test('HTTP 401 (signed-in session needs a token we do not read) falls back to the DOM', async () => {
  const p = page(html, URL_)
  const fetch = async () => ({ ok: false, status: 401, json: async () => ({}), text: async () => '' })
  const conv = await extractConversation(adapter, { location: p.location, document: p.document, fetch })
  assert.equal(conv.source.method, 'dom')
  assert.equal(conv.completeness, 'partial')
  assert.ok(conv.warnings.some((w) => /HTTP 401/.test(w.message)))
  assert.equal(conv.title, 'Weekend plans')
  assert.deepEqual(conv.messages.map((m) => m.role), ['user', 'assistant', 'user', 'assistant'])
  assert.equal(conv.messages[0].content[0].markdown, 'Suggest a weekend plan in Lisbon.')
  const md = conv.messages[1].content[0].markdown
  assert.ok(md.includes('## Saturday\n\n- Alfama walk\n- Tram 28'), md)
  assert.ok(md.includes('```python\nprint("olá")\n```'), md)
  assert.ok(md.includes('| Day | Area |\n| --- | --- |\n| 1 | Alfama |'), md)
  assert.ok(!md.includes('Like') && !md.includes('Dislike'))
})

test('generic document.title is not used as a conversation title', async () => {
  const p = page('<!doctype html><html><head><title>Microsoft Copilot: Your AI companion</title></head><body><div class="group/user-message"><div data-content="user-message">Hi</div></div></body></html>', URL_)
  const conv = await extractConversation(adapter, { location: p.location, document: p.document, fetch: mockFetch({}) })
  assert.equal(conv.title, 'Untitled conversation')
})

test('hosts and conversation ids', () => {
  assert.equal(adapter.conversationId(new URL(URL_)), ID)
  assert.equal(adapter.conversationId(new URL('https://copilot.microsoft.com/')), null)
  assert.equal(adapter.conversationId(new URL('https://copilot.microsoft.com/shares/abc')), null)
  assert.ok(adapter.matches(new URL('https://www.copilot.com/chats/x')))
  assert.ok(!adapter.matches(new URL('https://m365.cloud.microsoft/chat')))
})
