/**
 * Microsoft Copilot adapter (copilot.microsoft.com, copilot.com — the consumer app).
 *
 * API path (same-origin, as the web app itself calls it):
 *   GET /c/api/conversations/{id}/history?api-version=2
 *     -> { results: [{ id, author: "human" | "ai" (or { type }), createdAt,
 *                      content: [{ type: "text", text }, ...] }] }   newest first
 * Signed-in requests of the web app also carry an MSAL access token it keeps in
 * localStorage, which this project never reads; cookies are sent, and if the API refuses
 * the DOM path takes over. Only "text" parts are exported (reasoning and tool parts are
 * not conversation content). The title comes from the page (sidebar / document.title).
 *
 * DOM path: .group/user-message and .group/ai-message turns, bodies in
 * [data-content="user-message"] and .group/ai-message-item (structure recorded by an
 * open-source userscript). Always partial.
 *
 * m365.cloud.microsoft (Microsoft 365 Copilot Chat) is a different product and is not covered.
 */
import { STATUS } from '../core/adapter.js'
import { createConversation, createMessage, block } from '../core/schema.js'
import { domConversation, pageTitle } from './_shared.js'

const CONVERSATION_PATH = /^\/chats\/([A-Za-z0-9_-]{8,128})\/?$/
const TITLE_SUFFIX = /^\s*Microsoft[\s_-]*Copilot.*$|\s*[-|–]\s*(Microsoft )?Copilot.*$/i

function title(doc) {
  const selected = doc.querySelector('[role="option"][aria-selected="true"] p')
  return (selected && selected.textContent.trim()) || pageTitle(doc, TITLE_SUFFIX)
}

const adapter = {
  id: 'copilot',
  name: 'Microsoft Copilot',
  status: STATUS.EXPERIMENTAL,
  hosts: ['copilot.microsoft.com', 'copilot.com'],
  allowedPaths: [/^\/c\/api\/conversations\/[A-Za-z0-9_-]+\/history$/],

  matches: (location) => location.hostname === 'copilot.microsoft.com' || /(^|\.)copilot\.com$/.test(location.hostname),
  conversationId: (location) => {
    const m = location.pathname.match(CONVERSATION_PATH)
    return m ? m[1] : null
  },

  async fromApi(ctx) {
    const id = adapter.conversationId(ctx.location)
    if (!id) return null
    const data = await ctx.net.json(`/c/api/conversations/${id}/history?api-version=2`)
    if (!data || !Array.isArray(data.results)) throw new Error('unexpected history payload')
    const messages = []
    for (const m of data.results.slice().reverse()) {
      if (!m) continue
      const author = String(typeof m.author === 'string' ? m.author : (m.author && m.author.type) || '').toLowerCase()
      const role = author === 'human' ? 'user' : author === 'ai' ? 'assistant' : null
      if (!role) continue
      const text = (Array.isArray(m.content) ? m.content : []).filter((p) => p && p.type === 'text' && typeof p.text === 'string').map((p) => p.text)
      messages.push(createMessage({ id: m.id || `${role}-${messages.length}`, role, createdAt: m.createdAt, content: [block.text(text.join('\n\n'))] }))
    }
    if (!messages.length) throw new Error('history has no messages')
    return createConversation({
      platform: adapter.id,
      url: `${ctx.location.origin}/chats/${id}`,
      conversationId: id,
      method: 'api',
      title: title(ctx.document),
      createdAt: messages[0].createdAt,
      updatedAt: messages[messages.length - 1].createdAt,
      messages,
      completeness: 'complete',
    })
  },

  fromDom(ctx) {
    const doc = ctx.document
    const turns = Array.from(doc.querySelectorAll('[class~="group/user-message"], [class~="group/ai-message"]')).map((el) => {
      const user = el.classList.contains('group/user-message')
      return { role: user ? 'user' : 'assistant', node: el.querySelector(user ? '[data-content="user-message"]' : '[class~="group/ai-message-item"]') || el }
    })
    return domConversation(adapter, ctx, turns, title(doc), '[data-testid="message-item-reactions"]')
  },
}

export default adapter
