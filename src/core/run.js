/**
 * Orchestrator: detect platform -> extract (API first, DOM fallback) -> show panel
 * -> download the chosen format. Runs only when the bookmarklet is clicked.
 */
import { detectAdapter, supportedNames } from './registry.js'
import { createNet } from './net.js'
import { finalize, validateConversation } from './schema.js'
import { createPanel } from './ui.js'
import { downloadText } from './download.js'
import { buildFilename } from './filename.js'
import { toMarkdown } from '../formatters/markdown.js'
import { toJson } from '../formatters/json.js'
import { toHtml } from '../formatters/html.js'
import { t } from './i18n.js'

const API_TIMEOUT_MS = 20000

const FORMATS = [
  { id: 'md', label: 'Markdown', ext: 'md', mime: 'text/markdown;charset=utf-8', render: toMarkdown },
  { id: 'json', label: 'JSON', ext: 'json', mime: 'application/json;charset=utf-8', render: toJson },
  { id: 'html', label: 'HTML', ext: 'html', mime: 'text/html;charset=utf-8', render: toHtml },
]

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`API timed out after ${ms} ms`)), ms)
    promise.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (e) => {
        clearTimeout(timer)
        reject(e)
      },
    )
  })
}

export async function extractConversation(adapter, env) {
  const warnings = []
  const warn = (code, message) => {
    if (!warnings.some((w) => w.code === code && w.message === message)) warnings.push({ code, message })
  }
  const ctx = {
    location: env.location,
    document: env.document,
    net: createNet(env.location, adapter.allowedPaths, env.fetch),
    warn,
  }

  let conv = null
  let apiError = null
  if (adapter.fromApi) {
    try {
      conv = await withTimeout(adapter.fromApi(ctx), env.apiTimeoutMs || API_TIMEOUT_MS)
    } catch (e) {
      apiError = e
    }
  }
  if (!conv) {
    conv = adapter.fromDom(ctx)
    if (conv && adapter.fromApi) {
      warn('dom-fallback', `${t('dom_fallback')}${apiError ? ` (${apiError.message})` : ''}`)
      if (conv.completeness === 'unknown') conv.completeness = 'partial'
    }
  }
  if (!conv) return null
  finalize(conv)
  for (const w of warnings) conv.warnings.push(w)
  const issues = validateConversation(conv)
  if (issues.length) throw new Error(`schema validation failed: ${issues.join('; ')}`)
  return conv
}

export async function run(env) {
  env = env || {}
  const doc = env.document || document
  const loc = env.location || location
  const panel = createPanel(doc)
  try {
    const adapter = detectAdapter(loc)
    if (!adapter) {
      panel.showError(t('unsupported', { list: supportedNames().join(', ') }))
      return null
    }
    if (adapter.status === 'planned') {
      panel.showError(t('planned', { name: adapter.name }))
      return null
    }
    if (!adapter.conversationId(loc)) {
      panel.showError(t('noConversation'))
      return null
    }
    panel.showLoading()
    const conv = await extractConversation(adapter, { location: loc, document: doc, fetch: env.fetch, apiTimeoutMs: env.apiTimeoutMs })
    if (!conv || !conv.stats.messages) {
      panel.showError(t('empty'))
      return null
    }

    const warnings = conv.warnings.map((w) => w.message)
    if (conv.stats.branchedMessages) warnings.push(t('branches', { count: conv.stats.branchedMessages }))
    const status = `${t('exported', { count: conv.stats.messages })}${conv.completeness === 'partial' ? ` · ${t('partial')}` : ''}`
    const meta = `${adapter.name} · ${conv.source.method === 'api' ? t('source_api') : t('source_dom')} · ${conv.title}`

    panel.showResult({
      statusText: status,
      metaText: meta,
      warnings,
      buttons: FORMATS.map((f) => ({
        label: f.label,
        onClick: () => downloadText(f.render(conv), buildFilename(adapter.id, conv.title, f.ext), f.mime, doc),
      })),
    })
    return conv
  } catch (e) {
    panel.showError(t('error', { message: e && e.message ? e.message : String(e) }))
    return null
  }
}
