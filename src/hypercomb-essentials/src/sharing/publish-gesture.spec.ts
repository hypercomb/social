// sharing/publish-gesture.spec.ts
//
// PUBLISHING IS AN ACT — the write-conformance check 10 ratchets.
//
// Five sites used to publish, place, or provision with no participant
// gesture. Each is closed in code; these mechanical guards keep them closed
// the way doctrine.spec.ts keeps its allowlists: by reading the source and
// refusing the shape that was wrong.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const SHARING = join(process.cwd(), 'hypercomb-essentials', 'src', 'sharing')
const read = (file: string): string => readFileSync(join(SHARING, file), 'utf8')

const ESSENTIALS = join(process.cwd(), 'hypercomb-essentials', 'src')
/** Every non-spec source file under essentials. */
const tsFiles = (dir: string = ESSENTIALS): string[] => readdirSync(dir).flatMap(name => {
  const full = join(dir, name)
  if (statSync(full).isDirectory()) return tsFiles(full)
  if (!name.endsWith('.ts') || name.endsWith('.spec.ts')) return []
  return [full]
})
const rel = (f: string): string => f.slice(ESSENTIALS.length + 1).replace(/\\/g, '/')

/** Source with comments removed. These guards read code, not prose — a file
 *  that DOCUMENTS the shape it refuses (this commit's collector does exactly
 *  that) must not trip its own ratchet. */
const code = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

describe('publishing is an act', () => {
  it('the passive replication queue asks for the host-sync opt-in before any work', () => {
    const src = read('passive-replication-queue.ts')
    // the gate exists, is consulted at dispatch, and the default wiring binds
    // it to the SAME predicate that gates every other self-domain push
    expect(src.includes('allowed?: () => boolean')).toBe(true)
    expect(src.includes("hostSync?.isEnabled?.() === true")).toBe(true)
    const dispatch = src.slice(src.indexOf('async #dispatchOne'), src.indexOf('async #complete'))
    expect(dispatch.indexOf('this.#allowed()')).toBeGreaterThan(-1)
    expect(dispatch.indexOf('this.#allowed()')).toBeLessThan(dispatch.indexOf('this.#currentGenome('))
  })

  it('a learned domain is probed, never placed — accept is reached only through placeOffers', () => {
    const src = read('published-pools.ts')
    const probe = src.slice(src.indexOf('export const probePublishedPool'), src.indexOf('export const probeDomain'))
    expect(probe.includes('handler.accept(')).toBe(false)
    const trigger = src.slice(src.indexOf("EffectBus.on('domain:learned'"))
    expect(trigger.includes('accept')).toBe(false)
    expect(trigger.includes('placeOffers')).toBe(false)
    const place = src.slice(src.indexOf('export const placeOffers'), src.indexOf('export const _resetOffers'))
    expect(place.includes('handler.accept(')).toBe(true)
    // exactly one call site for accept in the whole module
    expect(src.split('handler.accept(').length - 1).toBe(1)
  })

  it('placeOffers has ONE caller outside its module — the offers window, on a press', () => {
    const root = join(process.cwd(), 'hypercomb-essentials', 'src')
    const walk = (dir: string): string[] => readdirSync(dir).flatMap(name => {
      const full = join(dir, name)
      if (statSync(full).isDirectory()) return walk(full)
      if (!name.endsWith('.ts') || name.endsWith('.spec.ts') || name.endsWith('-keys.ts')) return []
      return [full]
    })
    const callers = walk(root)
      .filter(f => /\bplaceOffers\s*\(/.test(readFileSync(f, 'utf8')))
      .map(f => f.slice(root.length + 1).replace(/\\/g, '/'))
      .sort()
    // the definition site does not match `placeOffers(` — it is `placeOffers = async (`
    expect(callers).toEqual(['sharing/offers.view.ts'])
  })

  it('joining a swarm never provisions a third-party host — ensureSwarmTarget signals, it does not switch', () => {
    const src = read('host-sync.service.ts')
    const body = src.slice(src.indexOf('public readonly ensureSwarmTarget'), src.indexOf('public readonly disablePublicHost'))
    expect(body.includes('enablePublicHost(')).toBe(false)
    expect(body.includes("'needs-host'")).toBe(true)
    expect(body.includes("EffectBus.emit('host-sync:needs-target'")).toBe(true)
  })

  // ── the fifth hole (2026-09-04) ───────────────────────────────────────
  //
  // PushQueueService subscribed to `content:wrote` with NO gate — no opt-in,
  // no filter on kind, provenance or authorship — and wrote a full byte copy
  // of every committed sig into `sign('push')/{sig}.{kind}` for the DCP
  // installer to drain. The installer, and with it the only assigner of
  // `globalThis.__sentinelBridge`, was deleted on 2026-08-30 (`fc3696c3b`).
  // The drain half stopped; the write half did not, so every commit
  // duplicated its own bytes on disk with nothing reading or collecting
  // them. The service is gone and its pools are swept by
  // `sharing/retired-push-pool.ts`.

  it('the installer push channel is gone — no service, no callers', () => {
    expect(existsSync(join(SHARING, 'push-queue.service.ts'))).toBe(false)
    const referring = tsFiles()
      .filter(f => /PushQueueService/.test(code(readFileSync(f, 'utf8'))))
      .map(rel)
    expect(referring, 'PushQueueService is retired — nothing may resolve or re-register it').toEqual([])
  })

  it('the collector only ever REMOVES a duplicate whose canonical copy it confirmed', () => {
    const src = code(read('retired-push-pool.ts'))
    // it probes directory handles and never mints content
    expect(src.includes('create: true')).toBe(false)
    expect(src.includes('createWritable')).toBe(false)
    // never through Store, whose content reads stage every sig to the host —
    // a collector built on those would publish every sig it swept
    for (const staging of ['getLayerLocalBytes', 'getLayerPoolBytes', 'getResourceLocal', 'getBeeBytes']) {
      expect(src.includes(staging), staging + ` stages to the host — the collector must not call it`).toBe(false)
    }
    // every queue removal is downstream of the canonical-presence check, and
    // an entry that fails it is KEPT, never destroyed
    const sweep = src.slice(src.indexOf('const collectQueueDir'), src.indexOf('const collectReceiptsDir'))
    expect(sweep.indexOf('canonicalHolds(')).toBeLessThan(sweep.indexOf('removeEntry('))
    expect(sweep.includes('report.kept++')).toBe(true)
  })

  it('every file that touches content:wrote is accounted for — a new one is a new hole', () => {
    // FROZEN CENSUS, by the literal rather than by a subscribe shape: a
    // handler can be registered through a `listens` array, a loop over effect
    // names, `onEffect`, or a bare `EffectBus.on`, and a ratchet that only
    // knew one of those would wave the next one through. `content:wrote`
    // fires on every commit, so a subscriber that sends anything without an
    // opt-in is publishing without a gesture. A file joining this list needs
    // a gate decision; a file leaving it is debt paid. Either way the list
    // moves in the same commit as the code, deliberately.
    const touching = tsFiles()
      .filter(f => code(readFileSync(f, 'utf8')).includes('content:wrote'))
      .map(rel)
      .sort()
    expect(touching).toEqual([
      'history/active-genome.service.ts',      // derived cache, local only
      'history/history.service.ts',            // THE EMITTER (layer commits)
      'history/manifest-optimizer.drone.ts',   // derived cache, local only
      'molecule/molecule-index.drone.ts',      // derived cache, local only
      'presentation/tiles/tree-view.drone.ts', // repaint trigger, local only
      'search/search-index.drone.ts',          // derived cache, local only
      'sharing/folder-sync.service.ts',        // the participant's own folder, /folder-sync opt-in
      'sharing/host-sync.service.ts',          // THE SENDER — gated on #anyEnabled()
    ])
  })
})
