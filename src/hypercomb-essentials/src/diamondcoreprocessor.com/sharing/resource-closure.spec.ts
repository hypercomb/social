// resource-closure.spec.ts — a hard copy is everything.
//
// A layer is a CONTRACT: it names content by signature. So do many resources —
// thread manifests hold `contentSig`, install/instruction manifests and presets
// hold sigs too. A walk that fetches the contracts and stops reads as success
// while the bytes they name stay remote, which is how a "complete" portable
// backup can restore to nothing. These specs pin the descent.

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

;(window as unknown as { ioc: unknown }).ioc = {
  register: () => void 0,
  get: () => undefined,
  whenReady: () => void 0,
}

let ContentBrokerDrone: typeof import('./content-broker.drone.js').ContentBrokerDrone

const SIG = (seed: string): string => seed.repeat(64).slice(0, 64)

const MANIFEST = SIG('a')
const NESTED_RECORD = SIG('b')
const IMAGE = SIG('c')
const ORPHAN = SIG('d')

const json = (value: unknown): Uint8Array =>
  new TextEncoder().encode(JSON.stringify(value))

let served: Map<string, Uint8Array>
let fetched: string[]

const makeBroker = () => {
  const broker = new ContentBrokerDrone()
  ;(broker as unknown as { fetchBySig: unknown }).fetchBySig = vi.fn(
    async (sig: string) => {
      fetched.push(sig)
      return served.get(sig) ?? null
    },
  )
  return broker
}

beforeAll(async () => {
  ;({ ContentBrokerDrone } = await import('./content-broker.drone.js'))
})

beforeEach(() => {
  fetched = []
  served = new Map<string, Uint8Array>([
    // A thread manifest: names its message body, which names an image.
    [MANIFEST, json({ turns: [{ role: 'user', contentSig: NESTED_RECORD }] })],
    [NESTED_RECORD, json({ body: 'hello', imageSig: IMAGE })],
    // A binary leaf that happens to contain a 64-hex run in its bytes.
    [IMAGE, new TextEncoder().encode(`PNG not-json ${ORPHAN}`)],
    [ORPHAN, json({ never: 'reached' })],
  ])
})

describe('resource closure', () => {
  it('descends through records that name further content', async () => {
    const broker = makeBroker()
    const stats = await broker.adoptResources([MANIFEST], {
      deepResources: true,
      quiet: true,
    })

    expect(fetched).toContain(NESTED_RECORD)
    expect(fetched).toContain(IMAGE)
    expect(stats).toEqual({ leaves: 3, failed: 0, truncated: 0 })
  })

  it('treats non-JSON bytes as a leaf and never harvests hex out of them', async () => {
    const broker = makeBroker()
    await broker.adoptResources([MANIFEST], { deepResources: true, quiet: true })

    // ORPHAN appears as a 64-hex run inside the image bytes. Scanning binary
    // content for signatures would pull arbitrary unrelated resources.
    expect(fetched).not.toContain(ORPHAN)
  })

  it('stops at the contract when descent is off — the slim default', async () => {
    const broker = makeBroker()
    const stats = await broker.adoptResources([MANIFEST], { quiet: true })

    expect(fetched).toEqual([MANIFEST])
    expect(stats).toEqual({ leaves: 1, failed: 0, truncated: 0 })
  })

  it('counts content it cannot resolve as failed rather than silently passing', async () => {
    served.delete(NESTED_RECORD)
    const broker = makeBroker()
    const stats = await broker.adoptResources([MANIFEST], {
      deepResources: true,
      quiet: true,
    })

    expect(stats).toEqual({ leaves: 1, failed: 1, truncated: 0 })
  })

  it('bounds a hostile fan-out and reports what it dropped', async () => {
    // A record naming a huge set of signatures. The walk follows sigs found
    // INSIDE fetched content, and that content can be peer-authored, so an
    // unbounded walk is a fetch storm: disk here, amplified request fan-out
    // at whatever hosts those sigs resolve against.
    const many = Array.from({ length: 500 }, (_, i) =>
      i.toString(16).padStart(4, '0').repeat(16))
    served.set(MANIFEST, json({ refs: many }))
    for (const sig of many) served.set(sig, json({ leaf: true }))

    const broker = makeBroker()
    const stats = await broker.adoptResources([MANIFEST], {
      deepResources: true,
      quiet: true,
      maxResources: 10,
    })

    expect(fetched.length).toBeLessThanOrEqual(10)
    // Silently obeying the bound would report a portable copy that is missing
    // content. The overflow must surface.
    expect(stats.truncated).toBeGreaterThan(0)
  })

  it('does not parse an oversized record, so a huge blob costs a size check', async () => {
    const huge = new TextEncoder().encode(
      `{"pad":"${'x'.repeat(9 * 1024 * 1024)}","ref":"${ORPHAN}"}`,
    )
    served.set(MANIFEST, huge)
    const broker = makeBroker()
    await broker.adoptResources([MANIFEST], { deepResources: true, quiet: true })

    expect(fetched).toEqual([MANIFEST])
  })

  it('terminates on a reference cycle', async () => {
    served.set(MANIFEST, json({ next: NESTED_RECORD }))
    served.set(NESTED_RECORD, json({ back: MANIFEST }))
    const broker = makeBroker()
    const stats = await broker.adoptResources([MANIFEST], {
      deepResources: true,
      quiet: true,
    })

    expect(stats).toEqual({ leaves: 2, failed: 0, truncated: 0 })
    expect(fetched).toHaveLength(2)
  })
})
