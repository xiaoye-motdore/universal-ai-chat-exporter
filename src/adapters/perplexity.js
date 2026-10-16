/**
 * Perplexity adapter (perplexity.ai).
 *
 * API path: a thread (/search/{slug}) is served by the same-origin endpoint the web
 * app itself reads, with cookie auth only:
 *   GET /rest/thread/{slug}?with_parent_info=true&with_schematized_response=true
 *       &version=2.18&source=default&limit=50&from_first=true&offset={cursor}
 *     -> { entries: [...], has_next_page, next_cursor }
 * Each entry is one turn: `query_str` (the question) and `blocks`, whose "ask_text"
 * markdown_block.answer is the answer; web_result_block / sources_mode_block hold the
 * cited sources. (Entries older than the block layout keep the answer in a `text`
 * JSON string; those are not decoded and come out empty, with the DOM as fallback.)
 *
 * DOM path: [class~="group/user-bubble"] (question) and [class~="group/final-text"]
 * (answer), as recorded by an open-source exporter. Always partial.
 */
import { STATUS } from '../core/adapter.js'
import { createConversation, createMessage, block } from '../core/schema.js'
import { domConversation, pageTitle } from './_shared.js'

const THREAD_PATH = /^\/search\/([A-Za-z0-9._~%-]+)/
const TITLE_SUFFIX = /\s*[-|]\s*Perplexity.*$/i
const QUERY = 'with_parent_info=true&with_schematized_response=true&version=2.18&source=default&limit=50&from_first=true'
const MAX_PAGES = 40

/** Perplexity's datetimes carry no zone and are UTC. */
const utc = (s) => (typeof s === 'string' && !/[zZ]$|[+-]\d\d:?\d\d$/.test(s) ? `${s}Z` : s)

function answerBlocks(entry) {
  const blocks = Array.isArray(entry.blocks) ? entry.blocks.filter(Boolean) : []
  const md = blocks.filter((b) => b.markdown_block && typeof b.markdown_block.answer === 'string')
  const pick = md.find((b) => b.intended_usage === 'ask_text') || md.find((b) => /^ask_text/.test(b.intended_usage)) || md[0]
  const out = [block.text(pick ? pick.markdown_block.answer : '')]
  const urls = new Set()
  for (const b of blocks) {
    for (const k of ['web_result_block', 'sources_mode_block']) {
      for (const s of b[k] && Array.isArray(b[k].web_results) ? b[k].web_results : []) if (s && typeof s.url === 'string' && !urls.has(s.url) && urls.add(s.url)) out.push(block.citation(s.name || s.title, s.url))
    }
  }
  return out
}

const adapter = {
  id: 'perplexity',
  name: 'Perplexity',
  status: STATUS.VERIFIED, // live-verified 2026-10-16, see TEST-RESULTS.md
  hosts: ['www.perplexity.ai', 'perplexity.ai'],
  allowedPaths: [/^\/rest\/thread\/[A-Za-z0-9._~%-]+$/],

  matches: (location) => /(^|\.)perplexity\.ai$/.test(location.hostname),
  conversationId: (location) => {
    const m = location.pathname.match(THREAD_PATH)
    return m ? m[1] : null
  },

  async fromApi(ctx) {
    const slug = adapter.conversationId(ctx.location)
    if (!slug) return null
    const entries = []
    const seen = new Set()
    let offset = 0
    for (let page = 0; page < MAX_PAGES; page++) {
      const data = await ctx.net.json(`/rest/thread/${slug}?${QUERY}&offset=${offset}`)
      if (!data || !Array.isArray(data.entries)) throw new Error('unexpected thread payload')
      let added = 0
      for (const e of data.entries) {
        const key = e && (e.uuid || e.backend_uuid)
        if (!key || seen.has(key)) continue
        seen.add(key)
        entries.push(e)
        added++
      }
      const next = data.next_cursor
      if (!data.has_next_page || !added || (typeof next !== 'number' && typeof next !== 'string') || next === '') break
      offset = next
    }
    if (!entries.length) throw new Error('thread has no entries')
    const messages = []
    for (const e of entries) {
      const eid = String(e.uuid || e.backend_uuid)
      messages.push(createMessage({ id: `${eid}:q`, role: 'user', createdAt: utc(e.entry_created_datetime || e.updated_datetime), content: [block.text(typeof e.query_str === 'string' ? e.query_str : '')] }))
      messages.push(createMessage({ id: eid, parentId: `${eid}:q`, role: 'assistant', createdAt: utc(e.updated_datetime || e.entry_updated_datetime), model: typeof e.display_model === 'string' ? e.display_model : null, content: answerBlocks(e) }))
    }
    return createConversation({
      platform: adapter.id,
      url: ctx.location.href,
      conversationId: slug,
      method: 'api',
      title: typeof entries[0].thread_title === 'string' ? entries[0].thread_title : pageTitle(ctx.document, TITLE_SUFFIX),
      model: (messages.find((m) => m.model) || {}).model,
      createdAt: messages[0].createdAt,
      updatedAt: messages[messages.length - 1].createdAt,
      messages,
      completeness: 'complete',
    })
  },

  fromDom(ctx) {
    const doc = ctx.document
    const turns = Array.from(doc.querySelectorAll('[class~="group/user-bubble"], [class~="group/final-text"]')).map((el) => ({ role: el.classList.contains('group/user-bubble') ? 'user' : 'assistant', node: el }))
    return domConversation(adapter, ctx, turns, pageTitle(doc, TITLE_SUFFIX), '[data-testid="toggle-query-expand-button"]')
  },
}

export default adapter
