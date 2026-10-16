import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { page, mockFetch } from './helpers.js'
import adapter from '../src/adapters/grok.js'
import { extractConversation } from '../src/core/run.js'
import { toMarkdown } from '../src/formatters/markdown.js'

const CONV = '12345678-1234-4123-8123-123456789abc'
const URL_ = `https://grok.com/c/${CONV}?rid=abc`

// Tree: u1 -> a1 -> u2 -> { a2a (abandoned), a2b (regenerated, newest) }
const nodes = [
  { responseId: 'u1', sender: 'human', parentResponseId: '' },
  { responseId: 'a1', sender: 'ASSISTANT', parentResponseId: 'u1' },
  { responseId: 'u2', sender: 'human', parentResponseId: 'a1' },
  { responseId: 'a2a', sender: 'ASSISTANT', parentResponseId: 'u2' },
  { responseId: 'a2b', sender: 'ASSISTANT', parentResponseId: 'u2' },
]
const responses = [
  { responseId: 'u1', message: 'What is 2+2?', sender: 'human', createTime: '2026-04-02T06:26:13.519Z', partial: false, model: 'grok-3' },
  { responseId: 'a1', message: '**4**.\n\n```python\nprint(2+2)\n```', sender: 'ASSISTANT', createTime: '2026-04-02T06:26:30.548Z', parentResponseId: 'u1', model: 'grok-3', webSearchResults: [{ url: 'https://noise.example/1', title: 'Noise' }], citedWebSearchResults: [{ url: 'https://example.com/math', title: 'Math facts', preview: 'x' }] },
  { responseId: 'u2', message: '', query: 'Draw it', sender: 'human', createTime: '2026-04-02T06:27:00.000Z', parentResponseId: 'a1' },
  { responseId: 'a2a', message: 'OLD attempt', sender: 'ASSISTANT', createTime: '2026-04-02T06:27:10.000Z', parentResponseId: 'u2' },
  { responseId: 'a2b', message: 'Here you go', sender: 'ASSISTANT', createTime: '2026-04-02T06:28:00.000Z', parentResponseId: 'u2', partial: true, generatedImageUrls: ['users/abc/generated/img1.jpg'] },
]

test('API path: tree + load-responses, newest branch, regenerations, citations', async () => {
  const p = page('<!doctype html><html><head><title>Adding numbers - Grok</title></head><body></body></html>', URL_)
  const log = []
  const fetch = mockFetch(
    {
      [`/rest/app-chat/conversations/${CONV}/response-node?includeThreads=true`]: { conversationId: CONV, responseNodes: nodes },
      [`POST /rest/app-chat/conversations/${CONV}/load-responses`]: (init) => {
        assert.deepEqual(JSON.parse(init.body).responseIds, nodes.map((n) => n.responseId))
        return { responses }
      },
    },
    log,
  )
  const conv = await extractConversation(adapter, { location: p.location, document: p.document, fetch })
  assert.equal(conv.source.method, 'api')
  assert.equal(conv.source.conversationId, CONV)
  assert.equal(conv.title, 'Adding numbers')
  assert.equal(conv.model, 'grok-3')
  assert.equal(log.length, 2)
  assert.ok(log.every((r) => r.url.startsWith('https://grok.com/')))
  assert.deepEqual(conv.messages.map((m) => m.id), ['u1', 'a1', 'u2', 'a2b'])
  assert.deepEqual(conv.messages[1].content.map((b) => b.type), ['text', 'citation'])
  assert.equal(conv.messages[1].content[1].url, 'https://example.com/math')
  assert.equal(conv.messages[2].content[0].markdown, 'Draw it', 'empty message falls back to query')
  assert.equal(conv.messages[3].siblings, 2)
  assert.equal(conv.messages[3].flags.interrupted, true)
  assert.equal(conv.inactiveMessages.length, 1)
  assert.equal(conv.inactiveMessages[0].id, 'a2a')
  assert.equal(conv.createdAt, '2026-04-02T06:26:13.519Z')
  const md = toMarkdown(conv)
  assert.ok(md.includes('```python\nprint(2+2)\n```') && !md.includes('OLD attempt') && !md.includes('noise.example'))
})

test('unexpected API shape falls back to the DOM with a warning', async () => {
  const html = readFileSync(new URL('./fixtures/grok-dom.html', import.meta.url), 'utf8')
  const p = page(html, URL_)
  const fetch = mockFetch({ [`/rest/app-chat/conversations/${CONV}/response-node?includeThreads=true`]: { responseNodes: 'nope' } })
  const conv = await extractConversation(adapter, { location: p.location, document: p.document, fetch })
  assert.equal(conv.source.method, 'dom')
  assert.equal(conv.completeness, 'partial')
  assert.ok(conv.warnings.some((w) => w.code === 'dom-fallback' && /response-node/.test(w.message)))
  assert.equal(conv.title, 'Capital gains tax')
  assert.equal(conv.messages.length, 2)
  assert.equal(conv.messages[0].role, 'user')
  assert.equal(conv.messages[0].content[0].markdown, 'Does a higher capital gains tax raise revenue?\nAssume the rate doubles.')
  const md = conv.messages[1].content[0].markdown
  assert.ok(md.includes('## Three effects'), md)
  assert.ok(md.includes('- **Timing.** Owners choose when to sell.'), md)
  assert.ok(md.includes('[⁠CBO](https://www.cbo.gov/publication/example)'), md)
  assert.ok(md.includes('```\ncurl -X POST\n\necho done\n```'), md)
  assert.ok(md.includes('$$\n\\text{revenue} = \\text{rate} \\times \\text{base}\n$$'), md)
  assert.ok(md.includes('| Rate | Revenue |\n| --- | --- |\n| 20% | 100 |'), md)
  for (const leak of ['SECRET', 'Worked for', 'Copy', 'Retry', 'Edit', 'Bash']) assert.ok(!md.includes(leak), `leaked: ${leak}`)
})

test('no conversation id -> API path is skipped', async () => {
  const p = page(null, 'https://grok.com/')
  assert.equal(await adapter.fromApi({ location: p.location, document: p.document }), null)
  assert.equal(adapter.conversationId(new URL(URL_)), CONV)
  assert.equal(adapter.conversationId(new URL('https://grok.com/share/abc')), null)
})
