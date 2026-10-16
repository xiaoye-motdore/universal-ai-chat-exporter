/**
 * Gemini adapter (gemini.google.com).
 *
 * API path: Gemini has no JSON REST API; the web app loads conversations through a
 * batchexecute RPC (rpcid hNvQHb) whose payload is an undocumented nested array.
 * This adapter calls the same same-origin RPC with the page's own `at` token
 * (read from the page's WIZ_global_data script configuration, not from cookies),
 * follows the pagination cursor, and validates the shape of every record before
 * using it. Any mismatch aborts the API path and the DOM path takes over.
 *
 * Record layout (observed; see TEST-RESULTS.md for the verification status):
 *   [0] = [conversationId, turnId]
 *   [1] = [conversationId, parentTurnId, chosenCandidateId]
 *   [2][0][0] = user text; attachments nested somewhere under [2][0][4]
 *   [3][0] = response candidates: [candidateId, [markdown, ...], ...]
 *   [4][0] = epoch seconds (optional)
 *
 * DOM path: reads the rendered conversation turns. Gemini lazy-loads history, so
 * this is always marked partial.
 */
import { STATUS } from '../core/adapter.js'
import { createConversation, createMessage, block } from '../core/schema.js'
import { domToMarkdown } from '../core/dom-to-markdown.js'

const CONVERSATION_PATH = /\/app\/([a-z0-9]+)/i
const RPC_ID = 'hNvQHb'
const PAGE_SIZE = 100
const MAX_PAGES = 50
const FILENAME = /^[^/\\:*?"<>|$\s][^/\\:*?"<>|$]{0,118}\.[a-z0-9]{2,6}$/i

function collectFilenames(node, names) {
  if (typeof node === 'string') {
    if (FILENAME.test(node) && !names.includes(node)) names.push(node)
  } else if (Array.isArray(node)) {
    for (const child of node) collectFilenames(child, names)
  }
  return names
}

function wizData(doc) {
  // WIZ_global_data is a global set by Gemini's own inline script. It is read from
  // the window, never evaluated; only the two string fields below are used.
  const win = doc.defaultView || globalThis
  const wiz = win.WIZ_global_data
  if (!wiz || typeof wiz.SNlM0e !== 'string') throw new Error('page token (WIZ_global_data.SNlM0e) not found')
  return { at: wiz.SNlM0e, bl: typeof wiz.cfb2h === 'string' ? wiz.cfb2h : '', sid: typeof wiz.FdrFJe === 'string' ? wiz.FdrFJe : '' }
}

async function rpc(ctx, conversationId, count, cursor) {
  const wiz = wizData(ctx.document)
  const lang = ((typeof navigator !== 'undefined' && navigator.language) || 'en').split('-')[0]
  const query = [
    `rpcids=${RPC_ID}`,
    `source-path=${encodeURIComponent(ctx.location.pathname)}`,
    wiz.bl ? `bl=${encodeURIComponent(wiz.bl)}` : '',
    wiz.sid ? `f.sid=${encodeURIComponent(wiz.sid)}` : '',
    `hl=${encodeURIComponent(lang)}`,
    `_reqid=${Math.floor(100000 + (Date.now() % 900000))}`,
    'rt=c',
  ]
    .filter(Boolean)
    .join('&')
  const inner = JSON.stringify([conversationId, count, cursor, 1, [0], [4], null, 1])
  const freq = JSON.stringify([[[RPC_ID, inner, null, 'generic']]])
  const text = await ctx.net.text(`/_/BardChatUi/data/batchexecute?${query}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8' },
    body: `f.req=${encodeURIComponent(freq)}&at=${encodeURIComponent(wiz.at)}`,
  })
  // Envelope: ")]}'" prefix, then length lines interleaved with JSON chunks.
  for (const line of text.split('\n')) {
    if (line.charAt(0) !== '[') continue
    let chunk
    try {
      chunk = JSON.parse(line)
    } catch (e) {
      continue
    }
    for (const entry of Array.isArray(chunk) ? chunk : []) {
      if (Array.isArray(entry) && entry[0] === 'wrb.fr' && entry[1] === RPC_ID && typeof entry[2] === 'string') return JSON.parse(entry[2])
    }
  }
  throw new Error('no payload in batchexecute response')
}

function validRecord(r) {
  return Array.isArray(r) && Array.isArray(r[0]) && typeof r[0][1] === 'string' && (Array.isArray(r[2]) || Array.isArray(r[3]))
}

function mapTurns(turns) {
  const chosen = new Set()
  for (const t of turns) if (Array.isArray(t[1]) && typeof t[1][2] === 'string') chosen.add(t[1][2])
  const messages = []
  const inactive = []
  const listed = new Set()
  for (const t of turns) {
    const turnId = t[0][1]
    const createdAt = Array.isArray(t[4]) && typeof t[4][0] === 'number' && t[4][0] > 1e9 ? t[4][0] : null
    const user = (Array.isArray(t[2]) && t[2][0]) || []
    const text = typeof user[0] === 'string' ? user[0] : ''
    const names = collectFilenames(user[4], []).filter((n) => {
      if (listed.has(n)) return false
      listed.add(n)
      return true
    })
    const userBlocks = [block.text(text), ...names.map((n) => block.attachment({ name: n }))].filter(Boolean)
    if (userBlocks.length) messages.push(createMessage({ id: `${turnId}:user`, role: 'user', createdAt, content: userBlocks }))

    // Empty candidate slots exist alongside the real answer (observed live): only
    // candidates with text count as versions.
    const candidates = ((Array.isArray(t[3]) && t[3][0]) || []).filter((c) => Array.isArray(c) && Array.isArray(c[1]) && typeof c[1][0] === 'string' && c[1][0].trim())
    if (!candidates.length) continue
    const pick = candidates.find((c) => chosen.has(c[0])) || candidates[0]
    messages.push(createMessage({ id: pick[0] || `${turnId}:model`, parentId: `${turnId}:user`, role: 'assistant', createdAt, content: [block.text(pick[1][0])].filter(Boolean), siblings: candidates.length }))
    for (const c of candidates) {
      if (c !== pick) inactive.push(createMessage({ id: c[0], parentId: `${turnId}:user`, role: 'assistant', createdAt, content: [block.text(c[1][0])].filter(Boolean), siblings: candidates.length }))
    }
  }
  return { messages, inactive }
}

function pageTitle(doc) {
  const el = doc.querySelector('[data-test-id="conversation-title"], .conversation-title, .selected .conversation-title')
  const fromEl = el && el.textContent.trim()
  if (fromEl) return fromEl
  return (doc.title || '').replace(/\s*[-|]\s*(Google\s+)?Gemini\s*$/i, '').trim()
}

const adapter = {
  id: 'gemini',
  name: 'Gemini',
  status: STATUS.VERIFIED, // live-verified 2026-10-16, see TEST-RESULTS.md
  allowedPaths: [/^\/_\/BardChatUi\/data\/batchexecute$/],

  matches: (location) => location.hostname === 'gemini.google.com',
  conversationId: (location) => {
    const m = location.pathname.match(CONVERSATION_PATH)
    return m ? m[1] : null
  },

  async fromApi(ctx) {
    const id = adapter.conversationId(ctx.location)
    if (!id) return null
    const conversationId = `c_${id}`
    let payload = await rpc(ctx, conversationId, PAGE_SIZE, null)
    const turns = []
    const seen = new Set()
    for (let page = 0; page < MAX_PAGES && payload; page++) {
      const records = Array.isArray(payload[0]) ? payload[0] : []
      let added = 0
      for (const r of records) {
        if (!validRecord(r)) throw new Error('unexpected record shape in batchexecute payload')
        if (seen.has(r[0][1])) continue
        seen.add(r[0][1])
        turns.push(r)
        added++
      }
      const cursor = typeof payload[1] === 'string' && payload[1] ? payload[1] : null
      if (!cursor || !added) break
      payload = await rpc(ctx, conversationId, PAGE_SIZE, cursor)
    }
    if (!turns.length) throw new Error('RPC returned no turns')
    turns.reverse() // newest first -> chronological
    const { messages, inactive } = mapTurns(turns)
    return createConversation({
      platform: adapter.id,
      url: ctx.location.href,
      conversationId: id,
      method: 'api',
      title: pageTitle(ctx.document),
      createdAt: messages.length ? messages[0].createdAt : null,
      messages,
      inactiveMessages: inactive,
      completeness: 'complete',
    })
  },

  fromDom(ctx) {
    const doc = ctx.document
    const containers = Array.from(doc.querySelectorAll('div.conversation-container'))
    const messages = []
    for (const c of containers) {
      const query = c.querySelector('user-query .query-text, .query-content, user-query')
      const response = c.querySelector('model-response message-content, .response-content, model-response')
      if (query) {
        const md = domToMarkdown(query, { baseUrl: ctx.location.href })
        const files = Array.from(c.querySelectorAll('user-query [data-test-id="file-name"], user-query .file-name')).map((n) => n.textContent.trim()).filter(Boolean)
        messages.push(createMessage({ id: `dom-${messages.length}`, role: 'user', content: [block.text(md), ...files.map((n) => block.attachment({ name: n }))].filter(Boolean) }))
      }
      if (response) {
        const md = domToMarkdown(response, { baseUrl: ctx.location.href, skip: '.code-block-decoration, .table-footer, [class*="export-sheets"], [class*="hide-from-message"], .response-footer, sources-list, .thoughts-header' })
        messages.push(createMessage({ id: `dom-${messages.length}`, role: 'assistant', content: [block.text(md)].filter(Boolean) }))
      }
    }
    if (!messages.length) return null
    return createConversation({
      platform: adapter.id,
      url: ctx.location.href,
      conversationId: adapter.conversationId(ctx.location),
      method: 'dom',
      title: pageTitle(doc),
      messages,
      completeness: 'partial',
    })
  },
}

export default adapter
