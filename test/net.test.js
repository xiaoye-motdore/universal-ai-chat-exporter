import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createNet } from '../src/core/net.js'

const location = { origin: 'https://claude.ai', hostname: 'claude.ai' }

test('refuses cross-origin, disallowed paths and bad methods', async () => {
  let called = 0
  const net = createNet(location, [/^\/api\//], async () => {
    called++
    return { ok: true, json: async () => ({}), text: async () => '' }
  })
  await assert.rejects(net.json('https://evil.example/api/x'), /cross-origin/)
  await assert.rejects(net.json('//evil.example/api/x'), /cross-origin/)
  await assert.rejects(net.json('/other/path'), /allow-list/)
  await assert.rejects(net.json('/api/x', { method: 'DELETE' }), /method/)
  assert.equal(called, 0)
})

test('allowed request is same-origin, credentialed to same origin, no redirects', async () => {
  const seen = []
  const net = createNet(location, [/^\/api\//], async (href, init) => {
    seen.push({ href, init })
    return { ok: true, json: async () => ({ ok: 1 }), text: async () => 'x' }
  })
  assert.deepEqual(await net.json('/api/x?y=1'), { ok: 1 })
  assert.equal(seen[0].href, 'https://claude.ai/api/x?y=1')
  assert.equal(seen[0].init.credentials, 'same-origin')
  assert.equal(seen[0].init.redirect, 'error')
  assert.equal(seen[0].init.mode, 'same-origin')
  assert.equal(seen[0].init.cache, 'no-store')
})

test('non-2xx becomes an error with status', async () => {
  const net = createNet(location, [/^\/api\//], async () => ({ ok: false, status: 401 }))
  await assert.rejects(net.json('/api/x'), (e) => e.status === 401)
})
