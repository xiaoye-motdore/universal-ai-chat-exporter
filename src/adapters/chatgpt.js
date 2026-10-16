/**
 * ChatGPT adapter (chatgpt.com, chat.openai.com).
 *
 * API path: the page is virtualised (off-screen turns are unloaded), so the
 * complete conversation comes from the same endpoints the web app itself calls:
 *   GET /api/auth/session                -> { accessToken }   (same-origin, cookie auth)
 *   GET /backend-api/conversation/{uuid} -> { title, mapping, current_node, ... }
 * The access token is used once, as the Authorization header of the second
 * same-origin request, and is never stored or logged.
 *
 * The mapping is a tree (edits / regenerations create siblings). The active branch
 * is the parent chain of current_node; every other node is exported under
 * `inactiveMessages` so nothing is lost.
 *
 * DOM path: reads [data-turn] / [data-message-author-role] sections currently
 * rendered. Always marked partial.
 */
import { STATUS } from '../core/adapter.js'
import { createConversation, createMessage, block } from '../core/schema.js'
import { domToMarkdown } from '../core/dom-to-markdown.js'

// /c/<uuid> for signed-in chats, /uc/<uuid> for logged-out chats (DOM path only)
const CONVERSATION_PATH = /\/u?c\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i
const HIDDEN_CONTENT_TYPES = new Set(['thoughts', 'reasoning_recap', 'system_error', 'user_editable_context', 'model_editable_context', 'tether_browsing_display', 'tether_quote', 'sonic_webpage'])

function assetName(pointer) {
  const m = String(pointer || '').match(/([^/]+)$/)
  return m ? m[1] : 'image'
}

/** Converts a mapping-node message to blocks (empty array = not exportable). */
function messageBlocks(message, warn) {
  const content = message.content || {}
  const type = content.content_type
  const out = []
  if (type === 'text') {
    out.push(block.text((content.parts || []).filter((p) => typeof p === 'string').join('\n\n')))
  } else if (type === 'multimodal_text') {
    for (const part of content.parts || []) {
      if (typeof part === 'string') out.push(block.text(part))
      else if (part && part.content_type === 'image_asset_pointer') out.push(block.image(assetName(part.asset_pointer), null, 'image'))
      else if (part && typeof part.text === 'string') out.push(block.text(part.text))
    }
  } else if (type === 'code') {
    const lang = content.language && content.language !== 'unknown' ? content.language : ''
    out.push(block.code(content.text, lang))
  } else if (type === 'execution_output') {
    out.push(block.code(content.text, 'output'))
  } else if (!HIDDEN_CONTENT_TYPES.has(type) && type) {
    warn('chatgpt-unknown-content', `Unknown ChatGPT content type "${type}" skipped`)
  }
  const meta = message.metadata || {}
  for (const a of meta.attachments || []) {
    out.push(block.attachment({ name: a.name, mimeType: a.mime_type || a.mimeType, sizeBytes: typeof a.size === 'number' ? a.size : null }))
  }
  for (const ref of meta.content_references || []) {
    if (ref && ref.type === 'webpage' && ref.url) out.push(block.citation(ref.title, ref.url))
    for (const item of (ref && ref.items) || []) if (item && item.url) out.push(block.citation(item.title, item.url))
  }
  return out.filter(Boolean)
}

function nodeIsVisible(node) {
  const m = node && node.message
  if (!m) return false
  if (m.metadata && m.metadata.is_visually_hidden_from_conversation) return false
  const role = m.author && m.author.role
  if (role === 'system') return false
  if (role === 'tool' && !(m.content && m.content.content_type === 'multimodal_text')) return false
  if (role === 'assistant' && m.recipient && m.recipient !== 'all' && m.content && m.content.content_type === 'code') return false
  return true
}

function activeChain(data) {
  const chain = []
  let id = data.current_node
  const seen = new Set()
  while (id && data.mapping[id] && !seen.has(id)) {
    seen.add(id)
    chain.push(data.mapping[id])
    id = data.mapping[id].parent
  }
  return chain.reverse()
}

function buildMessages(nodes, data, warn) {
  const messages = []
  let current = null
  for (const node of nodes) {
    if (!nodeIsVisible(node)) continue
    const m = node.message
    const role = m.author.role === 'tool' ? 'assistant' : m.author.role
    const blocks = messageBlocks(m, warn)
    const parent = data.mapping[node.parent]
    const siblings = parent && Array.isArray(parent.children) ? parent.children.filter((cid) => nodeIsVisible(data.mapping[cid])).length : 1
    const finish = (m.metadata && m.metadata.finish_details && m.metadata.finish_details.type) || ''
    const flags = {}
    if (finish === 'interrupted' || (m.status === 'finished_partial_completion')) flags.interrupted = true
    if (finish === 'max_tokens') flags.truncated = true
    // Assistant turns span several nodes (text + tool code chains): merge consecutive
    // assistant nodes into one message, exactly as the UI shows one bubble.
    if (role === 'assistant' && current && current.role === 'assistant') {
      current.content.push(...blocks)
      Object.assign(current.flags, flags)
      if (siblings > current.siblings) current.siblings = siblings
      continue
    }
    current = createMessage({
      id: m.id || node.id,
      parentId: node.parent,
      role,
      createdAt: m.create_time,
      model: (m.metadata && m.metadata.model_slug) || null,
      content: blocks,
      siblings,
      flags,
    })
    messages.push(current)
  }
  return messages
}

const adapter = {
  id: 'chatgpt',
  name: 'ChatGPT',
  status: STATUS.VERIFIED, // live-verified 2026-10-16, see TEST-RESULTS.md
  hosts: ['chatgpt.com', 'chat.openai.com'],
  allowedPaths: [/^\/api\/auth\/session$/, /^\/backend-api\/conversation\/[0-9a-f-]{36}$/i],

  matches: (location) => /(^|\.)chatgpt\.com$/.test(location.hostname) || /(^|\.)chat\.openai\.com$/.test(location.hostname),
  conversationId: (location) => {
    const m = location.pathname.match(CONVERSATION_PATH)
    return m ? m[1].toLowerCase() : null
  },

  async fromApi(ctx) {
    const id = adapter.conversationId(ctx.location)
    if (!id) return null
    const session = await ctx.net.json('/api/auth/session')
    if (!session || typeof session.accessToken !== 'string') throw new Error('not signed in (no session token)')
    const data = await ctx.net.json(`/backend-api/conversation/${id}`, { headers: { authorization: `Bearer ${session.accessToken}` } })
    if (!data || typeof data.mapping !== 'object' || typeof data.current_node !== 'string') throw new Error('unexpected conversation payload')

    const active = activeChain(data)
    const activeIds = new Set(active.map((n) => n.id))
    const messages = buildMessages(active, data, ctx.warn)
    const inactiveNodes = Object.values(data.mapping).filter((n) => !activeIds.has(n.id) && nodeIsVisible(n))
    const inactive = buildMessages(
      inactiveNodes.sort((a, b) => ((a.message && a.message.create_time) || 0) - ((b.message && b.message.create_time) || 0)),
      data,
      ctx.warn,
    )
    const model = (messages.find((m) => m.role === 'assistant' && m.model) || {}).model || data.default_model_slug || null

    return createConversation({
      platform: adapter.id,
      url: `${ctx.location.origin}/c/${id}`,
      conversationId: id,
      method: 'api',
      title: data.title,
      model,
      createdAt: data.create_time,
      updatedAt: data.update_time,
      messages,
      inactiveMessages: inactive.filter((m) => m.content.length),
      completeness: 'complete',
    })
  },

  fromDom(ctx) {
    const doc = ctx.document
    // Three generations of markup, newest first (verified live 2026-10: li[data-message-role]).
    let turns = Array.from(doc.querySelectorAll('li[data-message-role]'))
    if (!turns.length) turns = Array.from(doc.querySelectorAll('[data-turn]'))
    if (!turns.length) turns = Array.from(doc.querySelectorAll('[data-message-author-role]'))
    const messages = []
    for (const turn of turns) {
      const roleAttr = turn.getAttribute('data-message-role') || turn.getAttribute('data-turn') || turn.getAttribute('data-message-author-role')
      const role = roleAttr === 'user' ? 'user' : 'assistant'
      const node =
        turn.querySelector('[data-assistant-markdown-root]') ||
        turn.querySelector('[data-user-message-bubble]') ||
        turn.querySelector('.markdown') ||
        turn.querySelector('.whitespace-pre-wrap') ||
        turn
      const md = domToMarkdown(node, {
        baseUrl: ctx.location.href,
        skip: '[data-message-attribution], [data-message-actions], [data-message-content-controls], [data-assistant-message-actions], [data-message-intervention], [data-testid="copy-turn-action-button"], .sr-only',
      })
      const images = Array.from(turn.querySelectorAll('img')).filter((img) => !/avatar|icon/i.test(img.getAttribute('alt') || '') && (img.getAttribute('src') || '').startsWith('http'))
      const blocks = [block.text(md), ...images.map((img) => block.image(img.getAttribute('alt') || 'image', img.getAttribute('src'), img.getAttribute('alt') || ''))]
      messages.push(createMessage({ id: turn.id || turn.getAttribute('data-message-id') || `dom-${messages.length}`, role, content: blocks.filter(Boolean) }))
    }
    if (!messages.length) return null
    const generic = /^ChatGPT\b/i.test(doc.title || '')
    const title = generic ? '' : (doc.title || '').replace(/\s*[-|]\s*ChatGPT\s*$/i, '').trim()
    const idEl = doc.querySelector('[data-conversation-id]')
    return createConversation({
      platform: adapter.id,
      url: ctx.location.href,
      conversationId: adapter.conversationId(ctx.location) || (idEl && idEl.getAttribute('data-conversation-id')) || null,
      method: 'dom',
      title,
      messages,
      completeness: 'partial',
    })
  },
}

export default adapter
