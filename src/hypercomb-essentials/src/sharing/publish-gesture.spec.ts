// sharing/publish-gesture.spec.ts
//
// PUBLISHING IS AN ACT — the write-conformance check 10 ratchets.
//
// Four sites used to publish, place, or provision with no participant
// gesture. Each is closed in code; these mechanical guards keep them closed
// the way doctrine.spec.ts keeps its allowlists: by reading the source and
// refusing the shape that was wrong.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const SHARING = join(process.cwd(), 'hypercomb-essentials', 'src', 'sharing')
const read = (file: string): string => readFileSync(join(SHARING, file), 'utf8')

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

  it('joining a swarm never provisions a third-party host — ensureSwarmTarget signals, it does not switch', () => {
    const src = read('host-sync.service.ts')
    const body = src.slice(src.indexOf('public readonly ensureSwarmTarget'), src.indexOf('public readonly disablePublicHost'))
    expect(body.includes('enablePublicHost(')).toBe(false)
    expect(body.includes("'needs-host'")).toBe(true)
    expect(body.includes("EffectBus.emit('host-sync:needs-target'")).toBe(true)
  })
})
