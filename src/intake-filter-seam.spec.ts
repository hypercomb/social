// intake-filter-seam.spec.ts
//
// THE WHOLE LOOP, WITH NOTHING STUBBED IN THE MIDDLE.
//
// Every other spec around this feature tests one half against a double of the
// other. `intake-filter.spec.ts` drives the real gate against a hand-written
// registry (it must: essentials may not import shared, so the gate only ever
// sees the loose-IoC seam). `interest-registry.spec.ts` drives the real
// registry with nobody calling it. Between them, NOTHING had ever observed
// this feature actually refuse anything: the two halves were each correct
// against a copy of the other's contract, and a copy is exactly what drifted —
// the gate's double sat one clause behind the registry for a while, asserting
// semantics the real thing had stopped having.
//
// So this file wires the REAL InterestRegistry to the REAL gate over the REAL
// mark carrier, and the only fake left is the store underneath — a
// content-addressed bag with pool directories, which is what OPFS is.
//
// IT LIVES AT THE ROOT because it belongs to neither package. Essentials may
// not import shared, and a spec inside essentials that does is a file its own
// project cannot typecheck. The seam between two packages is not a member of
// either one — same reason `doctrine.spec.ts` sits here. A spec may cross the
// boundary the shipped code may not (the ratchets skip `.spec.ts` for exactly
// this), but it should do it from somewhere honest.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { SignatureService } from '@hypercomb/core'

vi.hoisted(() => {
  const g = globalThis as Record<string, unknown>
  g['register'] = () => { /* the shared registry self-registers; IoC below is ours */ }
  g['get'] = () => undefined
  ;(window as unknown as { ioc: unknown }).ioc = {
    register: () => { /* noop */ },
    get: (key: string) => (window as any).__ioc?.[key],
    whenReady: () => { /* noop */ },
    onRegister: () => () => { /* noop */ },
  }
  // jsdom's Blob has no `text()`; every real browser has. The registry reads
  // its marks resources with it, and without this every write returns null
  // through a catch and the failures point at logic that is in fact correct.
  const proto = Blob.prototype as unknown as { text?: () => Promise<string> }
  if (typeof proto.text !== 'function') {
    proto.text = function (this: Blob): Promise<string> {
      return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result ?? ''))
        reader.onerror = () => reject(reader.error)
        reader.readAsText(this)
      })
    }
  }
})

// ── the store ───────────────────────────────────────────────────────────────
//
// A pool directory with real member files, because both consumers need one and
// they need DIFFERENT things from it: `registry-document.ts` puts one current
// document in it, `pheromone-marks.ts` writes a member named by the signature
// it describes. One fake serves both, which is the point — they are the same
// primitive.

const sign = async (text: string): Promise<string> =>
  await SignatureService.sign(new TextEncoder().encode(text).buffer as ArrayBuffer)

type FakeDir = {
  meaning: string
  files: Map<string, string>
  getFileHandle(name: string, opts?: { create?: boolean }): Promise<{
    getFile(): Promise<{ text(): Promise<string> }>
    createWritable(): Promise<{ write(data: unknown): Promise<void>; close(): Promise<void> }>
  }>
  removeEntry(name: string): Promise<void>
}

const makeStore = () => {
  const resources = new Map<string, string>()
  const pools = new Map<string, FakeDir>()
  /** Every meaning whose directory this store was asked to CREATE. Half of
   *  the "inert on disk" claim is measured here and nowhere else. */
  const created: string[] = []
  /** Every meaning it was asked to OPEN for reading. The other half: a read
   *  that mints nothing is still a read, and the point of the registry's
   *  `filters()` short-circuit is that a participant with no interest is not
   *  made to perform one. Without this the short-circuit could be deleted and
   *  every assertion here would still pass. */
  const opened: string[] = []

  const dir = (meaning: string): FakeDir => {
    const files = new Map<string, string>()
    return {
      meaning,
      files,
      getFileHandle: async (name: string, opts?: { create?: boolean }) => {
        if (!files.has(name) && !opts?.create) throw new Error('NotFoundError')
        return {
          getFile: async () => ({ text: async () => files.get(name) ?? '' }),
          createWritable: async () => ({
            write: async (data: unknown) => { files.set(name, String(data)) },
            close: async () => { /* committed on write */ },
          }),
        }
      },
      removeEntry: async (name: string) => { files.delete(name) },
    }
  }

  return {
    resources,
    pools,
    created,
    opened,
    putResource: async (blob: Blob) => {
      const text = await blob.text()
      const sig = await sign(text)
      resources.set(sig, text)
      return sig
    },
    getResource: async (sig: string) =>
      resources.has(sig) ? new Blob([resources.get(sig)!]) : null,

    /** The WRITE opener — creates, and says so. */
    getPool: async (meaning: string): Promise<FakeDir> => {
      let held = pools.get(meaning)
      if (!held) { held = dir(meaning); pools.set(meaning, held); created.push(meaning) }
      return held
    },
    /** The READ opener — null when the pool has never been written. */
    openPool: async (meaning: string): Promise<FakeDir | null> => {
      opened.push(meaning)
      return pools.get(meaning) ?? null
    },

    getPoolDoc: async (p: FakeDir | undefined | null) => {
      const only = p ? [...p.files.values()][0] : undefined
      return only === undefined ? null : new TextEncoder().encode(only).buffer as ArrayBuffer
    },
    putPoolDoc: async (p: FakeDir | undefined | null, bytes: ArrayBuffer) => {
      if (!p) return null
      const text = new TextDecoder().decode(bytes)
      const sig = await sign(text)
      p.files.clear()          // one current member, replaces siblings by design
      p.files.set(sig, text)
      return sig
    },
  }
}

let store: ReturnType<typeof makeStore>

const { InterestRegistry } = await import('./hypercomb-shared/core/interest-registry.js')
const { addSigMark } = await import('./hypercomb-essentials/src/pheromones/pheromone-marks.js')
const { allows, allowsHere } = await import('./hypercomb-essentials/src/pheromones/intake-filter.js')

/** Both modules under test hold PROCESS-LIFETIME caches — the mark record
 *  cache and the gate's kick-once set — so a signature reused across tests
 *  carries the previous test's answer with it. Fresh bytes per test, which is
 *  also what real content addressing gives you. */
let counter = 0
const freshSig = async (): Promise<string> => await sign(`content-${++counter}`)

const put = (reg: unknown): void => {
  ;(window as any).__ioc = {
    '@hypercomb.social/Store': store,
    '@hypercomb.social/InterestRegistry': reg,
  }
}

beforeEach(() => {
  store = makeStore()
  ;(window as any).__ioc = { '@hypercomb.social/Store': store }
})

describe('the real registry, through the real gate', () => {

  it('a DROP interest the participant saved refuses the bytes they marked', async () => {
    const reg = new InterestRegistry()
    put(reg)

    // The participant names an interest and points the DROP role at it.
    expect(await reg.save('junk', ['malicious'])).toBeTruthy()
    expect(await reg.setRole('drop', 'junk')).toBe(true)

    // ...and marks some exact bytes with it, through the real carrier.
    const bad = await freshSig()
    const fine = await freshSig()
    expect(await addSigMark(bad, 'malicious')).toBe(true)

    expect(await allows({ sig: bad })).toBe(false)
    expect(await allows({ sig: fine })).toBe(true)
  })

  it('a KEEP interest narrows to what carries an enrolled mark', async () => {
    const reg = new InterestRegistry()
    put(reg)
    await reg.save('mine', ['cigars'])
    await reg.setRole('keep', 'mine')

    const wanted = await freshSig()
    const other = await freshSig()
    await addSigMark(wanted, 'cigars')
    await addSigMark(other, 'knitting')

    expect(await allows({ sig: wanted })).toBe(true)
    expect(await allows({ sig: other })).toBe(false)
  })

  // THE BLOCKER, end to end. Everything arriving from a stranger is unmarked
  // until this participant marks it, so a KEEP set that judged unmarked
  // content would empty the swarm on the day somebody named one interest.
  // Only a run with the real registry can prove the real gate does not.
  it('unmarked content still arrives under a KEEP interest', async () => {
    const reg = new InterestRegistry()
    put(reg)
    await reg.save('mine', ['cigars'])
    await reg.setRole('keep', 'mine')

    const stranger = await freshSig()
    expect(await allows({ sig: stranger })).toBe(true)
    expect(allowsHere({ sig: stranger })).toBe(true)
  })

  it('a DROP beats a KEEP on the same bytes', async () => {
    const reg = new InterestRegistry()
    put(reg)
    await reg.save('mine', ['cigars'])
    await reg.save('junk', ['malicious'])
    await reg.setRole('keep', 'mine')
    await reg.setRole('drop', 'junk')

    const both = await freshSig()
    await addSigMark(both, 'cigars')
    await addSigMark(both, 'malicious')

    expect(await allows({ sig: both })).toBe(false)
  })

  // THE GAP THAT SHIPPED INERT, proved against the thing that would actually
  // have been inert. Nothing in the tree calls `ensureLoaded`; the gate's own
  // warm-up is the only caller, so a registry handed to IoC cold must still
  // refuse. Note that this test never touches `reg` after constructing it.
  it('the gate loads a cold registry itself — nobody else ever calls ensureLoaded', async () => {
    const bad = await freshSig()
    {
      // A previous session: the participant set the filter and it persisted.
      const first = new InterestRegistry()
      put(first)
      await first.save('junk', ['malicious'])
      await first.setRole('drop', 'junk')
      await addSigMark(bad, 'malicious')
    }
    // This session: a brand-new registry, never loaded, in IoC.
    const cold = new InterestRegistry()
    put(cold)
    expect(cold.filters()).toBe(false)          // it genuinely has not read yet

    expect(await allows({ sig: bad })).toBe(false)
    expect(cold.filters()).toBe(true)           // the gate is what loaded it
  })

  // ── inert, and inert ON DISK ─────────────────────────────────────────────
  //
  // "Changes nothing until a participant expresses an interest" is two claims.
  // The verdict half was always true. The storage half was not: reaching the
  // registry opened `registry:interests` (and `registry` behind it) with a
  // creating handle, and the mark read opened `pheromones:content`, so a
  // participant who had never named an interest still grew three pool
  // directories the first time a peer tile arrived — in a root that walkers,
  // the collector and /flatten all enumerate.
  describe('a participant who expressed no interest', () => {
    it('gets every verdict allowed', async () => {
      const reg = new InterestRegistry()
      put(reg)
      const sig = await freshSig()
      await addSigMark(sig, 'malicious')
      expect(await allows({ sig })).toBe(true)
      expect(allowsHere({ sig })).toBe(true)
    })

    it('gets no pool directory minted on their behalf', async () => {
      const reg = new InterestRegistry()
      put(reg)
      const sig = await freshSig()
      expect(await allows({ sig })).toBe(true)
      expect(allowsHere({ sig })).toBe(true)
      await new Promise(resolve => setTimeout(resolve, 0))   // flush any kick
      expect(store.created).toEqual([])
      expect(store.opened).not.toContain('pheromones:content')
    })

    it('is not made to read the mark pool either', async () => {
      const reg = new InterestRegistry()
      put(reg)
      // The pool EXISTS — this participant marked something once — but with no
      // role set there is no verdict a read could change, so it is not read.
      //
      // The mark goes on OTHER bytes on purpose. Marking the signature under
      // test would seed the record cache, `sigMarksOf` would answer from
      // memory, and the pool would go unopened whether or not the gate had
      // decided to skip it — the assertion would hold for the wrong reason.
      await addSigMark(await freshSig(), 'malicious')
      const sig = await freshSig()
      store.created.length = 0
      store.opened.length = 0
      expect(await allows({ sig })).toBe(true)
      expect(allowsHere({ sig })).toBe(true)
      await new Promise(resolve => setTimeout(resolve, 0))
      expect(store.created).toEqual([])
      expect(store.opened).not.toContain('pheromones:content')
    })
  })

  // Hide first, delete second. The sync gate cannot await, so it answers from
  // the record cache and kicks the read for what it has not seen; the commit
  // gate is the authoritative one. Both must reach the same verdict once the
  // read has landed, or the screen and the hive disagree.
  it('the sync gate catches up with the commit gate', async () => {
    const reg = new InterestRegistry()
    put(reg)
    await reg.save('junk', ['malicious'])
    await reg.setRole('drop', 'junk')

    const bad = await freshSig()
    await addSigMark(bad, 'malicious')

    // A write populates the record cache, so take a signature the gate has
    // genuinely never read: same marks, arriving cold.
    const alsoBad = await freshSig()
    await addSigMark(alsoBad, 'malicious')

    expect(await allows({ sig: alsoBad })).toBe(false)
    expect(allowsHere({ sig: alsoBad })).toBe(false)
  })

  // An interest is a signature somebody can hand you — that is the cold-start
  // answer, and it is only true if an ADOPTED one filters exactly like a saved
  // one. The bytes here reach the second participant with no author, no
  // permission and no network: only the signature crossed.
  it('an ADOPTED interest filters the same as one you assembled', async () => {
    const author = new InterestRegistry()
    put(author)
    const shared = await author.save('junk', ['malicious'])
    expect(shared).toBeTruthy()

    // A different participant, same store (the bytes arrived), no interests.
    const reader = new InterestRegistry()
    put(reader)
    await reader.ensureLoaded()
    expect(await reader.adopt('theirs', shared!)).toBe(true)
    await reader.setRole('drop', 'theirs')

    const bad = await freshSig()
    await addSigMark(bad, 'malicious')
    expect(await allows({ sig: bad })).toBe(false)
  })
})
