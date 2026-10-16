/**
 * Small helpers shared by the phase-2 adapters (Grok, DeepSeek, Perplexity, Copilot)
 * so each adapter stays within the bookmarklet size budget.
 */
import { createConversation, createMessage, block } from '../core/schema.js'
import { domToMarkdown } from '../core/dom-to-markdown.js'

/** Follows parent links from `leafId` to the root. Returns the items oldest first. */
export function branch(byId, leafId, parentOf) {
  const out = []
  let cur = byId.get(leafId)
  while (cur && !out.includes(cur)) {
    out.push(cur)
    cur = byId.get(parentOf(cur))
  }
  return out.reverse()
}

/** Returns a function giving how many items share an item's parent (for `siblings`). */
export function siblingCounter(items, parentOf) {
  const counts = new Map()
  for (const m of items) counts.set(parentOf(m), (counts.get(parentOf(m)) || 0) + 1)
  return (m) => counts.get(parentOf(m)) || 1
}

/** Builds the partial DOM conversation from rendered turns: [{ role, node }]. */
export function domConversation(adapter, ctx, turns, title, skip) {
  const messages = turns.map((t, i) => createMessage({ id: `dom-${i}`, role: t.role, content: [block.text(domToMarkdown(t.node, { baseUrl: ctx.location.href, skip }))] })).filter((m) => m.content.length)
  if (!messages.length) return null
  return createConversation({
    platform: adapter.id,
    url: ctx.location.href,
    conversationId: adapter.conversationId(ctx.location),
    method: 'dom',
    title,
    messages,
    completeness: 'partial',
  })
}

/** document.title without the platform suffix. */
export function pageTitle(doc, suffix) {
  return (doc.title || '').replace(suffix, '').trim()
}
