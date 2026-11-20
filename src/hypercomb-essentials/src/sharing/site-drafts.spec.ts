// site-drafts.spec.ts — HOME, HELD (jwize, 2026-11-20): the drafts a card's
// Publish carries. The record is the same for the same drafts whatever order
// they are read in, and its signature is the one the decoration write lands;
// carrying writes nothing when nothing changed, takes the record off when no
// drafts are left, and never touches the card when the drafts cannot be read;
// a device that carries fewer drafts never strips the others; and drafts this
// device runs that the card lacks make a Publish owed, and nothing else does.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { SignatureService, type CarriedModuleDraft } from '@hypercomb/core'

// The brood as it reads from disk, by module: a spec says what it holds.
const brood = vi.hoisted(() => new Map<string, { source: { kind: string; how?: string } }>())
vi.mock('@hypercomb/core', async importOriginal => ({
  ...(await importOriginal<typeof import('@hypercomb/core')>()),
  broodRecordOnDisk: async (sig: string) => brood.get(sig) ?? null,
}))
import { writeDecoration } from '../commands/decoration-manifest.js'
import { DRAFTS_KIND, carryDrafts, composeDraftsRecord, draftsOwed, planDrafts, portCarriesDrafts, type ComposedDrafts, type DraftDecorations, type DraftsRecord, type KnowsDraft } from './site-drafts.js'
import type { HistoryLike } from './site-replica.js'

const sig = (ch: string): string => ch.repeat(64)
const A: CarriedModuleDraft = { root: sig('a'), layer: sig('1'), to: sig('2'), from: sig('3') }
const B: CarriedModuleDraft = { root: sig('b'), layer: sig('4'), to: sig('5'), from: '' }
const provider = (drafts: readonly CarriedModuleDraft[]) => ({ carry: async () => drafts })
const CARD = ['business-card']
const known: KnowsDraft = async () => true
const unknown: KnowsDraft = async () => false

const history = (head: string | null): HistoryLike => ({
  sign: async () => 'loc',
  currentLayerAt: async () => ({ name: 'business-card' }),
  warmHeadSigFor: () => head,
  commitLayer: async () => '',
})

const decorations = (onCard: (string | ComposedDrafts)[]) => {
  const calls: string[] = []
  const ops: DraftDecorations = {
    list: async () => onCard.map(s => typeof s === 'string' ? { sig: s } : { sig: s.sig, record: s.record }),
    write: async (record: DraftsRecord) => { calls.push(`write ${record.payload.drafts.length}`); return 'w' },
    remove: async (s: string) => { calls.push(`remove ${s}`) },
  }
  return { ops, calls }
}

describe('the drafts record', () => {
  it('is the same for the same drafts, whatever order they are read in', async () => {
    const one = await composeDraftsRecord(provider([A, B]), CARD)
    const two = await composeDraftsRecord(provider([B, A, B]), CARD)
    expect(one?.sig).toMatch(/^[0-9a-f]{64}$/)
    expect(two?.sig).toBe(one?.sig)
    expect(one?.drafts).toBe(2)
    expect(one?.record).toMatchObject({ kind: DRAFTS_KIND, appliesTo: CARD, payload: { drafts: [{ root: A.root, layer: A.layer }, { root: B.root, layer: B.layer }] } })
    // Signatures only: every part it names, and no time, ruling or text.
    expect(new Set(one?.record.refs)).toEqual(new Set([A.root, A.layer, A.to, A.from, B.root, B.layer, B.to]))
    expect(JSON.stringify(one?.record)).not.toMatch(/"at"|ruling|verdict/)
  })

  it('is null with no drafts, and unknown when they cannot be read', async () => {
    expect(await composeDraftsRecord(provider([]), CARD)).toBeNull()
    expect(await composeDraftsRecord({}, CARD)).toBeUndefined()
    expect(await composeDraftsRecord(undefined, CARD)).toBeUndefined()
    expect(await composeDraftsRecord({ carry: async () => { throw new Error('no brood') } }, CARD)).toBeUndefined()
  })

  describe('signed as the decoration write lands it', () => {
    const before = (window as { ioc?: unknown }).ioc
    afterEach(() => { (window as { ioc?: unknown }).ioc = before })

    it('has the signature writeDecoration returns for it', async () => {
      const read = (blob: Blob): Promise<string> => new Promise(resolve => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result))
        reader.readAsText(blob)
      })
      const store = {
        putResource: async (blob: Blob) => {
          const bytes = new TextEncoder().encode(await read(blob))
          return SignatureService.sign(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)
        },
        getResource: async () => null,
      }
      const committer = { commitSlotAppend: async () => undefined, commitSlotRemove: async () => undefined }
      ;(window as { ioc?: unknown }).ioc = {
        get: (key: string) => key === '@hypercomb.social/Store' ? store : key === '@diamondcoreprocessor.com/LayerCommitter' ? committer : undefined,
      }
      const composed = await composeDraftsRecord(provider([B, A]), CARD)
      const written = await writeDecoration({
        kind: composed!.record.kind, appliesTo: composed!.record.appliesTo, payload: composed!.record.payload,
        segments: CARD, refs: composed!.record.refs,
      })
      expect(written).toBe(composed!.sig)
    })
  })
})

describe('carrying the drafts onto the card', () => {
  it('writes the record over the one before it, and returns the head after it', async () => {
    const { ops, calls } = decorations([sig('e')])
    const head = await carryDrafts({ history: history(sig('f')), drafts: provider([A]) }, 'business-card', ops)
    expect(calls).toEqual(['write 1', `remove ${sig('e')}`])
    expect(head).toBe(sig('f'))
  })

  it('a write that fails takes nothing off: the card keeps the drafts it carried', async () => {
    const card = await composeDraftsRecord(provider([B]), CARD)
    const { ops, calls } = decorations([card!])
    const failing: DraftDecorations = { ...ops, write: async () => { calls.push('write failed'); throw new Error('putResource') } }
    await expect(carryDrafts({ history: history(sig('f')), drafts: provider([A]) }, 'business-card', failing, unknown)).rejects.toThrow('putResource')
    expect(calls).toEqual(['write failed'])
  })

  it('never takes off the record it just wrote, when the card already wore it beside another', async () => {
    const composed = await composeDraftsRecord(provider([A]), CARD)
    const { ops, calls } = decorations([sig('e'), composed!])
    await carryDrafts({ history: history(sig('f')), drafts: provider([A]) }, 'business-card', { ...ops, write: async r => { calls.push(`write ${r.payload.drafts.length}`); return composed!.sig } }, known)
    expect(calls).toEqual(['write 1', `remove ${sig('e')}`])
  })

  it('writes nothing when the card already carries these drafts', async () => {
    const composed = await composeDraftsRecord(provider([A, B]), CARD)
    const { ops, calls } = decorations([composed!.sig])
    expect(await carryDrafts({ history: history(sig('f')), drafts: provider([B, A]) }, 'business-card', ops)).toBe(sig('f'))
    expect(calls).toEqual([])
  })

  it('takes the record off when no drafts are left: every one it carries is known here and none runs', async () => {
    const card = await composeDraftsRecord(provider([A]), CARD)
    const { ops, calls } = decorations([card!])
    await carryDrafts({ history: history(sig('f')), drafts: provider([]) }, 'business-card', ops, known)
    expect(calls).toEqual([`remove ${card!.sig}`])
  })

  it('a device that carries fewer drafts keeps the ones it knows nothing of, and takes off only the ones it knows and no longer runs', async () => {
    const card = await composeDraftsRecord(provider([A, B]), CARD)
    // Over another build here: neither ever came home, so both stay as the card carries them.
    const away = decorations([card!])
    await carryDrafts({ history: history(sig('f')), drafts: provider([]) }, 'business-card', away.ops, unknown)
    expect(away.calls).toEqual([])
    // A was dropped here (known, not running), B still runs.
    const plan = await planDrafts(provider([B]), CARD, decorations([card!]).ops, known)
    expect(plan).toMatchObject({ owed: false, dropped: 1, unchanged: false })
    expect(plan!.composed!.record.payload.drafts.map(d => d.root)).toEqual([B.root])
    // Every module a draft adds travels with it.
    const two = await composeDraftsRecord(provider([{ ...A, parts: [A.to, sig('9')] }]), CARD)
    expect(two!.record.payload.drafts[0]!.parts).toEqual([A.to, sig('9')].sort())
    expect(two!.record.refs).toContain(sig('9'))
  })

  it('never names more drafts than a reader takes: this device\'s own first, and the rest counted as coming off', async () => {
    const many = (n: number): CarriedModuleDraft[] => Array.from({ length: n }, (_, i) => {
      const hex = (ch: string): string => ch + i.toString(16).padStart(63, '0')
      return { root: hex('e'), layer: hex('d'), to: hex('c'), from: '' }
    })
    // 64 drafts from the other devices already on the card, none known here.
    const full = await composeDraftsRecord(provider(many(64)), CARD)
    expect(full!.drafts).toBe(64)
    expect((await composeDraftsRecord(provider(many(65)), CARD))!.drafts).toBe(64)
    // This device runs one more: the record still names 64, its own among them.
    const plan = await planDrafts(provider([A]), CARD, decorations([full!]).ops, unknown)
    const roots = plan!.composed!.record.payload.drafts.map(d => d.root)
    expect(roots).toHaveLength(64)
    expect(roots).toContain(A.root)
    expect(plan).toMatchObject({ owed: true, dropped: 1 })
  })

  it('keeps a draft still picked here after Update all, though this device no longer carries it', async () => {
    const card = await composeDraftsRecord(provider([A]), CARD)
    // Over the old trunk, so carry() leaves it out; it still runs here.
    const kept = { carry: async () => [], list: async () => [{ path: 'games', layerSig: A.layer, rootSig: A.root, section: 's', from: A.from, at: 1 }] }
    const plan = await planDrafts(kept, CARD, decorations([card!]).ops, known)
    expect(plan).toMatchObject({ unchanged: true, dropped: 0, running: [A.root] })
    const { ops, calls } = decorations([card!])
    await carryDrafts({ history: history(sig('f')), drafts: kept }, 'business-card', ops, known)
    expect(calls).toEqual([])
    // Picks that cannot be read: the card is left as it is.
    expect(await planDrafts({ carry: async () => [], list: async () => { throw new Error('x') } }, CARD, decorations([card!]).ops, known)).toBeUndefined()
  })

  it('a draft put back here is known only once it settled: one a gate refused never ran here, and stays on the card', async () => {
    const card = await composeDraftsRecord(provider([A]), CARD)
    // Held here, never picked: the receipt does not name it.
    const gated = await planDrafts(provider([]), CARD, decorations([card!]).ops, unknown, [])
    expect(gated).toMatchObject({ unchanged: true, dropped: 0 })
    // Put back, then dropped here: settled, so it comes off.
    const dropped = await planDrafts(provider([]), CARD, decorations([card!]).ops, unknown, [A.root])
    expect(dropped).toMatchObject({ composed: null, dropped: 1 })
    const { ops, calls } = decorations([card!])
    await carryDrafts({ history: history(sig('f')), drafts: provider([]), settled: [A.root] }, 'business-card', ops, unknown)
    expect(calls).toEqual([`remove ${card!.sig}`])
  })

  it('knows from the brood only a draft written here, never one a card put back', async () => {
    const card = await composeDraftsRecord(provider([A]), CARD)
    brood.set(A.to, { source: { kind: 'own', how: 'a draft of s at games, carried home with business-card' } })
    expect(await planDrafts(provider([]), CARD, decorations([card!]).ops)).toMatchObject({ dropped: 0 })
    brood.set(A.to, { source: { kind: 'own', how: 'a draft of s at games' } })
    expect(await planDrafts(provider([]), CARD, decorations([card!]).ops)).toMatchObject({ dropped: 1 })
    brood.clear()
  })

  it('never touches the card when the drafts cannot be read', async () => {
    const { ops, calls } = decorations([sig('e')])
    expect(await carryDrafts({ history: history(sig('f')), drafts: null }, 'business-card', ops)).toBe(sig('f'))
    await carryDrafts({ history: history(sig('f')), drafts: { carry: async () => { throw new Error('x') } } }, 'business-card', ops)
    expect(calls).toEqual([])
  })
})

describe('a card whose records cannot be read here', () => {
  const before = (window as { ioc?: unknown }).ioc
  afterEach(() => { (window as { ioc?: unknown }).ioc = before })

  it('is unreadable, never "carries nothing": a record not held here may be the drafts another device kept on it', async () => {
    const other = await composeDraftsRecord(provider([B]), CARD)
    const bytes = new Map<string, string>()
    const missing = sig('e')
    let slot = [missing]
    const store = { getResource: async (s: string) => (bytes.has(s) ? { text: async () => bytes.get(s)! } : null), putResource: async () => sig('9') }
    const historyService = { sign: async () => 'loc', currentLayerAt: async () => ({ decorations: slot }) }
    ;(window as { ioc?: unknown }).ioc = {
      get: (key: string) => key === '@hypercomb.social/Store' ? store : key === '@diamondcoreprocessor.com/HistoryService' ? historyService : undefined,
    }
    // Through the live reading: undefined, so carrying leaves the card as it is.
    expect(await planDrafts(provider([A]), CARD, undefined, known)).toBeUndefined()
    expect(await draftsOwed(provider([A]), 'business-card', undefined, known)).toBe(false)
    const { listDecorations } = await import('../commands/decoration-manifest.js')
    // The ordinary listing still leaves an unreadable record out.
    expect(await listDecorations({ kind: DRAFTS_KIND, segments: CARD })).toEqual([])
    // Once held, it is read: the other device's drafts stay on the card.
    bytes.set(other!.sig, JSON.stringify(other!.record))
    slot = [other!.sig]
    const plan = await planDrafts(provider([A]), CARD, undefined, unknown)
    expect(plan!.composed!.record.payload.drafts.map(d => d.root)).toEqual([A.root, B.root])
  })
})

describe('a Publish owed for drafts alone', () => {
  it('is owed only when this device runs drafts the card does not carry', async () => {
    const composed = await composeDraftsRecord(provider([A]), CARD)
    expect(await draftsOwed(provider([A]), 'business-card', decorations([]).ops, known)).toBe(true)
    expect(await draftsOwed(provider([A]), 'business-card', decorations([composed!]).ops, known)).toBe(false)
    expect(await draftsOwed(provider([A, B]), 'business-card', decorations([composed!]).ops, known)).toBe(true)
    // Carrying fewer (an Update all moved the trunk, a refusal here, a draft
    // that has not come home yet) is never a change to publish.
    expect(await draftsOwed(provider([]), 'business-card', decorations([composed!]).ops, known)).toBe(false)
    expect(await draftsOwed(provider([]), 'business-card', decorations([]).ops, known)).toBe(false)
    expect(await draftsOwed(undefined, 'business-card', decorations([sig('e')]).ops, known)).toBe(false)
  })

  it('a draft that only came home here is never owed, and is never put back once the card dropped it', async () => {
    const homeX: CarriedModuleDraft = { ...A, carried: true }
    const withX = await composeDraftsRecord(provider([A]), CARD)
    // The card still carries it: it rides on, nothing owed.
    expect(await planDrafts(provider([homeX]), CARD, decorations([withX!]).ops, unknown)).toMatchObject({ unchanged: true, owed: false, dropped: 0 })
    // The device that wrote it dropped it and published: not owed here, and a
    // Publish from here leaves it off.
    expect(await draftsOwed(provider([homeX]), 'business-card', decorations([]).ops, unknown)).toBe(false)
    const plan = await planDrafts(provider([homeX, B]), CARD, decorations([]).ops, unknown)
    expect(plan!.composed!.record.payload.drafts.map(d => d.root)).toEqual([B.root])
    expect(plan).toMatchObject({ owed: true, dropped: 0 })
    const { ops, calls } = decorations([])
    await carryDrafts({ history: history(sig('f')), drafts: provider([homeX]) }, 'business-card', ops, unknown)
    expect(calls).toEqual([])
  })

  it('a draft past the cap is never owed: once the card carries all that fit, Publish stops asking', async () => {
    const many = (n: number): CarriedModuleDraft[] => Array.from({ length: n }, (_, i) => {
      const hex = (ch: string): string => ch + i.toString(16).padStart(63, '0')
      return { root: hex('e'), layer: hex('d'), to: hex('c'), from: '' }
    })
    const full = await composeDraftsRecord(provider(many(65)), CARD)
    expect(full!.drafts).toBe(64)
    const plan = await planDrafts(provider(many(65)), CARD, decorations([full!]).ops, known)
    expect(plan).toMatchObject({ unchanged: true, owed: false })
    expect(await draftsOwed(provider(many(65)), 'business-card', decorations([]).ops, known)).toBe(true)
  })
})

describe('carrying the plan the dialog showed', () => {
  it('writes the plan it is handed, never planning again from drafts read later', async () => {
    const { ops, calls } = decorations([])
    const plan = await planDrafts(provider([A]), CARD, ops, known)
    expect(plan?.composed?.drafts).toBe(1)
    // A second draft lands between the dialog and the write: the card still carries what the dialog said.
    let read = 0
    const later = { carry: async () => { read++; return [A, B] } }
    await carryDrafts({ history: history(sig('f')), drafts: later, plan: plan! }, 'business-card', ops, known)
    expect(read).toBe(0)
    expect(calls).toEqual(['write 1'])
  })
})

describe('a publish port from before drafts travelled', () => {
  it('carries drafts only through a port that has the drafts closure (ownsThisCard)', () => {
    const publishRoot = async () => ({ ok: true })
    expect(portCarriesDrafts({ publishRoot, ownsThisCard: async () => true } as never)).toBe(true)
    // The older shim: publishRoot alone, no 'part' kind, no bees-pool read.
    expect(portCarriesDrafts({ publishRoot } as never)).toBe(false)
    expect(portCarriesDrafts(undefined)).toBe(false)
    expect(portCarriesDrafts(null)).toBe(false)
  })

  it('the card page plans, carries and owes drafts only through such a port', async () => {
    const { readFileSync } = await import('node:fs')
    const { resolve } = await import('node:path')
    const view = readFileSync(resolve(process.cwd(), 'hypercomb-essentials/src/sharing/site-manage.view.ts'), 'utf8')
    const publishNow = view.slice(view.indexOf('async #publishNow('), view.indexOf('const message = dropped'))
    expect(publishNow).toContain('const carries = portCarriesDrafts(port)')
    expect(publishNow).toMatch(/const plan = carries \?/)
    expect(publishNow).toMatch(/if \(carries\) sig = \(await carryDrafts\(/)
    // The plan the dialog shows is the one written, and drafts that cannot be read publish nothing.
    expect(publishNow).toMatch(/carryDrafts\(\{[^}]*\.\.\.\(plan \? \{ plan \} : \{\}\)/)
    expect(publishNow).toMatch(/if \(carries && typeof provider\?\.carry === 'function' && !plan\) \{ unread\(\); return \}/)
    expect(publishNow).toMatch(/\} catch \{ unread\(\); return \}/)
    expect(publishNow).not.toContain('published as it stands')
    // Every draftsOwed asked on the page is asked behind the same gate.
    const owed = view.split('await draftsOwed(').length - 1
    const gated = view.split(/portCarriesDrafts\(ioc\(\)\?\.get\?\.<ManagedPublishLike>\(MANAGED_PUBLISH_KEY\)\)\s*\?\s*await draftsOwed\(/).length - 1
    expect(owed).toBeGreaterThan(0)
    expect(gated).toBe(owed)
  })
})
