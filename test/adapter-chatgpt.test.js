import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { page, mockFetch } from './helpers.js'
import adapter from '../src/adapters/chatgpt.js'
import { extractConversation } from '../src/core/run.js'
import { toMarkdown } from '../src/formatters/markdown.js'

const CONV = '11111111-2222-3333-4444-555555555555'
const node = (id, parent, children, message) => ({ id, parent, children, message })

function conversationPayload() {
  return {
    title: 'GPT branches',
    create_time: 1767322245,
    update_time: 1767322999,
    default_model_slug: 'gpt-5',
    current_node: 'a2b',
    mapping: {
      root: node('root', null, ['sys'], null),
      sys: node('sys', 'root', ['u1'], { id: 'sys', author: { role: 'system' }, content: { content_type: 'text', parts: [''] }, metadata: { is_visually_hidden_from_conversation: true } }),
      u1: node('u1', 'sys', ['a1'], { id: 'u1', author: { role: 'user' }, create_time: 1767322245, content: { content_type: 'text', parts: ['First question'] }, metadata: { attachments: [{ name: 'data.csv', mime_type: 'text/csv', size: 120 }] } }),
      a1: node('a1', 'u1', ['a1code'], { id: 'a1', author: { role: 'assistant' }, create_time: 1767322250, content: { content_type: 'text', parts: ['Answer part one.'] }, metadata: { model_slug: 'gpt-5-thinking' } }),
      a1code: node('a1code', 'a1', ['a1out'], { id: 'a1code', author: { role: 'assistant' }, recipient: 'all', content: { content_type: 'code', language: 'python', text: 'print(42)' } }),
      a1out: node('a1out', 'a1code', ['u2'], { id: 'a1out', author: { role: 'tool', name: 'python' }, content: { content_type: 'execution_output', text: '42' } }),
      u2: node('u2', 'a1out', ['a2a', 'a2b'], { id: 'u2', author: { role: 'user' }, create_time: 1767322300, content: { content_type: 'multimodal_text', parts: ['Second question', { content_type: 'image_asset_pointer', asset_pointer: 'file-service://file-ABC', width: 10, height: 10 }] } }),
      a2a: node('a2a', 'u2', [], { id: 'a2a', author: { role: 'assistant' }, create_time: 1767322310, content: { content_type: 'text', parts: ['OLD regenerated answer'] }, metadata: {} }),
      a2b: node('a2b', 'u2', [], { id: 'a2b', author: { role: 'assistant' }, create_time: 1767322320, content: { content_type: 'text', parts: ['Second answer'] }, metadata: { finish_details: { type: 'interrupted' }, content_references: [{ type: 'webpage', title: 'Ref', url: 'https://ref.example/x' }] } }),
      thought: node('thought', 'u2', [], { id: 'thought', author: { role: 'assistant' }, content: { content_type: 'thoughts', thoughts: [{ summary: 'hidden reasoning' }] }, metadata: { is_visually_hidden_from_conversation: true } }),
    },
  }
}

test('API path: active branch, merging, hidden nodes, attachments, inactive branch', async () => {
  const p = page(null, `https://chatgpt.com/c/${CONV}`)
  const log = []
  const fetch = mockFetch(
    {
      '/api/auth/session': { accessToken: 'tok-123', user: { email: 'x@y' } },
      [`/backend-api/conversation/${CONV}`]: (init) => {
        assert.equal(init.headers.authorization, 'Bearer tok-123')
        return conversationPayload()
      },
    },
    log,
  )
  const conv = await extractConversation(adapter, { location: p.location, document: p.document, fetch })
  assert.equal(conv.source.method, 'api')
  assert.equal(conv.title, 'GPT branches')
  assert.equal(conv.model, 'gpt-5-thinking')
  assert.equal(conv.createdAt, '2026-01-02T02:50:45.000Z')
  assert.equal(conv.completeness, 'complete')
  assert.equal(conv.stats.messages, 4, 'user, merged assistant, user, assistant')
  const [u1, a1, u2, a2] = conv.messages
  assert.equal(u1.role, 'user')
  assert.deepEqual(u1.content.map((b) => b.type), ['text', 'attachment'])
  assert.equal(u1.content[1].name, 'data.csv')
  assert.deepEqual(a1.content.map((b) => b.type), ['text', 'code'], 'execution output of hidden tool skipped, code merged')
  assert.equal(a1.content[1].language, 'python')
  assert.deepEqual(u2.content.map((b) => b.type), ['text', 'image'])
  assert.equal(u2.content[1].name, 'file-ABC')
  assert.equal(a2.siblings, 2)
  assert.equal(a2.flags.interrupted, true)
  assert.equal(a2.content.find((b) => b.type === 'citation').url, 'https://ref.example/x')
  assert.equal(conv.inactiveMessages.length, 1)
  assert.equal(conv.inactiveMessages[0].content[0].markdown, 'OLD regenerated answer')
  assert.equal(conv.stats.branchedMessages, 1)
  const md = toMarkdown(conv)
  assert.ok(!md.includes('OLD regenerated'), 'markdown shows the selected branch only')
  assert.ok(!md.includes('hidden reasoning'))
  assert.ok(md.includes('```python\nprint(42)\n```'))
  assert.ok(log.every((r) => r.url.startsWith('https://chatgpt.com/')), 'all requests same-origin')
  assert.ok(!JSON.stringify(conv).includes('tok-123'), 'token never lands in the export')
})

test('API failure falls back to DOM with a warning and partial completeness', async () => {
  const html = readFileSync(new URL('./fixtures/chatgpt-dom.html', import.meta.url), 'utf8')
  const p = page(html, `https://chatgpt.com/c/${CONV}`)
  const fetch = mockFetch({ '/api/auth/session': {} })
  const conv = await extractConversation(adapter, { location: p.location, document: p.document, fetch })
  assert.equal(conv.source.method, 'dom')
  assert.equal(conv.completeness, 'partial')
  assert.equal(conv.title, 'Sorting algorithms')
  assert.ok(conv.warnings.some((w) => w.code === 'dom-fallback' && /session token/.test(w.message)))
  assert.equal(conv.messages.length, 2)
  assert.equal(conv.messages[0].content[0].markdown, 'Explain quicksort in \\*\\*short\\*\\*')
  const md = conv.messages[1].content[0].markdown
  assert.ok(md.includes('**divide and conquer**'))
  assert.ok(md.includes('```python\ndef qs(a):\n    return a\n```'), md)
  assert.ok(md.includes('| Case | Time |\n| --- | --- |\n| Best | n log n |'))
  assert.ok(md.includes('$O(n \\log n)$'))
  assert.ok(!md.includes('Copy code') && !md.includes('ChatGPT said'))
})

test('no conversation id -> API path returns null, DOM may still work', async () => {
  const p = page(null, 'https://chatgpt.com/')
  assert.equal(adapter.conversationId(p.location), null)
  assert.equal(await adapter.fromApi({ location: p.location }), null)
})

test('DOM path on the current (octane) markup: li[data-message-role], label-text code language, math, table', async () => {
  const html = readFileSync(new URL('./fixtures/chatgpt-dom-octane.html', import.meta.url), 'utf8')
  const p = page(html, 'https://chatgpt.com/uc/6ad19a2a-62d0-83ea-b5d5-cc0e30b5fe0a')
  assert.equal(adapter.conversationId(p.location), '6ad19a2a-62d0-83ea-b5d5-cc0e30b5fe0a')
  const conv = await extractConversation(adapter, { location: p.location, document: p.document, fetch: mockFetch({ '/api/auth/session': {} }) })
  assert.equal(conv.source.method, 'dom')
  assert.equal(conv.title, 'Untitled conversation', 'generic page title is not used as the conversation title')
  assert.equal(conv.messages.length, 2)
  assert.equal(conv.messages[0].id, 'a78f5502-3b29-4553-b84f-88e1ef05b674')
  assert.equal(conv.messages[0].content[0].markdown, 'Explain quicksort in 3 sentences.')
  const md = conv.messages[1].content[0].markdown
  assert.equal(
    md,
    'Runs in $O(n\\log n)$ time.\n\n### Python implementation\n\n```python\ndef quicksort(arr):\n    return arr\n```\n\n| Case | Time |\n| --- | --- |\n| Best | n log n |\n\n$$\nT(n)=\\Theta(n\\log n)\n$$',
  )
  assert.ok(!md.includes('You said') && !md.includes('Copy'))
})
