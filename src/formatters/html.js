/**
 * Standalone HTML export. No scripts, no external resources: a single file that
 * renders anywhere. Every string from the conversation is escaped.
 */
import { markdownToHtml, escapeHtml } from '../core/markdown-to-html.js'
import { renderBlock, ROLE_LABEL } from './markdown.js'

const CSS = `
body{margin:0;background:#f5f5f7;color:#1d1d1f;font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"PingFang SC",sans-serif}
main{max-width:860px;margin:0 auto;padding:32px 20px 64px}
h1{font-size:24px;margin:0 0 6px}
.meta{color:#6e6e73;font-size:13px}.meta span{margin-right:14px}
.warning,.note{background:#fff7e6;border:1px solid #ffd591;color:#613400;border-radius:8px;padding:6px 10px;margin:8px 0;font-size:13px}
article{background:#fff;border:1px solid #e5e5ea;border-radius:12px;padding:16px 20px;margin:16px 0}
article.user{background:#eef3ff;border-color:#d3dffb}
.role{font-weight:700;font-size:13px;text-transform:uppercase;color:#6e6e73;margin-bottom:8px}
.role time{font-weight:400;text-transform:none;margin-left:8px}
pre{background:#1e1e24;color:#f3f3f3;padding:12px 14px;border-radius:8px;overflow:auto;font:13px/1.5 ui-monospace,Menlo,Consolas,monospace}
code{font:.92em ui-monospace,Menlo,Consolas,monospace;background:rgba(0,0,0,.06);padding:1px 4px;border-radius:4px}
pre code{background:none;padding:0;font-size:inherit}
table{border-collapse:collapse;margin:10px 0;display:block;overflow:auto}
th,td{border:1px solid #d2d2d7;padding:6px 10px;text-align:left;vertical-align:top}th{background:#f0f0f5}
blockquote{margin:8px 0;padding:4px 14px;border-left:3px solid #c7c7cc;color:#515154}
img{max-width:100%;height:auto;border-radius:6px}
.math{font-family:ui-monospace,monospace;white-space:pre-wrap;background:#fafafa;border:1px dashed #d2d2d7;padding:8px;border-radius:6px}
hr{border:0;border-top:1px solid #e5e5ea;margin:16px 0}
`

function blockHtml(b) {
  if (b.type === 'image' && b.url && /^https?:\/\//i.test(b.url)) {
    return `<figure><img src="${escapeHtml(b.url)}" alt="${escapeHtml(b.alt || b.name)}"><figcaption>${escapeHtml(b.name)}</figcaption></figure>`
  }
  return markdownToHtml(renderBlock(b))
}

export function toHtml(conv) {
  const meta = [
    `<span>Platform: ${escapeHtml(conv.platform)}</span>`,
    conv.model ? `<span>Model: ${escapeHtml(conv.model)}</span>` : '',
    conv.createdAt ? `<span>Created: ${escapeHtml(conv.createdAt)}</span>` : '',
    `<span>Exported: ${escapeHtml(conv.exportedAt)}</span>`,
    `<span>Messages: ${conv.stats.messages}</span>`,
    conv.source.url ? `<span><a href="${escapeHtml(conv.source.url)}" rel="noopener noreferrer">Original conversation</a></span>` : '',
  ]
    .filter(Boolean)
    .join('')

  const warnings = conv.warnings.map((w) => `<div class="warning">${escapeHtml(w.message)}</div>`).join('\n')

  const articles = conv.messages
    .map((m) => {
      const when = m.createdAt ? `<time datetime="${escapeHtml(m.createdAt)}">${escapeHtml(m.createdAt.replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC'))}</time>` : ''
      const notes = []
      if (m.siblings > 1) notes.push(`This message has ${m.siblings} versions (edited or regenerated); the selected version is shown.`)
      if (m.flags.interrupted) notes.push('Response was stopped before completion.')
      if (m.flags.truncated) notes.push('Message flagged as truncated by the platform.')
      const citations = m.content.filter((b) => b.type === 'citation')
      const body = m.content
        .filter((b) => b.type !== 'citation')
        .map(blockHtml)
        .join('\n')
      const sources = citations.length ? `<p><strong>Sources:</strong></p>${markdownToHtml(citations.map(renderBlock).join('\n'))}` : ''
      return `<article class="${escapeHtml(m.role)}">
<div class="role">${escapeHtml(ROLE_LABEL[m.role] || m.role)}${when}</div>
${notes.map((n) => `<div class="note">${escapeHtml(n)}</div>`).join('\n')}
${body}
${sources}
</article>`
    })
    .join('\n')

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="${escapeHtml(conv.exporter.name)} ${escapeHtml(conv.exporter.version)}">
<title>${escapeHtml(conv.title)}</title>
<style>${CSS}</style>
</head>
<body>
<main>
<header>
<h1>${escapeHtml(conv.title)}</h1>
<div class="meta">${meta}</div>
</header>
${warnings}
${articles}
</main>
</body>
</html>
`
}
