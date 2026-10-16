/**
 * The export panel. Built exclusively with createElement/textContent so it works
 * under Trusted Types (chatgpt.com and gemini.google.com block innerHTML).
 */
import { t } from './i18n.js'

const ROOT_ID = 'uace-panel'
const STYLE_ID = 'uace-style'
const CSS = `
#${ROOT_ID}{--bg:#fff;--fg:#1a1a22;--mut:#6b6b78;--line:#e7e7ee;--btn:#f4f4f8;--btnh:#e9e9f1;--acc:#5b6cff;position:fixed;top:18px;right:18px;z-index:2147483647;width:344px;max-width:calc(100vw - 36px);box-sizing:border-box;padding:16px 18px;color:var(--fg);background:var(--bg);border:1px solid var(--line);border-radius:18px;box-shadow:0 24px 60px #14142838,0 2px 8px #14142814;font:13px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;animation:uace-in .24s cubic-bezier(.2,.9,.25,1.15)}
@media(prefers-color-scheme:dark){#${ROOT_ID}{--bg:#1d1d24;--fg:#f2f2f6;--mut:#9f9fac;--line:#34343f;--btn:#2a2a34;--btnh:#363642;--acc:#7b8aff}}
@keyframes uace-in{from{opacity:0;transform:translateY(-8px) scale(.97)}}
@keyframes uace-spin{to{transform:rotate(360deg)}}
#${ROOT_ID} *{box-sizing:border-box;margin:0}
.uace-head{display:flex;align-items:center;gap:10px;margin-bottom:12px}
.uace-logo{flex:none;width:32px;height:32px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:17px;background:linear-gradient(135deg,#6f86ff,#b36bff);box-shadow:0 4px 12px #6f86ff59}
.uace-title{flex:1;font-weight:700;font-size:15px;letter-spacing:-.01em}
#${ROOT_ID} .uace-close{border:0;background:none;color:var(--mut);font:15px/1 inherit;cursor:pointer;padding:6px;border-radius:8px}
#${ROOT_ID} .uace-close:hover{background:var(--btn);color:var(--fg)}
.uace-status{display:flex;align-items:center;gap:9px;font-weight:600;font-size:14px}
.uace-dot{flex:none;width:9px;height:9px;border-radius:50%;background:#22c55e;box-shadow:0 0 0 3px #22c55e33}
.uace-dot.warn{background:#f59e0b;box-shadow:0 0 0 3px #f59e0b38}
.uace-spin{flex:none;width:14px;height:14px;border:2px solid var(--line);border-top-color:var(--acc);border-radius:50%;animation:uace-spin .7s linear infinite}
.uace-meta{color:var(--mut);font-size:12px;margin:3px 0 0 18px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.uace-warn,.uace-error{border-radius:11px;padding:9px 11px;margin-top:10px;font-size:12px;line-height:1.45}
.uace-warn{background:#f59e0b1c;border:1px solid #f59e0b59}
.uace-error{background:#ef44441a;border:1px solid #ef444459}
.uace-buttons{display:flex;gap:8px;margin-top:14px}
#${ROOT_ID} .uace-btn{flex:1;border:1px solid var(--line);background:var(--btn);color:var(--fg);border-radius:11px;padding:9px 0;font:inherit;font-weight:650;cursor:pointer;transition:background .15s,transform .08s}
#${ROOT_ID} .uace-btn:hover{background:var(--btnh)}
#${ROOT_ID} .uace-btn:active{transform:scale(.96)}
#${ROOT_ID} .uace-btn.primary{background:var(--acc);border-color:var(--acc);color:#fff}
#${ROOT_ID} .uace-btn.primary:hover{filter:brightness(1.08)}
.uace-hint{color:var(--mut);font-size:11px;text-align:center;margin-top:11px}
`

function el(doc, tag, className, text) {
  const node = doc.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

export function createPanel(doc) {
  if (!doc.getElementById(STYLE_ID)) {
    const style = el(doc, 'style')
    style.id = STYLE_ID
    style.textContent = CSS
    doc.head.appendChild(style)
  }
  const previous = doc.getElementById(ROOT_ID)
  if (previous) previous.remove()

  const root = el(doc, 'div')
  root.id = ROOT_ID
  root.setAttribute('role', 'dialog')
  root.setAttribute('aria-label', 'AI Chat Export')

  const head = el(doc, 'div', 'uace-head')
  head.appendChild(el(doc, 'span', 'uace-logo', '\u{1F4E4}'))
  head.appendChild(el(doc, 'span', 'uace-title', 'AI Chat Export'))
  const close = el(doc, 'button', 'uace-close', '✕')
  close.setAttribute('aria-label', t('close'))
  close.addEventListener('click', () => root.remove())
  head.appendChild(close)
  root.appendChild(head)

  const body = el(doc, 'div', 'uace-body')
  root.appendChild(body)
  doc.body.appendChild(root)

  function clear() {
    while (body.firstChild) body.removeChild(body.firstChild)
  }

  return {
    root,
    showLoading() {
      clear()
      const status = el(doc, 'div', 'uace-status')
      status.appendChild(el(doc, 'span', 'uace-spin'))
      status.appendChild(doc.createTextNode(t('loading')))
      body.appendChild(status)
    },
    showError(message) {
      clear()
      body.appendChild(el(doc, 'div', 'uace-error', message))
    },
    showResult({ statusText, metaText, warnings, partial, buttons }) {
      clear()
      const status = el(doc, 'div', 'uace-status')
      status.appendChild(el(doc, 'span', partial ? 'uace-dot warn' : 'uace-dot'))
      status.appendChild(doc.createTextNode(statusText))
      body.appendChild(status)
      if (metaText) {
        const meta = el(doc, 'div', 'uace-meta', metaText)
        meta.title = metaText
        body.appendChild(meta)
      }
      for (const w of warnings || []) body.appendChild(el(doc, 'div', 'uace-warn', w))
      const row = el(doc, 'div', 'uace-buttons')
      buttons.forEach((b, i) => {
        const btn = el(doc, 'button', i === 0 ? 'uace-btn primary' : 'uace-btn', b.label)
        btn.addEventListener('click', b.onClick)
        row.appendChild(btn)
      })
      body.appendChild(row)
      body.appendChild(el(doc, 'div', 'uace-hint', t('hint')))
    },
    remove() {
      root.remove()
    },
  }
}
