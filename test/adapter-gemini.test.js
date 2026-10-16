import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { page, mockFetch } from './helpers.js'
import adapter from '../src/adapters/gemini.js'
import { extractConversation } from '../src/core/run.js'

const CID = 'c_0123456789abcdef'
const attach = [[null, null, null, null, [[null, 11, 'Sample_Guide.pdf', null, null, '$AQbNOISE']]]]
const turnNew = [[CID, 'r_new'], [CID, 'r_old', 'rc_old_chosen'], [['Second question', null, null, null, null]], [[['rc_new', ['Second answer with **bold**.']]]], [1770564030, 0]]
const turnOld = [[CID, 'r_old'], [CID, 'r_root', 'rc_root'], [['First question', null, null, null, attach]], [[['rc_old_draft', ['WRONG abandoned draft']], ['rc_old_chosen', ['First answer, chosen draft.']]]], [1770500417, 0]]
const envelope = (payload) => `)]}'\n\n123\n${JSON.stringify([['wrb.fr', 'hNvQHb', JSON.stringify(payload), null, null, null, 'generic']])}`

function geminiPage(html) {
  const p = page(html, 'https://gemini.google.com/app/0123456789abcdef')
  p.window.WIZ_global_data = { SNlM0e: 'at-token-123', cfb2h: 'boq_test', FdrFJe: '-42' }
  return p
}

test('API path: envelope, pagination, chronological order, chosen draft, attachments', async () => {
  const p = geminiPage('<!doctype html><body><div class="conversation-title">Gemini test</div></body>')
  const requests = []
  const fetch = async (href, init) => {
    requests.push({ href, init })
    assert.ok(href.startsWith('https://gemini.google.com/_/BardChatUi/data/batchexecute?rpcids=hNvQHb'))
    assert.ok(init.body.includes('at=at-token-123'))
    const text = requests.length === 1 ? envelope([[turnNew], 'CURSOR-1', null, []]) : envelope([[turnOld], null, null, []])
    return { ok: true, status: 200, text: async () => text, json: async () => ({}) }
  }
  const conv = await extractConversation(adapter, { location: p.location, document: p.document, fetch })
  assert.equal(requests.length, 2)
  assert.ok(decodeURIComponent(requests[1].init.body).includes('CURSOR-1'))
  assert.equal(conv.source.method, 'api')
  assert.equal(conv.title, 'Gemini test')
  assert.equal(conv.stats.messages, 4)
  assert.equal(conv.messages[0].content[0].markdown, 'First question')
  assert.equal(conv.messages[0].content[1].name, 'Sample_Guide.pdf')
  assert.equal(conv.messages[0].createdAt, '2026-02-07T21:40:17.000Z')
  assert.equal(conv.messages[1].content[0].markdown, 'First answer, chosen draft.')
  assert.equal(conv.messages[1].siblings, 2)
  assert.equal(conv.inactiveMessages[0].content[0].markdown, 'WRONG abandoned draft')
  assert.equal(conv.messages[3].content[0].markdown, 'Second answer with **bold**.')
  assert.ok(!JSON.stringify(conv).includes('at-token-123'))
})

test('unexpected RPC shape aborts the API path and the DOM path takes over', async () => {
  const html = readFileSync(new URL('./fixtures/gemini-dom.html', import.meta.url), 'utf8')
  const p = geminiPage(html)
  const fetch = mockFetch({ '/_/BardChatUi/data/batchexecute': () => envelope([[['garbage']], null]) })
  const conv = await extractConversation(adapter, { location: p.location, document: p.document, fetch })
  assert.equal(conv.source.method, 'dom')
  assert.ok(conv.warnings.some((w) => /unexpected record shape/.test(w.message)))
  assert.equal(conv.title, 'Trip planning')
  assert.equal(conv.messages.length, 4)
  assert.equal(conv.messages[0].content[0].markdown, 'Plan a 2 day trip')
  const md = conv.messages[1].content[0].markdown
  assert.ok(md.includes('### Day 1'))
  assert.ok(md.includes('```bash\necho hi\n```'), md)
  assert.ok(md.includes('| Day | Plan |\n| --- | --- |\n| 1 | Walk |'))
  assert.ok(!md.includes('Export to Sheets') && !md.includes('Good response') && !md.includes('You said'))
  assert.equal(conv.messages[3].content[0].markdown, 'Beach.')
})

test('missing page token is reported, not guessed', async () => {
  const p = page('<!doctype html><body></body>', 'https://gemini.google.com/app/0123456789abcdef')
  const conv = await extractConversation(adapter, { location: p.location, document: p.document, fetch: mockFetch({}) })
  assert.equal(conv, null, 'no API, no DOM turns -> nothing')
})
