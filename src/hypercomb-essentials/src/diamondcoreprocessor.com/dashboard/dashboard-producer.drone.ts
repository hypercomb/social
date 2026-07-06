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

import { Drone, EffectBus, normalizeCell } from '@hypercomb/core'

const STORE_KEY = '@hypercomb.social/Store'
const HISTORY_KEY = '@diamondcoreprocessor.com/HistoryService'
const COMMITTER_KEY = '@diamondcoreprocessor.com/LayerCommitter'
const DASHBOARD_BEE_KEY = '@diamondcoreprocessor.com/DashboardBee'
const NAV_KEY = '@hypercomb.social/Navigation'

const ENABLED_KEY = 'hc:feedback-channel:enabled'
const FEEDBACK_CHANNEL_KEY = '@diamondcoreprocessor.com/FeedbackChannelDrone'
const BINDING_KIND = 'dashboard-q-binding'
// Per-tile decoration that groups a question/header tile into a category island.
// Read by show-cell (dashboardIslandGroupForLabel/RoleForLabel) to lay the bag
// out as clustered islands — NOT `launch:target`, which would hijack the click.
const ISLAND_KIND = 'dashboard-island'
const REBUILD_DEBOUNCE_MS = 600

type OpenQ = { qId: string; question: string; path: string[]; sig: string }
type Bag = { bagLocSig: string; bagSegments: readonly string[] }

interface StoreLike {
  listOptimizations?: () => Promise<string[]>
  getOptimization?: (sig: string) => Promise<Blob | null>
  putOptimization?: (blob: Blob, options?: { emit?: boolean }) => Promise<string>
  removeOptimization?: (sig: string) => Promise<boolean>
  putResource?: (blob: Blob) => Promise<string>
}
interface HistoryLike {
  currentLayerAt: (locationSig: string) => Promise<Record<string, unknown> | null>
  sign?: (lineage: { explorerSegments: () => readonly string[] }) => Promise<string>
  commitLayer?: (locationSig: string, layer: { name?: string; [slot: string]: unknown }) => Promise<string>
}
interface CommitterLike {
  update: (segments: readonly string[], layer: { name?: string; [slot: string]: unknown }, nameSlots?: ReadonlySet<string>) => Promise<string>
}
interface DashboardBeeLike {
  listPinnedBags: () => readonly Bag[]
  createDashboardForCurrentLocation?: () => Promise<Bag | null>
  isActive?: () => boolean
}
interface NavigationLike { goRaw?: (segments: readonly string[]) => void }

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
    // Mirror the feedback channel's owner-default-on (so returned qa renders
    // for the owner on their own hive without a hidden flag). Fall back to the
    // raw flag if the channel drone isn't resolved yet.
    const channel = ioc()?.get<{ isEnabled?: () => boolean }>(FEEDBACK_CHANNEL_KEY)
    if (channel?.isEnabled) return channel.isEnabled()
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

      // 1) open questions, deduped by path + question (mirror the node script)
      const open = await this.#openQuestions(store)

      // Lazily mint the dashboard bag on the FIRST arriving question so a
      // channel-ingested qa is visible without the user having run /dashboard
      // once (closes the pinned-bag precondition). Never mint an empty one.
      let bag = bee.listPinnedBags()[0]
      if ((!bag || !bag.bagSegments?.length) && open.length > 0 && bee.createDashboardForCurrentLocation) {
        try { await bee.createDashboardForCurrentLocation() } catch { /* best-effort */ }
        bag = bee.listPinnedBags()[0]
      }
      if (!bag || !bag.bagSegments?.length) return  // nothing pinned + nothing to render

      // 2) group open questions into ISLANDS by category — the root of each
      //    question's path (games, websites, feedback, …); a path-less question
      //    is 'general'. Categories keep first-seen order so islands are stable.
      const catOrder: string[] = []
      const byCat = new Map<string, OpenQ[]>()
      for (const q of open) {
        const cat = normalizeCell((q.path.length ? q.path[0] : 'general') || 'general') || 'general'
        let arr = byCat.get(cat)
        if (!arr) { arr = []; byCat.set(cat, arr); catOrder.push(cat) }
        arr.push(q)
      }

      // Allocate a UNIQUE label per tile. EVERY tile is a QUESTION — no category
      // header/title tiles, because a dashboard item that isn't tied to a question
      // would be an "empty item". The category still groups the questions into a
      // spatial island (a headerless cluster); it's carried on each question's
      // `dashboard-island` decoration, never as its own tile.
      const used = new Set<string>()
      const uniq = (base: string): string => {
        const b = normalizeCell(base || 'q') || 'q'
        let label = b, n = 1
        while (used.has(label)) label = `${b}-${++n}`
        used.add(label)
        return label
      }
      const orderedLabels: string[] = []
      const tiles: Array<{ label: string; island: string }> = []
      const byLabel: Array<{ label: string; q: OpenQ }> = []
      catOrder.forEach((cat, i) => {
        const island = `island-${i}`
        for (const q of byCat.get(cat) ?? []) {
          const base = q.path.length ? q.path[q.path.length - 1] : 'q'
          const label = uniq(base)
          orderedLabels.push(label)
          tiles.push({ label, island })
          byLabel.push({ label, q })
        }
      })

      // 3) commit each question tile's OWN layer carrying a `dashboard-island`
      //    decoration (its island id — no role: every tile is a question). Direct
      //    put-resource + commitLayer so the child head the bag links below already
      //    carries the decoration — the same deterministic pattern MixedGroupBag
      //    uses for launcher tiles, avoiding the empty-marker race a
      //    DecorationService request would hit. The emit warms the decoration-kind
      //    index (and nudges show-cell to cluster) when the host is already looking
      //    at the bag. Best-effort: if this store lacks putResource, tiles still
      //    render — just unclustered.
      if (store.putResource && history.sign && history.commitLayer) {
        for (const t of tiles) {
          try {
            const record = { kind: ISLAND_KIND, appliesTo: [], payload: { group: t.island } }
            const decoSig = await store.putResource(new Blob([JSON.stringify(record)], { type: 'application/json' }))
            const childSegs = [...bag.bagSegments, t.label]
            const childLocSig = await history.sign({ explorerSegments: () => childSegs })
            await history.commitLayer(childLocSig, { name: t.label, decorations: [decoSig] })
            EffectBus.emit('decorations:changed', { segments: childSegs, op: 'append', sig: decoSig })
          } catch { /* fall through — the tile still renders, just unclustered */ }
        }
      }

      // 4) replace the bag's children with the island-ordered labels —
      //    committer.update re-resolves each label to its (decoration-carrying)
      //    head. Preserve every OTHER array slot (context, etc.) to avoid wiping it.
      const cur = (await history.currentLayerAt(bag.bagLocSig)) ?? {}
      const payload: { name?: string; [slot: string]: unknown } = { name: String(bag.bagSegments[0]) }
      for (const [k, v] of Object.entries(cur)) {
        if (k === 'name' || k === 'children') continue
        if (Array.isArray(v)) payload[k] = v
      }
      const prevChildren = Array.isArray(cur['children']) ? (cur['children'] as unknown[]).map(String) : []
      const changed = prevChildren.length !== orderedLabels.length || prevChildren.some((c, i) => c !== orderedLabels[i])
      payload['children'] = orderedLabels
      await committer.update(bag.bagSegments, payload)

      // 4) bag-scoped bindings: prune the old set, write the current one
      await this.#rewriteBindings(store, bag.bagSegments, byLabel)

      // 5) REAL-TIME: if the host is looking at the dashboard right now, force the
      //    hex view to re-read the layer so a newly-arrived question (or a drained
      //    one) shows LIVE — no reload. The render pipeline only re-renders on nav
      //    or the processor's `synchronize` (which only the processor may
      //    dispatch), so re-navigate to the current bag — the established
      //    "force re-read" pattern (show-cell.drone uses the same goRaw). Guarded
      //    on an actual child-set change so a stream of ingests doesn't churn the
      //    viewport when nothing visible changed.
      if (changed && bee.isActive?.()) {
        ioc()?.get<NavigationLike>(NAV_KEY)?.goRaw?.(bag.bagSegments)
      }
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
