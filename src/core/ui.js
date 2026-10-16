/**
 * The export panel. Built exclusively with createElement/textContent so it works
 * under Trusted Types (chatgpt.com and gemini.google.com block innerHTML).
 */
import { t } from './i18n.js'

const ROOT_ID = 'uace-panel'
const STYLE_ID = 'uace-style'
const CSS = `
#${ROOT_ID}{position:fixed;top:16px;right:16px;z-index:2147483647;width:320px;max-width:calc(100vw - 32px);
box-sizing:border-box;padding:14px 16px;color:#111;background:#fff;border:1px solid #d9d9df;border-radius:12px;
box-shadow:0 12px 32px rgba(0,0,0,.22);font:13px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif}
#${ROOT_ID} *{box-sizing:border-box}
#${ROOT_ID} .uace-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px}
#${ROOT_ID} .uace-title{font-weight:700;font-size:14px}
#${ROOT_ID} .uace-close{border:0;background:transparent;font-size:16px;cursor:pointer;color:#666;padding:2px 6px;border-radius:6px}
#${ROOT_ID} .uace-close:hover{background:#eee;color:#111}
#${ROOT_ID} .uace-status{margin:4px 0 8px;color:#333}
#${ROOT_ID} .uace-meta{color:#666;font-size:12px;margin-bottom:8px}
#${ROOT_ID} .uace-warn{background:#fff7e6;border:1px solid #ffd591;color:#613400;border-radius:8px;padding:8px 10px;margin:6px 0;font-size:12px}
#${ROOT_ID} .uace-error{background:#fff1f0;border:1px solid #ffa39e;color:#5c0011;border-radius:8px;padding:8px 10px;font-size:12px}
#${ROOT_ID} .uace-buttons{display:flex;gap:8px;margin-top:10px}
#${ROOT_ID} .uace-btn{flex:1;border:1px solid #c9c9d1;background:#f6f6f8;color:#111;border-radius:8px;padding:8px 0;font:inherit;font-weight:600;cursor:pointer}
#${ROOT_ID} .uace-btn:hover{background:#e9e9ef}
#${ROOT_ID} .uace-spin{display:inline-block;width:12px;height:12px;border:2px solid #ccc;border-top-color:#333;border-radius:50%;
vertical-align:-2px;margin-right:6px;animation:uace-spin .8s linear infinite}
@keyframes uace-spin{to{transform:rotate(360deg)}}
@media (prefers-color-scheme: dark){#${ROOT_ID}{background:#1f1f24;color:#eee;border-color:#3a3a44}
#${ROOT_ID} .uace-status{color:#ddd}#${ROOT_ID} .uace-meta{color:#aaa}
#${ROOT_ID} .uace-btn{background:#2b2b33;border-color:#45454f;color:#eee}#${ROOT_ID} .uace-btn:hover{background:#3a3a44}
#${ROOT_ID} .uace-close{color:#aaa}#${ROOT_ID} .uace-close:hover{background:#333;color:#fff}}
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
    showResult({ statusText, metaText, warnings, buttons }) {
      clear()
      body.appendChild(el(doc, 'div', 'uace-status', statusText))
      if (metaText) body.appendChild(el(doc, 'div', 'uace-meta', metaText))
      for (const w of warnings || []) body.appendChild(el(doc, 'div', 'uace-warn', w))
      const row = el(doc, 'div', 'uace-buttons')
      for (const b of buttons) {
        const btn = el(doc, 'button', 'uace-btn', b.label)
        btn.addEventListener('click', b.onClick)
        row.appendChild(btn)
      }
      body.appendChild(row)
    },
    remove() {
      root.remove()
    },
  }
}
