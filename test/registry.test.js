import { test } from 'node:test'
import assert from 'node:assert/strict'
import { detectAdapter, supportedNames, adapters } from '../src/core/registry.js'

const loc = (href) => new URL(href)

test('detects supported platforms and conversation ids', () => {
  const cases = [
    ['https://chatgpt.com/c/11111111-2222-3333-4444-555555555555', 'chatgpt', '11111111-2222-3333-4444-555555555555'],
    ['https://chatgpt.com/g/g-abc/c/11111111-2222-3333-4444-555555555555', 'chatgpt', '11111111-2222-3333-4444-555555555555'],
    ['https://chat.openai.com/', 'chatgpt', null],
    ['https://claude.ai/chat/11111111-2222-3333-4444-555555555555', 'claude', '11111111-2222-3333-4444-555555555555'],
    ['https://claude.ai/new', 'claude', null],
    ['https://gemini.google.com/app/0123456789abcdef', 'gemini', '0123456789abcdef'],
    ['https://gemini.google.com/u/1/app/0123456789abcdef', 'gemini', '0123456789abcdef'],
    ['https://grok.com/c/12345678-1234-4123-8123-123456789abc?rid=x', 'grok', '12345678-1234-4123-8123-123456789abc'],
    ['https://grok.com/', 'grok', null],
    ['https://www.perplexity.ai/search/best-boots-AbC123', 'perplexity', 'best-boots-AbC123'],
    ['https://copilot.microsoft.com/chats/Ab12cD34eF56', 'copilot', 'Ab12cD34eF56'],
    ['https://www.copilot.com/chats/Ab12cD34eF56', 'copilot', 'Ab12cD34eF56'],
  ]
  for (const [href, id, conv] of cases) {
    const a = detectAdapter(loc(href))
    assert.equal(a && a.id, id, href)
    assert.equal(a.conversationId(loc(href)), conv, href)
  }
})

test('planned platforms are detected but not exportable; unknown hosts are null', () => {
  for (const [href, id] of [['https://chat.deepseek.com/a/chat/s/x', 'deepseek']]) {
    const a = detectAdapter(loc(href))
    assert.equal(a && a.id, id, href)
    assert.equal(a.status, 'planned')
  }
  assert.equal(detectAdapter(loc('https://example.com/')), null)
  assert.equal(detectAdapter(loc('https://claude.ai.evil.com/chat/x')), null, 'suffix spoof must not match')
  assert.equal(detectAdapter(loc('https://notchatgpt.com/')), null)
  assert.equal(detectAdapter(loc('https://x.com/i/grok')), null, 'Grok inside x.com is a different app')
  assert.equal(detectAdapter(loc('https://m365.cloud.microsoft/chat')), null, 'M365 Copilot Chat is a different product')
  assert.deepEqual(supportedNames(), ['ChatGPT', 'Claude', 'Gemini', 'Grok', 'Perplexity', 'Microsoft Copilot'])
  assert.equal(adapters.length, 7)
})
