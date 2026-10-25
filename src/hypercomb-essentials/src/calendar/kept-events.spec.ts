// calendar/kept-events.spec.ts — keeping a meeting is replication, and it is
// verified before anything is added: typed or from a link, a record is kept
// only when the bytes hash to the signature asked for and read as a meeting.
// A refusal writes nothing; keeping twice changes nothing.

import { beforeEach, describe, expect, it } from 'vitest'
import { SignatureService } from '@hypercomb/core'

;(globalThis as unknown as { window: unknown }).window ??= globalThis

// A host: sig -> bytes it serves, at /content/<sig>.
let served: Map<string, Uint8Array>
// A store: resources by signature, one pool document. (jsdom's Blob has no
// arrayBuffer(), so the fake holds the bytes behind one that does.)
type Held = { arrayBuffer: () => Promise<ArrayBuffer> }
const held = (bytes: Uint8Array): Held => ({ arrayBuffer: async () => bytes.slice().buffer as ArrayBuffer })
let resources: Map<string, Held>
let poolDoc: ArrayBuffer | null
let putFails = false
let landsWrong = false

const pool = { keys: async function* () { if (poolDoc) yield 'a'.repeat(64) } } as unknown as FileSystemDirectoryHandle
const store = {
  opfsRoot: { getDirectoryHandle: async () => { if (!poolDoc) throw new DOMException('', 'NotFoundError'); return pool } },
  getPool: async () => pool,
  getPoolDoc: async () => poolDoc,
  putPoolDoc: async (_pool: unknown, bytes: ArrayBuffer) => { if (putFails) return null; poolDoc = bytes; return 'doc' },
  putResource: async (blob: Blob) => {
    const bytes = new Uint8Array(await new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as ArrayBuffer)
      reader.onerror = () => reject(reader.error)
      reader.readAsArrayBuffer(blob)
    }))
    const sig = landsWrong ? 'f'.repeat(64) : await SignatureService.sign(bytes.slice().buffer as ArrayBuffer)
    resources.set(sig, held(bytes))
    return sig
  },
  getResource: async (sig: string) => resources.get(sig) ?? null,
}
;(window as unknown as { ioc: unknown }).ioc = {
  register: () => undefined,
  get: (key: string) => (key === '@hypercomb.social/Store' ? store : undefined),
}

const { KEPT_EVENTS_POOL, forgetEvent, keepEvents, listKept, readKeptMeetings, verifiedMeeting } = await import('./kept-events.js')
const { eventSignature, eventText } = await import('./event.js')

const meeting = async (date: string, extra: Record<string, unknown> = {}): Promise<{ sig: string; bytes: Uint8Array }> => {
  const text = eventText({ title: 'Hypercomb Meetup', date, time: '09:15', where: 'Yaletown Galleria', series: 'meetups', host: 'meetups.hypercomb.com', at: 1 })
  const bytes = new TextEncoder().encode(Object.keys(extra).length ? JSON.stringify({ ...JSON.parse(text), ...extra }) : text)
  return { sig: await eventSignature(new TextDecoder().decode(bytes)), bytes }
}
const serve = (m: { sig: string; bytes: Uint8Array }): void => { served.set(m.sig, m.bytes) }

beforeEach(() => {
  served = new Map()
  resources = new Map()
  poolDoc = null
  putFails = false
  landsWrong = false
  globalThis.fetch = (async (url: string | URL) => {
    const sig = new URL(String(url)).pathname.replace(/^\/(content\/)?/, '')
    const bytes = served.get(sig)
    return bytes ? new Response(bytes.slice().buffer as ArrayBuffer, { status: 200 }) : new Response('', { status: 404 })
  }) as unknown as typeof fetch
})

describe('keeping meetings', () => {
  it('the pool has its own meaning', () => {
    expect(KEPT_EVENTS_POOL).toBe('calendar:kept')
  })

  it('keeps a verified meeting: held by its signature, named on the list, read back as the meeting', async () => {
    const a = await meeting('2026-10-31'); serve(a)
    const result = await keepEvents([{ sig: a.sig, host: 'meetups.hypercomb.com' }])
    expect(result).toEqual({ kept: [a.sig], already: [], refused: [] })
    expect(resources.has(a.sig)).toBe(true)
    expect((await listKept()).map(row => [row.sig, row.host])).toEqual([[a.sig, 'meetups.hypercomb.com']])
    expect((await readKeptMeetings()).map(k => k.record.date)).toEqual(['2026-10-31'])
  })

  it('keeps several at once, soonest first, and keeping again changes nothing', async () => {
    const later = await meeting('2026-11-07'); const sooner = await meeting('2026-10-31')
    serve(later); serve(sooner)
    const asks = [{ sig: later.sig, host: 'h.example' }, { sig: sooner.sig, host: 'h.example' }]
    expect((await keepEvents(asks)).kept).toHaveLength(2)
    const again = await keepEvents(asks)
    expect(again.kept).toEqual([])
    expect(again.already.sort()).toEqual([later.sig, sooner.sig].sort())
    expect((await readKeptMeetings()).map(k => k.record.date)).toEqual(['2026-10-31', '2026-11-07'])
    expect(await listKept()).toHaveLength(2)
  })

  it('REFUSES bytes that do not hash to the name — a host that serves other bytes keeps nothing', async () => {
    const real = await meeting('2026-10-31')
    const forged = await meeting('2026-12-25')
    served.set(real.sig, forged.bytes)                 // the host serves a different meeting under that name
    const result = await keepEvents([{ sig: real.sig, host: 'h.example' }])
    expect(result.kept).toEqual([])
    expect(result.refused[0]?.sig).toBe(real.sig)
    expect(resources.size).toBe(0)
    expect(poolDoc).toBeNull()
  })

  it('REFUSES a record that is not a meeting, and one that is too large to be one', async () => {
    const text = JSON.stringify({ v: 1, kind: 'note', hello: 'world' })
    const notMeeting = { sig: await eventSignature(text), bytes: new TextEncoder().encode(text) }
    const big = await meeting('2026-10-31', { padding: 'x'.repeat(5000) })
    serve(notMeeting); serve(big)
    const result = await keepEvents([{ sig: notMeeting.sig, host: 'h.example' }, { sig: big.sig, host: 'h.example' }])
    expect(result.kept).toEqual([])
    expect(result.refused.map(r => r.reason)).toEqual(['is not a meeting', 'too large to be a meeting'])
    expect(poolDoc).toBeNull()
  })

  it('refuses what a host does not serve, and keeps the rest of the ticks', async () => {
    const good = await meeting('2026-10-31'); serve(good)
    const missing = await meeting('2026-11-14')
    const result = await keepEvents([{ sig: missing.sig, host: 'h.example' }, { sig: good.sig, host: 'h.example' }])
    expect(result.kept).toEqual([good.sig])
    expect(result.refused.map(r => r.sig)).toEqual([missing.sig])
  })

  it('writes nothing when the record would not land by its own signature, or the list will not save', async () => {
    const a = await meeting('2026-10-31'); serve(a)
    landsWrong = true
    expect((await keepEvents([{ sig: a.sig, host: 'h.example' }])).kept).toEqual([])
    expect(poolDoc).toBeNull()
    landsWrong = false; putFails = true
    const result = await keepEvents([{ sig: a.sig, host: 'h.example' }])
    expect(result.kept).toEqual([])
    expect(result.refused[0]?.reason).toMatch(/did not save/)
  })

  it('forgets a meeting: off the list, others stay', async () => {
    const a = await meeting('2026-10-31'); const b = await meeting('2026-11-07')
    serve(a); serve(b)
    await keepEvents([{ sig: a.sig, host: 'h.example' }, { sig: b.sig, host: 'h.example' }])
    expect(await forgetEvent(a.sig)).toBe(true)
    expect((await listKept()).map(row => row.sig)).toEqual([b.sig])
    expect(await forgetEvent(a.sig)).toBe(false)
  })

  it('a record the store no longer holds, or that no longer hashes, is not listed', async () => {
    const a = await meeting('2026-10-31'); serve(a)
    await keepEvents([{ sig: a.sig, host: 'h.example' }])
    resources.set(a.sig, held(new TextEncoder().encode(JSON.stringify({ v: 1, kind: 'event', title: 'Tampered' }))))
    expect(await readKeptMeetings()).toEqual([])
    resources.delete(a.sig)
    expect(await readKeptMeetings()).toEqual([])
  })

  it('reads a single record the same way, for a caller that checks before it ticks', async () => {
    const a = await meeting('2026-10-31'); serve(a)
    expect((await verifiedMeeting('h.example', a.sig)).ok).toBe(true)
    expect(await verifiedMeeting('h.example', 'not-a-sig')).toEqual({ ok: false, reason: 'not a signature' })
  })
})
