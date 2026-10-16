/**
 * The only module allowed to perform network requests.
 *
 * Every request is resolved against the current page origin and refused when:
 *   - it would leave the origin (no third-party traffic, ever),
 *   - its path is not in the adapter's allow-list,
 *   - it uses a method other than GET/POST,
 *   - the server tries to redirect (a redirect could carry the request elsewhere).
 *
 * Credentials are 'same-origin' (the browser sends the user's own session cookies
 * to the platform it already uses; the script never reads them).
 */

export class NetError extends Error {
  constructor(message, status) {
    super(message)
    this.name = 'NetError'
    this.status = status || 0
  }
}

export function createNet(location, allowedPaths, fetchImpl) {
  const doFetch = fetchImpl || ((...args) => globalThis.fetch(...args))
  const origin = location.origin

  function resolve(path) {
    const url = new URL(path, origin)
    if (url.origin !== origin) throw new NetError(`refused cross-origin request to ${url.origin}`)
    if (!allowedPaths.some((re) => re.test(url.pathname))) throw new NetError(`refused request outside allow-list: ${url.pathname}`)
    return url
  }

  async function request(path, init) {
    init = init || {}
    const method = String(init.method || 'GET').toUpperCase()
    if (method !== 'GET' && method !== 'POST') throw new NetError(`refused method ${method}`)
    const url = resolve(path)
    const response = await doFetch(url.href, {
      method,
      headers: init.headers || {},
      body: method === 'POST' ? init.body : undefined,
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
      mode: 'same-origin',
    })
    if (!response.ok) throw new NetError(`${method} ${url.pathname} returned HTTP ${response.status}`, response.status)
    return response
  }

  return {
    async json(path, init) {
      const response = await request(path, Object.assign({}, init, { headers: Object.assign({ accept: 'application/json' }, (init && init.headers) || {}) }))
      return response.json()
    },
    async text(path, init) {
      const response = await request(path, init)
      return response.text()
    },
  }
}
