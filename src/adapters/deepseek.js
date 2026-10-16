/**
 * DeepSeek adapter (chat.deepseek.com).
 *
 * API path:
 *   GET /api/v0/chat/history_messages?chat_session_id={id}
 *     -> { code, msg, data: { biz_code, biz_data: {
 *            chat_session: { id, title, current_message_id, inserted_at, updated_at },
 *            chat_messages: [{ message_id, parent_id, role: USER|ASSISTANT, inserted_at,
 *                              fragments: [{ type: REQUEST|RESPONSE|THINK|..., content }],
 *                              content, thinking_content }] } } }
 * Branches (edits / regenerations) are kept in chat_messages; the branch on screen ends
 * at current_message_id. THINK fragments (DeepThink reasoning) are not exported.
 *
 * Caveat: the web app itself sends a bearer token it keeps in localStorage, which this
 * project never reads. The request is sent with cookies only; if DeepSeek rejects it
 * (HTTP 401 or a non-zero `code`), the DOM path takes over.
 *
 * DOM path: user text carries per-deploy hashed class names, so turns are read from
 * `.ds-message` containers: a turn with a `.ds-markdown` body outside `.ds-think-content`
 * is the assistant, anything else is the user. Unverified on the live site.
 */
import { STATUS } from '../core/adapter.js'
import { createConversation, createMessage, block } from '../core/schema.js'
import { branch, siblingCounter, domConversation, pageTitle } from './_shared.js'

const CONVERSATION_PATH = /\/a\/chat\/s\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i
const TITLE_SUFFIX = /\s*[-|]\s*DeepSeek.*$/i

function toMessage(m, siblings) {
  const user = m.role === 'USER'
  const want = user ? 'REQUEST' : 'RESPONSE'
  const texts = (Array.isArray(m.fragments) ? m.fragments : []).filter((f) => f && f.type === want && typeof f.content === 'string').map((f) => f.content)
  return createMessage({ id: m.message_id, parentId: m.parent_id, role: user ? 'user' : 'assistant', createdAt: m.inserted_at, content: [block.text(texts.length ? texts.join('\n\n') : typeof m.content === 'string' ? m.content : '')], siblings })
}

const adapter = {
  id: 'deepseek',
  name: 'DeepSeek',
  status: STATUS.EXPERIMENTAL,
  allowedPaths: [/^\/api\/v0\/chat\/history_messages$/],

  matches: (location) => location.hostname === 'chat.deepseek.com',
  conversationId: (location) => {
    const m = location.pathname.match(CONVERSATION_PATH)
    return m ? m[1].toLowerCase() : null
  },

  async fromApi(ctx) {
    const id = adapter.conversationId(ctx.location)
    if (!id) return null
    const res = await ctx.net.json(`/api/v0/chat/history_messages?chat_session_id=${id}`)
    const biz = res && res.data && res.data.biz_data
    if (!biz || !Array.isArray(biz.chat_messages)) throw new Error(res && res.msg ? `DeepSeek API: ${res.msg}` : 'unexpected history payload')
    const all = biz.chat_messages.filter((m) => m && m.message_id != null)
    if (!all.length) throw new Error('history is empty')
    const session = biz.chat_session || {}
    const key = (v) => (v == null ? '' : String(v))
    const byId = new Map(all.map((m) => [key(m.message_id), m]))
    const parentOf = (m) => key(m.parent_id)
    let active = branch(byId, key(session.current_message_id), parentOf)
    if (!active.length) {
      ctx.warn('deepseek-branch', 'Could not resolve the current branch; all messages are exported in order')
      active = all
    }
    const siblingsOf = siblingCounter(all, parentOf)
    const messages = active.map((m) => toMessage(m, siblingsOf(m)))
    return createConversation({
      platform: adapter.id,
      url: `${ctx.location.origin}/a/chat/s/${id}`,
      conversationId: id,
      method: 'api',
      title: typeof session.title === 'string' ? session.title : pageTitle(ctx.document, TITLE_SUFFIX),
      createdAt: session.inserted_at,
      updatedAt: session.updated_at,
      messages,
      inactiveMessages: all.filter((m) => !active.includes(m)).map((m) => toMessage(m, siblingsOf(m))).filter((m) => m.content.length),
      completeness: 'complete',
    })
  },

  fromDom(ctx) {
    const doc = ctx.document
    const turns = []
    for (const el of doc.querySelectorAll('.ds-message')) {
      const bodies = Array.from(el.querySelectorAll('.ds-markdown')).filter((n) => !n.closest('.ds-think-content'))
      if (bodies.length) {
        const box = doc.createElement('div')
        for (const b of bodies) box.appendChild(b.cloneNode(true))
        // Code-block banner: the language label sits next to div-based copy buttons.
        for (const banner of box.querySelectorAll('.md-code-block-banner')) {
          const label = banner.querySelector('.md-code-block-infostring')
          const pre = (banner.closest('.md-code-block') || banner.parentNode).querySelector('pre')
          if (label && pre) pre.setAttribute('data-language', label.textContent.trim().toLowerCase())
          banner.remove()
        }
        turns.push({ role: 'assistant', node: box })
      } else {
        turns.push({ role: 'user', node: el })
      }
    }
    return domConversation(adapter, ctx, turns, pageTitle(doc, TITLE_SUFFIX), '.ds-think-content')
  },
}

export default adapter
