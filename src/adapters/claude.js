/**
 * Claude adapter (claude.ai).
 *
 * API path: claude.ai keeps only the most recent messages in the DOM, so the
 * complete conversation comes from the app's own same-origin endpoints:
 *   GET /api/organizations                                        -> [{ uuid }]
 *   GET /api/organizations/{org}/chat_conversations/{uuid}
 *         ?tree=True&rendering_mode=messages&render_all_tools=true -> { name, chat_messages, current_leaf_message_uuid, ... }
 * No cookie is read by the script: the browser attaches the session itself.
 *
 * Each message carries typed content blocks. `text` blocks are the message;
 * `tool_use` blocks for artifacts / created files are content and are exported
 * (artifact revisions are folded into the final version); other tool calls become
 * one-line markers; `thinking` and `tool_result` are not conversation content and
 * are skipped.
 *
 * DOM path: reads the rendered user / assistant turns. Always marked partial.
 */
import { STATUS } from '../core/adapter.js'
import { createConversation, createMessage, block } from '../core/schema.js'
import { domToMarkdown } from '../core/dom-to-markdown.js'

const CONVERSATION_PATH = /\/chat\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i
const UUID = /^[0-9a-f-]{36}$/i

const ARTIFACT_KINDS = {
  'application/vnd.ant.react': { lang: 'jsx', kind: 'React' },
  'text/html': { lang: 'html', kind: 'HTML' },
  'image/svg+xml': { lang: 'svg', kind: 'SVG' },
  'application/vnd.ant.mermaid': { lang: 'mermaid', kind: 'Mermaid' },
  'text/markdown': { lang: 'markdown', kind: 'Markdown' },
  'application/vnd.ant.code': { lang: '', kind: 'Code' },
}

/** Folds create / update / rewrite commands into each artifact's final content. */
function collectArtifacts(messages, warn) {
  const artifacts = new Map()
  for (const m of messages) {
    for (const b of m.content || []) {
      if (b.type !== 'tool_use' || b.name !== 'artifacts') continue
      const input = b.input || {}
      const id = input.id || '__artifact__'
      let a = artifacts.get(id)
      if (!a) {
        a = { content: '', title: '', type: '', language: '' }
        artifacts.set(id, a)
      }
      if (input.command === 'update' && typeof input.old_str === 'string' && typeof input.new_str === 'string') {
        if (a.content.indexOf(input.old_str) === -1) warn('claude-artifact-update', `Artifact "${a.title || id}": an update could not be applied; content may be incomplete`)
        else a.content = a.content.replace(input.old_str, () => input.new_str)
      } else if (typeof input.content === 'string') {
        a.content = input.content
      }
      if (input.title) a.title = input.title
      if (input.type) a.type = input.type
      if (input.language) a.language = input.language
      a.lastVersion = input.version_uuid || null
      a.lastBlock = b
    }
  }
  return artifacts
}

const EXT_LANG = { py: 'python', js: 'javascript', jsx: 'jsx', ts: 'typescript', tsx: 'tsx', md: 'markdown', html: 'html', css: 'css', json: 'json', sh: 'bash', yml: 'yaml', yaml: 'yaml', sql: 'sql', svg: 'svg', java: 'java', rb: 'ruby', go: 'go', rs: 'rust', c: 'c', cpp: 'cpp' }

function basename(path) {
  return String(path || 'file').split('/').pop()
}

function toolUseBlock(b, artifacts) {
  const input = b.input || {}
  if (b.name === 'artifacts') {
    const a = artifacts.get(input.id || '__artifact__')
    if (!a || a.lastBlock !== b || !a.content) return null // rendered once, at its final revision
    const info = ARTIFACT_KINDS[a.type] || { lang: a.language || '', kind: a.language || '' }
    return block.artifact({ title: a.title, kind: info.kind, language: info.lang || a.language || '', content: a.content })
  }
  // Files the model wrote: legacy `create_file` { path, file_text } and the current
  // `Write` tool { file_path, content } (verified live 2026-10-16). The `Artifact` tool
  // that publishes such a file carries no content itself and becomes a marker below.
  const fileText = typeof input.file_text === 'string' ? input.file_text : b.name === 'Write' && typeof input.content === 'string' ? input.content : ''
  if ((b.name === 'create_file' || b.name === 'Write') && fileText) {
    const file = basename(input.path || input.file_path)
    const ext = file.includes('.') ? file.split('.').pop().toLowerCase() : ''
    return block.artifact({ title: file, kind: 'File', language: EXT_LANG[ext] || '', content: fileText })
  }
  if (b.name === 'visualize:show_widget' && typeof input.widget_code === 'string') {
    return block.artifact({ title: input.title || 'widget', kind: 'Widget', language: 'jsx', content: input.widget_code })
  }
  const summary = [input.query, input.command, input.skill, input.description, input.file_path && basename(input.file_path)].find((v) => typeof v === 'string' && v) || ''
  return block.toolUse(b.name, summary)
}

function attachmentBlocks(m, origin) {
  const out = []
  const abs = (u) => {
    if (!u || typeof u !== 'string') return null
    try {
      return new URL(u, origin).href
    } catch (e) {
      return null
    }
  }
  const seen = new Set()
  for (const f of [...(m.files || []), ...(m.files_v2 || [])]) {
    const key = f.file_uuid || f.uuid || f.file_name
    if (!key || seen.has(key)) continue
    seen.add(key)
    if (f.file_kind === 'image') {
      out.push(block.image(f.file_name || 'image', abs(f.preview_url || (f.preview_asset && f.preview_asset.url)), f.file_name))
    } else {
      out.push(block.attachment({ name: f.file_name, mimeType: f.file_kind || null, sizeBytes: typeof f.size_bytes === 'number' ? f.size_bytes : null, url: abs(f.document_asset && f.document_asset.url) }))
    }
  }
  for (const a of m.attachments || []) {
    out.push(block.attachment({ name: a.file_name || a.name, mimeType: a.file_type || null, sizeBytes: typeof a.file_size === 'number' ? a.file_size : null, extractedText: a.extracted_content }))
  }
  return out
}

function messageToUnified(m, artifacts, siblings, origin) {
  const blocks = attachmentBlocks(m, origin)
  for (const b of m.content || []) {
    if (b.type === 'text' && typeof b.text === 'string') blocks.push(block.text(b.text))
    else if (b.type === 'tool_use') blocks.push(toolUseBlock(b, artifacts))
    // 'thinking' and 'tool_result' are not conversation content
  }
  if (!blocks.filter(Boolean).length && typeof m.text === 'string') blocks.push(block.text(m.text))
  const flags = {}
  if (m.stop_reason === 'user_canceled') flags.interrupted = true
  if (m.truncated) flags.truncated = true
  return createMessage({
    id: m.uuid,
    parentId: m.parent_message_uuid,
    role: m.sender === 'human' ? 'user' : m.sender === 'assistant' ? 'assistant' : m.sender || 'other',
    createdAt: m.created_at,
    content: blocks.filter(Boolean),
    siblings,
    flags,
  })
}

const adapter = {
  id: 'claude',
  name: 'Claude',
  status: STATUS.VERIFIED, // live-verified 2026-10-16, see TEST-RESULTS.md
  hosts: ['claude.ai'],
  allowedPaths: [/^\/api\/organizations$/, /^\/api\/organizations\/[0-9a-f-]{36}\/chat_conversations\/[0-9a-f-]{36}$/i],

  matches: (location) => /(^|\.)claude\.ai$/.test(location.hostname),
  conversationId: (location) => {
    const m = location.pathname.match(CONVERSATION_PATH)
    return m ? m[1].toLowerCase() : null
  },

  async fromApi(ctx) {
    const id = adapter.conversationId(ctx.location)
    if (!id) return null
    const orgs = await ctx.net.json('/api/organizations')
    const orgIds = (Array.isArray(orgs) ? orgs : []).map((o) => o && o.uuid).filter((u) => typeof u === 'string' && UUID.test(u))
    if (!orgIds.length) throw new Error('not signed in (no organizations)')

    let data = null
    let lastError = null
    for (const org of orgIds) {
      try {
        data = await ctx.net.json(`/api/organizations/${org}/chat_conversations/${id}?tree=True&rendering_mode=messages&render_all_tools=true`)
        if (data && Array.isArray(data.chat_messages)) break
        data = null
      } catch (e) {
        lastError = e
      }
    }
    if (!data) throw lastError || new Error('conversation not found in any organization')

    const all = data.chat_messages
    const byId = new Map(all.map((m) => [m.uuid, m]))
    let ordered = null
    const leaf = data.current_leaf_message_uuid
    if (leaf && byId.has(leaf)) {
      const path = []
      const seen = new Set()
      let cur = byId.get(leaf)
      while (cur && !seen.has(cur.uuid)) {
        seen.add(cur.uuid)
        path.push(cur)
        cur = cur.parent_message_uuid ? byId.get(cur.parent_message_uuid) : null
      }
      ordered = path.reverse()
    }
    if (!ordered) {
      ctx.warn('claude-branch', 'Could not resolve the current branch; messages are in index order, which may interleave branches')
      ordered = [...all].sort((a, b) => (a.index || 0) - (b.index || 0))
    }
    const childrenOf = new Map()
    for (const m of all) {
      const key = m.parent_message_uuid || '__root__'
      childrenOf.set(key, (childrenOf.get(key) || 0) + 1)
    }
    const siblingsOf = (m) => childrenOf.get(m.parent_message_uuid || '__root__') || 1

    const artifacts = collectArtifacts(ordered, ctx.warn)
    const activeIds = new Set(ordered.map((m) => m.uuid))
    const messages = ordered.map((m) => messageToUnified(m, artifacts, siblingsOf(m), ctx.location.origin))
    const inactiveRaw = all.filter((m) => !activeIds.has(m.uuid))
    const inactiveArtifacts = collectArtifacts(inactiveRaw, () => {})
    const inactive = inactiveRaw.map((m) => messageToUnified(m, inactiveArtifacts, siblingsOf(m), ctx.location.origin)).filter((m) => m.content.length)

    return createConversation({
      platform: adapter.id,
      url: `${ctx.location.origin}/chat/${id}`,
      conversationId: id,
      method: 'api',
      title: data.name,
      model: data.model || null,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
      messages,
      inactiveMessages: inactive,
      completeness: 'complete',
    })
  },

  fromDom(ctx) {
    const doc = ctx.document
    const nodes = Array.from(doc.querySelectorAll('[data-testid="user-message"], .font-claude-response, .font-claude-message'))
    const messages = []
    for (const node of nodes) {
      if (nodes.some((other) => other !== node && other.contains(node))) continue
      const isUser = node.getAttribute('data-testid') === 'user-message'
      let source = node
      if (!isUser) {
        const parts = node.querySelectorAll('.standard-markdown')
        if (parts.length) {
          source = doc.createElement('div')
          parts.forEach((p) => source.appendChild(p.cloneNode(true)))
        }
      }
      const md = domToMarkdown(source, { baseUrl: ctx.location.href })
      messages.push(createMessage({ id: `dom-${messages.length}`, role: isUser ? 'user' : 'assistant', content: [block.text(md)].filter(Boolean) }))
    }
    if (!messages.length) return null
    const title = (doc.title || '').replace(/\s*[-|]\s*Claude\s*$/i, '').trim()
    return createConversation({
      platform: adapter.id,
      url: ctx.location.href,
      conversationId: adapter.conversationId(ctx.location),
      method: 'dom',
      title,
      messages,
      completeness: 'partial',
    })
  },
}

export default adapter
