#!/usr/bin/env node
/**
 * Deterministic build:
 *   dist/ai-chat-export.js                readable bundle (for auditing)
 *   dist/ai-chat-export.min.js            minified bundle (exactly what the bookmarklet runs)
 *   dist/ai-chat-export.bookmarklet.js    javascript: URL (percent-encoded minified bundle)
 *   dist/ai-chat-export.bookmarklet.sha256
 *   dist/build-info.json
 *   install.html, index.html              generated from build/install.template.html (index.html = GitHub Pages entry)
 *
 * No timestamps are embedded, so the same sources always yield the same bytes.
 */
import * as esbuild from 'esbuild'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
const MAX_BOOKMARKLET_BYTES = 64 * 1024

const common = {
  bundle: true,
  entryPoints: [resolve(root, 'src/main.js')],
  format: 'iife',
  legalComments: 'none',
  sourcemap: false,
  write: false,
  target: ['chrome100', 'firefox100', 'safari15', 'edge100'],
  define: { __VERSION__: JSON.stringify(pkg.version) },
}

const readable = await esbuild.build({ ...common, minify: false })
const minified = await esbuild.build({ ...common, minify: true })
const readableJs = readable.outputFiles[0].text
const minJs = minified.outputFiles[0].text.trim()

// The URL parser strips tabs/newlines and percent-decodes the body, so the whole
// script is percent-encoded. encodeURI leaves the URL-safe characters readable.
const bookmarklet = 'javascript:' + encodeURI('void ' + minJs)
const sha256 = createHash('sha256').update(bookmarklet).digest('hex')

mkdirSync(resolve(root, 'dist'), { recursive: true })
writeFileSync(resolve(root, 'dist/ai-chat-export.js'), readableJs)
writeFileSync(resolve(root, 'dist/ai-chat-export.min.js'), minJs + '\n')
writeFileSync(resolve(root, 'dist/ai-chat-export.bookmarklet.js'), bookmarklet)
writeFileSync(resolve(root, 'dist/ai-chat-export.bookmarklet.sha256'), `${sha256}  ai-chat-export.bookmarklet.js\n`)

const info = {
  name: pkg.name,
  version: pkg.version,
  bookmarkletSha256: sha256,
  bytes: { readable: Buffer.byteLength(readableJs), minified: Buffer.byteLength(minJs), bookmarklet: Buffer.byteLength(bookmarklet) },
  limitBytes: MAX_BOOKMARKLET_BYTES,
}
writeFileSync(resolve(root, 'dist/build-info.json'), JSON.stringify(info, null, 2) + '\n')

const escapeAttr = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
const template = readFileSync(resolve(root, 'build/install.template.html'), 'utf8')
const page = template
  .replace(/{{BOOKMARKLET_HREF}}/g, () => escapeAttr(bookmarklet))
  .replace(/{{VERSION}}/g, pkg.version)
  .replace(/{{SHA256}}/g, sha256)
  .replace(/{{SIZE_KB}}/g, (info.bytes.bookmarklet / 1024).toFixed(1))
writeFileSync(resolve(root, 'install.html'), page)
// index.html is the same page, so GitHub Pages serves the installer at the repository root URL.
writeFileSync(resolve(root, 'index.html'), page)

console.log(`bundle: ${info.bytes.minified} B minified, bookmarklet: ${info.bytes.bookmarklet} B (limit ${MAX_BOOKMARKLET_BYTES})`)
console.log(`sha256: ${sha256}`)
if (info.bytes.bookmarklet > MAX_BOOKMARKLET_BYTES) {
  console.error('ERROR: bookmarklet exceeds the size limit')
  process.exit(1)
}
