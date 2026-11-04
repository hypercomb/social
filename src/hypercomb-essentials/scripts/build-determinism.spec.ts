// @vitest-environment node
//
// build-determinism.spec.ts — the same inputs make the same bytes on any
// machine, and a publish that skips the build signs only what was built.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { bagSignature } from '../../hypercomb-runtime/src/bags.js'
import { encodeTransferPack } from '../../hypercomb-runtime/src/transfer-pack.js'
import {
  buildInputsDigest, buildScriptPaths, byCodeUnit, checkBuildStamp, fileContentSig, inputsMoved, sortedNames, writeBuildStamp,
} from './build-determinism.js'
import { bagAddress } from './retention.js'

let root: string
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'build-determinism-')) })
afterEach(() => { rmSync(root, { recursive: true, force: true }) })

/** Run `build` with `String.prototype.localeCompare` replaced — the stand-in
 *  for a machine whose ICU collation differs. A build that never asks the
 *  locale cannot notice. */
const underCollation = async <T>(compare: (a: string, b: string) => number, build: () => T | Promise<T>): Promise<T> => {
  const original = String.prototype.localeCompare
  String.prototype.localeCompare = function (this: string, that: string) { return compare(String(this), that) }
  try { return await build() } finally { String.prototype.localeCompare = original }
}

const REVERSED = (a: string, b: string): number => (a < b ? 1 : a > b ? -1 : 0)
const CASE_BLIND = (a: string, b: string): number => {
  const [x, y] = [a.toLowerCase(), b.toLowerCase()]
  return x < y ? -1 : x > y ? 1 : 0
}
const HOSTILE = { reversed: REVERSED, 'case-blind (ICU-like)': CASE_BLIND, throws: () => { throw new Error('the build asked the locale') } }

describe('ordering is by code unit, not by the machine\'s locale', () => {
  const names = ['b', 'B', 'a', '_x', '-y', 'Z.ts', 'a-b', 'a_b', 'é', 'e', 'E', '10', '9']

  it('byCodeUnit is the UTF-16 order', () => {
    expect([...names].sort(byCodeUnit)).toEqual(['-y', '10', '9', 'B', 'E', 'Z.ts', '_x', 'a', 'a-b', 'a_b', 'b', 'e', 'é'])
  })

  it('a directory listing sorts the same under every collation', async () => {
    for (const name of names) writeFileSync(join(root, name), '')
    const reference = sortedNames(root)
    for (const [label, compare] of Object.entries(HOSTILE)) {
      expect(await underCollation(compare, () => sortedNames(root)), label).toEqual(reference)
    }
  })

  it('a bag is addressed by the same bytes under every collation — build, runtime and retention agree', async () => {
    const entries = ['f'.repeat(64), '0'.repeat(64), 'a'.repeat(64), '9'.repeat(64), 'b0'.padEnd(64, '1')]
      .map(sig => ({ sig, content: `\n${sig}\n` }))
    const reference = await bagSignature(entries)
    expect(bagAddress(entries)).toBe(reference)
    for (const [label, compare] of Object.entries(HOSTILE)) {
      expect(await underCollation(compare, () => bagSignature(entries)), label).toBe(reference)
      expect(await underCollation(compare, () => bagAddress(entries)), label).toBe(reference)
    }
  })

  it('a transfer pack is the same bytes under every collation', async () => {
    const members: Array<readonly [string, Uint8Array]> = [
      ['d'.repeat(64), new Uint8Array([1, 2, 3])], ['0'.repeat(64), new Uint8Array([9])], ['a'.repeat(64), new Uint8Array([4, 5])],
    ]
    const reference = Buffer.from(encodeTransferPack(members)).toString('hex')
    for (const [label, compare] of Object.entries(HOSTILE)) {
      expect(await underCollation(compare, () => Buffer.from(encodeTransferPack([...members].reverse())).toString('hex')), label).toBe(reference)
    }
  })

  it('the digest of one source tree is the same under every collation and every listing order', async () => {
    const project = join(root, 'p')
    for (const rel of ['src/B/two.ts', 'src/a/one.ts', 'src/_x/three.ts', 'src/a-b/four.ts']) {
      mkdirSync(join(project, rel, '..'), { recursive: true })
      writeFileSync(join(project, rel), `export const v = '${rel}'\n`)
    }
    writeFileSync(join(project, 'atomized-roots.json'), '{"roots":[]}')
    const reference = buildInputsDigest(project, [])
    for (const [label, compare] of Object.entries(HOSTILE)) {
      expect(await underCollation(compare, () => buildInputsDigest(project, [])), label).toBe(reference)
    }
  })

  it('no build script, nor the code the build bundles into a signature, asks the locale to order anything', () => {
    // The ratchet behind the proof above: the specs show the CURRENT code is
    // locale-free; this keeps the next edit from reintroducing it.
    const scripts = readdirSync(__dirname).filter(n => n.endsWith('.ts') && !n.endsWith('.d.ts') && !n.endsWith('.spec.ts'))
    const hits = [
      ...scripts.map(n => join(__dirname, n)),
      join(__dirname, '../../hypercomb-runtime/src/bags.ts'),
      join(__dirname, '../../hypercomb-runtime/src/transfer-pack.ts'),
    ].filter(f => /\.localeCompare\(/.test(readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')))
    expect(hits).toEqual([])
  })
})

describe('the cache keys on content, never on a clock', () => {
  it('a touched file (new mtime, same bytes) has not moved; a rewritten one (same size, new bytes) has', () => {
    const file = join(root, 'a.ts')
    writeFileSync(file, 'const a = 1')
    const recorded = { [file]: { sig: fileContentSig(file) } }
    expect(inputsMoved(recorded)).toBe(false)

    utimesSync(file, new Date(2001, 1, 1), new Date(2001, 1, 1))
    expect(inputsMoved(recorded)).toBe(false)

    writeFileSync(file, 'const a = 2')
    utimesSync(file, new Date(2001, 1, 1), new Date(2001, 1, 1))   // the clock says nothing happened
    expect(inputsMoved(recorded)).toBe(true)
  })

  it('a recorded input that is gone counts as moved', () => {
    expect(inputsMoved({ [join(root, 'gone.ts')]: { sig: 'x' } })).toBe(true)
  })
})

describe('a publish that skips the build', () => {
  const ROOT_SIG = 'c'.repeat(64)
  let project: string
  let dist: string
  let scripts: string

  beforeEach(() => {
    project = join(root, 'essentials')
    dist = join(project, 'dist')
    scripts = join(project, 'scripts')
    mkdirSync(join(project, 'src', 'x'), { recursive: true })
    mkdirSync(scripts, { recursive: true })
    for (const path of buildScriptPaths(scripts)) writeFileSync(path, '// script')
    writeFileSync(join(project, 'src', 'x', 'x.drone.ts'), 'export class X {}')
    writeFileSync(join(project, 'atomized-roots.json'), '{"roots":[]}')
  })

  const stampNow = (rootSig = ROOT_SIG): void =>
    writeBuildStamp(dist, { inputs: buildInputsDigest(project, buildScriptPaths(scripts)), root: rootSig })

  it('is allowed when the stamp matches the sources and the root', () => {
    stampNow()
    expect(checkBuildStamp(project, dist, ROOT_SIG, scripts)).toEqual({ ok: true })
  })

  it('is refused when dist carries no stamp', () => {
    const verdict = checkBuildStamp(project, dist, ROOT_SIG, scripts)
    expect(verdict.ok).toBe(false)
    expect(existsSync(dist)).toBe(false)
  })

  it('is refused once a source file changes after the build', () => {
    stampNow()
    writeFileSync(join(project, 'src', 'x', 'x.drone.ts'), 'export class X { y = 1 }')
    expect(checkBuildStamp(project, dist, ROOT_SIG, scripts)).toMatchObject({ ok: false, reason: expect.stringContaining('sources have changed') })
  })

  it('is refused once a build script changes — how a unit is compiled is an input too', () => {
    stampNow()
    writeFileSync(buildScriptPaths(scripts)[0]!, '// changed')
    expect(checkBuildStamp(project, dist, ROOT_SIG, scripts).ok).toBe(false)
  })

  it('is refused when dist holds a different root than the build made', () => {
    stampNow()
    expect(checkBuildStamp(project, dist, 'd'.repeat(64), scripts)).toMatchObject({ ok: false, reason: expect.stringContaining('last build made') })
    expect(checkBuildStamp(project, dist, null, scripts).ok).toBe(false)
  })
})
