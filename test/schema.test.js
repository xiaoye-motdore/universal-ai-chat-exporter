import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createConversation, createMessage, block, finalize, validateConversation, toIso } from '../src/core/schema.js'

test('toIso accepts ISO, epoch seconds and epoch milliseconds', () => {
  assert.equal(toIso('2026-01-02T03:04:05.000Z'), '2026-01-02T03:04:05.000Z')
  assert.equal(toIso(1767322245), '2026-01-02T02:50:45.000Z')
  assert.equal(toIso(1767322245000), '2026-01-02T02:50:45.000Z')
  assert.equal(toIso('garbage'), null)
  assert.equal(toIso(null), null)
})

test('blocks drop empty content', () => {
  assert.equal(block.text('   '), null)
  assert.equal(block.code('', 'js'), null)
  assert.deepEqual(block.text('hi\r\nthere'), { type: 'text', markdown: 'hi\nthere' })
})

test('finalize computes stats and drops empty messages', () => {
  const conv = createConversation({
    platform: 'test',
    messages: [
      createMessage({ id: '1', role: 'user', content: [block.text('q')] }),
      createMessage({ id: '2', role: 'assistant', content: [], siblings: 3 }),
      createMessage({ id: '3', role: 'assistant', content: [block.text('a')], siblings: 2 }),
    ],
  })
  finalize(conv)
  assert.equal(conv.messages.length, 2)
  assert.deepEqual(conv.stats, { messages: 2, user: 1, assistant: 1, other: 0, branchedMessages: 1 })
  assert.deepEqual(validateConversation(conv), [])
})

test('validateConversation reports bad shapes', () => {
  const conv = createConversation({ platform: 'x', messages: [{ role: 'alien', content: [{ type: 'nope' }] }] })
  const issues = validateConversation(conv)
  assert.ok(issues.some((i) => i.includes('invalid role')))
  assert.ok(issues.some((i) => i.includes('invalid block type')))
})
