// sandbox-door-read.spec.ts — a sandbox door is read the one way there is:
// the newest marker of its own bag, sign(<door host>); the verdicts from their
// records by signature; who assessed it from sign('assess:<root>').
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SignatureService } from '@hypercomb/core'
import { doorReader, readSandboxDoor, readSharedChange, rootOfDoor, takeHostsOf, type AssessorIndex } from './module-review.js'

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

// jwize, 2026-11-10: "the files should all be served from the root domain".
// A shared change is read from the zone root; the door is only a fallback.
describe('a shared change is read from the root domain', () => {
  const ROOT_ORIGIN = 'https://hypercomb.com'
  const asked: string[] = []
  const serveHosts = (routes: Record<string, unknown>): void => {
    asked.length = 0
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input))
      asked.push(url.host)
      const key = `${url.origin}${url.pathname}`
      if (!(key in routes)) return new Response(null, { status: 404 })
      const value = routes[key]
      return new Response(typeof value === 'string' ? value : JSON.stringify(value))
    }))
  }
  const listing = { trials: [{ name: 'try-fresh-rooms', door: DOOR, package: ROOT, pubkey: PUB, publisher: 'Jaime', at: 5,
    sections: [], off: [], change: CHANGE, review: REVIEW, reviewVerdict: 'accept' }] }

  it('names the root a door hangs off, port kept, and nothing for a host that is no door', () => {
    expect(rootOfDoor('http://try-fresh-rooms.localhost:4291')).toEqual({ origin: 'http://localhost:4291', host: 'localhost:4291', name: 'try-fresh-rooms' })
    expect(rootOfDoor('https://hypercomb.com')).toBeNull()
    expect(takeHostsOf(DOOR)).toEqual(['hypercomb.com', 'try-fresh-rooms.hypercomb.com'])
  })

  it('assembles the change from the zone listing and each assessor’s own signed index, never asking the door', async () => {
    const note = JSON.stringify({ kind: 'module-assessment', root: ROOT, verdict: 'refuse' })
    const record = await sign(note)
    const other = JSON.stringify({ kind: 'module-assessment', root: PUB, verdict: 'accept' })
    const otherRecord = await sign(other)
    const DROPPED = '2'.repeat(64)
    const WRONG = '3'.repeat(64)
    serveHosts({
      [`${ROOT_ORIGIN}/${await sign('host:trials')}`]: listing,
      [`${ROOT_ORIGIN}/${await sign(`assess:${ROOT}`)}/`]: `${ASSESSOR}\n${DROPPED}\n${WRONG}\nnot-a-key\n`,
      [`${ROOT_ORIGIN}/${record}`]: note,
      [`${ROOT_ORIGIN}/${otherRecord}`]: other,
    })
    const index: AssessorIndex = async (host, pubkey) => {
      expect(host).toBe('hypercomb.com')
      if (pubkey === ASSESSOR) return { roots: { [`assess:${ROOT}`]: record }, createdAt: 9 }
      // One who dropped the key, and one whose record is of another root.
      if (pubkey === WRONG) return { roots: { [`assess:${ROOT}`]: otherRecord }, createdAt: 3 }
      return { roots: {}, createdAt: 1 }
    }
    expect(await readSharedChange(DOOR, index)).toEqual({
      sandbox: true, title: 'try-fresh-rooms', package: ROOT, pubkey: PUB, publisher: 'Jaime',
      change: CHANGE, review: REVIEW, reviewVerdict: 'accept',
      assessments: [{ pubkey: ASSESSOR, record, verdict: 'refuse', at: 9 }],
    })
    expect(new Set(asked)).toEqual(new Set(['hypercomb.com']))
  })

  it('is null when the root lists no change by that name, so the door is asked', async () => {
    serveHosts({ [`${ROOT_ORIGIN}/${await sign('host:trials')}`]: { trials: [] } })
    expect(await readSharedChange(DOOR, async () => null)).toBeNull()
    expect(await readSandboxDoor(DOOR)).toBeNull()
    expect(asked).toContain('try-fresh-rooms.hypercomb.com')
  })

  it('reads a signature from the root first, and from the door only when the root has none', async () => {
    const bytes = 'the changed file'
    const sig = await sign(bytes)
    serveHosts({ [`${ROOT_ORIGIN}/${sig}`]: bytes })
    expect(await doorReader(DOOR)(sig)).toBe(bytes)
    expect(asked).toEqual(['hypercomb.com'])
    serveHosts({ [`${DOOR}/${sig}`]: bytes, [`${ROOT_ORIGIN}/${sig}`]: 'not those bytes' })
    expect(await doorReader(DOOR)(sig)).toBe(bytes)
    expect(asked).toEqual(['hypercomb.com', 'try-fresh-rooms.hypercomb.com'])
  })
})

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
