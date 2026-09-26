// sandbox-door-read.spec.ts — a sandbox door is read the one way there is:
// the newest marker of its own bag, sign(<door host>); the verdicts from their
// records by signature; who assessed it from sign('assess:<root>').
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SignatureService } from '@hypercomb/core'
import { readSandboxDoor } from './module-review.js'

const sign = (text: string): Promise<string> => {
  const bytes = new TextEncoder().encode(text)
  return SignatureService.sign(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)
}
const [ROOT, PUB, REVIEW, JEV, CHANGE, ASSESSOR, RECORD] = ['a', 'b', 'c', 'd', 'e', 'f', '1'].map(ch => ch.repeat(64))
const DOOR = 'https://try-fresh-rooms.hypercomb.com'

const serve = async (routes: Record<string, unknown>): Promise<void> => {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const path = new URL(String(input)).pathname
    if (!(path in routes)) return new Response(null, { status: 404 })
    const value = routes[path]
    return new Response(typeof value === 'string' ? value : JSON.stringify(value))
  }))
}

afterEach(() => { vi.unstubAllGlobals() })

describe('readSandboxDoor', () => {
  it('assembles the door from its bag, its records and its assessment pool', async () => {
    const bag = await sign('try-fresh-rooms.hypercomb.com')
    const pool = await sign(`assess:${ROOT}`)
    await serve({
      [`/${bag}/`]: '00000000\n00000001\n',
      [`/${bag}/00000001`]: { sandbox: true, layer: ROOT, pubkey: PUB, lineage: 'try-fresh-rooms', title: 'try-fresh-rooms',
        publisher: 'Jaime', change: CHANGE, review: REVIEW, jev: JEV },
      [`/content/${REVIEW}`]: { kind: 'module-review', verdict: 'accept' },
      [`/content/${JEV}`]: { kind: 'jev-reading', verdict: 'nonsense' },
      [`/${pool}/`]: `${ASSESSOR}\nnot-a-key\n`,
      [`/${pool}/${ASSESSOR}`]: { pubkey: ASSESSOR, record: RECORD, verdict: 'refuse', at: 7 },
    })
    expect(await readSandboxDoor(DOOR)).toEqual({
      sandbox: true, title: 'try-fresh-rooms', package: ROOT, pubkey: PUB, publisher: 'Jaime',
      change: CHANGE, review: REVIEW, reviewVerdict: 'accept', jev: JEV, jevVerdict: 'unsure',
      assessments: [{ pubkey: ASSESSOR, record: RECORD, verdict: 'refuse', at: 7 }],
    })
  })

  it('is null where the bag describes no sandbox', async () => {
    const bag = await sign('try-fresh-rooms.hypercomb.com')
    await serve({ [`/${bag}/`]: '00000000\n', [`/${bag}/00000000`]: { layer: ROOT, pubkey: PUB } })
    expect(await readSandboxDoor(DOOR)).toBeNull()
    await serve({})
    expect(await readSandboxDoor(DOOR)).toBeNull()
  })
})
