// diamondcoreprocessor.com/dashboard/dashboard-producer.drone.ts
//
// In-app dashboard producer. Renders the dashboard's open-question SURFACE
// (hex tiles + the click-to-answer QaModalView) from the LOCAL optimization
// substrate, so a participant's browser shows its dashboard WITHOUT a node
// script driving the bridge. This is the render side of the durable feedback
// channel: as kind:'qa' records arrive (feedback:channel-ingested) or are
// written locally (optimization:wrote), the dashboard is kept in sync.
//
// TARGET = the participant-local hidden bag that DashboardBee navigates the
// toggle INTO (its bagSegments) — NOT the literal ['dashboard'] location the
// legacy node script `scripts/bridge/_dashboard-refresh.cjs` writes to. Those
// had diverged: the script rendered into ['dashboard'] while the toggle opened
// an empty hidden bag. This producer makes the bag — the place the toggle
// actually opens — the live surface. DashboardQOpenWorker is updated in tandem
// so tile clicks INSIDE the bag open the modal.
//
// Per open question we mint:
//   • one CHILD on the bag's layer (a hex tile), and
//   • one `dashboard-q-binding` optimization with
//     appliesTo = [...bagSegments, label] so DashboardQOpenWorker opens the
//     matching QaModalView on click.
// Labels + dedup mirror `_dashboard-refresh.cjs` exactly so the two paths agree.
//
// INERT BY DEFAULT — gated on the same flag as the feedback channel
// (hc:feedback-channel:enabled), since the producer is the render side of the
// channel-fed loop. With the gate off it never commits to the hive, so a
// hot-reload into a running session changes nothing.

import { Drone, normalizeCell } from '@hypercomb/core'

const STORE_KEY = '@hypercomb.social/Store'
const HISTORY_KEY = '@diamondcoreprocessor.com/HistoryService'
const COMMITTER_KEY = '@diamondcoreprocessor.com/LayerCommitter'
const DASHBOARD_BEE_KEY = '@diamondcoreprocessor.com/DashboardBee'

const ENABLED_KEY = 'hc:feedback-channel:enabled'
const BINDING_KIND = 'dashboard-q-binding'
const REBUILD_DEBOUNCE_MS = 600

type OpenQ = { qId: string; question: string; path: string[]; sig: string }
type Bag = { bagLocSig: string; bagSegments: readonly string[] }

interface StoreLike {
  listOptimizations?: () => Promise<string[]>
  getOptimization?: (sig: string) => Promise<Blob | null>
  putOptimization?: (blob: Blob, options?: { emit?: boolean }) => Promise<string>
  removeOptimization?: (sig: string) => Promise<boolean>
}
interface HistoryLike {
  currentLayerAt: (locationSig: string) => Promise<Record<string, unknown> | null>
}
interface CommitterLike {
  update: (segments: readonly string[], layer: { name?: string; [slot: string]: unknown }, nameSlots?: ReadonlySet<string>) => Promise<string>
}
interface DashboardBeeLike {
  listPinnedBags: () => readonly Bag[]
}

const ioc = () => (window as { ioc?: { get: <T>(k: string) => T | undefined } }).ioc
const enc = new TextEncoder()

export class DashboardProducerDrone extends Drone {

  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'dashboard'

  public override description =
    'Renders the dashboard open-question surface (hex tiles + answer modal) from the local kind:\'qa\' optimization substrate into the participant-local dashboard bag, so the toggle shows live questions without a node script. Inert until hc:feedback-channel:enabled.'

  protected override listens: string[] = ['feedback:channel-ingested', 'optimization:wrote']
  protected override emits: string[] = []

  #initialized = false
  #timer: ReturnType<typeof setTimeout> | null = null
  #rebuilding = false

  protected override sense = () => true
  protected override heartbeat = async (): Promise<void> => {
    if (this.#initialized) return
    this.#initialized = true
    // Both triggers only ACT when enabled, so flipping the gate on takes
    // effect on the next qa without a reload (mirrors the channel drone).
    const schedule = () => { if (this.#isEnabled()) this.#scheduleRebuild() }
    this.onEffect('feedback:channel-ingested', schedule)
    this.onEffect('optimization:wrote', schedule)
    if (this.#isEnabled()) this.#scheduleRebuild()  // boot sync
  }

  #isEnabled(): boolean {
    try { return String(localStorage.getItem(ENABLED_KEY) ?? '').trim().toLowerCase() === 'true' }
    catch { return false }
  }

  #scheduleRebuild(): void {
    if (this.#timer) clearTimeout(this.#timer)
    this.#timer = setTimeout(() => { this.#timer = null; void this.#rebuild() }, REBUILD_DEBOUNCE_MS)
  }

  /** Public manual trigger (tests / explicit refresh). Resolves after the
   *  bag + bindings are committed. */
  public readonly refresh = (): Promise<void> => this.#rebuild()

  readonly #rebuild = async (): Promise<void> => {
    if (this.#rebuilding) return
    this.#rebuilding = true
    try {
      const store = ioc()?.get<StoreLike>(STORE_KEY)
      const committer = ioc()?.get<CommitterLike>(COMMITTER_KEY)
      const bee = ioc()?.get<DashboardBeeLike>(DASHBOARD_BEE_KEY)
      const history = ioc()?.get<HistoryLike>(HISTORY_KEY)
      if (!store?.listOptimizations || !store.getOptimization || !committer?.update || !bee?.listPinnedBags || !history) return

      const bag = bee.listPinnedBags()[0]
      if (!bag || !bag.bagSegments?.length) return  // no dashboard pinned — nothing to render into

      // 1) open questions, deduped by path + question (mirror the node script)
      const open = await this.#openQuestions(store)

      // 2) one normalized child label per open Q — last path segment, numbered
      //    on collision so every label is unique (same algorithm as the script)
      const labels: string[] = []
      const counts = new Map<string, number>()
      const byLabel: Array<{ label: string; q: OpenQ }> = []
      for (const q of open) {
        const base = normalizeCell((q.path.length ? q.path[q.path.length - 1] : 'root') || 'q') || 'q'
        const n = (counts.get(base) ?? 0) + 1
        counts.set(base, n)
        const label = n === 1 ? base : `${base}-${n}`
        labels.push(label)
        byLabel.push({ label, q })
      }

      // 3) replace the bag's children — committer.update replaces the slot set,
      //    so preserve every OTHER array slot (context, etc.) to avoid wiping it
      const cur = (await history.currentLayerAt(bag.bagLocSig)) ?? {}
      const payload: { name?: string; [slot: string]: unknown } = { name: String(bag.bagSegments[0]) }
      for (const [k, v] of Object.entries(cur)) {
        if (k === 'name' || k === 'children') continue
        if (Array.isArray(v)) payload[k] = v
      }
      payload['children'] = labels
      await committer.update(bag.bagSegments, payload)

      // 4) bag-scoped bindings: prune the old set, write the current one
      await this.#rewriteBindings(store, bag.bagSegments, byLabel)
    } finally {
      this.#rebuilding = false
    }
  }

  readonly #openQuestions = async (store: StoreLike): Promise<OpenQ[]> => {
    const sigs = (await store.listOptimizations?.()) ?? []
    const all: OpenQ[] = []
    for (const sig of sigs) {
      const blob = await store.getOptimization?.(sig)
      if (!blob) continue
      let p: { kind?: string; appliesTo?: unknown; payload?: { qId?: unknown; question?: unknown } }
      try { p = JSON.parse(await blob.text()) } catch { continue }
      if (p.kind !== 'qa') continue
      const question = typeof p.payload?.question === 'string' ? p.payload.question.trim() : ''
      if (!question) continue
      all.push({
        qId: typeof p.payload?.qId === 'string' && p.payload.qId ? p.payload.qId : sig.slice(0, 16),
        question,
        path: Array.isArray(p.appliesTo) ? p.appliesTo.map(String) : [],
        sig,
      })
    }
    // dedupe: same path + same question text = one row
    const seen = new Set<string>()
    const open: OpenQ[] = []
    for (const q of all) {
      const key = q.path.join('/') + '\n' + q.question
      if (seen.has(key)) continue
      seen.add(key)
      open.push(q)
    }
    return open
  }

  readonly #rewriteBindings = async (
    store: StoreLike,
    bagSegments: readonly string[],
    byLabel: Array<{ label: string; q: OpenQ }>,
  ): Promise<void> => {
    const bagRoot = String(bagSegments[0])
    // prune existing bindings scoped to THIS bag (stale labels/questions)
    const sigs = (await store.listOptimizations?.()) ?? []
    for (const sig of sigs) {
      const blob = await store.getOptimization?.(sig)
      if (!blob) continue
      let p: { kind?: string; appliesTo?: unknown }
      try { p = JSON.parse(await blob.text()) } catch { continue }
      if (p.kind !== BINDING_KIND) continue
      if (Array.isArray(p.appliesTo) && String(p.appliesTo[0]) === bagRoot) {
        await store.removeOptimization?.(sig)
      }
    }
    // write the current set; appliesTo = [...bagSegments, label] so
    // DashboardQOpenWorker matches it against [...explorerSegments, label]
    for (const { label, q } of byLabel) {
      const binding = {
        kind: BINDING_KIND,
        appliesTo: [...bagSegments, label],
        payload: { qId: q.qId, qSig: q.sig, qPath: q.path, question: q.question },
      }
      // emit:false — bindings are participant-local, not a synced loop record
      await store.putOptimization?.(new Blob([enc.encode(JSON.stringify(binding)) as BlobPart]), { emit: false })
    }
  }
}

const _dashboardProducer = new DashboardProducerDrone()
window.ioc.register('@diamondcoreprocessor.com/DashboardProducerDrone', _dashboardProducer)
