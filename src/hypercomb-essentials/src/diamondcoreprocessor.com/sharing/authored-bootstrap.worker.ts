// diamondcoreprocessor.com/sharing/authored-bootstrap.worker.ts
//
// ONE-TIME BOOTSTRAP for the authored-sigs allow-set (authored-sigs.ts).
// Existing hives predate per-signature authorship tracking, so this worker
// grandfathers them: walk the participant's lineage EXCLUDING adopted roots
// (isWithinAdoptedRoot as an EXCLUSION filter — foreign subtrees are never
// yours to mark) and record every page sig found — `website` / `context`
// slot entries plus `visual:website:page` decoration htmlSigs, the exact
// sigs the verification gate resolves a page from.
//
// Completeness rule: the bootstrap flag is set ONLY after a walk with zero
// cold misses (childNamesOfStrict). A cold child means "couldn't see it",
// not "doesn't exist" — flagging then would permanently skip pages that
// merely weren't warm. Partial results are still marked (marking is
// idempotent and additive); the walk simply retries next session until it
// completes. Runs OFF the boot path — idle-scheduled, read-only, never
// gates paint (same posture as the content relocation).
//
// Also reconciles the sign('authored') pool with the localStorage cache
// first, so authorship survives a localStorage clear.

import { Worker } from '@hypercomb/core'
import { markManyAuthored, reconcileAuthoredPool } from './authored-sigs.js'
import { isWithinAdoptedRoot } from './adopted-roots.js'
import { childNamesOfStrict, type PlacementHistory, type PlacementLayer } from '../history/layer-placement.js'

const FLAG_KEY = 'hc:authored-sigs:bootstrapped'
const PAGE_KIND = 'visual:website:page'
const SIG_RE = /^[a-f0-9]{64}$/

type WalkHistory = PlacementHistory & {
  sign: (ctx: { explorerSegments: () => readonly string[] }) => Promise<string>
}
type WalkStore = {
  getResource: (sig: string) => Promise<Blob | null>
}

export class AuthoredBootstrapWorker extends Worker {
  readonly namespace = 'diamondcoreprocessor.com'
  override description = 'one-time grandfathering walk: marks pre-existing page sigs as locally authored'

  protected override ready = (): boolean => {
    try { if (localStorage.getItem(FLAG_KEY)) return true } catch { /* fall through */ }
    const ioc = (globalThis as any).ioc
    return !!ioc?.get('@diamondcoreprocessor.com/HistoryService') && !!ioc?.get('@hypercomb.social/Store')
  }

  protected override act = async (): Promise<void> => {
    // Reconcile pool ↔ cache EVERY session (one idle dir listing) — a
    // selective clear of the cache key alone must not orphan pool
    // authorship until the next full bootstrap. The walk itself runs
    // only while the one-time flag is absent.
    let walked = true
    try { walked = !!localStorage.getItem(FLAG_KEY) } catch { /* storage denied — walk anyway */ }
    const idle = (globalThis as any).requestIdleCallback as
      | ((cb: () => void, opts?: { timeout: number }) => number)
      | undefined
    const run = walked
      ? () => { void reconcileAuthoredPool().catch(() => 0) }
      : () => { void this.#bootstrap() }
    if (idle) idle(run, { timeout: 10_000 })
    else setTimeout(run, 3_000)
  }

  async #bootstrap(): Promise<void> {
    const ioc = (globalThis as any).ioc
    const history = ioc?.get('@diamondcoreprocessor.com/HistoryService') as WalkHistory | undefined
    const store = ioc?.get('@hypercomb.social/Store') as WalkStore | undefined
    if (!history?.sign || !history.currentLayerAt || !store?.getResource) return

    await reconcileAuthoredPool().catch(() => 0)

    const found: string[] = []
    const visited = new Set<string>()
    let complete = true

    const walk = async (segments: readonly string[]): Promise<void> => {
      // Exclusion filter, never an inclusion gate: a subtree folded in
      // from a peer is not yours — skipping it is a COMPLETE outcome.
      if (segments.length > 0 && isWithinAdoptedRoot(segments)) return

      const locSig = await history.sign({ explorerSegments: () => segments }).catch(() => '')
      if (!locSig || visited.has(locSig)) return
      visited.add(locSig)

      const layer = await history.currentLayerAt(locSig).catch(() => null) as PlacementLayer | null
      if (!layer) { complete = false; return }

      for (const slot of ['website', 'context'] as const) {
        const v = (layer as Record<string, unknown>)[slot]
        if (Array.isArray(v)) for (const s of v) if (SIG_RE.test(String(s))) found.push(String(s))
      }
      const decorations = (layer as Record<string, unknown>)['decorations']
      if (Array.isArray(decorations)) {
        for (const d of decorations) {
          const dsig = String(d)
          if (!SIG_RE.test(dsig)) continue
          try {
            const blob = await store.getResource(dsig)
            if (!blob) continue
            const rec = JSON.parse(await blob.text()) as { kind?: string; payload?: { htmlSig?: string } }
            const h = rec?.payload?.htmlSig
            if (rec?.kind === PAGE_KIND && typeof h === 'string' && SIG_RE.test(h)) found.push(h)
          } catch { /* malformed / cold decoration — pages it names stay ungrandfathered this pass */ }
        }
      }

      const { names, coldMiss } = await childNamesOfStrict(history, layer)
      if (coldMiss) complete = false
      for (const name of names) await walk([...segments, name])
    }

    try { await walk([]) } catch { complete = false }

    markManyAuthored(found)
    if (complete) {
      try { localStorage.setItem(FLAG_KEY, String(Date.now())) } catch { /* retry next session */ }
      console.log(`[authored-bootstrap] complete — ${found.length} page sig(s) grandfathered across ${visited.size} cells`)
    } else {
      console.log(`[authored-bootstrap] partial (cold misses) — ${found.length} page sig(s) marked, will retry next session`)
    }
  }
}

const _authoredBootstrap = new AuthoredBootstrapWorker()
window.ioc.register('@diamondcoreprocessor.com/AuthoredBootstrapWorker', _authoredBootstrap)
