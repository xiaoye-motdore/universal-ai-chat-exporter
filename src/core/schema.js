/**
 * Unified conversation schema shared by every platform adapter and formatter.
 *
 * A Conversation is a plain JSON-serialisable object. Adapters produce it,
 * formatters consume it. Nothing else in the pipeline needs platform knowledge.
 *
 * Conversation {
 *   schemaVersion: '1.0'
 *   exporter:      { name, version }
 *   platform:      'chatgpt' | 'claude' | 'gemini' | ...
 *   source:        { url, conversationId, method: 'api' | 'dom' }
 *   title:         string
 *   model:         string | null
 *   createdAt:     ISO-8601 string | null
 *   updatedAt:     ISO-8601 string | null
 *   exportedAt:    ISO-8601 string
 *   messages:      Message[]            // the active branch, in display order
 *   inactiveMessages: Message[]         // messages on other branches (regenerations,
 *                                       // edits). Empty when the platform exposes none.
 *   stats:         { messages, user, assistant, other, branchedMessages }
 *   completeness:  'complete' | 'partial' | 'unknown'
 *   warnings:      { code, message }[]
 * }
 *
 * Message {
 *   id:        string
 *   parentId:  string | null
 *   role:      'user' | 'assistant' | 'system' | 'tool'
 *   createdAt: ISO-8601 string | null
 *   model:     string | null
 *   content:   Block[]
 *   siblings:  number    // how many versions exist at this position (1 = no branch)
 *   flags:     { interrupted?: true, truncated?: true }
 * }
 *
 * Block (discriminated by `type`):
 *   { type: 'text',       markdown }
 *   { type: 'code',       language, code }
 *   { type: 'image',      name, url, alt }               // url may be null
 *   { type: 'attachment', name, mimeType, sizeBytes, url, extractedText }
 *   { type: 'artifact',   title, kind, language, content }
 *   { type: 'tool_use',   name, summary }
 *   { type: 'citation',   title, url }
 */

export const SCHEMA_VERSION = '1.0'
export const EXPORTER = { name: 'universal-ai-chat-exporter', version: '1.0.0' }

export const ROLES = ['user', 'assistant', 'system', 'tool']
export const BLOCK_TYPES = ['text', 'code', 'image', 'attachment', 'artifact', 'tool_use', 'citation']

export function createConversation(fields) {
  return {
    schemaVersion: SCHEMA_VERSION,
    exporter: { ...EXPORTER },
    platform: fields.platform,
    source: {
      url: fields.url || '',
      conversationId: fields.conversationId || null,
      method: fields.method || 'unknown',
    },
    title: (fields.title || '').trim() || 'Untitled conversation',
    model: fields.model || null,
    createdAt: toIso(fields.createdAt),
    updatedAt: toIso(fields.updatedAt),
    exportedAt: new Date().toISOString(),
    messages: fields.messages || [],
    inactiveMessages: fields.inactiveMessages || [],
    stats: { messages: 0, user: 0, assistant: 0, other: 0, branchedMessages: 0 },
    completeness: fields.completeness || 'unknown',
    warnings: [],
  }
}

export function createMessage(fields) {
  const role = ROLES.includes(fields.role) ? fields.role : 'other'
  return {
    id: String(fields.id || ''),
    parentId: fields.parentId ? String(fields.parentId) : null,
    role,
    createdAt: toIso(fields.createdAt),
    model: fields.model || null,
    content: (fields.content || []).filter(Boolean),
    siblings: fields.siblings > 1 ? fields.siblings : 1,
    flags: fields.flags || {},
  }
}

export const block = {
  text: (markdown) => (markdown && markdown.trim() ? { type: 'text', markdown: markdown.replace(/\r\n/g, '\n').trim() } : null),
  code: (code, language) => (typeof code === 'string' && code.trim() ? { type: 'code', language: language || '', code: code.replace(/\r\n/g, '\n') } : null),
  image: (name, url, alt) => ({ type: 'image', name: name || 'image', url: url || null, alt: alt || name || 'image' }),
  attachment: (f) => ({
    type: 'attachment',
    name: f.name || 'attachment',
    mimeType: f.mimeType || null,
    sizeBytes: typeof f.sizeBytes === 'number' ? f.sizeBytes : null,
    url: f.url || null,
    extractedText: typeof f.extractedText === 'string' && f.extractedText.trim() ? f.extractedText : null,
  }),
  artifact: (a) => ({ type: 'artifact', title: a.title || 'untitled', kind: a.kind || null, language: a.language || '', content: a.content || '' }),
  toolUse: (name, summary) => ({ type: 'tool_use', name: name || 'tool', summary: summary || '' }),
  citation: (title, url) => ({ type: 'citation', title: title || url || '', url: url || null }),
}

/** Accepts ISO strings, epoch seconds or epoch milliseconds; returns ISO or null. */
export function toIso(value) {
  if (value === null || value === undefined || value === '') return null
  let date
  if (typeof value === 'number') {
    date = new Date(value < 1e12 ? value * 1000 : value)
  } else {
    date = new Date(value)
  }
  return isNaN(date.getTime()) ? null : date.toISOString()
}

/** Computes stats and drops messages without any content. Mutates and returns conv. */
export function finalize(conv) {
  conv.messages = conv.messages.filter((m) => m.content.length > 0)
  const stats = { messages: conv.messages.length, user: 0, assistant: 0, other: 0, branchedMessages: 0 }
  for (const m of conv.messages) {
    if (m.role === 'user') stats.user++
    else if (m.role === 'assistant') stats.assistant++
    else stats.other++
    if (m.siblings > 1) stats.branchedMessages++
  }
  conv.stats = stats
  if (!conv.messages.length) conv.completeness = 'unknown'
  return conv
}

/** Returns a list of human-readable schema problems (empty = valid). */
export function validateConversation(conv) {
  const issues = []
  if (!conv || typeof conv !== 'object') return ['conversation is not an object']
  if (conv.schemaVersion !== SCHEMA_VERSION) issues.push('schemaVersion mismatch')
  if (typeof conv.platform !== 'string' || !conv.platform) issues.push('platform missing')
  if (typeof conv.title !== 'string') issues.push('title missing')
  if (!Array.isArray(conv.messages)) issues.push('messages is not an array')
  else {
    conv.messages.forEach((m, i) => {
      if (!ROLES.includes(m.role) && m.role !== 'other') issues.push(`message ${i}: invalid role ${m.role}`)
      if (!Array.isArray(m.content)) issues.push(`message ${i}: content is not an array`)
      else m.content.forEach((b, j) => {
        if (!b || !BLOCK_TYPES.includes(b.type)) issues.push(`message ${i} block ${j}: invalid block type`)
      })
    })
  }
  return issues
}
