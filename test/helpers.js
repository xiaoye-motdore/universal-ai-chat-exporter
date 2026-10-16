import { JSDOM } from 'jsdom'

/** Creates a jsdom page and returns { window, document, location }. */
export function page(html, url) {
  const dom = new JSDOM(html || '<!doctype html><html><head><title>Test</title></head><body></body></html>', { url, pretendToBeVisual: true })
  return { dom, window: dom.window, document: dom.window.document, location: dom.window.location }
}

/** Mock fetch: routes keyed by "METHOD path?query" or just the path. */
export function mockFetch(routes, log) {
  return async (href, init) => {
    const url = new URL(href)
    const method = (init && init.method) || 'GET'
    const key = url.pathname + url.search
    const route = routes[`${method} ${key}`] || routes[key] || routes[url.pathname]
    if (log) log.push({ method, url: href, init })
    if (!route) return { ok: false, status: 404, json: async () => ({}), text: async () => '' }
    const body = typeof route === 'function' ? await route(init) : route
    return {
      ok: true,
      status: 200,
      json: async () => (typeof body === 'string' ? JSON.parse(body) : body),
      text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    }
  }
}

export function ctxFor(p, adapter, fetch, warnings) {
  const { createNet } = awaitNet()
  return {
    location: p.location,
    document: p.document,
    net: createNet(p.location, adapter.allowedPaths, fetch),
    warn: (code, message) => warnings && warnings.push({ code, message }),
  }
}

let netModule = null
function awaitNet() {
  if (!netModule) throw new Error('call loadNet() first')
  return netModule
}
export async function loadNet() {
  netModule = await import('../src/core/net.js')
  return netModule
}
