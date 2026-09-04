// molecule/vocabulary.leak-skeptic.spec.ts
//
// THE ACCIDENTAL PUBLISH, from the other side: not "does a claim get signed",
// but "does ANY byte leave this machine because a participant OPENED,
// READ, COMPLETED or PREVIEWED one of these two surfaces".
//
// The publish door is genuinely well guarded — the confirmation resolves above
// every write, `readerPubkey` is nowhere on a read path, and no claim is ever
// precomputed. These tests are about the two paths NOBODY GUARDED, both of
// which are reached by a read the surfaces describe in writing as local.
//
// Each test states the property the surface's own copy promises. A failure
// here is the promise being false, not the test being wrong.

import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { MoleculeIndexService } from './molecule-index.service.js'
import { readVocabularyPanel, type VocabularyPanelIo } from './vocabulary.view.js'
import { buildHorizon } from './vocabulary-horizon.js'
import { searchVocabulary, type VocabularySearchDeps } from './vocabulary-search.js'
import type { HiveIndexResult } from '../sharing/hive-pointer.js'

const ROOT = join(import.meta.dirname, '..', '..', '..')
const source = (relative: string): string => readFileSync(join(ROOT, relative), 'utf8')

const HEX = (c: string): string => c.repeat(64)

// ---------------------------------------------------------------------------
// 1. OPENING THE VOCABULARY WINDOW
// ---------------------------------------------------------------------------

describe('opening the vocabulary window', () => {

  const reader = (whole: boolean) => {
    const calls: string[] = []
    return {
      calls,
      io: {
        reader: () => ({
          addressOf: async () => null,
          holds: async () => false,
          vocabulary: async () => { calls.push('vocabulary'); return new Map() },
          fallbackVocabulary: async () => { calls.push('fallbackVocabulary'); return new Map() },
          declaredVocabulary: async () => {
            calls.push('declaredVocabulary')
            return new Set(whole ? [HEX('a')] : [])
          },
          declaredVocabularyPartial: async () => { calls.push('partial'); return !whole },
          readRecord: async () => null,
          subtreeVocabulary: async () => null,
          rootSig: async () => HEX('b'),
        }),
        records: async () => [],
        pubkey: () => null,
      } satisfies VocabularyPanelIo,
    }
  }

  it('THE COLD WALK IS NEVER SKIPPED — a whole index buys the reader nothing', async () => {
    // The panel's header says opening this window "asks it three questions,
    // reads this device's own publish ledger, and stops". But the spelling
    // loop iterates `[fallbackVocabulary, vocabulary]` UNCONDITIONALLY, so
    // the accelerator can never spare the walk. `fallbackVocabulary` is the
    // COLD PATH — `#walkNames` over every manifest under the root, up to
    // COLD_WALK_NODES = 20,000 — and the next test shows where that reaches.
    const { calls, io } = reader(true)
    await readVocabularyPanel(io)
    expect(calls).not.toContain('fallbackVocabulary')
  })

  it('the cold walk asks HISTORY to resolve layers by signature', async () => {
    // The real service, a fake container. `readChildrenManifest` misses (the
    // ordinary state — `manifests` is a wipe-safe derived cache and the
    // MoleculeIndexDrone that would warm it is not even registered), so
    // `#manifestOf` falls through to `history.getLayerBySig`.
    const asked: string[] = []
    const win = globalThis as unknown as { ioc?: unknown }
    const previous = win.ioc
    win.ioc = {
      get: (key: string) => {
        if (key === '@hypercomb.social/Store') {
          return { getPool: async () => null, readChildrenManifest: async () => null }
        }
        if (key === '@diamondcoreprocessor.com/HistoryService') {
          return {
            sign: async () => HEX('b'),
            headLayer: async () => ({ layerSig: HEX('c') }),
            getLayerBySig: async (sig: string) => { asked.push(sig); return null },
            childrenManifestFor: async () => null,
          }
        }
        return undefined
      },
    }
    try {
      const service = new MoleculeIndexService()
      await service.fallbackVocabulary()
    } finally {
      win.ioc = previous
    }

    // It DOES. Stated as the property the panel's copy claims instead.
    expect(asked).toEqual([])
  })

  it('and `getLayerBySig` fires an UNAWAITED HOST FETCH on a local miss', () => {
    // The other half of the chain, asserted as a fact rather than a wish —
    // this one is true, and it is what makes the two tests above matter.
    const history = source(join('hypercomb-essentials', 'src', 'history', 'history.service.ts'))
    const body = history.slice(history.indexOf('public readonly getLayerBySig'))
      .slice(0, 4000)
    expect(body).toContain('void store?.fetchLayerFromHost?.(')

    // And that call is a real network read: the broker fetches the signature
    // from a host.
    const store = source(join('hypercomb-runtime', 'src', 'store.ts'))
    const fetcher = store.slice(store.indexOf('public fetchLayerFromHost')).slice(0, 3000)
    expect(fetcher).toContain("broker.fetchBySig(signature, 'layer')")
  })
})

// ---------------------------------------------------------------------------
// 2. ONE PRESS OF "LOOK"
// ---------------------------------------------------------------------------

describe('one press of Look', () => {

  const K1 = HEX('1')
  const K2 = HEX('2')

  it('does not tell a host about publishers it was never associated with', async () => {
    // `buildHorizon` gives EVERY publisher the shared doors — every community
    // zone plus the standing public endpoint. `searchVocabulary` then asks
    // every door of every publisher concurrently, and `hiveIndexUrl` puts the
    // publisher's key in the PATH (`https://<host>/hive/<pubkey>`).
    //
    // So one press sends the standing endpoint one request per publisher this
    // participant has ever followed or visited: the follow graph, disclosed in
    // a single burst to a host that hosts none of them. The window says
    // "Asked {p} publishers across {d} doors" only AFTER the fact, and the
    // behaviour's own description says merely "Asks every publisher you
    // follow, and says which could not answer".
    const horizon = buildHorizon({
      visits: [{ pubkey: K1, domain: 'alice.example' }],
      follows: { bob: { pubkey: K2, hosts: ['content.bob.example'] } },
      communityZones: [],
      fallbackHosts: ['content.pluginthematrix.com'],
    })

    const askedAt = new Map<string, string[]>()
    const deps: VocabularySearchDeps = {
      surface: HEX('d'),
      readIndex: async (host: string, pubkey: string): Promise<HiveIndexResult> => {
        const seen = askedAt.get(host) ?? []
        seen.push(pubkey)
        askedAt.set(host, seen)
        return { ok: false, reason: 'missing' } as HiveIndexResult
      },
      readAtom: async () => ({ ok: false, why: 'unreachable' as const }),
    }

    await searchVocabulary(HEX('a'), horizon, deps)

    // Each publisher's OWN door may of course be asked about that publisher.
    expect(askedAt.get('content.alice.example') ?? []).toEqual([K1])
    expect(askedAt.get('content.bob.example') ?? []).toEqual([K2])

    // The standing endpoint, which neither participant chose for this lookup,
    // must not learn who they follow.
    expect(askedAt.get('content.pluginthematrix.com') ?? []).toEqual([])
  })

  it('the fan-out is uncapped — publishers times doors, all at once', async () => {
    // Twenty visited branches and three community zones is 20 x 4 = 80
    // simultaneous outbound requests from one keystroke. There is no
    // concurrency limit anywhere on this path; `deadlines.search` bounds how
    // long the SURFACE waits, never how much leaves.
    const visits = Array.from({ length: 20 }, (_, i) => ({
      pubkey: HEX(i.toString(16).padStart(1, '0')[0] ?? '1'),
      domain: `visit${i}.example`,
    }))
    const horizon = buildHorizon({
      visits,
      communityZones: ['one.example', 'two.example', 'three.example'],
      fallbackHosts: ['content.pluginthematrix.com'],
    })

    let inFlight = 0
    let peak = 0
    const deps: VocabularySearchDeps = {
      surface: HEX('d'),
      readIndex: async (): Promise<HiveIndexResult> => {
        inFlight += 1
        peak = Math.max(peak, inFlight)
        await Promise.resolve()
        inFlight -= 1
        return { ok: false, reason: 'missing' } as HiveIndexResult
      },
      readAtom: async () => ({ ok: false, why: 'unreachable' as const }),
    }

    await searchVocabulary(HEX('a'), horizon, deps)
    expect(peak).toBeLessThanOrEqual(8)
  })
})

// ---------------------------------------------------------------------------
// 3. THE RATCHET THAT WALKS A GENERATED FILE
// ---------------------------------------------------------------------------

describe('the publish-door ratchet', () => {
  it('walks a generated, gitignored facade and therefore cannot stay green', () => {
    // `vocabulary.queen.spec.ts` walks every non-spec `.ts` under
    // `hypercomb-essentials/src` and fails if any file outside three named
    // modules mentions `publishVocabulary`. `essentials-keys.ts` is
    // auto-generated ("do not edit manually"), is gitignored, and lists EVERY
    // exported symbol in the package — including `publishVocabulary`. The
    // ratchet is red the moment the generator runs, which is every
    // `npm run build:essentials`.
    const keys = source(join('hypercomb-essentials', 'src', 'essentials-keys.ts'))
    expect(keys).toContain('auto-generated')
    expect(keys).toContain('publishVocabulary')

    const ratchet = source(join('hypercomb-essentials', 'src', 'molecule', 'vocabulary.queen.spec.ts'))
    // A ratchet over generated output must exclude it. This one does not.
    expect(ratchet).toContain('essentials-keys')
  })
})
