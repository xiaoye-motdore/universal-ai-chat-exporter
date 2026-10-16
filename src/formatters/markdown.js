/**
 * Markdown export. Message content is emitted verbatim (headings, tables, math and
 * code exactly as the platform stored them). Each turn is introduced by a level-2
 * heading; the conversation title is the level-1 heading.
 */

export const ROLE_LABEL = { user: 'User', assistant: 'Assistant', system: 'System', tool: 'Tool', other: 'Other' }

function yaml(value) {
  return `"${String(value === null || value === undefined ? '' : value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

export function fenceFor(source) {
  const longest = (String(source).match(/`{3,}/g) || []).reduce((m, s) => Math.max(m, s.length), 0)
  return '`'.repeat(Math.max(3, longest + 1))
}

export function renderBlock(b) {
  switch (b.type) {
    case 'text':
      return b.markdown
    case 'code': {
      const f = fenceFor(b.code)
      return `${f}${b.language || ''}\n${b.code.replace(/\n$/, '')}\n${f}`
    }
    case 'image':
      return b.url ? `![${b.alt || b.name}](${b.url})` : `[Image: ${b.name}]`
    case 'attachment': {
      const meta = [b.mimeType, b.sizeBytes !== null ? formatBytes(b.sizeBytes) : null].filter(Boolean).join(', ')
      const label = b.url ? `[${b.name}](${b.url})` : b.name
      const head = `**Attachment:** ${label}${meta ? ` (${meta})` : ''}`
      if (!b.extractedText) return head
      const quoted = b.extractedText
        .split('\n')
        .map((l) => (l ? `> ${l}` : '>'))
        .join('\n')
      return `${head}\n\n${quoted}`
    }
    case 'artifact': {
      const f = fenceFor(b.content)
      const kind = b.kind ? ` (${b.kind})` : ''
      return `**Artifact:** ${b.title}${kind}\n\n${f}${b.language || ''}\n${b.content.replace(/\n$/, '')}\n${f}`
    }
    case 'tool_use':
      return `*[Tool: ${b.name}${b.summary ? ` — ${b.summary}` : ''}]*`
    case 'citation':
      return b.url ? `- [${b.title || b.url}](${b.url})` : `- ${b.title}`
    default:
      return ''
  }
}

export function formatBytes(n) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

function timestamp(iso) {
  return iso ? iso.replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC') : ''
}

export function toMarkdown(conv) {
  const lines = [
    '---',
    `title: ${yaml(conv.title)}`,
    `platform: ${yaml(conv.platform)}`,
    `source: ${yaml(conv.source.url)}`,
    `conversation_id: ${yaml(conv.source.conversationId)}`,
    `model: ${yaml(conv.model)}`,
    `created: ${yaml(conv.createdAt)}`,
    `exported: ${yaml(conv.exportedAt)}`,
    `extraction: ${yaml(conv.source.method)}`,
    `completeness: ${yaml(conv.completeness)}`,
    `messages: ${conv.stats.messages}`,
    '---',
    '',
    `# ${conv.title}`,
    '',
  ]
  if (conv.warnings.length) {
    for (const w of conv.warnings) lines.push(`> **Warning:** ${w.message}`)
    lines.push('')
  }
  conv.messages.forEach((m, i) => {
    const when = timestamp(m.createdAt)
    lines.push(`## ${ROLE_LABEL[m.role] || m.role}${when ? ` — ${when}` : ''}`)
    lines.push('')
    if (m.siblings > 1) lines.push(`> *This message has ${m.siblings} versions (edited or regenerated); the selected version is shown.*`, '')
    const citations = m.content.filter((b) => b.type === 'citation')
    for (const b of m.content) {
      if (b.type === 'citation') continue
      const rendered = renderBlock(b)
      if (rendered) lines.push(rendered, '')
    }
    if (citations.length) lines.push('**Sources:**', '', ...citations.map(renderBlock), '')
    if (m.flags.interrupted) lines.push('> *Response was stopped before completion.*', '')
    if (m.flags.truncated) lines.push('> *Message flagged as truncated by the platform.*', '')
    if (i < conv.messages.length - 1) lines.push('---', '')
  })
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n'
}
