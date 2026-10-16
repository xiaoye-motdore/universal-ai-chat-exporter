/**
 * Minimal, dependency-free DOM -> Markdown converter used by the DOM fallbacks.
 * Works on DOM nodes only (never on HTML strings: Trusted Types forbid re-parsing).
 *
 * Handles: paragraphs, headings, bold/italic/strike, inline code, fenced code with
 * language, ordered/unordered (nested) lists, blockquotes, links, images, tables,
 * horizontal rules, KaTeX/MathJax formulas (restored from their TeX annotation).
 * UI chrome (buttons, screen-reader labels, svg, hidden nodes) is skipped.
 */

const SKIP_SELECTOR = 'button, svg, script, style, template, select, input, textarea, .sr-only, .cdk-visually-hidden, [aria-hidden="true"]'

function isElement(node) {
  return node.nodeType === 1
}

function escapeInline(text) {
  // Escape only the characters that would otherwise change Markdown structure
  return text.replace(/([\\`*_~[\]])/g, '\\$1')
}

function codeLanguage(pre, code) {
  const classes = `${(code && code.className) || ''} ${pre.className || ''}`
  const m = classes.match(/(?:language|lang)-([\w#+.-]+)/)
  if (m) return m[1]
  const dataLang = (code && code.getAttribute('data-language')) || pre.getAttribute('data-language')
  return dataLang || ''
}

function fence(code, lang) {
  const longest = (code.match(/`{3,}/g) || []).reduce((max, s) => Math.max(max, s.length), 0)
  const marks = '`'.repeat(Math.max(3, longest + 1))
  return `\n\n${marks}${lang}\n${code.replace(/\n$/, '')}\n${marks}\n\n`
}

function texOf(el) {
  const annotation = el.querySelector('annotation[encoding="application/x-tex"]')
  if (annotation) return annotation.textContent.trim()
  const alt = el.getAttribute('data-tex') || el.getAttribute('alttext') || el.getAttribute('data-math')
  return alt ? alt.trim() : ''
}

function tableToMarkdown(table, convert) {
  const rows = Array.from(table.querySelectorAll('tr')).filter((tr) => tr.closest('table') === table)
  if (!rows.length) return ''
  const cells = rows.map((tr) =>
    Array.from(tr.children)
      .filter((c) => c.tagName === 'TD' || c.tagName === 'TH')
      .map((c) => convert(c, { inline: true }).replace(/\s*\n\s*/g, ' ').replace(/\|/g, '\\|').trim()),
  )
  const width = Math.max(...cells.map((r) => r.length))
  const pad = (r) => r.concat(Array(width - r.length).fill(''))
  const header = pad(cells[0])
  const lines = [`| ${header.join(' | ')} |`, `| ${header.map(() => '---').join(' | ')} |`]
  for (const row of cells.slice(1)) lines.push(`| ${pad(row).join(' | ')} |`)
  return `\n\n${lines.join('\n')}\n\n`
}

const LANG_LABEL = /^[\w#+.-]{1,20}$/
const NOT_A_LANGUAGE = /^(copy|copied|code|run|edit|download|expand|collapse|wrap)$/i

/**
 * Returns the language label carried by a node next to a <pre>, or ''. A text
 * node is the label itself; an element may hold the label in one child next to
 * copy-button chrome, so each child is tried separately.
 */
function labelText(node) {
  if (!node) return ''
  if (node.nodeType === 3) return (node.nodeValue || '').trim()
  if (!isElement(node) || node.querySelector('pre, code, p, table, ul, ol')) return ''
  const candidates = []
  let own = ''
  node.childNodes.forEach((c) => {
    if (c.nodeType === 3) own += c.nodeValue
    else if (isElement(c) && !c.matches('button, svg, [aria-hidden="true"]')) candidates.push(c.textContent.trim())
  })
  candidates.unshift(own.trim())
  return candidates.find((t) => LANG_LABEL.test(t) && !NOT_A_LANGUAGE.test(t)) || ''
}

/** Previous siblings that could carry a label: skips whitespace, comments and button chrome. */
function prevSiblings(node, max) {
  const out = []
  let s = node.previousSibling
  while (s && out.length < max) {
    const skip = s.nodeType === 8 || (s.nodeType === 3 && !s.nodeValue.trim()) || (isElement(s) && s.matches('button, svg, [aria-hidden="true"]'))
    if (!skip) out.push(s)
    s = s.previousSibling
  }
  return out
}

/**
 * Platforms render the language of a code block as a label next to the <pre>
 * (ChatGPT: a text node, Claude: a sibling <div> of the wrapper, Gemini: a
 * decoration bar). Returns { lang, node } so the label is used and not exported.
 */
function siblingLanguage(pre) {
  const candidates = prevSiblings(pre, 3)
  const parent = pre.parentElement
  if (parent && parent.children.length === 1) candidates.push(...prevSiblings(parent, 2))
  for (const c of candidates) {
    const text = labelText(c)
    if (text && LANG_LABEL.test(text) && !NOT_A_LANGUAGE.test(text)) return { lang: text.toLowerCase(), node: c }
  }
  return null
}

export function domToMarkdown(root, options) {
  const opts = options || {}
  const consumed = new Set()
  const langOf = new Map()
  root.querySelectorAll('pre').forEach((pre) => {
    if (codeLanguage(pre, pre.querySelector('code'))) return
    const found = siblingLanguage(pre)
    if (found) {
      consumed.add(found.node)
      langOf.set(pre, found.lang)
    }
  })

  function convertChildren(node, ctx) {
    let out = ''
    for (const child of Array.from(node.childNodes)) if (!consumed.has(child)) out += convertNode(child, ctx)
    return out
  }

  function convertNode(node, ctx) {
    if (node.nodeType === 3) {
      const text = node.nodeValue || ''
      if (ctx.pre) return text
      const collapsed = text.replace(/\s+/g, ' ')
      return ctx.raw ? collapsed : escapeInline(collapsed)
    }
    if (!isElement(node)) return ''
    if (node.matches(SKIP_SELECTOR)) return ''
    if (opts.skip && node.matches(opts.skip)) return ''

    const tag = node.tagName.toLowerCase()

    // Rendered math: KaTeX wraps the TeX source in <annotation>; MathJax in alttext
    if (node.classList.contains('katex-display') || (tag === 'math' && node.getAttribute('display') === 'block')) {
      const tex = texOf(node)
      return tex ? `\n\n$$\n${tex}\n$$\n\n` : ''
    }
    if (node.classList.contains('katex') || tag === 'math' || node.classList.contains('MathJax')) {
      const tex = texOf(node)
      return tex ? `$${tex}$` : ''
    }
    if (node.classList.contains('katex-html')) return '' // visual duplicate of the annotation

    switch (tag) {
      case 'br':
        return ctx.inline ? ' ' : '  \n'
      case 'hr':
        return '\n\n---\n\n'
      case 'p':
      case 'div':
      case 'section':
      case 'article': {
        const inner = convertChildren(node, ctx)
        if (ctx.inline) return inner
        const isBlockContainer = tag !== 'p' && Array.from(node.children).some((c) => /^(p|div|ul|ol|pre|table|h[1-6]|blockquote)$/i.test(c.tagName))
        return isBlockContainer ? inner : `\n\n${inner.trim()}\n\n`
      }
      case 'h1':
      case 'h2':
      case 'h3':
      case 'h4':
      case 'h5':
      case 'h6': {
        const level = Number(tag[1])
        return `\n\n${'#'.repeat(level)} ${convertChildren(node, { ...ctx, inline: true }).trim()}\n\n`
      }
      case 'strong':
      case 'b': {
        const inner = convertChildren(node, ctx).trim()
        return inner ? `**${inner}**` : ''
      }
      case 'em':
      case 'i': {
        const inner = convertChildren(node, ctx).trim()
        return inner ? `*${inner}*` : ''
      }
      case 'del':
      case 's':
      case 'strike': {
        const inner = convertChildren(node, ctx).trim()
        return inner ? `~~${inner}~~` : ''
      }
      case 'code': {
        if (ctx.pre) return node.textContent
        const text = node.textContent
        const ticks = '`'.repeat((text.match(/`+/g) || []).reduce((m, s) => Math.max(m, s.length), 0) + 1)
        return `${ticks}${text}${ticks}`
      }
      case 'pre': {
        const code = node.querySelector('code')
        const lang = codeLanguage(node, code) || langOf.get(node) || ''
        // Only the <code> element (or, failing that, the <pre> text) is the source:
        // siblings such as language labels and copy buttons are UI chrome.
        const source = code ? code.textContent : node.textContent
        return fence(source, lang)
      }
      case 'blockquote': {
        const inner = convertChildren(node, ctx).replace(/\n{3,}/g, '\n\n').trim()
        return `\n\n${inner
          .split('\n')
          .map((l) => (l ? `> ${l}` : '>'))
          .join('\n')}\n\n`
      }
      case 'ul':
      case 'ol':
        return `\n\n${listToMarkdown(node, ctx, 0)}\n\n`
      case 'li':
        return convertChildren(node, ctx)
      case 'a': {
        const href = node.getAttribute('href') || ''
        const inner = convertChildren(node, { ...ctx, inline: true }).trim()
        if (!href || href.startsWith('javascript:')) return inner
        const abs = absolute(href)
        return inner ? `[${inner}](${abs})` : `<${abs}>`
      }
      case 'img': {
        const src = node.getAttribute('src') || ''
        const alt = node.getAttribute('alt') || ''
        if (!src || src.startsWith('data:')) return alt ? `[image: ${alt}]` : ''
        return `![${alt}](${absolute(src)})`
      }
      case 'table':
        return ctx.inline ? convertChildren(node, ctx) : tableToMarkdown(node, (el, c) => convertChildren(el, { ...ctx, ...c }))
      case 'thead':
      case 'tbody':
      case 'tr':
      case 'td':
      case 'th':
        return convertChildren(node, ctx) + (tag === 'tr' ? '\n' : ' ')
      default:
        // inline wrappers (span, sup, sub, mark, kbd, …) contribute their children only
        return convertChildren(node, ctx)
    }
  }

  function listToMarkdown(list, ctx, depth) {
    const ordered = list.tagName.toLowerCase() === 'ol'
    const start = Number(list.getAttribute('start') || 1)
    const items = Array.from(list.children).filter((c) => c.tagName === 'LI')
    const indent = '  '.repeat(depth)
    return items
      .map((li, i) => {
        const marker = ordered ? `${start + i}.` : '-'
        let body = ''
        const nested = []
        for (const child of Array.from(li.childNodes)) {
          if (isElement(child) && /^(ul|ol)$/i.test(child.tagName)) nested.push(listToMarkdown(child, ctx, depth + 1))
          else body += convertNode(child, ctx)
        }
        const lines = body.replace(/\n{3,}/g, '\n\n').trim().split('\n')
        const first = lines.shift() || ''
        const rest = lines.map((l) => (l ? `${indent}  ${l}` : '')).join('\n')
        return `${indent}${marker} ${first}${rest ? `\n${rest}` : ''}${nested.length ? `\n${nested.join('\n')}` : ''}`
      })
      .join('\n')
  }

  function absolute(href) {
    if (!opts.baseUrl) return href
    try {
      return new URL(href, opts.baseUrl).href
    } catch (e) {
      return href
    }
  }

  const md = convertNode(root, { inline: false, pre: false })
  return md
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
