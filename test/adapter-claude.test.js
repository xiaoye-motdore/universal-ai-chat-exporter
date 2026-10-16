import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { page, mockFetch } from './helpers.js'
import adapter from '../src/adapters/claude.js'
import { extractConversation } from '../src/core/run.js'
import { toMarkdown } from '../src/formatters/markdown.js'

const CONV = '11111111-2222-3333-4444-555555555555'
const ORG_A = 'aaaaaaaa-0000-0000-0000-000000000000'
const ORG_B = 'bbbbbbbb-0000-0000-0000-000000000000'

function payload() {
  return {
    name: 'Claude tree',
    model: 'claude-opus-5',
    created_at: '2026-10-01T10:00:00.000000Z',
    updated_at: '2026-10-01T11:00:00.000000Z',
    current_leaf_message_uuid: 'a2b',
    chat_messages: [
      {
        uuid: 'u1', parent_message_uuid: '00000000-0000-4000-8000-000000000000', index: 0, sender: 'human', created_at: '2026-10-01T10:00:00Z', text: '',
        content: [{ type: 'text', text: 'Analyze this PRD' }],
        attachments: [{ file_name: 'PRD.md', file_type: 'text/markdown', file_size: 300, extracted_content: '# PRD\n\nBody.' }],
        files: [{ file_kind: 'image', file_name: 'shot.png', file_uuid: 'f1', preview_url: '/api/f1/preview' }, { file_kind: 'document', file_name: 'spec.pdf', file_uuid: 'f2', document_asset: { url: '/api/f2/doc', page_count: 3 } }],
      },
      {
        uuid: 'a1', parent_message_uuid: 'u1', index: 1, sender: 'assistant', created_at: '2026-10-01T10:01:00Z', stop_reason: 'end_turn',
        content: [
          { type: 'thinking', thinking: 'SECRET reasoning' },
          { type: 'text', text: 'Here is my analysis.\n\n## Section\n\n| a | b |\n|---|---|\n| 1 | 2 |' },
          { type: 'tool_use', name: 'web_search', input: { query: 'PRD best practices' } },
          { type: 'tool_result', name: 'web_search', content: [{ type: 'text', text: 'RESULT noise' }] },
          { type: 'tool_use', name: 'artifacts', input: { command: 'create', id: 'art1', title: 'parser.py', type: 'application/vnd.ant.code', language: 'python', content: 'print("v1")', version_uuid: 'v1' } },
          { type: 'tool_use', name: 'artifacts', input: { command: 'update', id: 'art1', old_str: 'v1', new_str: 'v2 $& done', version_uuid: 'v2' } },
          { type: 'text', text: 'Done.' },
        ],
      },
      { uuid: 'u2', parent_message_uuid: 'a1', index: 2, sender: 'human', created_at: '2026-10-01T10:02:00Z', content: [{ type: 'text', text: 'Thanks' }] },
      { uuid: 'a2a', parent_message_uuid: 'u2', index: 3, sender: 'assistant', created_at: '2026-10-01T10:03:00Z', content: [{ type: 'text', text: 'OLD first attempt' }] },
      { uuid: 'a2b', parent_message_uuid: 'u2', index: 4, sender: 'assistant', created_at: '2026-10-01T10:04:00Z', stop_reason: 'user_canceled', content: [{ type: 'text', text: 'Regenerated answer' }] },
    ],
  }
}

test('API path: org discovery without cookies, branch walk, artifacts, attachments, thinking excluded', async () => {
  const p = page(null, `https://claude.ai/chat/${CONV}`)
  const log = []
  const fetch = mockFetch(
    {
      '/api/organizations': [{ uuid: ORG_A, name: 'Other org' }, { uuid: ORG_B, name: 'Mine' }],
      [`/api/organizations/${ORG_B}/chat_conversations/${CONV}?tree=True&rendering_mode=messages&render_all_tools=true`]: payload(),
    },
    log,
  )
  const conv = await extractConversation(adapter, { location: p.location, document: p.document, fetch })
  assert.equal(conv.source.method, 'api')
  assert.equal(conv.title, 'Claude tree')
  assert.equal(conv.model, 'claude-opus-5')
  assert.equal(conv.stats.messages, 4)
  assert.equal(log.length, 3, 'organizations + one 404 + one hit')
  const [u1, a1, , a2] = conv.messages
  assert.deepEqual(u1.content.map((b) => b.type), ['image', 'attachment', 'attachment', 'text'])
  assert.equal(u1.content[0].url, 'https://claude.ai/api/f1/preview')
  assert.equal(u1.content[1].url, 'https://claude.ai/api/f2/doc')
  assert.equal(u1.content[2].extractedText, '# PRD\n\nBody.')
  assert.deepEqual(a1.content.map((b) => b.type), ['text', 'tool_use', 'artifact', 'text'])
  assert.equal(a1.content[2].content, 'print("v2 $& done")', 'artifact folded; $& not interpreted')
  assert.equal(a1.content[2].kind, 'Code')
  assert.equal(a2.content[0].markdown, 'Regenerated answer')
  assert.equal(a2.siblings, 2)
  assert.equal(a2.flags.interrupted, true)
  assert.equal(conv.inactiveMessages.length, 1)
  assert.equal(conv.inactiveMessages[0].id, 'a2a')
  const md = toMarkdown(conv)
  assert.ok(!md.includes('SECRET') && !md.includes('RESULT noise') && !md.includes('OLD first'))
  assert.ok(md.includes('## Section\n\n| a | b |'), 'markdown kept verbatim')
  assert.ok(md.includes('*[Tool: web_search — PRD best practices]*'))
})

test('missing leaf falls back to index order with a warning', async () => {
  const p = page(null, `https://claude.ai/chat/${CONV}`)
  const data = payload()
  delete data.current_leaf_message_uuid
  const fetch = mockFetch({ '/api/organizations': [{ uuid: ORG_A }], [`/api/organizations/${ORG_A}/chat_conversations/${CONV}?tree=True&rendering_mode=messages&render_all_tools=true`]: data })
  const conv = await extractConversation(adapter, { location: p.location, document: p.document, fetch })
  assert.equal(conv.stats.messages, 5)
  assert.ok(conv.warnings.some((w) => w.code === 'claude-branch'))
})

test('DOM fallback reads rendered turns', async () => {
  const html = readFileSync(new URL('./fixtures/claude-dom.html', import.meta.url), 'utf8')
  const p = page(html, `https://claude.ai/chat/${CONV}`)
  const fetch = mockFetch({ '/api/organizations': [] })
  const conv = await extractConversation(adapter, { location: p.location, document: p.document, fetch })
  assert.equal(conv.source.method, 'dom')
  assert.equal(conv.completeness, 'partial')
  assert.equal(conv.title, 'Parser design')
  assert.equal(conv.messages.length, 2)
  assert.equal(conv.messages[0].content[0].markdown, 'Write a parser\n\n```\ninput: 1,2,3\n```')
  const md = conv.messages[1].content[0].markdown
  assert.ok(md.includes('```javascript\nconst parse = (s) => s.split(\',\')\n```'), md)
  assert.ok(md.includes('- Handles commas\n- Returns strings'))
  assert.ok(!md.includes('Searched the web'))
})

test('current tool names: Write carries the file content, Artifact/Skill become markers with a summary', async () => {
  const p = page(null, `https://claude.ai/chat/${CONV}`)
  const data = {
    name: 'Tools',
    current_leaf_message_uuid: 'a1',
    chat_messages: [
      { uuid: 'u1', parent_message_uuid: null, sender: 'human', content: [{ type: 'text', text: 'make a page' }] },
      {
        uuid: 'a1', parent_message_uuid: 'u1', sender: 'assistant',
        content: [
          { type: 'thinking', thinking: 'HIDDEN', summaries: [{ summary: 'HIDDEN too' }] },
          { type: 'text', text: 'Building it.' },
          { type: 'tool_use', name: 'Skill', input: { skill: 'artifact-design' } },
          { type: 'tool_result', name: 'Skill', content: [{ type: 'text', text: 'Launching skill' }] },
          { type: 'tool_use', name: 'Write', input: { file_path: '/tmp/x/hello-page.html', content: '<title>Hello</title>' } },
          { type: 'tool_result', name: 'Write', content: [{ type: 'text', text: 'File created' }] },
          { type: 'tool_use', name: 'Artifact', input: { description: 'Minimal test page.', file_path: '/tmp/x/hello-page.html', icon: 'text' } },
          { type: 'text', text: 'Done.' },
        ],
      },
    ],
  }
  const fetch = mockFetch({ '/api/organizations': [{ uuid: ORG_A }], [`/api/organizations/${ORG_A}/chat_conversations/${CONV}?tree=True&rendering_mode=messages&render_all_tools=true`]: data })
  const conv = await extractConversation(adapter, { location: p.location, document: p.document, fetch })
  const a1 = conv.messages[1]
  assert.deepEqual(a1.content.map((b) => b.type), ['text', 'tool_use', 'artifact', 'tool_use', 'text'])
  assert.equal(a1.content[1].summary, 'artifact-design')
  assert.deepEqual(a1.content[2], { type: 'artifact', title: 'hello-page.html', kind: 'File', language: 'html', content: '<title>Hello</title>' })
  assert.equal(a1.content[3].summary, 'Minimal test page.')
  const md = toMarkdown(conv)
  assert.ok(md.includes('**Artifact:** hello-page.html (File)\n\n```html\n<title>Hello</title>\n```'))
  assert.ok(!md.includes('HIDDEN'))
})
