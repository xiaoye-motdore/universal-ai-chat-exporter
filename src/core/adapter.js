/**
 * Platform adapter contract.
 *
 * An adapter is a plain object:
 *
 *   {
 *     id:      'chatgpt'                     // used in filenames and the JSON export
 *     name:    'ChatGPT'                     // shown in the UI
 *     status:  'verified' | 'experimental' | 'planned'
 *     (no hosts list: matches() is the single source of truth)
 *     allowedPaths: [/^\/backend-api\//]     // same-origin paths this adapter may request.
 *                                            // The network guard refuses everything else.
 *     matches(location)        -> boolean    // is this the right adapter for the page?
 *     conversationId(location) -> string|null
 *     fromApi(ctx)   -> Promise<Conversation|null>   // optional. Complete extraction via
 *                                                    // the platform's own same-origin API.
 *                                                    // Return null or throw to fall back.
 *     fromDom(ctx)   -> Conversation|null            // required. Reads what is rendered.
 *   }
 *
 * ctx (built by core/run.js):
 *   { location, document, net: { json(path, init), text(path, init) }, warn(code, message) }
 *
 * Rules every adapter must follow (enforced by src/security/validate.js and by core/net.js):
 *   - Never call fetch/XMLHttpRequest directly: only ctx.net, which is same-origin only.
 *   - Never read document.cookie, localStorage, sessionStorage or indexedDB.
 *   - Never write HTML strings into the page (innerHTML / DOMParser are Trusted-Types sinks).
 *   - Never modify the conversation on the page.
 */

export const STATUS = Object.freeze({
  VERIFIED: 'verified', // extraction exercised on the live site; see TEST-RESULTS.md
  EXPERIMENTAL: 'experimental', // implemented from documented/observed structures, not live-verified
  PLANNED: 'planned', // detection only; export not implemented
})

export function assertAdapter(a) {
  const required = ['id', 'name', 'status', 'matches', 'conversationId', 'fromDom']
  for (const key of required) {
    if (!(key in a)) throw new Error(`adapter ${a && a.id}: missing ${key}`)
  }
  if (!Array.isArray(a.allowedPaths)) throw new Error(`adapter ${a.id}: allowedPaths must be an array`)
  return a
}
