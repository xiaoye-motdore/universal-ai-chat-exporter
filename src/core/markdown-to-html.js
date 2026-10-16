/**
 * Compact Markdown -> HTML renderer for the HTML export. All text is escaped;
 * only http(s) links/images are emitted. The output is written to a file, never
 * injected into the live page.
 */
export function escapeHtml(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function safeUrl(url) {
  return /^https?:\/\//i.test(url) ? escapeHtml(url) : null
}

function inline(text) {
  const codes = []
  let html = escapeHtml(text)
  html = html.replace(/(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/g, (m, ticks, code) => {
    codes.push(`<code>${code}</code>`)
    return `\u0000${codes.length - 1}\u0000`
  })
  html = html.replace(/!\[([^\]]*)\]\(((?:[^()\s]|\([^()\s]*\))+)\)/g, (m, alt, src) => {
    const u = safeUrl(src)
    return u ? `<img src="${u}" alt="${alt}">` : alt
  })
  html = html.replace(/\[([^\]]+)\]\(((?:[^()\s]|\([^()\s]*\))+)\)/g, (m, label, href) => {
    const u = safeUrl(href)
    return u ? `<a href="${u}" rel="noopener noreferrer">${label}</a>` : label
  })
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  html = html.replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?!\w)/g, '$1<em>$2</em>')
  html = html.replace(/~~([^~]+)~~/g, '<del>$1</del>')
  html = html.replace(/\u0000(\d+)\u0000/g, (m, i) => codes[Number(i)])
  return html
}

function tableHtml(rows) {
  const cells = (line) =>
    line
      .trim()
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split(/(?<!\\)\|/)
      .map((c) => inline(c.replace(/\\\|/g, '|').trim()))
  const head = cells(rows[0])
  const body = rows.slice(2).map(cells)
  return `<table><thead><tr>${head.map((c) => `<th>${c}</th>`).join('')}</tr></thead><tbody>${body
    .map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`)
    .join('')}</tbody></table>`
}

export function markdownToHtml(markdown) {
  const lines = String(markdown).replace(/\r\n/g, '\n').split('\n')
  const out = []
  let paragraph = []
  let list = null // { tag, items: [{ indent, html }] }

  const flushParagraph = () => {
    if (paragraph.length) out.push(`<p>${paragraph.map(inline).join('<br>')}</p>`)
    paragraph = []
  }
  const flushList = () => {
    if (!list) return
    // Build nested lists from indentation
    const stack = []
    let html = ''
    for (const item of list.items) {
      while (stack.length && stack[stack.length - 1].indent > item.indent) html += `</li></${stack.pop().tag}>`
      if (!stack.length || stack[stack.length - 1].indent < item.indent) {
        stack.push({ tag: item.tag, indent: item.indent })
        html += `<${item.tag}>`
      } else {
        html += '</li>'
      }
      html += `<li>${item.html}`
    }
    while (stack.length) html += `</li></${stack.pop().tag}>`
    out.push(html)
    list = null
  }
  const flushAll = () => {
    flushParagraph()
    flushList()
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()

    const fenceMatch = trimmed.match(/^(`{3,}|~{3,})\s*([\w#+.-]*)\s*$/)
    if (fenceMatch) {
      flushAll()
      const marks = fenceMatch[1]
      const code = []
      i++
      while (i < lines.length && !(lines[i].trim().startsWith(marks[0]) && lines[i].trim().length >= marks.length && /^[`~]+$/.test(lines[i].trim()))) {
        code.push(lines[i])
        i++
      }
      const cls = fenceMatch[2] ? ` class="language-${escapeHtml(fenceMatch[2])}"` : ''
      out.push(`<pre><code${cls}>${escapeHtml(code.join('\n'))}</code></pre>`)
      continue
    }
    if (trimmed === '$$') {
      flushAll()
      const tex = []
      i++
      while (i < lines.length && lines[i].trim() !== '$$') tex.push(lines[i++])
      out.push(`<div class="math">$$\n${escapeHtml(tex.join('\n'))}\n$$</div>`)
      continue
    }
    if (!trimmed) {
      flushAll()
      continue
    }
    const heading = trimmed.match(/^(#{1,6})\s+(.*)$/)
    if (heading) {
      flushAll()
      out.push(`<h${heading[1].length}>${inline(heading[2])}</h${heading[1].length}>`)
      continue
    }
    if (/^(-{3,}|_{3,}|\*{3,})$/.test(trimmed)) {
      flushAll()
      out.push('<hr>')
      continue
    }
    if (trimmed.startsWith('>')) {
      flushAll()
      const quote = [trimmed.replace(/^>\s?/, '')]
      while (i + 1 < lines.length && lines[i + 1].trim().startsWith('>')) quote.push(lines[++i].trim().replace(/^>\s?/, ''))
      out.push(`<blockquote>${markdownToHtml(quote.join('\n'))}</blockquote>`)
      continue
    }
    if (/^\|.*\|\s*$/.test(trimmed) && i + 1 < lines.length && /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(lines[i + 1].trim())) {
      flushAll()
      const rows = [trimmed, lines[++i].trim()]
      while (i + 1 < lines.length && /^\|.*\|\s*$/.test(lines[i + 1].trim())) rows.push(lines[++i].trim())
      out.push(tableHtml(rows))
      continue
    }
    const bullet = line.match(/^(\s*)[-*+]\s+(.*)$/)
    const ordered = line.match(/^(\s*)\d+[.)]\s+(.*)$/)
    if (bullet || ordered) {
      flushParagraph()
      const m = bullet || ordered
      const indent = m[1].replace(/\t/g, '  ').length
      if (!list) list = { items: [] }
      list.items.push({ tag: bullet ? 'ul' : 'ol', indent, html: inline(m[2]) })
      continue
    }
    if (list && /^\s{2,}\S/.test(line)) {
      list.items[list.items.length - 1].html += `<br>${inline(trimmed)}`
      continue
    }
    flushList()
    paragraph.push(trimmed)
  }
  flushAll()
  return out.join('\n')
}
