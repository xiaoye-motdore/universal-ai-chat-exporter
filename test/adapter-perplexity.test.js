import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { page, mockFetch } from './helpers.js'
import adapter from '../src/adapters/perplexity.js'
import { extractConversation } from '../src/core/run.js'

const SLUG = 'best-hiking-boots-for-wet-cli-AbC123_xyz'
const URL_ = `https://www.perplexity.ai/search/${SLUG}`
const QUERY = 'with_parent_info=true&with_schematized_response=true&version=2.18&source=default&limit=50&from_first=true'

const entry1 = {
  uuid: 'e1',
  backend_uuid: 'b1',
  query_str: 'Best hiking boots for wet climates?',
  thread_title: 'Best hiking boots',
  display_model: 'pplx_pro',
  entry_created_datetime: '2026-10-01T10:00:00.123456',
  updated_datetime: '2026-10-01T10:00:20.000000',
  blocks: [
    { intended_usage: 'ask_text_0_markdown', markdown_block: { answer: 'DRAFT' } },
    { intended_usage: 'ask_text', markdown_block: { answer: 'Look for **waterproof** membranes[1].\n\n| Boot | Price |\n|---|---|\n| A | 1 |', chunks: ['Look for'] } },
    { intended_usage: 'web_results', web_result_block: { web_results: [{ name: 'Boot guide', url: 'https://example.com/boots', snippet: 's' }, { name: 'dup', url: 'https://example.com/boots' }] } },
  ],
}
const entry2 = { uuid: 'e2', query_str: 'And for summer?', updated_datetime: '2026-10-01T10:05:00', blocks: [{ intended_usage: 'ask_text', markdown_block: { answer: 'Mesh uppers.' } }, { sources_mode_block: { web_results: [{ title: 'Summer', url: 'https://example.com/summer' }] } }] }

test('API path: pagination by next_cursor, ask_text block preferred, sources deduplicated, UTC timestamps', async () => {
  const p = page(null, URL_)
  const log = []
  const fetch = mockFetch(
    {
      [`/rest/thread/${SLUG}?${QUERY}&offset=0`]: { status: 'ok', entries: [entry1], has_next_page: true, next_cursor: 'CUR-1' },
      [`/rest/thread/${SLUG}?${QUERY}&offset=CUR-1`]: { entries: [entry1, entry2], has_next_page: false },
    },
    log,
  )
  const conv = await extractConversation(adapter, { location: p.location, document: p.document, fetch })
  assert.equal(log.length, 2)
  assert.ok(log.every((r) => r.url.startsWith('https://www.perplexity.ai/rest/thread/')))
  assert.equal(conv.source.method, 'api')
  assert.equal(conv.source.conversationId, SLUG)
  assert.equal(conv.title, 'Best hiking boots')
  assert.equal(conv.model, 'pplx_pro')
  assert.equal(conv.stats.messages, 4)
  const [q1, a1, q2, a2] = conv.messages
  assert.equal(q1.content[0].markdown, 'Best hiking boots for wet climates?')
  assert.equal(q1.createdAt, '2026-10-01T10:00:00.123Z')
  assert.equal(a1.content[0].markdown, 'Look for **waterproof** membranes[1].\n\n| Boot | Price |\n|---|---|\n| A | 1 |')
  assert.deepEqual(a1.content.slice(1), [{ type: 'citation', title: 'Boot guide', url: 'https://example.com/boots' }])
  assert.equal(a1.parentId, 'e1:q')
  assert.equal(q2.content[0].markdown, 'And for summer?')
  assert.deepEqual(a2.content.map((b) => b.type), ['text', 'citation'])
  assert.equal(a2.content[1].title, 'Summer')
  assert.equal(conv.updatedAt, '2026-10-01T10:05:00.000Z')
  assert.ok(!JSON.stringify(conv).includes('DRAFT'))
})

test('unexpected payload falls back to the DOM', async () => {
  const html = readFileSync(new URL('./fixtures/perplexity-dom.html', import.meta.url), 'utf8')
  const p = page(html, URL_)
  const fetch = mockFetch({ [`/rest/thread/${SLUG}?${QUERY}&offset=0`]: { error: 'nope' } })
  const conv = await extractConversation(adapter, { location: p.location, document: p.document, fetch })
  assert.equal(conv.source.method, 'dom')
  assert.equal(conv.completeness, 'partial')
  assert.equal(conv.title, 'Best hiking boots')
  assert.deepEqual(conv.messages.map((m) => m.role), ['user', 'assistant', 'user', 'assistant'])
  assert.equal(conv.messages[0].content[0].markdown, 'Best hiking boots for wet climates?')
  const md = conv.messages[1].content[0].markdown
  assert.ok(md.includes('**waterproof membranes**') && md.includes('[1](https://example.com/boots)'), md)
  assert.ok(md.includes('### Top picks\n\n1. Boot A\n2. Boot B'), md)
  assert.ok(md.includes('```text\nGORE-TEX, Vibram\n```'), md)
  assert.ok(!md.includes('Copy') && !md.includes('Share') && !md.includes('Expand'))
  assert.equal(conv.messages[3].content[0].markdown, 'Breathable mesh uppers.')
})

test('thread slug detection', () => {
  assert.equal(adapter.conversationId(new URL(URL_)), SLUG)
  assert.equal(adapter.conversationId(new URL('https://www.perplexity.ai/')), null)
  assert.equal(adapter.conversationId(new URL('https://www.perplexity.ai/discover')), null)
  assert.ok(adapter.matches(new URL('https://perplexity.ai/search/x')))
  assert.ok(!adapter.matches(new URL('https://perplexity.ai.evil.com/search/x')))
})
