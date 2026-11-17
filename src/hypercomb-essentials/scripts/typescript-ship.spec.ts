// @vitest-environment node
//
// typescript-ship.spec.ts — a publish carries the source atoms to this
// machine's host, and whatever goes wrong the package still ships: the copy
// never throws, and it never touches the `.partial` names another session's
// ship sweeps.

import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PARTIAL_SUFFIX } from './atomic-copy.js'
import { syncTarget } from './copy-content.js'
import { hostPackagesPool } from './pool-address.js'
import { TYPESCRIPT_STAGING } from './typescript-atoms.js'
import { ABANDONED_MS, TYPESCRIPT_INCOMING, shipTypescript, typescriptShipLines } from './typescript-ship.js'

const sha = (text: string): string => createHash('sha256').update(text).digest('hex')
const ATOMS = ['// @hypercomb/typescript/assistant\n', '// @hypercomb/typescript/games\nexport const game = 1\n', '// @hypercomb/typescript/sharing\n'.repeat(40)]

let root: string
let staging: string
let relay: string
let other: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'typescript-ship-'))
  staging = join(root, 'dist', '.typescript')
  relay = join(root, 'relay')
  other = join(root, 'other')
  mkdirSync(staging, { recursive: true })
  mkdirSync(relay)
  for (const text of ATOMS) writeFileSync(join(staging, sha(text)), text)
  // Not content: a name that is no signature is never shipped.
  writeFileSync(join(staging, 'README'), 'not an atom')
})
afterEach(() => { rmSync(root, { recursive: true, force: true }) })

const bytes = ATOMS.reduce((sum, text) => sum + Buffer.byteLength(text), 0)

describe('shipTypescript', () => {
  it('copies every atom to every target, and only atoms', () => {
    const ship = shipTypescript(staging, [relay, other])
    expect(ship).toEqual({ named: 3, bytes, copied: 6, held: 0, failed: [] })
    for (const dir of [relay, other]) {
      expect(readdirSync(dir).sort()).toEqual(ATOMS.map(sha).sort())
      for (const text of ATOMS) expect(readFileSync(join(dir, sha(text)), 'utf8')).toBe(text)
    }
  })

  it('a second run copies none and counts all held', () => {
    shipTypescript(staging, [relay])
    expect(shipTypescript(staging, [relay])).toEqual({ named: 3, bytes, copied: 0, held: 3, failed: [] })
  })

  it('replaces a short copy', () => {
    const sig = sha(ATOMS[1]!)
    writeFileSync(join(relay, sig), 'torn')
    const ship = shipTypescript(staging, [relay])
    expect(ship.copied).toBe(3)
    expect(readFileSync(join(relay, sig), 'utf8')).toBe(ATOMS[1])
  })

  it('a target that cannot be written is counted, never thrown', () => {
    const blocked = join(root, 'blocked')
    writeFileSync(blocked, 'a file where the content dir should be')
    let ship: ReturnType<typeof shipTypescript> | undefined
    expect(() => { ship = shipTypescript(staging, [blocked, relay]) }).not.toThrow()
    expect(ship!.failed.map(failure => failure.sig).sort()).toEqual(ATOMS.map(sha).sort())
    expect(ship!.failed.every(failure => failure.why.length > 0)).toBe(true)
    // The other target still got everything.
    expect(ship!.copied).toBe(3)
    const lines = typescriptShipLines(ship!, [blocked, relay]).join('\n')
    expect(lines).toMatch(/3 source atom\(s\) NOT copied \(first: [0-9a-f]{12}… — .+\); the package ships as before/)
  })

  it('removes an abandoned in-flight copy and leaves a fresh one', () => {
    const old = join(relay, `${sha('old')}.111${TYPESCRIPT_INCOMING}`)
    const fresh = join(relay, `${sha('fresh')}.222${TYPESCRIPT_INCOMING}`)
    writeFileSync(old, 'half')
    writeFileSync(fresh, 'half')
    const longAgo = new Date(Date.now() - 11 * 60 * 1000)
    utimesSync(old, longAgo, longAgo)
    shipTypescript(staging, [relay])
    expect(existsSync(old)).toBe(false)
    expect(existsSync(fresh)).toBe(true)
  })

  it('stamps a copy with the time it was made, so another ship\'s sweep never reads it as abandoned', () => {
    // A copy keeps its source's modified time, and an atom untouched since
    // an earlier build is far older than ABANDONED_MS: judged by that time,
    // a ship running beside this one would delete the copy in flight.
    const sig = sha(ATOMS[1]!)
    const longAgo = new Date(Date.now() - 6 * ABANDONED_MS)
    utimesSync(join(staging, sig), longAgo, longAgo)
    const made = Date.now() - 90_000
    expect(shipTypescript(staging, [relay], () => made).copied).toBe(3)
    // The rename keeps the temp copy's time: it is what the sweep would have judged.
    const stamped = statSync(join(relay, sig)).mtimeMs
    expect(Math.abs(stamped - made)).toBeLessThan(2_000)
    expect(made - stamped).toBeLessThan(ABANDONED_MS)
    // The same judgement on a copy in flight: an in-flight name carrying that time survives a sweep.
    const inFlight = join(relay, `${sha('in flight')}.333${TYPESCRIPT_INCOMING}`)
    writeFileSync(inFlight, 'half')
    utimesSync(inFlight, new Date(stamped), new Date(stamped))
    writeFileSync(join(staging, sha('one more')), 'one more')
    shipTypescript(staging, [relay])
    expect(existsSync(inFlight)).toBe(true)
  })

  it('neither creates nor touches a .partial: that suffix is another session\'s to sweep', () => {
    expect(TYPESCRIPT_INCOMING.endsWith(PARTIAL_SUFFIX)).toBe(false)
    const theirs = join(relay, `${sha(ATOMS[0]!)}${PARTIAL_SUFFIX}`)
    writeFileSync(theirs, 'another session, mid-copy')
    shipTypescript(staging, [relay])
    expect(readFileSync(theirs, 'utf8')).toBe('another session, mid-copy')
    expect(readdirSync(relay).filter(name => name.endsWith(PARTIAL_SUFFIX))).toEqual([`${sha(ATOMS[0]!)}${PARTIAL_SUFFIX}`])
    expect(readdirSync(relay).filter(name => name.endsWith(TYPESCRIPT_INCOMING))).toEqual([])
  })

  it('an empty or missing staging dir names nothing and writes nothing', () => {
    const empty = join(root, 'empty')
    mkdirSync(empty)
    for (const dir of [empty, join(root, 'missing')]) {
      expect(shipTypescript(dir, [relay])).toEqual({ named: 0, bytes: 0, copied: 0, held: 0, failed: [] })
    }
    expect(readdirSync(relay)).toEqual([])
    expect(typescriptShipLines(shipTypescript(empty, [relay]), [relay])).toEqual(['[copy-content] TypeScript — this build names no source atoms'])
  })

  it('says what it did in one line', () => {
    const ship = shipTypescript(staging, [relay])
    expect(typescriptShipLines(ship, [relay])).toEqual([`[copy-content] TypeScript — 3 source atom(s), 0.0 MB: 3 copied, 0 already held → ${relay} (before the pool was read)`])
  })
})

describe('nothing that ships dist\'s signature-named entries takes a source atom', () => {
  const POOL = hostPackagesPool()
  const layer = JSON.stringify({ name: 'essentials', cells: [], bees: [], dependencies: [], typescript: sha(ATOMS[1]!) })
  const bee = 'export const bee = 1\n'

  /** A dist as a build leaves it: a layer and a bee at the root, the pool,
   *  the build cache, and the atoms in their own folder. */
  const aDist = (): string => {
    const dist = join(root, 'dist')
    writeFileSync(join(dist, sha(layer)), layer)
    writeFileSync(join(dist, sha(bee)), bee)
    mkdirSync(join(dist, POOL))
    writeFileSync(join(dist, POOL, '00000000'), `${sha(layer)}\nessentials`)
    mkdirSync(join(dist, '.cache'))
    writeFileSync(join(dist, '.cache', 'unit.js'), 'cached')
    return dist
  }
  const everyName = (dir: string): string[] => readdirSync(dir, { recursive: true }).map(String)

  it('the ship\'s copier, run over a dist that holds .typescript, copies the package and no atom, mirrored or additive', () => {
    const dist = aDist()
    expect(readdirSync(join(dist, TYPESCRIPT_STAGING)).filter(name => /^[0-9a-f]{64}$/.test(name))).toHaveLength(3)
    const order = [{ sig: sha(layer), label: 'essentials' }]
    for (const additive of [false, true]) {
      const target = join(root, additive ? 'host' : 'feed')
      const result = syncTarget(target, additive, order, new Set([sha(layer), sha(bee)]), [], dist)
      expect(result.copied).toBeGreaterThanOrEqual(2)
      const names = everyName(target)
      expect(names).toContain(sha(layer))
      expect(names).toContain(sha(bee))
      for (const text of ATOMS) expect(names.some(name => name.includes(sha(text)))).toBe(false)
      expect(names.some(name => name.includes(TYPESCRIPT_STAGING) || name.includes('.cache'))).toBe(false)
    }
  })

  it('the shim build\'s rule for what it bundles from dist takes no atom and not their folder', () => {
    // build.mjs runs a whole build when imported, so its rule is read from
    // its text and applied here to the same dist: if the rule changes, this
    // stops matching and the proof has to be made again.
    const shim = readFileSync(resolve(__dirname, '..', '..', 'hypercomb-shim', 'build.mjs'), 'utf8')
    expect(shim).toContain('const SIG_NAME = /^[0-9a-f]{64}$/i')
    expect(shim).toContain("const isContent = SIG_NAME.test(entry.name) || entry.name === 'manifest.json'")
    expect(shim).toMatch(/for \(const entry of await readdir\(essentialsDist, \{ withFileTypes: true \}\)\) \{\s*const isContent = [^\n]+\s*if \(!isContent\) continue\s*const from = resolve\(essentialsDist, entry\.name\)\s*await cp\(from, resolve\(outContent, entry\.name\), \{ recursive: entry\.isDirectory\(\) \}\)/)
    const SIG_NAME = /^[0-9a-f]{64}$/i
    const dist = aDist()
    const out = join(root, 'shim-content')
    mkdirSync(out)
    for (const entry of readdirSync(dist, { withFileTypes: true })) {
      const isContent = SIG_NAME.test(entry.name) || entry.name === 'manifest.json'
      if (!isContent) continue
      cpSync(join(dist, entry.name), join(out, entry.name), { recursive: entry.isDirectory() })
    }
    const names = everyName(out)
    expect(names).toContain(sha(layer))
    for (const text of ATOMS) expect(names.some(name => name.includes(sha(text)))).toBe(false)
    expect(names.some(name => name.includes(TYPESCRIPT_STAGING))).toBe(false)
  })
})

describe('the ship carries them first, and only on publish', () => {
  const ship = readFileSync(join(__dirname, 'copy-content.ts'), 'utf8')
  const main = ship.slice(ship.indexOf('const main = '))

  it('before the pool is read, to the additive host alone, inside its own catch', () => {
    const carried = main.indexOf('shipTypescript(')
    expect(carried).toBeGreaterThan(-1)
    expect(carried).toBeLessThan(main.indexOf('poolEntries('))
    const block = main.slice(main.indexOf('if (publishing) {'), carried + 200)
    expect(block).toMatch(/TARGETS\.filter\(target => target\.additive\)/)
    expect(block).toMatch(/try \{[\s\S]*shipTypescript\([\s\S]*\} catch/)
  })
})
