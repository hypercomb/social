// swarm-byte-arrival.spec.ts
//
// "It should be immediate when participants connect."
//
// Tiles resolved sparsely, slowly, and without their pictures in a swarm, and
// the transport was never at fault — the mesh request/response path worked. Two
// things starved it:
//
//   1. A live participant holding the bytes was not treated as NEW KNOWLEDGE.
//      The broker only ever cleared a miss window on HTTP domain attribution,
//      which most peers never advertise, so every sig that had already missed
//      stayed on the exponential ladder (60s doubling toward 30 min) while the
//      one participant who could answer it in a single round trip stood right
//      there announcing itself.
//   2. The resolution order was serial — the whole HTTP tier walk first, then a
//      2s mesh window — so a peer's unpublished bytes were asked for last and
//      on the shortest deadline.
//
// These are the behavioural guards. The WIRING half (a namespace-free IoC key
// that nothing registers, which is how Store lost the broker entirely for two
// and a half weeks) is a mechanical ratchet in src/doctrine.spec.ts instead.

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { visualArtifactSigs } from './visual-hosts.js'

const registrations = new Map<string, unknown>()
;(window as unknown as { ioc: unknown }).ioc = {
  register: (key: string, value: unknown) => { registrations.set(key, value) },
  get: (key: string) => registrations.get(key),
  whenReady: () => void 0,
}

let ContentBrokerDrone: typeof import('./content-broker.drone.js').ContentBrokerDrone

const sig = (seed: string): string => seed.repeat(64).slice(0, 64)
const PEER_A = sig('a')
const PEER_B = sig('b')

beforeAll(async () => {
  ;({ ContentBrokerDrone } = await import('./content-broker.drone.js'))
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  localStorage.clear()
  registrations.clear()
})

/** A broker with no reachable host and no mesh: every fetch is a full-cascade
 *  miss, which is exactly the state that arms the backoff ladder. */
const brokerWithNothingReachable = () => {
  registrations.set('@hypercomb.social/Store', {
    getResourceLocal: async () => null,
    putResource: async () => '',
  })
  vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })))
  return new ContentBrokerDrone()
}

describe('a live participant is new knowledge', () => {
  it('parks an unresolvable sig in a miss window, then lifts it when a peer claims it', async () => {
    const broker = brokerWithNothingReachable()
    const target = sig('1')

    expect(await broker.fetchBySig(target, 'resource')).toBeNull()
    // The ladder is armed: the sig now answers null instantly without dialing.
    expect(broker.missUntil(target)).toBeGreaterThan(Date.now())

    broker.notePeerLiveness(PEER_A, [target])

    // Lifted — the next ask re-dials immediately instead of waiting out 60s.
    expect(broker.missUntil(target)).toBe(0)
  })

  it('grants one retry per claimant, so a 30s heartbeat re-announce cannot storm', async () => {
    const broker = brokerWithNothingReachable()
    const target = sig('2')

    await broker.fetchBySig(target, 'resource')
    broker.notePeerLiveness(PEER_A, [target])
    expect(broker.missUntil(target)).toBe(0)

    // Miss again — the window comes back, now on a doubled budget.
    await broker.fetchBySig(target, 'resource')
    const armed = broker.missUntil(target)
    expect(armed).toBeGreaterThan(Date.now())

    // The SAME peer re-announcing the same sig is not new knowledge. This is
    // the guard #noteDomains learned the hard way: clearing on every repeat
    // woke consumers that missed again and went round, hundreds of times.
    broker.notePeerLiveness(PEER_A, [target])
    expect(broker.missUntil(target)).toBe(armed)

    // A DIFFERENT participant claiming it is genuinely new — somebody else may
    // hold what the first could not serve.
    broker.notePeerLiveness(PEER_B, [target])
    expect(broker.missUntil(target)).toBe(0)
  })

  it('ignores a malformed claimant or sig rather than clearing indiscriminately', async () => {
    const broker = brokerWithNothingReachable()
    const target = sig('3')
    await broker.fetchBySig(target, 'resource')
    const armed = broker.missUntil(target)

    broker.notePeerLiveness('not-a-pubkey', [target])
    broker.notePeerLiveness(PEER_A, ['not-a-sig'])
    broker.notePeerLiveness(PEER_A, [])

    expect(broker.missUntil(target)).toBe(armed)
  })

  it('only wakes gated consumers for sigs that were actually missing', async () => {
    const broker = brokerWithNothingReachable()
    const missing = sig('4')
    const neverAsked = sig('5')
    await broker.fetchBySig(missing, 'resource')

    const arrivals: unknown[] = []
    const off = (broker as unknown as {
      onEffect: (name: string, cb: (p: unknown) => void) => () => void
    }).onEffect?.('content:arrived', p => arrivals.push(p))
    // EffectBus replays the last value to a late subscriber, so counts are
    // measured as deltas from whatever this subscription was handed on arrival.
    const baseline = arrivals.length

    // A sig nobody ever asked for was in no window, so it has nothing to wake.
    broker.notePeerLiveness(PEER_A, [neverAsked])
    expect(arrivals.length - baseline).toBe(0)

    // content:arrived forces a full render pass, so a peer announcing a whole
    // page of tiles must produce ONE wake, not one per tile.
    broker.notePeerLiveness(PEER_A, [missing, neverAsked, sig('6'), sig('7')])
    expect(arrivals.length - baseline).toBe(1)
    off?.()
  })
})

describe('the refs a visual carries', () => {
  it('collects the layer and every admitted image variant, deduped', () => {
    const refs = visualArtifactSigs([{
      name: 'tile',
      layerSig: sig('1'),
      imageSig: sig('2'),
      small: { image: sig('3') },
      large: { image: sig('3') },        // same picture — one ref
      point: { image: sig('4') },
      flat: { small: { image: sig('5') }, large: { image: sig('6') } },
      link: 'https://example.com',        // not a signature
    }])
    expect(refs.sort()).toEqual([sig('1'), sig('2'), sig('3'), sig('4'), sig('5'), sig('6')].sort())
  })

  it('treats a pictureless visual as an absence, not a ref', () => {
    expect(visualArtifactSigs([{ name: 'tile' }])).toEqual([])
    expect(visualArtifactSigs([{ name: 'tile', imageSig: 'nope' }])).toEqual([])
  })
})
