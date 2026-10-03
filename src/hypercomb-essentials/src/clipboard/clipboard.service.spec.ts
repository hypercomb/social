// clipboard.service.spec.ts — the clipboard's entry semantics, especially
// the source layer SIG captured at cut/copy intent (the cut+paste-elsewhere
// fix): captureEntries must PRESERVE sigs, and the restore path depends on
// that. What the clipboard holds is the same sig reference for a cut or a
// copy; the one fact kept from the gesture is `cut` — the source page no
// longer lists the tile, so the entry is its only easy handle. The module self-registers in
// window.ioc at load, so it is imported dynamically after stubbing the
// registry.

import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { ClipboardService } from './clipboard.service.js'

const SIG = 'a'.repeat(64)

let svc: ClipboardService

beforeAll(async () => {
  ;(window as any).ioc ??= { register() { /* spec stub */ }, get() { return undefined } }
  const mod = await import('./clipboard.service.js')
  svc = new (mod.ClipboardService)()
})

beforeEach(() => svc.clear())

describe('ClipboardService', () => {
  it('captureEntries preserves per-item sourceSegments AND the intent-captured sig', () => {
    svc.captureEntries([
      { label: 'a', sourceSegments: ['page'], sig: SIG },
      { label: 'b', sourceSegments: ['other', 'deep'] },
    ])
    expect(svc.items).toEqual([
      { label: 'a', sourceSegments: ['page'], sig: SIG },
      { label: 'b', sourceSegments: ['other', 'deep'], sig: undefined },
    ])
  })

  it('re-capture (post-commit sig enrichment) replaces wholesale', () => {
    svc.captureEntries([{ label: 'a', sourceSegments: ['page'] }])
    expect(svc.items[0].sig).toBeUndefined()
    svc.captureEntries([{ label: 'a', sourceSegments: ['page'], sig: SIG }])
    expect(svc.items[0].sig).toBe(SIG)
    expect(svc.count).toBe(1)
  })

  it('appendEntries upserts by label + source path, never erasing a held sig', () => {
    svc.appendEntries([{ label: 'a', sourceSegments: ['page'], sig: SIG }])
    svc.appendEntries([{ label: 'a', sourceSegments: ['page'] }])
    expect(svc.count).toBe(1)
    expect(svc.items[0].sig).toBe(SIG)
    svc.appendEntries([{ label: 'a', sourceSegments: ['elsewhere'] }])
    expect(svc.count).toBe(2)
  })

  it('keeps the cut mark through a capture, and an upsert never erases it', () => {
    // A held cut is the tile's only easy handle (its page no longer lists it);
    // the mark is what lets a machine be refused a copy over it.
    svc.captureEntries([{ label: 'a', sourceSegments: ['page'], cut: true }, { label: 'b', sourceSegments: ['page'] }])
    expect(svc.items.map(i => [i.label, i.cut === true])).toEqual([['a', true], ['b', false]])
    svc.appendEntries([{ label: 'a', sourceSegments: ['page'], sig: SIG }])
    expect(svc.items.find(i => i.label === 'a')).toEqual({ label: 'a', sourceSegments: ['page'], sig: SIG, cut: true })
    // A copy entry carries no mark at all, so a held copy is never mistaken for one.
    expect(svc.items.find(i => i.label === 'b')).not.toHaveProperty('cut')
  })

  it('removeItems filters by label without disturbing other entries', () => {
    svc.captureEntries([
      { label: 'a', sourceSegments: [], sig: SIG },
      { label: 'b', sourceSegments: [] },
    ])
    svc.removeItems(new Set(['b']))
    expect(svc.items.map(i => i.label)).toEqual(['a'])
    expect(svc.items[0].sig).toBe(SIG)
  })
})

describe("a peer's tile keeps its mark on the clipboard", () => {
  beforeEach(() => svc.clear())

  it('captureEntries keeps fromPeer, and an entry without it carries none', () => {
    svc.captureEntries([
      { label: 'theirs', sourceSegments: ['peer-branch'], fromPeer: true },
      { label: 'mine', sourceSegments: ['page'] },
    ])
    expect(svc.items.find(i => i.label === 'theirs')?.fromPeer).toBe(true)
    expect(svc.items.find(i => i.label === 'mine')).not.toHaveProperty('fromPeer')
  })

  it('an append upsert never erases a mark the first pass took', () => {
    svc.appendEntries([{ label: 'theirs', sourceSegments: ['peer-branch'], cut: true, fromPeer: true }])
    svc.appendEntries([{ label: 'theirs', sourceSegments: ['peer-branch'], sig: SIG }])
    expect(svc.items).toHaveLength(1)
    expect(svc.items[0]).toMatchObject({ sig: SIG, cut: true, fromPeer: true })
  })
})
