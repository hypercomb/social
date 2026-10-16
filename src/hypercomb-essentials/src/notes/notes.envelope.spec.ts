// notes.envelope.spec.ts — a note named through its envelope is still ONE note.
//
// A committed layer heals every sig in its `notes` slot into a meta envelope
// ({ resource: <note>, relation: 'notes' }), while the word's facet lists the
// notes themselves. Read side by side, every note showed twice, and a removal
// took one copy while the re-written list put the other back (/games/arkanoid,
// 2026-10-11). These drive the real NotesService over an in-memory store whose
// committer heals the slot the way the life primitive does.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mintMetaEnvelope } from '@hypercomb/core'

const facet = { list: [] as string[] }
vi.mock('./notes-facet.js', async (load) => {
  const real = await load<typeof import('./notes-facet.js')>()
  return {
    ...real,
    readNotesFacet: async () => [...facet.list],
    cachedNotesFacet: () => [...facet.list],
    writeNotesFacet: async (_name: string, sigs: readonly string[]) => { facet.list = [...sigs]; return { ok: true } },
  }
})

const raw = new Map<string, string>()
const layers = new Map<string, Record<string, unknown>>()
const sha256 = async (text: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')
}
const put = async (text: string): Promise<string> => {
  const sig = await sha256(text)
  raw.set(sig, text)
  return sig
}
/** What the store hands a reader: an envelope resolves to what it names. */
const resolved = (sig: string): string | null => {
  let text = raw.get(sig) ?? null
  for (let hop = 0; text && hop < 4; hop++) {
    const parsed = JSON.parse(text) as Record<string, unknown>
    if (parsed['meta'] !== 1 || typeof parsed['resource'] !== 'string') break
    text = raw.get(parsed['resource'] as string) ?? null
  }
  return text
}
const envelopeOf = (sig: string): Promise<string> => put(JSON.stringify(mintMetaEnvelope({ resource: sig, relation: 'notes' })))

/** jsdom's Blob has no text(); the store hands back a blob-like that does. */
const blobOf = (text: string) => ({ size: new TextEncoder().encode(text).byteLength, text: async () => text })
const textOf = (blob: Blob): Promise<string> => new Promise((resolve, reject) => {
  const reader = new FileReader()
  reader.onload = () => resolve(String(reader.result))
  reader.onerror = () => reject(reader.error)
  reader.readAsText(blob)
})

const services: Record<string, unknown> = {
  '@hypercomb.social/Store': {
    putResource: async (blob: Blob) => put(await textOf(blob)),
    getResource: async (sig: string) => { const t = resolved(sig); return t === null ? null : blobOf(t) },
    getResourceLocal: async (sig: string) => { const t = raw.get(sig); return t === undefined ? null : blobOf(t) },
    resolve: async (sig: string) => { const t = resolved(sig); return t === null ? null : JSON.parse(t) },
    putArtifactMeta: async (_kind: 'resource', sig: string, incidence: Record<string, unknown> = {}) =>
      put(JSON.stringify(mintMetaEnvelope({ resource: sig, ...incidence }))),
  },
  '@diamondcoreprocessor.com/HistoryService': {
    sign: async (lineage: { explorerSegments: () => readonly string[] }) => lineage.explorerSegments().join('/'),
    currentLayerAt: async (loc: string) => layers.get(loc) ?? null,
    peekCurrentLayer: (loc: string) => layers.get(loc) ?? null,
  },
  // The commit heals the slot as the life primitive does: a bare note sig
  // becomes the envelope that names it, and an entry that already IS an
  // envelope is kept as it stands (healLegacyLayer — the incidence, and the
  // arrival time it carries, survive every later commit).
  '@diamondcoreprocessor.com/LayerCommitter': {
    update: async (segments: readonly string[], layer: Record<string, unknown>) => {
      const notes = Array.isArray(layer['notes']) ? layer['notes'] as string[] : []
      const isEnvelope = (sig: string): boolean => { try { return JSON.parse(raw.get(sig) ?? 'null')?.meta === 1 } catch { return false } }
      layers.set(segments.join('/'), { ...layer, notes: await Promise.all(notes.map(n => isEnvelope(n) ? n : envelopeOf(n))) })
    },
  },
}
;(window as unknown as { ioc: unknown }).ioc = {
  register: (k: string, v: unknown) => { services[k] = v },
  get: (k: string) => services[k],
  whenReady: () => { /* the slot registry is not needed here */ },
}
;(globalThis as { get?: unknown }).get = (k: string) => services[k]

await import('./notes.drone.js')
type NotesLike = {
  getNotesAtSegments(s: readonly string[]): Promise<{ id: string; text: string }[]>
  deleteAtSegments(parents: readonly string[], cell: string, id: string): Promise<void>
  addAtSegments(parents: readonly string[], cell: string, text: string): Promise<void>
}
const notes = services['@diamondcoreprocessor.com/NotesService'] as NotesLike
const noteBytes = (text: string): string => JSON.stringify({ children: [], mark: null, note: text, shape: null })

let a: string
let b: string
beforeEach(async () => {
  raw.clear()
  layers.clear()
  a = await put(noteBytes('REQUIREMENT 3 (present, untested)'))
  b = await put(noteBytes('GATE (open): arrival'))
  // The arkanoid shape: the slot holds envelopes, the facet the notes.
  facet.list = [a, b]
  layers.set('games/arkanoid', { name: 'arkanoid', notes: [await envelopeOf(a), await envelopeOf(b)] })
})

describe('a note is one note, however a list names it', () => {
  it('reads each note once — the envelope and the note it names are one entry', async () => {
    const read = await notes.getNotesAtSegments(['games', 'arkanoid'])
    expect(read.map(n => n.id)).toEqual([a, b])
  })

  it('a slot that names the same note twice reads it once', async () => {
    const twice = await envelopeOf(a)
    facet.list = []
    layers.set('games/arkanoid', { name: 'arkanoid', notes: [twice, twice, await envelopeOf(b)] })
    expect((await notes.getNotesAtSegments(['games', 'arkanoid'])).map(n => n.id)).toEqual([a, b])
  })

  it('a removal removes — from the slot and the facet alike', async () => {
    await notes.deleteAtSegments(['games'], 'arkanoid', a)
    expect((await notes.getNotesAtSegments(['games', 'arkanoid'])).map(n => n.id)).toEqual([b])
    expect(facet.list).toEqual([b])
    expect(layers.get('games/arkanoid')!['notes']).toEqual([await envelopeOf(b)])
  })

  it('an id read from an older list (the envelope) removes the same note', async () => {
    await notes.deleteAtSegments(['games'], 'arkanoid', await envelopeOf(b))
    expect((await notes.getNotesAtSegments(['games', 'arkanoid'])).map(n => n.id)).toEqual([a])
  })

  it('an added note lands once, beside the others', async () => {
    await notes.addAtSegments(['games'], 'arkanoid', 'UPDATE 2026-10-11')
    const read = await notes.getNotesAtSegments(['games', 'arkanoid'])
    expect(read.map(n => n.text)).toEqual(['REQUIREMENT 3 (present, untested)', 'GATE (open): arrival', 'UPDATE 2026-10-11'])
  })

  it('a note new to the list is filed with its arrival time; the notes already there keep theirs', async () => {
    const before = Date.now()
    await notes.addAtSegments(['games'], 'arkanoid', 'ARRIVED 2026-10-16')
    const slot = layers.get('games/arkanoid')!['notes'] as string[]
    const arrivals = await notes.arrivalsOf(slot)
    const added = (await notes.getNotesAtSegments(['games', 'arkanoid'])).find(n => n.text === 'ARRIVED 2026-10-16')!
    expect(arrivals.get(added.id)).toBeGreaterThanOrEqual(before)
    // A second commit keeps the entry — and so the time — it already had.
    const entry = slot[slot.length - 1]
    await notes.addAtSegments(['games'], 'arkanoid', 'LATER')
    expect((layers.get('games/arkanoid')!['notes'] as string[])).toContain(entry)
  })
})
