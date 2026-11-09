// The code stamp names the code a relay is made of, and the relay says it.

import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { codeFiles, codeStamp } from './code-stamp.js'

const here = dirname(fileURLToPath(import.meta.url))

const world = () => {
  const dir = mkdtempSync(join(tmpdir(), 'hypercomb-code-stamp-'))
  writeFileSync(join(dir, 'entry.js'), "import { a } from './a.js'\nimport floor from './floor.json' with { type: 'json' }\nimport 'ws'\nexport const b = a\n")
  writeFileSync(join(dir, 'a.js'), "export const a = 1\n")
  writeFileSync(join(dir, 'floor.json'), '{}\n')
  writeFileSync(join(dir, 'unrelated.js'), "export const c = 3\n")
  return { dir, entry: join(dir, 'entry.js'), done: () => rmSync(dir, { recursive: true, force: true }) }
}

test('the stamp covers the entry and every local file it imports, and nothing else', () => {
  const w = world()
  try {
    assert.deepEqual(codeFiles(w.entry).map(f => f.slice(w.dir.length + 1)), ['a.js', 'entry.js', 'floor.json'])
    const before = codeStamp(w.entry)
    assert.match(before, /^[0-9a-f]{64}$/)
    writeFileSync(join(w.dir, 'unrelated.js'), "export const c = 4\n")
    assert.equal(codeStamp(w.entry), before)
    writeFileSync(join(w.dir, 'a.js'), "export const a = 2\n")
    assert.notEqual(codeStamp(w.entry), before)
  } finally { w.done() }
})

test('line endings are not a change of code', () => {
  const w = world()
  try {
    const before = codeStamp(w.entry)
    writeFileSync(join(w.dir, 'a.js'), "export const a = 1\r\n")
    assert.equal(codeStamp(w.entry), before)
  } finally { w.done() }
})

test('a running relay says the code it started from, and that it is not stale', async () => {
  const port = await new Promise(resolve => {
    const probe = createServer().listen(0, '127.0.0.1', () => { const { port } = probe.address(); probe.close(() => resolve(port)) })
  })
  const dir = mkdtempSync(join(tmpdir(), 'hypercomb-relay-stamp-'))
  const child = spawn(process.execPath, [join(here, 'relay.js'), '--port', String(port), '--content-dir', dir], { stdio: 'ignore' })
  try {
    const base = `http://127.0.0.1:${port}`
    let info = null
    for (let i = 0; i < 100 && !info; i++) {
      try { info = await (await fetch(base, { headers: { Accept: 'application/nostr+json' } })).json() } catch { await new Promise(r => setTimeout(r, 100)) }
    }
    assert.ok(info, 'the relay answered')
    assert.equal(info.code, codeStamp(join(here, 'relay.js')))
    assert.equal(info.stale, false)
    assert.ok(info.started_at > 0)
  } finally {
    child.kill()
    rmSync(dir, { recursive: true, force: true })
  }
})
