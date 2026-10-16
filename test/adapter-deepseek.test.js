/**
 * DeepSeek adapter tests. The adapter is implemented but NOT registered in the shipped
 * bookmarklet (size limit; see src/adapters/planned.js). These tests keep it working for
 * anyone who builds a bookmarklet that includes it.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { page, mockFetch } from './helpers.js'
import adapter from '../src/adapters/deepseek.js'
import { extractConversation } from '../src/core/run.js'

const ID = 'abcdef12-3456-4789-8abc-def123456789'
const URL_ = `https://chat.deepseek.com/a/chat/s/${ID}`

const bizData = {
  chat_session: { id: ID, title: 'Quicksort', current_message_id: 4, inserted_at: 1759312800, updated_at: 1759313000.5 },
  chat_messages: [
    { message_id: 1, parent_id: null, role: 'USER', inserted_at: 1759312800, fragments: [{ type: 'REQUEST', content: 'Explain quicksort' }, { type: 'FILE', content: '' }] },
    { message_id: 2, parent_id: 1, role: 'ASSISTANT', inserted_at: 1759312810, fragments: [{ type: 'THINK', content: 'SECRET reasoning' }, { type: 'RESPONSE', content: 'Pick a **pivot**.' }, { type: 'RESPONSE', content: 'Partition.' }] },
    { message_id: 3, parent_id: 2, role: 'ASSISTANT', inserted_at: 1759312900, content: 'OLD regenerated answer (legacy shape)', thinking_content: 'SECRET legacy thinking' },
    { message_id: 4, parent_id: 2, role: 'USER', inserted_at: 1759312950, fragments: [{ type: 'REQUEST', content: 'Thanks' }] },
  ],
}

test('API path: biz_data envelope, fragments, branch from current_message_id, THINK excluded', async () => {
  const p = page(null, URL_)
  const log = []
  const fetch = mockFetch({ [`/api/v0/chat/history_messages?chat_session_id=${ID}`]: { code: 0, msg: '', data: { biz_code: 0, biz_msg: '', biz_data: bizData } } }, log)
  const conv = await extractConversation(adapter, { location: p.location, document: p.document, fetch })
  assert.equal(log.length, 1)
  assert.ok(!('authorization' in log[0].init.headers), 'no token is sent (none is read)')
  assert.equal(conv.source.method, 'api')
  assert.equal(conv.title, 'Quicksort')
  assert.deepEqual(conv.messages.map((m) => m.id), ['1', '2', '4'])
  assert.equal(conv.messages[1].content[0].markdown, 'Pick a **pivot**.\n\nPartition.')
  assert.equal(conv.messages[1].createdAt, '2025-10-01T10:00:10.000Z')
  assert.equal(conv.messages[2].siblings, 2)
  assert.equal(conv.inactiveMessages[0].content[0].markdown, 'OLD regenerated answer (legacy shape)')
  assert.equal(conv.createdAt, '2025-10-01T10:00:00.000Z')
  assert.ok(!JSON.stringify(conv).includes('SECRET'))
})

test('API error envelope (signed out) falls back to the DOM', async () => {
  const html = readFileSync(new URL('./fixtures/deepseek-dom.html', import.meta.url), 'utf8')
  const p = page(html, URL_)
  const fetch = mockFetch({ [`/api/v0/chat/history_messages?chat_session_id=${ID}`]: { code: 40003, msg: 'token invalid', data: null } })
  const conv = await extractConversation(adapter, { location: p.location, document: p.document, fetch })
  assert.equal(conv.source.method, 'dom')
  assert.ok(conv.warnings.some((w) => /token invalid/.test(w.message)))
  assert.equal(conv.title, 'Sorting algorithms')
  assert.deepEqual(conv.messages.map((m) => m.role), ['user', 'assistant'])
  assert.equal(conv.messages[0].content[0].markdown, 'Explain quicksort briefly')
  const md = conv.messages[1].content[0].markdown
  assert.ok(md.includes('Quicksort picks a **pivot** and partitions.'), md)
  assert.ok(md.includes('```python\ndef qs(a): return a\n```'), md)
  assert.ok(md.includes('- Average O(n log n)'), md)
  assert.ok(!md.includes('SECRET') && !/Copy|Download/.test(md), md)
})

test('conversation id', () => {
  assert.equal(adapter.conversationId(new URL(URL_)), ID)
  assert.equal(adapter.conversationId(new URL('https://chat.deepseek.com/')), null)
})
