import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

test('static security validator passes on src/ and dist/', () => {
  const r = spawnSync(process.execPath, ['src/security/validate.js'], { cwd: new URL('..', import.meta.url), encoding: 'utf8' })
  assert.equal(r.status, 0, r.stdout + r.stderr)
  const report = JSON.parse(readFileSync(new URL('../dist/security-report.json', import.meta.url), 'utf8'))
  assert.equal(report.ok, true)
  assert.equal(report.failed, 0)
  assert.ok(report.checks > 100)
})

test('build is deterministic: rebuilding yields the committed hash', () => {
  const before = readFileSync(new URL('../dist/ai-chat-export.bookmarklet.sha256', import.meta.url), 'utf8')
  const r = spawnSync(process.execPath, ['build/build.js'], { cwd: new URL('..', import.meta.url), encoding: 'utf8' })
  assert.equal(r.status, 0, r.stdout + r.stderr)
  const after = readFileSync(new URL('../dist/ai-chat-export.bookmarklet.sha256', import.meta.url), 'utf8')
  assert.equal(before, after)
})
