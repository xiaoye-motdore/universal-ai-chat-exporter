/**
 * Grok adapter (grok.com).
 *
 * API path: the web app loads a conversation in two same-origin calls:
 *   GET  /rest/app-chat/conversations/{id}/response-node?includeThreads=true
 *          -> { responseNodes: [{ responseId, sender, parentResponseId }] }   (the tree)
 *   POST /rest/app-chat/conversations/{id}/load-responses  { responseIds }
 *          -> { responses: [{ responseId, message, sender, createTime, parentResponseId,
 *                             partial, model, citedWebSearchResults }] }
 * Cookie auth is attached by the browser; nothing is read from storage.
 * The active branch is the parent chain of the newest response; the rest is
 * exported under `inactiveMessages`. `sender` is "human" for the user and
 * "assistant" / "ASSISTANT" / a model name for Grok. The title comes from the page.
 *
 * DOM path: div[id^="response-"] > .message-bubble[data-testid=user-message|assistant-message]
 * with the body in .response-content-markdown (structure recorded by an open-source
 * userscript on 2026-09-29). Grok virtualises the transcript, so this is always partial.
 * (Image generation and the code-block language label are not exported on either path:
 * both were cut to keep the bookmarklet under 64 KB.)
 */
import { STATUS } from '../core/adapter.js'
import { createConversation, createMessage, block } from '../core/schema.js'
import { branch, siblingCounter, domConversation, pageTitle } from './_shared.js'

const CONVERSATION_PATH = /\/c\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i
const TITLE_SUFFIX = /\s*-\s*Grok\s*$/

function toMessage(r, siblings) {
  const human = /^human$/i.test(r.sender || '')
  const blocks = [block.text(typeof r.message === 'string' && r.message ? r.message : human && typeof r.query === 'string' ? r.query : '')]
  for (const w of Array.isArray(r.citedWebSearchResults) ? r.citedWebSearchResults : []) if (w && typeof w.url === 'string') blocks.push(block.citation(w.title, w.url))
  return createMessage({
    id: r.responseId,
    parentId: r.parentResponseId,
    role: human ? 'user' : 'assistant',
    createdAt: r.createTime,
    model: typeof r.model === 'string' ? r.model : null,
    content: blocks,
    siblings,
    flags: r.partial ? { interrupted: true } : {},
  })
}

const adapter = {
  id: 'grok',
  name: 'Grok',
  status: STATUS.VERIFIED, // live-verified 2026-10-16, see TEST-RESULTS.md
  hosts: ['grok.com'],
  allowedPaths: [/^\/rest\/app-chat\/conversations\/[0-9a-f-]{36}\/(response-node|load-responses)$/i],

  matches: (location) => /(^|\.)grok\.com$/.test(location.hostname),
  conversationId: (location) => {
    const m = location.pathname.match(CONVERSATION_PATH)
    return m ? m[1].toLowerCase() : null
  },

  async fromApi(ctx) {
    const id = adapter.conversationId(ctx.location)
    if (!id) return null
    const base = `/rest/app-chat/conversations/${id}/`
    const tree = await ctx.net.json(`${base}response-node?includeThreads=true`)
    const nodes = tree && Array.isArray(tree.responseNodes) ? tree.responseNodes.filter((n) => n && typeof n.responseId === 'string') : []
    if (!nodes.length) throw new Error('unexpected response-node payload')
    const loaded = await ctx.net.json(`${base}load-responses`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ responseIds: nodes.map((n) => n.responseId) }) })
    const responses = loaded && Array.isArray(loaded.responses) ? loaded.responses.filter((r) => r && typeof r.responseId === 'string') : []
    if (!responses.length) throw new Error('unexpected load-responses payload')
    const byId = new Map(responses.map((r) => [r.responseId, r]))
    for (const n of nodes) {
      const r = byId.get(n.responseId)
      if (r) {
        r.sender = r.sender || n.sender
        r.parentResponseId = r.parentResponseId || n.parentResponseId
      }
    }
    let leaf = responses[responses.length - 1]
    for (const r of responses) if (new Date(r.createTime) > new Date(leaf.createTime)) leaf = r
    const parentOf = (r) => r.parentResponseId || ''
    const active = branch(byId, leaf.responseId, parentOf)
    const siblingsOf = siblingCounter(responses, parentOf)
    const messages = active.map((r) => toMessage(r, siblingsOf(r)))
    return createConversation({
      platform: adapter.id,
      url: `${ctx.location.origin}/c/${id}`,
      conversationId: id,
      method: 'api',
      title: pageTitle(ctx.document, TITLE_SUFFIX),
      model: (messages.find((m) => m.model) || {}).model,
      createdAt: messages[0].createdAt,
      updatedAt: messages[messages.length - 1].createdAt,
      messages,
      inactiveMessages: responses.filter((r) => !active.includes(r)).map((r) => toMessage(r, siblingsOf(r))).filter((m) => m.content.length),
      completeness: 'complete',
    })
  },

  fromDom(ctx) {
    const doc = ctx.document
    const turns = []
    for (const el of doc.querySelectorAll('div[id^="response-"]')) {
      const bubble = el.querySelector('.message-bubble')
      if (!bubble) continue
      // Work on a clone and drop the code-block header (language label + copy button):
      // dom-to-markdown cannot pair that label with the <pre>, so fences carry no language.
      const node = (bubble.querySelector('.response-content-markdown') || bubble).cloneNode(true)
      for (const h of node.querySelectorAll('[class~="group/code-header"]')) h.remove()
      turns.push({ role: bubble.getAttribute('data-testid') === 'user-message' ? 'user' : 'assistant', node })
    }
    return domConversation(adapter, ctx, turns, pageTitle(doc, TITLE_SUFFIX), '.thinking-container, .action-buttons, .inline-media-container')
  },
}

export default adapter
