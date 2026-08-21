// clipboard.service.spec.ts — the clipboard's entry semantics, especially
// the source layer SIG captured at cut/copy intent (the cut+paste-elsewhere
// fix): captureEntries must PRESERVE sigs, and the restore path depends on
// that. What the clipboard holds is op-less — cut vs copy is a property of
// the capture gesture, not of the held record. The module self-registers in
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
