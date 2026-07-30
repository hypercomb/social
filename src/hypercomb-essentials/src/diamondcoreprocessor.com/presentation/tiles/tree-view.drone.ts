// diamondcoreprocessor.com/presentation/tiles/tree-view.drone.ts
//
// The sideways tree — a full-viewport takeover that reads a hive branch the
// way you read a mind map, except it grows like a branch: the trunk sits at
// the left, vertically centred, and every ring of the hierarchy fans out to
// the right as its own column. Limbs are tapered ribbons that thin as they
// travel, so a twig ending in a leaf comes to a point.
//
// It is a READER. It walks layers the hive already holds, writes nothing,
// and mints nothing. Any signature is a valid root — a layer sig, a location
// sig, a `/branch` name, or a path — which makes the view a lens you can
// point at any part of the merkle tree, including content that is not
// reachable from where you are standing.
//
// Working ring by ring is first-class: the ring bar along the top is the
// column index, clicking a ring focuses it (everything else dims), and the
// rail then reports and acts on that whole ring at once.
//
// Lifecycle uses an idempotent heartbeat plus lineage and ViewMode
// listeners, fixed host above the Pixi layer, owner-counted `view:active`
// via ModeRegistry, zero shell edits. Exits: Escape, right-click, or the
// toolbar's exit button.

import { Drone, EffectBus, I18N_IOC_KEY } from '@hypercomb/core'
import {
  layoutTree, limbColor, clipLabel, RING_GAP, ROW_GAP, ROW_GAP_ICONS,
  type TreeLayout, type TreeNode, type PlacedNode,
} from './tree-layout.js'
import {
  TreeIconCache, HEX_CLIP_POINTS, LEAF_CLIP_PATH,
  hexOutline, leafOutline, leafMidrib, iconSize, nodeHeight, type IconStore,
} from './tree-icons.js'
import { walkTree, expandNodes, type TreeRoot, type WalkHistory, type WalkStore } from './tree-walk.js'
import {
  loadInsights, saveInsight, deleteInsight, newInsight, withCall, withoutCall, isValidInsightName,
  type Insight, type InsightCatalog, type InsightStore,
} from './tree-insight.js'

export const TREE_VIEW = 'tree'

/** House palette — steel on ink, matching the other full-viewport views.
 *  A dark canvas is deliberate: the limb hues are the information here, and
 *  they only separate cleanly against ink. */
const INK = '#0b0f14'
const PANEL = 'rgba(126,182,214,0.06)'
const BORDER = 'rgba(126,182,214,0.18)'
const BORDER_LIT = 'rgba(126,182,214,0.45)'
const TEXT = '#d8e6ee'
const DIM = 'rgba(216,230,238,0.55)'
const FAINT = 'rgba(216,230,238,0.32)'
const STEEL = 'rgb(126,182,214)'

const TOOLBAR_H = 52
const RINGBAR_H = 34
/** Scroll-content height above the canvas origin: the stage is padded clear
 *  of the fixed toolbar, then the ring bar takes its row. Every viewport ↔
 *  canvas coordinate conversion goes through this. */
const TOP_OFFSET = TOOLBAR_H + RINGBAR_H
const RAIL_W = 320
const Z_BASE = 59988

const DEFAULT_RINGS = 6
const MAX_RINGS = 12
/** Budget for the FIRST walk only — it buys a fast first paint, not a limit.
 *  Whatever it leaves unresolved becomes frontier and fills in under the eye. */
const INITIAL_MAX_NODES = 1200
/** Runaway guard for viewport deepening. Not a feature — just a floor under
 *  the worst case so a pathological tree cannot walk forever. */
const NODE_CEILING = 6000
/** Frontier nodes resolved per deepening pass. Small enough that a pass never
 *  blocks a scroll; passes cascade until the viewport is fully resolved. */
const DEEPEN_BATCH = 12
/** Resolve a little beyond the edges so detail is already there when it
 *  scrolls in, rather than appearing after it arrives. */
const DEEPEN_MARGIN = 320
const MIN_ZOOM = 0.2
const MAX_ZOOM = 2
/** Auto-fit never goes below this — past it the labels stop being words. */
const FIT_FLOOR = 0.45
/** …nor blows a two-tile branch up to fill the screen. */
const FIT_CEILING = 1.15

const SIG = /^[0-9a-f]{64}$/

type ViewModeShape = EventTarget & { mode: string; setMode(next: string): void }
type NavigationShape = { goRaw(segments: readonly string[]): void }
type I18nShape = { t(key: string, params?: Record<string, string | number>): string }
type ModeRegistryShape = { enter(mode: string, owner: string): void; exit(mode: string, owner: string): void }

type Mount = {
  host: HTMLDivElement
  stage: HTMLDivElement
  ringbar: HTMLDivElement
  svg: SVGSVGElement
  status: HTMLDivElement
  notice: HTMLDivElement
  rail: HTMLDivElement
  filterInput: HTMLInputElement
  insightChip: HTMLDivElement
  insightMenu: HTMLDivElement
  ringsLabel: HTMLSpanElement
  zoomLabel: HTMLSpanElement
  crumb: HTMLDivElement
  nodeEls: Map<number, SVGGElement>
  ribbonEls: Map<number, SVGPathElement>
  /** Flat hex fills, hidden once a node's picture lands on top. */
  hexFills: Map<number, SVGPathElement>
  iconEls: Map<number, SVGImageElement>
  iconsButton: HTMLButtonElement
}

const svgEl = <K extends keyof SVGElementTagNameMap>(
  tag: K, attrs: Record<string, string | number> = {},
): SVGElementTagNameMap[K] => {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag)
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v))
  return el
}

const div = (css: string, text?: string): HTMLDivElement => {
  const el = document.createElement('div')
  el.style.cssText = css
  if (text !== undefined) el.textContent = text
  return el
}

export class TreeViewDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'presentation'
  override description =
    'Sideways tree view. Walks a branch ring by ring and draws it as a mind map that grows like a branch — trunk left, one column per ring, tapered limbs, any signature as the root.'

  #mount: Mount | null = null
  #viewActive = false
  #registered = false
  #lineageBound = false
  #viewModeBound = false
  #contextMenuBound = false
  #keyBound = false
  #effectsBound = false

  // ── view state ──
  #root: TreeRoot = {}
  #rings = DEFAULT_RINGS
  #nodes: TreeNode[] = []
  #layout: TreeLayout | null = null
  #collapsed = new Set<number>()
  #selected: number | null = null
  #ringFocus: number | null = null
  #hovered: number | null = null
  #filter = ''
  #zoom = 1
  #rootSigIsLocation = false
  #walkError: string | null = null
  /** Extra space above the canvas when the branch is shorter than the
   *  viewport (see #paintCanvas) — part of every coordinate conversion. */
  #topSlack = 0

  /** Identity of the walked data — a re-walk only happens when this moves. */
  #dataKey = ''
  #walking = false
  #walkSeq = 0
  #refreshTimer: ReturnType<typeof setTimeout> | null = null
  /** Viewport deepening — the tree resolves under the eye as you move. */
  #expanding = false
  #deepenTimer: ReturnType<typeof setTimeout> | null = null
  #ceilingHit = false
  #noticeDismissed = false
  /** The named fragment being built, and every fragment on file. */
  #insight: Insight | null = null
  #insights: InsightCatalog = {}
  #insightsLoaded = false
  /** Draw nodes as hex tiles carrying their picture. Off falls back to plain
   *  markers, which costs nothing at all — the escape hatch for a huge
   *  branch or a slow machine. */
  #icons = true
  #iconCache = new TreeIconCache()
  #iconTimer: ReturnType<typeof setTimeout> | null = null
  #iconsLoading = false

  protected override deps = {
    lineage: '@hypercomb.social/Lineage',
    store: '@hypercomb.social/Store',
  }
  protected override listens: string[] = []
  protected override emits = ['view:active']

  protected override heartbeat = async (): Promise<void> => {
    if (!this.#registered) {
      window.ioc.register('@diamondcoreprocessor.com/TreeViewDrone', this)
      this.#registered = true
    }
    if (!this.#lineageBound) {
      const lineage = this.resolve<EventTarget>('lineage')
      if (lineage?.addEventListener) {
        lineage.addEventListener('change', this.#onLineageChange)
        this.#lineageBound = true
      }
    }
    if (!this.#viewModeBound) {
      const vm = this.#vm()
      if (vm?.addEventListener) {
        vm.addEventListener('change', this.#onModeChange)
        this.#viewModeBound = true
      }
    }
    if (!this.#contextMenuBound) {
      window.addEventListener('contextmenu', this.#onContextMenu, true)
      this.#contextMenuBound = true
    }
    if (!this.#keyBound) {
      window.addEventListener('keydown', this.#onKeyDown, true)
      this.#keyBound = true
    }
    if (!this.#effectsBound) {
      // Structure changing under the view — re-walk, coalesced.
      for (const effect of ['cell:added', 'cell:removed', 'content:wrote']) {
        this.onEffect(effect, () => this.#scheduleRefresh())
      }
      this.#effectsBound = true
    }
    this.#sync()
  }

  protected override dispose(): void {
    const lineage = this.resolve<EventTarget>('lineage')
    if (this.#lineageBound && lineage?.removeEventListener) lineage.removeEventListener('change', this.#onLineageChange)
    const vm = this.#vm()
    if (this.#viewModeBound && vm?.removeEventListener) vm.removeEventListener('change', this.#onModeChange)
    if (this.#contextMenuBound) window.removeEventListener('contextmenu', this.#onContextMenu, true)
    if (this.#keyBound) window.removeEventListener('keydown', this.#onKeyDown, true)
    this.#teardown()
    // Object URLs outlive the DOM that referenced them — revoke on dispose,
    // not on teardown: the cache survives close/reopen, and that is the
    // point of it.
    this.#iconCache.dispose()
  }

  // ── public surface (the queen drives this) ─────────────────

  /** Point the view at a new root. Resets the per-branch view state so a
   *  re-root never inherits the previous branch's collapse/selection. */
  setRoot(root: TreeRoot, rings?: number): void {
    this.#root = { ...root }
    if (typeof rings === 'number' && Number.isFinite(rings)) {
      this.#rings = Math.max(1, Math.min(MAX_RINGS, Math.round(rings)))
    }
    this.#collapsed.clear()
    this.#selected = null
    this.#ringFocus = null
    this.#hovered = null
    this.#filter = ''
    this.#zoom = 1
    this.#dataKey = ''
    this.#ceilingHit = false
    this.#noticeDismissed = false
    this.#sync()
  }

  /** Root at the participant's current location — the bare `/tree` case. */
  setRootToCurrent(): void {
    this.setRoot({ segments: this.#currentSegments() })
  }

  /** Re-walk the SAME root at a new depth. */
  setRings(rings: number): void {
    this.#setRings(rings)
  }

  // ── insights — named cut-outs of the tree ──────────────────

  /** Every fragment on file, for the queen's autocomplete and listing. */
  async insights(): Promise<InsightCatalog> {
    await this.#loadInsights()
    return this.#insights
  }

  /** Re-open a named insight: its root becomes the trunk and its called
   *  branches come back marked. */
  async openInsight(name: string): Promise<boolean> {
    await this.#loadInsights()
    const insight = this.#insights[name]
    if (!insight) return false
    // The insight's name belongs on the chip, NOT on the trunk — stamping it
    // over the root tile's own name would read as a rename, and the name is
    // the address.
    this.setRoot({
      sig: insight.root.sig,
      segments: insight.root.segments ? [...insight.root.segments] : undefined,
      label: insight.root.label,
    })
    this.#insight = insight
    this.#paintInsightChip()
    return true
  }

  /** Start a fragment at the current root. The name IS the starting point —
   *  you name it, then keep calling branches into it. */
  async beginInsight(name: string): Promise<boolean> {
    const clean = String(name ?? '').trim()
    if (!isValidInsightName(clean)) return false
    await this.#loadInsights()
    const existing = this.#insights[clean]
    if (existing) { await this.openInsight(clean); return true }
    const insight = newInsight(clean, {
      sig: this.#root.sig,
      segments: this.#root.segments ? [...this.#root.segments] : undefined,
      label: this.#root.label,
    }, Date.now())
    this.#insight = insight
    this.#insights = await saveInsight(this.#store() as InsightStore, insight)
    this.#paintInsightChip()
    this.#draw()
    EffectBus.emit('activity:log', {
      message: this.#t('tree.insight.began', 'Insight “{name}” started — call branches into it', { name: clean }),
      icon: '🌿',
    })
    return true
  }

  #store(): (WalkStore & Partial<InsightStore>) | undefined {
    return this.resolve<WalkStore & Partial<InsightStore>>('store')
  }

  async #loadInsights(): Promise<void> {
    if (this.#insightsLoaded) return
    const store = this.#store()
    if (!store?.getPool) return
    this.#insights = await loadInsights(store as InsightStore)
    this.#insightsLoaded = true
  }

  /** Call a branch into the current fragment (or drop it back out). */
  async #toggleCall(sig: string): Promise<void> {
    if (!this.#insight) { this.#promptInsightName(); return }
    const at = Date.now()
    const next = this.#insight.calls.includes(sig)
      ? withoutCall(this.#insight, sig, at)
      : withCall(this.#insight, sig, at)
    this.#insight = next
    this.#insights = await saveInsight(this.#store() as InsightStore, next)
    this.#paintInsightChip()
    this.#draw()
  }

  #isCalled(sig: string): boolean {
    return this.#insight ? this.#insight.calls.includes(sig) : false
  }

  #currentSegments(): string[] {
    const lineage = this.resolve<{ explorerSegments?: () => readonly string[] }>('lineage')
    return [...(lineage?.explorerSegments?.() ?? [])]
  }

  // ── reactivity ─────────────────────────────────────────────

  readonly #onModeChange = (): void => { this.#sync() }

  /** Navigating elsewhere while the tree is up does not re-root it: the view
   *  is a lens on a chosen branch, not a mirror of the cursor. Only a
   *  path-rooted trunk that has never been walked follows the lineage. */
  readonly #onLineageChange = (): void => {
    if (this.#vm()?.mode !== TREE_VIEW) return
    if (this.#dataKey === '') this.#sync()
  }

  readonly #onContextMenu = (e: MouseEvent): void => {
    const vm = this.#vm()
    if (!vm || vm.mode !== TREE_VIEW) return
    e.preventDefault()
    vm.setMode('hexagons')
  }

  readonly #onKeyDown = (e: KeyboardEvent): void => {
    const vm = this.#vm()
    if (!vm || vm.mode !== TREE_VIEW) return
    const typing = document.activeElement === this.#mount?.filterInput
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopImmediatePropagation()
      if (typing && this.#filter) { this.#setFilter(''); this.#mount?.filterInput.blur(); return }
      vm.setMode('hexagons')
      return
    }
    if (typing) return
    if (e.key === '+' || e.key === '=') { e.preventDefault(); this.#setZoom(this.#zoom * 1.25) }
    else if (e.key === '-' || e.key === '_') { e.preventDefault(); this.#setZoom(this.#zoom / 1.25) }
    else if (e.key === '0') { e.preventDefault(); this.#fit() }
  }

  #scheduleRefresh(): void {
    if (this.#vm()?.mode !== TREE_VIEW) return
    if (this.#refreshTimer) clearTimeout(this.#refreshTimer)
    this.#refreshTimer = setTimeout(() => {
      this.#refreshTimer = null
      this.#dataKey = ''
      this.#sync()
    }, 400)
  }

  #vm(): ViewModeShape | undefined {
    return window.ioc?.get<ViewModeShape>('@hypercomb.social/ViewMode')
  }

  #history(): WalkHistory | undefined {
    return window.ioc?.get<WalkHistory>('@diamondcoreprocessor.com/HistoryService')
  }

  /** Localised text with an inline fallback. The fallback is interpolated
   *  too — it is the string every locale without these keys actually sees,
   *  and a literal "{n}" on screen is a bug, not a placeholder. */
  #t(key: string, fallback: string, params?: Record<string, string | number>): string {
    const value = window.ioc?.get<I18nShape>(I18N_IOC_KEY)?.t?.(key, params)
    if (value && value !== key) return value
    if (!params) return fallback
    return fallback.replace(/\{(\w+)\}/g, (whole, token: string) =>
      token in params ? String(params[token]) : whole)
  }

  /** Count-aware text. The catalog pluralises off `count` (key.one /
   *  key.other); the inline fallbacks pick their own form so a locale
   *  without these keys never reads "1 tiles". */
  #plural(key: string, count: number, one: string, other: string): string {
    return this.#t(key, count === 1 ? one : other, { count, n: count })
  }

  // ── walk / mount ───────────────────────────────────────────

  #sync(): void {
    const vm = this.#vm()
    if (!vm || vm.mode !== TREE_VIEW) { this.#teardown(); return }

    // Assigned directly rather than through setRoot — this runs inside sync,
    // and setRoot re-enters it.
    if (!this.#root.sig && !this.#root.segments) this.#root = { segments: this.#currentSegments() }
    if (!this.#mount) this.#mountShell()

    const key = JSON.stringify({ s: this.#root.sig ?? null, p: this.#root.segments ?? null, r: this.#rings })
    if (key === this.#dataKey) { this.#draw(); return }
    if (this.#walking) return
    this.#dataKey = key
    void this.#walk()
  }

  async #walk(): Promise<void> {
    const history = this.#history()
    const store = this.resolve<WalkStore>('store')
    if (!history || !store?.getResource) {
      this.#walkError = 'history unavailable'
      this.#draw()
      return
    }

    const seq = ++this.#walkSeq
    this.#walking = true
    this.#nodes = []
    this.#layout = null
    this.#walkError = null
    this.#status(this.#t('tree.status.reading', 'Reading the branch…'))

    try {
      const result = await walkTree(this.#root, history, store, {
        maxDepth: this.#rings,
        maxNodes: INITIAL_MAX_NODES,
        cancelled: () => seq !== this.#walkSeq || this.#vm()?.mode !== TREE_VIEW,
        onProgress: ({ ring, nodes }) => {
          if (seq !== this.#walkSeq) return
          this.#status(this.#t('tree.status.ring', 'Ring {ring} · {nodes} tiles', { ring, nodes }))
        },
      })
      if (seq !== this.#walkSeq) return
      this.#nodes = result.nodes
      this.#rootSigIsLocation = result.rootSigIsLocation
      this.#walkError = result.error ?? null
    } catch (err) {
      if (seq !== this.#walkSeq) return
      this.#walkError = String((err as Error)?.message ?? err)
      console.warn('[tree-view] walk failed', err)
    } finally {
      if (seq === this.#walkSeq) this.#walking = false
    }

    if (seq !== this.#walkSeq || this.#vm()?.mode !== TREE_VIEW) return
    this.#status(null)
    this.#draw()
    // First paint of a fresh branch lands insightd rather than at 1:1.
    if (this.#layout) this.#fit()
    this.#scheduleDeepen(80)
  }

  // ── viewport deepening ─────────────────────────────────────
  //
  // The first walk lays down a shallow shape fast; everything past it stays
  // as frontier (the two-dot mark) until you look at it. Moving around IS the
  // request for more levels, so wherever the viewport lands resolves itself —
  // a magnifying glass over the rings rather than a fixed depth.

  #scheduleDeepen(delay = 140): void {
    if (this.#deepenTimer) clearTimeout(this.#deepenTimer)
    this.#deepenTimer = setTimeout(() => { this.#deepenTimer = null; void this.#deepen() }, delay)
  }

  /** Moving the view is the request for BOTH: more levels, and the pictures
   *  of whatever just came into insight. Icons get the shorter delay — a tile
   *  arriving blank and filling in a beat later is the thing you notice. */
  readonly #onScroll = (): void => {
    this.#scheduleDeepen()
    if (this.#icons) this.#scheduleIcons(60)
  }

  /** Unresolved nodes inside (or just outside) the viewport. Reads the LAID
   *  OUT nodes, so a folded-away subtree is never resolved — folding is also
   *  how you tell the view to stop looking somewhere. */
  #frontierInView(): number[] {
    const mount = this.#mount
    const layout = this.#layout
    if (!mount || !layout) return []
    const z = this.#zoom
    const left = mount.host.scrollLeft - DEEPEN_MARGIN
    const right = mount.host.scrollLeft + mount.host.clientWidth + DEEPEN_MARGIN
    const top = mount.host.scrollTop - DEEPEN_MARGIN
    const bottom = mount.host.scrollTop + mount.host.clientHeight + DEEPEN_MARGIN

    const targets: number[] = []
    for (const node of layout.nodes) {
      if (node.walked || node.collapsed) continue
      const x = node.x * z
      const y = node.y * z + TOP_OFFSET + this.#topSlack
      if (x < left || x > right || y < top || y > bottom) continue
      targets.push(node.id)
      if (targets.length >= DEEPEN_BATCH) break
    }
    return targets
  }

  async #deepen(): Promise<void> {
    if (this.#walking || this.#expanding) return
    if (this.#vm()?.mode !== TREE_VIEW) return
    const mount = this.#mount
    if (!mount || !this.#layout) return

    if (this.#nodes.length >= NODE_CEILING) {
      // Too much branch to draw whole. Say so once and point at the fix —
      // re-rooting further down — rather than silently drawing a fraction.
      if (!this.#ceilingHit) { this.#ceilingHit = true; this.#paintNotice() }
      return
    }

    const targets = this.#frontierInView()
    if (targets.length === 0) return

    const history = this.#history()
    const store = this.resolve<WalkStore>('store')
    if (!history || !store?.getResource) return

    const seq = this.#walkSeq
    this.#expanding = true
    this.#paintCrumb()
    try {
      const result = await expandNodes(this.#nodes, targets, history, store, {
        maxNodes: NODE_CEILING,
        cancelled: () => seq !== this.#walkSeq || this.#vm()?.mode !== TREE_VIEW,
      })
      if (seq !== this.#walkSeq || this.#vm()?.mode !== TREE_VIEW) return

      // New rows push the tree apart; hold whatever the eye was on still.
      const anchor = this.#anchor()
      this.#nodes = result.nodes
      this.#draw()
      this.#restoreAnchor(anchor)

      // Cascade until the viewport is fully resolved, then fall quiet.
      if (result.added > 0 || targets.length === DEEPEN_BATCH) this.#scheduleDeepen(60)
    } catch (err) {
      console.warn('[tree-view] deepening failed', err)
    } finally {
      if (seq === this.#walkSeq) {
        this.#expanding = false
        this.#paintCrumb()
      }
    }
  }

  /** The node nearest the viewport's vertical middle — the thing the reader
   *  is looking at, and the fixed point a re-layout must not move. */
  #anchor(): { id: number; y: number } | null {
    const mount = this.#mount
    const layout = this.#layout
    if (!mount || !layout || layout.nodes.length === 0) return null
    const middle =
      (mount.host.scrollTop + mount.host.clientHeight / 2 - TOP_OFFSET - this.#topSlack) / this.#zoom
    let best = layout.nodes[0]
    let bestDistance = Infinity
    for (const node of layout.nodes) {
      const distance = Math.abs(node.y - middle)
      if (distance < bestDistance) { bestDistance = distance; best = node }
    }
    return { id: best.id, y: best.y }
  }

  #restoreAnchor(anchor: { id: number; y: number } | null): void {
    const mount = this.#mount
    const layout = this.#layout
    if (!anchor || !mount || !layout) return
    const now = layout.nodes.find(n => n.id === anchor.id)
    if (!now) return
    mount.host.scrollTop = Math.max(0, mount.host.scrollTop + (now.y - anchor.y) * this.#zoom)
  }

  #mountShell(): void {
    const host = div(
      `position:fixed;inset:0;z-index:${Z_BASE};overflow:auto;background:${INK};` +
      `color:${TEXT};font-family:inherit;overscroll-behavior:contain;`,
    )
    host.id = 'hc-tree-view-host'
    // Opt out of the always-on hex wheel-zoom handler so the canvas scrolls.
    host.setAttribute('data-consumes-wheel', '')
    document.body.appendChild(host)

    const stage = div(`position:relative;padding-top:${TOOLBAR_H}px;`)
    const ringbar = div(
      `position:sticky;top:${TOOLBAR_H}px;height:${RINGBAR_H}px;z-index:2;` +
      `background:linear-gradient(${INK} 60%, rgba(11,15,20,0));pointer-events:none;`,
    )
    const svg = svgEl('svg', { xmlns: 'http://www.w3.org/2000/svg' })
    svg.style.cssText = 'display:block;'
    stage.appendChild(ringbar)
    stage.appendChild(svg)
    host.appendChild(stage)

    const { toolbar, filterInput, insightChip, insightMenu, ringsLabel, zoomLabel, crumb, iconsButton } =
      this.#buildToolbar()
    host.appendChild(toolbar)
    host.appendChild(insightMenu)

    // z-index 3: above the sticky ring bar (2), below the toolbar (4) — the
    // ring bar spans the whole canvas width and would otherwise paint over
    // the rail's own header.
    const rail = div(
      `position:fixed;top:${TOOLBAR_H}px;right:0;bottom:0;width:${RAIL_W}px;z-index:3;box-sizing:border-box;` +
      `background:rgba(11,15,20,0.94);border-left:1px solid ${BORDER};padding:20px;overflow:auto;` +
      'display:none;backdrop-filter:blur(6px);',
    )
    host.appendChild(rail)

    const status = div(
      'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);text-align:center;' +
      `color:${DIM};font-size:14px;line-height:1.7;max-width:460px;padding:24px 28px;` +
      `background:${PANEL};border:1px solid ${BORDER};border-radius:12px;display:none;`,
    )
    host.appendChild(status)

    const notice = div(
      `position:fixed;top:${TOOLBAR_H + 10}px;left:50%;transform:translateX(-50%);z-index:5;` +
      `display:none;align-items:center;gap:14px;max-width:min(680px,92vw);box-sizing:border-box;` +
      `padding:12px 14px;border-radius:9px;background:rgba(11,15,20,0.96);` +
      `border:1px solid ${BORDER_LIT};box-shadow:0 8px 28px rgba(0,0,0,0.5);`,
    )
    host.appendChild(notice)

    host.addEventListener('wheel', this.#onWheel, { passive: false })
    host.addEventListener('pointerdown', this.#onPointerDown)
    host.addEventListener('scroll', this.#onScroll, { passive: true })

    this.#mount = {
      host, stage, ringbar, svg, status, notice, rail, filterInput,
      insightChip, insightMenu, ringsLabel, zoomLabel, crumb, iconsButton,
      nodeEls: new Map(), ribbonEls: new Map(), hexFills: new Map(), iconEls: new Map(),
    }
    this.#setViewActive(true)
    this.#paintIconsButton()
    void this.#loadInsights().then(() => this.#paintInsightChip())
  }

  #buildToolbar(): {
    toolbar: HTMLDivElement; filterInput: HTMLInputElement
    insightChip: HTMLDivElement; insightMenu: HTMLDivElement
    ringsLabel: HTMLSpanElement; zoomLabel: HTMLSpanElement; crumb: HTMLDivElement
    iconsButton: HTMLButtonElement
  } {
    const toolbar = div(
      `position:fixed;top:0;left:0;right:0;height:${TOOLBAR_H}px;z-index:4;box-sizing:border-box;` +
      `display:flex;align-items:center;gap:14px;padding:0 18px;background:rgba(11,15,20,0.92);` +
      `border-bottom:1px solid ${BORDER};backdrop-filter:blur(8px);`,
    )

    const title = div(`font-size:13px;font-weight:700;letter-spacing:0.14em;color:${STEEL};flex:none;`, 'TREE')
    const crumb = div(`font-size:13px;color:${DIM};flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;`)

    const filterInput = document.createElement('input')
    filterInput.type = 'search'
    filterInput.placeholder = this.#t('tree.filter.placeholder', 'find in branch…')
    filterInput.style.cssText =
      `all:unset;box-sizing:border-box;width:180px;padding:6px 10px;border-radius:6px;font-size:12px;` +
      `color:${TEXT};background:${PANEL};border:1px solid ${BORDER};flex:none;`
    filterInput.addEventListener('input', () => this.#setFilter(filterInput.value))

    const ringsLabel = document.createElement('span')
    ringsLabel.style.cssText = `font-size:12px;color:${DIM};min-width:56px;text-align:center;`

    const zoomLabel = document.createElement('span')
    zoomLabel.style.cssText = `font-size:12px;color:${DIM};min-width:44px;text-align:center;`

    // Pictures off is a real escape hatch, not a preference: a branch of
    // thousands with a cold thumbnail pool is the one case where drawing
    // tiles costs more than it tells you.
    const iconsButton = this.#button('⬡', this.#t('tree.icons.toggle', 'Tile pictures'), () => {
      this.#icons = !this.#icons
      this.#paintIconsButton()
      this.#draw()
    })
    // #button's hover handlers reset to the idle colours on leave; re-assert
    // the on/off state afterwards so the toggle doesn't lose its lit look.
    iconsButton.addEventListener('mouseleave', () => this.#paintIconsButton())

    // The insight chip: the name of the fragment being cut, and the way to
    // start one. Sits ahead of the view controls because naming comes first.
    const insightChip = div(
      'display:flex;align-items:center;gap:8px;flex:none;padding:5px 10px;border-radius:7px;' +
      `border:1px solid ${BORDER};background:${PANEL};cursor:pointer;max-width:260px;`,
    )
    const insightMenu = div(
      `position:fixed;top:${TOOLBAR_H + 4}px;z-index:6;display:none;min-width:220px;max-height:60vh;` +
      `overflow:auto;padding:6px;border-radius:9px;background:rgba(11,15,20,0.97);` +
      `border:1px solid ${BORDER_LIT};box-shadow:0 10px 30px rgba(0,0,0,0.55);`,
    )

    toolbar.append(
      title, crumb, insightChip, filterInput,
      this.#group([
        this.#button('−', this.#t('tree.rings.fewer', 'Fewer rings'), () => this.#setRings(this.#rings - 1)),
        ringsLabel,
        this.#button('+', this.#t('tree.rings.more', 'More rings'), () => this.#setRings(this.#rings + 1)),
      ]),
      this.#group([iconsButton]),
      this.#group([
        this.#button('－', this.#t('tree.zoom.out', 'Zoom out'), () => this.#setZoom(this.#zoom / 1.25)),
        zoomLabel,
        this.#button('＋', this.#t('tree.zoom.in', 'Zoom in'), () => this.#setZoom(this.#zoom * 1.25)),
        this.#button('⤢', this.#t('tree.zoom.fit', 'Fit branch'), () => this.#fit()),
      ]),
      this.#button('⬡ ' + this.#t('tree.exit', 'back to the hive'),
        this.#t('tree.exit', 'back to the hive'), () => this.#vm()?.setMode('hexagons'), true),
    )
    return { toolbar, filterInput, insightChip, insightMenu, ringsLabel, zoomLabel, crumb, iconsButton }
  }

  #paintIconsButton(): void {
    const button = this.#mount?.iconsButton
    if (!button) return
    button.style.color = this.#icons ? STEEL : DIM
    button.style.background = this.#icons ? 'rgba(126,182,214,0.12)' : 'transparent'
  }

  #group(children: HTMLElement[]): HTMLDivElement {
    const wrap = div(
      `display:flex;align-items:center;gap:2px;flex:none;padding:2px;border-radius:7px;` +
      `border:1px solid ${BORDER};background:${PANEL};`,
    )
    wrap.append(...children)
    return wrap
  }

  #button(label: string, title: string, onClick: () => void, outlined = false): HTMLButtonElement {
    const button = document.createElement('button')
    button.type = 'button'
    button.title = title
    button.textContent = label
    button.style.cssText =
      `all:unset;cursor:pointer;flex:none;font-size:12px;line-height:1;color:${DIM};` +
      `padding:7px 10px;border-radius:6px;text-align:center;` +
      (outlined ? `border:1px solid ${BORDER};` : '')
    button.addEventListener('click', onClick)
    button.addEventListener('mouseenter', () => {
      button.style.color = TEXT
      button.style.background = 'rgba(126,182,214,0.12)'
    })
    button.addEventListener('mouseleave', () => {
      button.style.color = DIM
      button.style.background = 'transparent'
    })
    return button
  }

  // ── draw ───────────────────────────────────────────────────

  #draw(): void {
    const mount = this.#mount
    if (!mount) return

    mount.ringsLabel.textContent = this.#t('tree.rings.count', '{n} rings', { n: this.#rings })
    mount.zoomLabel.textContent = `${Math.round(this.#zoom * 100)}%`
    this.#paintCrumb()
    this.#paintNotice()

    if (this.#walking) return
    if (this.#nodes.length === 0) {
      mount.svg.replaceChildren()
      mount.ringbar.replaceChildren()
      this.#status(this.#walkError
        ? this.#t('tree.status.error', 'Could not read that branch — {reason}', { reason: this.#walkError })
        : this.#t('tree.status.empty', 'Nothing grows here yet.'))
      return
    }
    this.#status(null)

    const layout = layoutTree(this.#nodes, this.#collapsed, this.#icons ? ROW_GAP_ICONS : ROW_GAP)
    this.#layout = layout
    this.#paintRingBar(layout)
    this.#paintCanvas(layout)
    this.#applyEmphasis()
    this.#paintRail()
    if (this.#icons) this.#scheduleIcons()
  }

  // ── tile pictures ──────────────────────────────────────────
  //
  // Same discipline as the deepening: only what is on screen is fetched, and
  // everything is cached by signature so a shared picture is read once for
  // the whole tree. A node without a picture keeps its limb-coloured hex, so
  // nothing moves when one arrives — pictures fade in, the layout does not
  // reflow.

  #scheduleIcons(delay = 90): void {
    if (this.#iconTimer) clearTimeout(this.#iconTimer)
    this.#iconTimer = setTimeout(() => { this.#iconTimer = null; void this.#loadIcons() }, delay)
  }

  async #loadIcons(): Promise<void> {
    if (!this.#icons || this.#iconsLoading) return
    const mount = this.#mount
    const layout = this.#layout
    if (!mount || !layout) return
    const store = this.resolve<IconStore>('store')
    if (!store?.getResource) return

    // Paint from cache FIRST, every pass. Fetching and painting are separate
    // concerns: a node whose picture some other tile already fetched has
    // nothing to load but everything to show, and a repaint clears the icon
    // elements while the cache keeps the pictures. Driving paint off "did
    // this load return new bytes" left both cases blank.
    this.#applyCachedIcons()

    const wanted = this.#iconsInView(layout, mount).slice(0, this.#iconCache.capacity)
    if (wanted.length === 0) return

    this.#iconsLoading = true
    try {
      await Promise.all(
        wanted.map(node => this.#iconCache.load(node.propsSig as string, store).catch(() => false)),
      )
    } finally {
      this.#iconsLoading = false
    }
    if (this.#vm()?.mode !== TREE_VIEW || !this.#mount) return
    this.#applyCachedIcons()
    this.#scheduleIcons(40)
  }

  /** Give every drawn node whose picture is in hand an image element. Cheap
   *  and idempotent — nodes that already have one are skipped. */
  #applyCachedIcons(): void {
    const mount = this.#mount
    const layout = this.#layout
    if (!mount || !layout) return
    for (const node of layout.nodes) {
      if (!node.propsSig || mount.iconEls.has(node.id)) continue
      if (this.#iconCache.iconFor(node.propsSig)) this.#applyIcon(node)
    }
  }

  #iconsInView(layout: TreeLayout, mount: Mount): PlacedNode[] {
    const z = this.#zoom
    const left = mount.host.scrollLeft - 200
    const right = mount.host.scrollLeft + mount.host.clientWidth + 200
    const top = mount.host.scrollTop - 200
    const bottom = mount.host.scrollTop + mount.host.clientHeight + 200

    const out: PlacedNode[] = []
    for (const node of layout.nodes) {
      if (!node.propsSig || this.#iconCache.settled(node.propsSig)) continue
      const x = node.x * z
      const y = node.y * z + TOP_OFFSET + this.#topSlack
      if (x < left || x > right || y < top || y > bottom) continue
      out.push(node)
    }
    return out
  }

  /** Swap a resolved picture into an already-drawn node. */
  #applyIcon(node: PlacedNode): void {
    const mount = this.#mount
    if (!mount) return
    const url = this.#iconCache.iconFor(node.propsSig)
    if (!url) return
    const group = mount.nodeEls.get(node.id)
    const fill = mount.hexFills.get(node.id)
    if (!group || !fill) return

    const isLeaf = node.childCount === 0
    const size = iconSize(node.depth, isLeaf)
    const height = nodeHeight(size, isLeaf)
    const image = svgEl('image', {
      x: node.x - size / 2, y: node.y - height / 2,
      width: size, height,
      preserveAspectRatio: 'xMidYMid slice',
      'clip-path': isLeaf ? 'url(#hc-tree-leaf)' : 'url(#hc-tree-hex)',
    })
    image.setAttribute('href', url)
    image.style.pointerEvents = 'none'
    // Behind the outline, in front of the flat fill it replaces.
    fill.style.opacity = '0'
    group.insertBefore(image, fill.nextSibling)
    mount.iconEls.set(node.id, image)
  }

  #paintRingBar(layout: TreeLayout): void {
    const mount = this.#mount
    if (!mount) return
    const z = this.#zoom
    mount.ringbar.replaceChildren()
    mount.ringbar.style.width = `${layout.width * z}px`

    // Header cells track their column, so they must narrow with it — at a
    // zoomed-out width a fixed 120px cell overlaps its neighbours.
    const cellWidth = Math.max(70, Math.min(120, Math.round(RING_GAP * z) - 10))

    for (const ring of layout.rings) {
      const focused = this.#ringFocus === ring.depth
      const cell = div(
        `position:absolute;top:6px;left:${(ring.x * z) - cellWidth / 2}px;width:${cellWidth}px;text-align:center;` +
        `font-size:11px;letter-spacing:0.08em;pointer-events:auto;cursor:pointer;` +
        `padding:3px 0;border-radius:5px;user-select:none;` +
        (focused
          ? `color:${TEXT};background:rgba(126,182,214,0.16);border:1px solid ${BORDER_LIT};`
          : `color:${FAINT};border:1px solid transparent;`),
      )
      cell.textContent = ring.depth === 0
        ? this.#t('tree.ring.trunk', 'TRUNK · {n}', { n: ring.count })
        : this.#t('tree.ring.label', 'RING {d} · {n}', { d: ring.depth, n: ring.count })
      cell.title = this.#t('tree.ring.hint', 'Focus this ring — everything else dims')
      cell.addEventListener('click', () => {
        this.#ringFocus = focused ? null : ring.depth
        this.#selected = null
        this.#draw()
      })
      mount.ringbar.appendChild(cell)
    }
  }

  #paintCanvas(layout: TreeLayout): void {
    const mount = this.#mount
    if (!mount) return
    const z = this.#zoom
    const svg = mount.svg

    svg.replaceChildren()
    mount.nodeEls.clear()
    mount.ribbonEls.clear()
    mount.hexFills.clear()
    mount.iconEls.clear()

    // The tile silhouette, declared once and referenced by every picture.
    const defs = svgEl('defs')
    const hexClip = svgEl('clipPath', { id: 'hc-tree-hex', clipPathUnits: 'objectBoundingBox' })
    hexClip.appendChild(svgEl('polygon', { points: HEX_CLIP_POINTS }))
    defs.appendChild(hexClip)
    const leafClip = svgEl('clipPath', { id: 'hc-tree-leaf', clipPathUnits: 'objectBoundingBox' })
    leafClip.appendChild(svgEl('path', { d: LEAF_CLIP_PATH }))
    defs.appendChild(leafClip)
    svg.appendChild(defs)

    svg.setAttribute('viewBox', `0 0 ${layout.width} ${layout.height}`)
    svg.setAttribute('width', String(layout.width * z))
    svg.setAttribute('height', String(layout.height * z))
    // Width only — the stage's height flows from the ring bar plus the svg,
    // and an explicit value that disagrees would desync the scrollbars.
    mount.stage.style.width = `${layout.width * z}px`

    // A branch shorter than the viewport gets centred rather than pinned to
    // the top edge — a two-tile tree hanging off the top reads as broken
    // rather than small. The slack is svg-only so the ring bar stays put,
    // and every coordinate conversion adds it back.
    const slack = Math.max(0, (mount.host.clientHeight - TOP_OFFSET - layout.height * z) / 2)
    this.#topSlack = slack
    svg.style.marginTop = `${slack}px`

    // Ring guides sit under everything — the column rhythm, barely there.
    const guides = svgEl('g')
    for (const ring of layout.rings) {
      guides.appendChild(svgEl('line', {
        x1: ring.x, y1: 0, x2: ring.x, y2: layout.height,
        stroke: this.#ringFocus === ring.depth ? 'rgba(126,182,214,0.16)' : 'rgba(126,182,214,0.05)',
        'stroke-width': this.#ringFocus === ring.depth ? 2 : 1,
      }))
    }
    svg.appendChild(guides)

    const ribbonLayer = svgEl('g')
    for (const ribbon of layout.ribbons) {
      const path = svgEl('path', {
        d: ribbon.d,
        fill: limbColor(ribbon.hue, ribbon.depth, 0.72),
        stroke: 'none',
      })
      path.style.transition = 'opacity 120ms ease'
      ribbonLayer.appendChild(path)
      mount.ribbonEls.set(ribbon.to, path)
    }
    svg.appendChild(ribbonLayer)

    const nodeLayer = svgEl('g')
    for (const node of layout.nodes) nodeLayer.appendChild(this.#nodeGroup(node))
    svg.appendChild(nodeLayer)
  }

  #nodeGroup(node: PlacedNode): SVGGElement {
    const mount = this.#mount as Mount
    const group = svgEl('g')
    group.style.cursor = 'pointer'
    group.style.transition = 'opacity 120ms ease'

    const color = limbColor(node.hue, node.depth)
    const hasChildren = node.childCount > 0
    const called = this.#isCalled(node.sig)
    // Half-width of whatever stands at the node — hex tile or plain marker.
    // Every ring, dot, label and hit box is measured from this, so the two
    // modes stay in proportion without a second set of numbers.
    // A childless node is the tip of the branch — it wears a leaf, not a
    // hexagon. The hex says "there is structure inside me"; a leaf is
    // exactly the node for which that is not true.
    const isLeaf = node.childCount === 0
    const size = this.#icons ? iconSize(node.depth, isLeaf) : node.radius * 2
    const markerExtent = size / 2

    // A branch called into the fragment wears a dashed steel ring — dashed so
    // it never reads as the solid selection halo it may sit inside.
    if (called) {
      group.appendChild(svgEl('circle', {
        cx: node.x, cy: node.y, r: markerExtent + 4.5,
        fill: 'none', stroke: STEEL, 'stroke-width': 1.5,
        'stroke-dasharray': '2 3', opacity: 0.95,
      }))
    }

    // Selection halo, drawn first so it reads as a glow behind the marker.
    if (this.#selected === node.id) {
      group.appendChild(svgEl('circle', {
        cx: node.x, cy: node.y, r: markerExtent + 7,
        fill: 'none', stroke: STEEL, 'stroke-width': 1.5, opacity: 0.9,
      }))
    }

    // Marker. With icons on, every node is a hex TILE — the same shape it is
    // on the canvas — filled with its limb colour until its picture arrives.
    // Reserving the tile whether or not a picture exists is what keeps the
    // layout still: an icon landing later never shifts a label.
    if (this.#icons) {
      const silhouette = isLeaf
        ? leafOutline(node.x, node.y, size)
        : hexOutline(node.x, node.y, size)
      const fill = svgEl('path', {
        d: silhouette,
        fill: node.collapsed ? INK : color,
        opacity: node.collapsed ? 1 : 0.9,
      })
      group.appendChild(fill)
      mount.hexFills.set(node.id, fill)
      // Outline last so it sits over whichever of fill/picture is showing.
      group.appendChild(svgEl('path', {
        d: silhouette,
        fill: 'none', stroke: color, 'stroke-width': node.collapsed ? 2 : 1.25,
        'stroke-linejoin': 'round',
      }))
      if (isLeaf) {
        group.appendChild(svgEl('path', {
          d: leafMidrib(node.x, node.y, size),
          stroke: INK, 'stroke-width': 1, opacity: 0.45, fill: 'none', 'stroke-linecap': 'round',
        }))
      }
    } else {
      group.appendChild(svgEl('circle', {
        cx: node.x, cy: node.y, r: node.radius,
        fill: node.collapsed ? INK : color,
        stroke: color,
        'stroke-width': node.collapsed ? 2 : 0,
      }))
    }

    // A node the walk stopped at still has hidden depth — mark it honestly.
    if (!node.walked && !node.collapsed) {
      group.appendChild(svgEl('circle', {
        cx: node.x + markerExtent + 7, cy: node.y, r: 1.6, fill: color, opacity: 0.8,
      }))
      group.appendChild(svgEl('circle', {
        cx: node.x + markerExtent + 12, cy: node.y, r: 1.6, fill: color, opacity: 0.5,
      }))
    }

    const label = svgEl('text', {
      x: node.x + markerExtent + (node.walked ? 9 : 18) + (called ? 4 : 0),
      y: node.y + 4,
      fill: called ? STEEL : (node.depth === 0 ? TEXT : color),
      'font-size': node.depth === 0 ? 15 : 13,
      'font-weight': called ? 700 : (node.depth === 0 ? 700 : (hasChildren ? 600 : 400)),
      'paint-order': 'stroke',
      stroke: INK,
      'stroke-width': 3.5,
      'stroke-linejoin': 'round',
    })
    label.style.pointerEvents = 'none'
    label.textContent = (called ? '✦ ' : '') + clipLabel(node.name)
    group.appendChild(label)

    // Counts ONLY on folded nodes. An open parent already shows its children
    // — printing the number next to every label put a digit in the gap where
    // the incoming limb and the previous column's label already are.
    if (node.collapsed) {
      const count = svgEl('text', {
        x: node.x - markerExtent - 6, y: node.y + 3.5,
        fill: color, 'font-size': 10, 'font-weight': 600, 'text-anchor': 'end',
        'paint-order': 'stroke', stroke: INK, 'stroke-width': 3, 'stroke-linejoin': 'round',
      })
      count.style.pointerEvents = 'none'
      count.textContent = `+${node.childCount}`
      group.appendChild(count)
    }

    // Generous invisible hit area — the markers are small by design.
    const hitHeight = Math.max(26, nodeHeight(size, isLeaf) + 4)
    const hit = svgEl('rect', {
      x: node.x - markerExtent - 10, y: node.y - hitHeight / 2,
      width: markerExtent + 10 + 190, height: hitHeight,
      fill: 'transparent',
    })
    group.appendChild(hit)

    group.addEventListener('click', (e) => {
      e.stopPropagation()
      // Meta/alt on a parent folds the subtree away without changing selection.
      if ((e.altKey || e.metaKey) && hasChildren) { this.#toggleCollapse(node.id); return }
      this.#select(node.id)
    })
    group.addEventListener('dblclick', (e) => {
      e.stopPropagation()
      if (hasChildren) this.#toggleCollapse(node.id)
    })
    group.addEventListener('mouseenter', () => { this.#hovered = node.id; this.#applyEmphasis() })
    group.addEventListener('mouseleave', () => { this.#hovered = null; this.#applyEmphasis() })

    mount.nodeEls.set(node.id, group)
    return group
  }

  // ── emphasis (hover path / ring focus / filter) ────────────

  /** Ids to keep lit, or null when nothing is dimmed. Ancestors always ride
   *  along: a highlighted twig with an invisible limb reads as floating. */
  #emphasis(): Set<number> | null {
    const layout = this.#layout
    if (!layout) return null
    const byId = new Map(layout.nodes.map(n => [n.id, n]))
    const lit = new Set<number>()
    let active = false

    const light = (id: number): void => {
      const node = byId.get(id)
      if (!node) return
      lit.add(id)
      for (const ancestor of node.ancestry) lit.add(ancestor)
    }

    const needle = this.#filter.trim().toLowerCase()
    if (needle) {
      active = true
      for (const node of layout.nodes) {
        if (node.name.toLowerCase().includes(needle) || node.sig.startsWith(needle)) light(node.id)
      }
    } else if (this.#ringFocus !== null) {
      active = true
      for (const node of layout.nodes) if (node.depth === this.#ringFocus) light(node.id)
    }

    if (this.#hovered !== null) { active = true; light(this.#hovered) }
    if (this.#selected !== null) light(this.#selected)

    return active ? lit : null
  }

  #applyEmphasis(): void {
    const mount = this.#mount
    if (!mount) return
    const lit = this.#emphasis()
    for (const [id, el] of mount.nodeEls) {
      el.style.opacity = !lit || lit.has(id) ? '1' : '0.16'
    }
    for (const [id, el] of mount.ribbonEls) {
      el.style.opacity = !lit || lit.has(id) ? '1' : '0.08'
    }
  }

  // ── interaction ────────────────────────────────────────────

  #select(id: number): void {
    this.#selected = this.#selected === id ? null : id
    this.#ringFocus = null
    this.#draw()
  }

  #toggleCollapse(id: number): void {
    if (this.#collapsed.has(id)) this.#collapsed.delete(id)
    else this.#collapsed.add(id)
    this.#draw()
    // Unfolding exposes new frontier; folding frees the viewport for other
    // branches to resolve into.
    this.#scheduleDeepen()
  }

  #setFilter(value: string): void {
    this.#filter = value
    if (this.#mount && this.#mount.filterInput.value !== value) this.#mount.filterInput.value = value
    this.#applyEmphasis()
  }

  #setRings(next: number): void {
    const clamped = Math.max(1, Math.min(MAX_RINGS, next))
    if (clamped === this.#rings) return
    this.#rings = clamped
    this.#dataKey = ''
    this.#sync()
  }

  /** Zoom about the viewport centre so the branch under the eye stays there. */
  #setZoom(next: number, anchor?: { x: number; y: number }): void {
    const mount = this.#mount
    const layout = this.#layout
    if (!mount || !layout) return
    const clamped = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, next))
    if (Math.abs(clamped - this.#zoom) < 0.001) return

    const host = mount.host
    const ax = anchor?.x ?? host.clientWidth / 2
    const ay = anchor?.y ?? host.clientHeight / 2
    const contentX = (host.scrollLeft + ax) / this.#zoom
    const contentY = (host.scrollTop + ay - TOP_OFFSET - this.#topSlack) / this.#zoom

    this.#zoom = clamped
    this.#draw()
    host.scrollLeft = Math.max(0, contentX * clamped - ax)
    host.scrollTop = Math.max(0, contentY * clamped + TOP_OFFSET + this.#topSlack - ay)
    // Zooming out brings more of the tree into view — resolve what arrived.
    this.#scheduleDeepen()
  }

  /**
   * Fit the branch ACROSS: every ring on screen at once, scrolling for
   * depth. Fitting both axes is the obvious move and the wrong one — a real
   * hive is far taller than it is wide, so height-fitting collapses the whole
   * tree to an illegible smear. The canvas is meant to be bigger than the
   * screen; what must not be cut is the column structure. The floor keeps
   * labels readable even when a very wide branch would rather not fit.
   */
  #fit(): void {
    const mount = this.#mount
    const layout = this.#layout
    if (!mount || !layout || layout.width === 0 || layout.height === 0) return
    const availableWidth = mount.host.clientWidth - (this.#selected !== null ? RAIL_W : 0) - 32
    const scale = Math.max(FIT_FLOOR, Math.min(FIT_CEILING, availableWidth / layout.width))
    this.#zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, scale))
    this.#draw()
    mount.host.scrollLeft = 0
    this.#centerOnTrunk()
  }

  /** Park the trunk at the vertical middle — where a side-on tree is read
   *  from. Without this a tall branch opens on empty canvas above the root. */
  #centerOnTrunk(): void {
    const mount = this.#mount
    const layout = this.#layout
    if (!mount || !layout) return
    const trunk = layout.nodes.find(n => n.parent < 0)
    if (!trunk) return
    mount.host.scrollTop = Math.max(0,
      TOP_OFFSET + this.#topSlack + trunk.y * this.#zoom - mount.host.clientHeight / 2)
  }

  readonly #onWheel = (e: WheelEvent): void => {
    if (!e.ctrlKey && !e.metaKey) return  // plain wheel scrolls the canvas
    e.preventDefault()
    const host = this.#mount?.host
    if (!host) return
    const rect = host.getBoundingClientRect()
    this.#setZoom(this.#zoom * (e.deltaY < 0 ? 1.12 : 1 / 1.12), {
      x: e.clientX - rect.left, y: e.clientY - rect.top,
    })
  }

  /** Drag the empty canvas to pan — grab-and-throw, no scrollbar hunting. */
  readonly #onPointerDown = (e: PointerEvent): void => {
    const mount = this.#mount
    if (!mount) return
    const target = e.target as Element | null
    // Any press outside the insight menu closes it, including one that goes
    // on to pan the canvas.
    if (mount.insightMenu.style.display === 'block' &&
        !mount.insightMenu.contains(target) && !mount.insightChip.contains(target)) {
      mount.insightMenu.style.display = 'none'
    }
    const onCanvas = target === mount.svg || target === mount.stage || target === mount.host
    if (!onCanvas && e.button !== 1) return

    e.preventDefault()
    const startX = e.clientX
    const startY = e.clientY
    const startLeft = mount.host.scrollLeft
    const startTop = mount.host.scrollTop
    let moved = false
    mount.host.style.cursor = 'grabbing'

    const move = (ev: PointerEvent): void => {
      const dx = ev.clientX - startX
      const dy = ev.clientY - startY
      if (!moved && Math.hypot(dx, dy) > 3) moved = true
      mount.host.scrollLeft = startLeft - dx
      mount.host.scrollTop = startTop - dy
    }
    const up = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      mount.host.style.cursor = ''
      // A click on bare canvas (no drag) clears the current focus.
      if (!moved && (this.#selected !== null || this.#ringFocus !== null)) {
        this.#selected = null
        this.#ringFocus = null
        this.#draw()
      }
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  // ── rail ───────────────────────────────────────────────────

  #paintRail(): void {
    const mount = this.#mount
    const layout = this.#layout
    if (!mount || !layout) return
    mount.rail.replaceChildren()

    const node = this.#selected !== null ? layout.nodes.find(n => n.id === this.#selected) : undefined
    if (!node && this.#ringFocus === null) { mount.rail.style.display = 'none'; return }
    mount.rail.style.display = 'block'

    if (node) this.#paintNodeRail(mount.rail, node)
    else this.#paintRingRail(mount.rail, layout)
  }

  #paintNodeRail(rail: HTMLDivElement, node: PlacedNode): void {
    const color = limbColor(node.hue, node.depth)
    rail.appendChild(div(
      `font-size:10px;letter-spacing:0.16em;color:${FAINT};margin-bottom:8px;`,
      node.depth === 0
        ? this.#t('tree.ring.trunk.bare', 'TRUNK')
        : this.#t('tree.rail.ring', 'RING {d}', { d: node.depth }),
    ))
    rail.appendChild(div(
      `font-size:19px;font-weight:700;color:${color};margin-bottom:16px;word-break:break-word;`,
      node.name,
    ))

    rail.appendChild(this.#field(this.#t('tree.rail.path', 'Path'),
      node.segments
        ? (node.segments.length ? '/' + node.segments.join('/') : '/')
        : this.#t('tree.rail.nopath', 'reached by signature — no path from here')))

    const isLocationSig = node.depth === 0 && this.#rootSigIsLocation
    rail.appendChild(this.#field(
      isLocationSig ? this.#t('tree.rail.location', 'Location signature') : this.#t('tree.rail.layer', 'Layer signature'),
      node.sig, true,
    ))

    const stats = [
      this.#plural('tree.rail.children', node.childCount, '{n} child', '{n} children'),
      this.#plural('tree.rail.leaves', node.leaves, '{n} tip drawn', '{n} tips drawn'),
    ]
    if (!node.walked) stats.push(this.#t('tree.rail.deeper', 'deeper rings not walked'))
    rail.appendChild(this.#field(this.#t('tree.rail.holds', 'Holds'), stats.join(' · ')))

    const actions = div('display:flex;flex-direction:column;gap:8px;margin-top:20px;')

    // Calling comes first — it is the point of having a node selected while a
    // fragment is open.
    if (this.#insight) {
      const called = this.#isCalled(node.sig)
      actions.appendChild(this.#railButton(
        called
          ? this.#t('tree.action.uncall', 'Remove from “{name}”', { name: this.#insight.name })
          : this.#t('tree.action.call', 'Call into “{name}”', { name: this.#insight.name }),
        () => void this.#toggleCall(node.sig),
        !called,
      ))
    } else {
      actions.appendChild(this.#railButton(
        this.#t('tree.action.nameFragment', 'Name a fragment to call this into'),
        () => this.#promptInsightName(),
      ))
    }

    actions.appendChild(this.#railButton(
      this.#t('tree.action.focus', 'Grow the tree from here'),
      () => this.setRoot(node.segments ? { segments: node.segments, label: node.name } : { sig: node.sig, label: node.name }),
      true,
    ))
    if (node.childCount > 0) {
      actions.appendChild(this.#railButton(
        node.collapsed ? this.#t('tree.action.expand', 'Unfold this branch') : this.#t('tree.action.collapse', 'Fold this branch away'),
        () => this.#toggleCollapse(node.id),
      ))
    }
    if (node.segments) {
      actions.appendChild(this.#railButton(
        this.#t('tree.action.open', 'Open in the hive'),
        () => this.#navigate(node.segments as readonly string[]),
      ))
    }
    actions.appendChild(this.#railButton(
      this.#t('tree.action.copySig', 'Copy signature'),
      () => void this.#copy(node.sig, this.#t('tree.copied.sig', 'Signature copied')),
    ))
    rail.appendChild(actions)
  }

  #paintRingRail(rail: HTMLDivElement, layout: TreeLayout): void {
    const depth = this.#ringFocus as number
    const ring = layout.nodes.filter(n => n.depth === depth)
    rail.appendChild(div(
      `font-size:10px;letter-spacing:0.16em;color:${FAINT};margin-bottom:8px;`,
      this.#t('tree.rail.ringHeader', 'RING FOCUS'),
    ))
    rail.appendChild(div(
      `font-size:19px;font-weight:700;color:${TEXT};margin-bottom:6px;`,
      this.#t('tree.rail.ringTitle', 'Ring {d}', { d: depth }),
    ))
    rail.appendChild(div(
      `font-size:13px;color:${DIM};line-height:1.6;margin-bottom:18px;`,
      this.#t('tree.rail.ringBody',
        '{n} tiles sit at this depth. Every one of them is a signature you can hand to another tool as input.',
        { n: ring.length }),
    ))

    const list = div(
      `max-height:44vh;overflow:auto;border:1px solid ${BORDER};border-radius:8px;padding:8px;background:${PANEL};`,
    )
    for (const node of ring.slice(0, 200)) {
      const row = div(
        `display:flex;align-items:center;gap:8px;padding:5px 6px;border-radius:5px;cursor:pointer;` +
        `font-size:12px;color:${DIM};`,
      )
      const dot = div(`width:7px;height:7px;border-radius:50%;flex:none;background:${limbColor(node.hue, node.depth)};`)
      const name = div('overflow:hidden;text-overflow:ellipsis;white-space:nowrap;', node.name)
      row.append(dot, name)
      row.addEventListener('mouseenter', () => { row.style.background = 'rgba(126,182,214,0.10)'; row.style.color = TEXT })
      row.addEventListener('mouseleave', () => { row.style.background = 'transparent'; row.style.color = DIM })
      row.addEventListener('click', () => this.#select(node.id))
      list.appendChild(row)
    }
    if (ring.length > 200) {
      list.appendChild(div(`padding:6px;font-size:11px;color:${FAINT};`,
        this.#t('tree.rail.ringMore', '…and {n} more', { n: ring.length - 200 })))
    }
    rail.appendChild(list)

    const actions = div('display:flex;flex-direction:column;gap:8px;margin-top:16px;')
    actions.appendChild(this.#railButton(
      this.#t('tree.action.copyRing', 'Copy this ring’s signatures'),
      () => void this.#copy(ring.map(n => n.sig).join('\n'),
        this.#t('tree.copied.ring', '{n} signatures copied', { n: ring.length })),
      true,
    ))
    actions.appendChild(this.#railButton(
      this.#t('tree.action.clearRing', 'Clear ring focus'),
      () => { this.#ringFocus = null; this.#draw() },
    ))
    rail.appendChild(actions)
  }

  #field(label: string, value: string, mono = false): HTMLDivElement {
    const wrap = div('margin-bottom:14px;')
    wrap.appendChild(div(`font-size:10px;letter-spacing:0.12em;color:${FAINT};margin-bottom:4px;`, label.toUpperCase()))
    wrap.appendChild(div(
      `font-size:12px;color:${DIM};line-height:1.6;word-break:break-all;` +
      (mono ? 'font-family:var(--md-font-mono,ui-monospace,monospace);' : ''),
      value,
    ))
    return wrap
  }

  #railButton(label: string, onClick: () => void, primary = false): HTMLButtonElement {
    const button = document.createElement('button')
    button.type = 'button'
    button.textContent = label
    button.style.cssText =
      'all:unset;cursor:pointer;box-sizing:border-box;text-align:center;padding:9px 12px;' +
      'border-radius:6px;font-size:12px;font-weight:600;' +
      (primary
        ? `color:${INK};background:${STEEL};`
        : `color:${DIM};border:1px solid ${BORDER};`)
    button.addEventListener('click', onClick)
    button.addEventListener('mouseenter', () => { if (!primary) button.style.color = TEXT })
    button.addEventListener('mouseleave', () => { if (!primary) button.style.color = DIM })
    return button
  }

  // ── odds and ends ──────────────────────────────────────────

  // ── insight chrome ─────────────────────────────────────────

  #paintInsightChip(): void {
    const mount = this.#mount
    if (!mount) return
    const chip = mount.insightChip
    chip.replaceChildren()
    chip.onclick = null

    const saved = Object.keys(this.#insights).length

    if (!this.#insight) {
      const label = div(`font-size:12px;color:${DIM};white-space:nowrap;`)
      label.textContent = '✦ ' + this.#t('tree.insight.start', 'name this view')
      chip.appendChild(label)
      chip.style.borderColor = BORDER
      chip.onclick = () => this.#promptInsightName()
    } else {
      const dot = div(`width:7px;height:7px;border-radius:50%;flex:none;background:${STEEL};`)
      const label = div(
        `font-size:12px;font-weight:600;color:${TEXT};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;`,
      )
      label.textContent = this.#insight.name
      const count = div(`font-size:11px;color:${DIM};flex:none;`)
      count.textContent = this.#plural(
        'tree.insight.calls', this.#insight.calls.length, '{n} branch', '{n} branches')
      chip.append(dot, label, count)
      chip.style.borderColor = BORDER_LIT
      chip.onclick = () => this.#toggleInsightMenu()
    }

    if (saved > 0 && !this.#insight) {
      const open = div(`font-size:11px;color:${FAINT};flex:none;border-left:1px solid ${BORDER};padding-left:8px;`)
      open.textContent = String(saved)
      open.title = this.#t('tree.insight.saved', 'Saved insights')
      chip.appendChild(open)
      chip.onclick = () => this.#toggleInsightMenu()
    }
  }

  /** Naming is the first move, so the chip becomes the field in place —
   *  no dialog, no mode, type and press enter. */
  #promptInsightName(): void {
    const mount = this.#mount
    if (!mount) return
    const chip = mount.insightChip
    chip.replaceChildren()
    chip.onclick = null
    chip.style.borderColor = BORDER_LIT

    const input = document.createElement('input')
    input.type = 'text'
    input.placeholder = this.#t('tree.insight.placeholder', 'name this insight…')
    input.style.cssText = `all:unset;width:180px;font-size:12px;color:${TEXT};`
    const commit = (): void => {
      const value = input.value.trim()
      if (!value) { this.#paintInsightChip(); return }
      if (!isValidInsightName(value)) {
        EffectBus.emit('activity:log', {
          message: this.#t('tree.insight.badName', 'Insight names are letters, numbers, spaces, . _ -'),
          icon: '✦',
        })
        return
      }
      void this.beginInsight(value)
    }
    input.addEventListener('keydown', (e) => {
      e.stopPropagation()
      if (e.key === 'Enter') { e.preventDefault(); commit() }
      else if (e.key === 'Escape') { e.preventDefault(); this.#paintInsightChip() }
    })
    input.addEventListener('blur', () => { if (!this.#insight) this.#paintInsightChip() })
    chip.appendChild(input)
    input.focus()
  }

  #toggleInsightMenu(): void {
    const mount = this.#mount
    if (!mount) return
    const menu = mount.insightMenu
    if (menu.style.display === 'block') { menu.style.display = 'none'; return }

    menu.replaceChildren()
    const names = Object.keys(this.#insights).sort()

    const header = div(`font-size:10px;letter-spacing:0.14em;color:${FAINT};padding:6px 8px;`)
    header.textContent = this.#t('tree.insight.header', 'INSIGHTS')
    menu.appendChild(header)

    if (names.length === 0) {
      menu.appendChild(div(`font-size:12px;color:${DIM};padding:6px 8px;`,
        this.#t('tree.insight.none', 'No insights yet.')))
    }

    for (const name of names) {
      const insight = this.#insights[name]
      const active = this.#insight?.name === name
      const row = div(
        `display:flex;align-items:center;gap:8px;padding:7px 8px;border-radius:5px;cursor:pointer;` +
        `font-size:12px;color:${active ? TEXT : DIM};` + (active ? 'background:rgba(126,182,214,0.12);' : ''),
      )
      const label = div('flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;', name)
      const count = div(`font-size:11px;color:${FAINT};flex:none;`, String(insight.calls.length))
      const remove = document.createElement('button')
      remove.type = 'button'
      remove.textContent = '×'
      remove.title = this.#t('tree.insight.delete', 'Forget this insight')
      remove.style.cssText = `all:unset;cursor:pointer;flex:none;color:${FAINT};padding:0 4px;`
      remove.addEventListener('click', (e) => {
        e.stopPropagation()
        void this.#forgetInsight(name)
      })
      row.append(label, count, remove)
      row.addEventListener('mouseenter', () => { row.style.background = 'rgba(126,182,214,0.12)' })
      row.addEventListener('mouseleave', () => {
        row.style.background = active ? 'rgba(126,182,214,0.12)' : 'transparent'
      })
      row.addEventListener('click', () => {
        menu.style.display = 'none'
        void this.openInsight(name)
      })
      menu.appendChild(row)
    }

    const fresh = div(
      `font-size:12px;color:${STEEL};padding:7px 8px;border-top:1px solid ${BORDER};` +
      'margin-top:4px;cursor:pointer;',
      '✦ ' + this.#t('tree.insight.new', 'Start a new insight'),
    )
    fresh.addEventListener('click', () => {
      menu.style.display = 'none'
      this.#insight = null
      this.#promptInsightName()
    })
    menu.appendChild(fresh)

    const box = mount.insightChip.getBoundingClientRect()
    menu.style.left = `${Math.round(box.left)}px`
    menu.style.display = 'block'
  }

  async #forgetInsight(name: string): Promise<void> {
    this.#insights = await deleteInsight(this.#store() as InsightStore, name)
    if (this.#insight?.name === name) this.#insight = null
    this.#paintInsightChip()
    if (this.#mount) this.#mount.insightMenu.style.display = 'none'
    this.#draw()
  }

  #paintCrumb(): void {
    if (this.#mount) this.#mount.crumb.textContent = this.#crumbText()
  }

  #crumbText(): string {
    const where = this.#root.sig
      ? this.#root.label ?? `${this.#root.sig.slice(0, 12)}…`
      : (this.#root.segments?.length ? '/' + this.#root.segments.join('/') : '/')
    const counts = this.#nodes.length
      ? this.#plural('tree.crumb.counts', this.#nodes.length, '{n} tile', '{n} tiles')
      : ''
    // The depth budget is not a defect to report — the tree resolves as you
    // move. Only say something while it is actively resolving.
    const state = this.#expanding ? this.#t('tree.crumb.deepening', 'resolving…') : ''
    return [where, counts, state].filter(Boolean).join('  ·  ')
  }

  /** Shown once the branch outgrows what can be drawn whole. There is no
   *  condensed mode by design — the honest answer is "start further down",
   *  and the rail's re-root action is exactly that. */
  #paintNotice(): void {
    const mount = this.#mount
    if (!mount) return
    if (!this.#ceilingHit || this.#noticeDismissed) { mount.notice.style.display = 'none'; return }
    if (mount.notice.style.display === 'flex') return

    mount.notice.replaceChildren()
    mount.notice.style.display = 'flex'

    const text = div(`font-size:12px;line-height:1.5;color:${TEXT};flex:1;`)
    text.textContent = this.#t('tree.notice.tooBig',
      'This branch is bigger than the view can draw whole ({n} tiles so far). Pick a branch further down and grow the tree from there.',
      { n: this.#nodes.length })

    const dismiss = document.createElement('button')
    dismiss.type = 'button'
    dismiss.textContent = this.#t('tree.notice.dismiss', 'got it')
    dismiss.style.cssText =
      `all:unset;cursor:pointer;flex:none;font-size:12px;font-weight:600;color:${INK};` +
      `background:${STEEL};padding:6px 12px;border-radius:5px;`
    dismiss.addEventListener('click', () => {
      this.#noticeDismissed = true
      this.#paintNotice()
    })

    mount.notice.append(text, dismiss)
  }

  #status(message: string | null): void {
    const status = this.#mount?.status
    if (!status) return
    if (!message) { status.style.display = 'none'; return }
    status.textContent = message
    status.style.display = 'block'
  }

  async #copy(text: string, toast: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text)
      EffectBus.emit('activity:log', { message: toast, icon: '⌥' })
    } catch {
      EffectBus.emit('activity:log', { message: this.#t('tree.copied.failed', 'Clipboard refused the copy'), icon: '⌥' })
    }
  }

  /** Traveling means leaving the view — hexagons first, then go. */
  #navigate(segments: readonly string[]): void {
    this.#vm()?.setMode('hexagons')
    window.ioc?.get<NavigationShape>('@hypercomb.social/Navigation')?.goRaw([...segments])
  }

  #teardown(): void {
    if (this.#refreshTimer) { clearTimeout(this.#refreshTimer); this.#refreshTimer = null }
    if (this.#deepenTimer) { clearTimeout(this.#deepenTimer); this.#deepenTimer = null }
    if (this.#iconTimer) { clearTimeout(this.#iconTimer); this.#iconTimer = null }
    if (this.#mount) {
      this.#mount.host.removeEventListener('wheel', this.#onWheel)
      this.#mount.host.removeEventListener('pointerdown', this.#onPointerDown)
      this.#mount.host.removeEventListener('scroll', this.#onScroll)
      this.#mount.host.remove()
      this.#mount = null
    }
    if (this.#viewActive) this.#setViewActive(false)
  }

  #setViewActive(active: boolean): void {
    if (this.#viewActive === active) return
    this.#viewActive = active
    // Owner-counted, not a raw boolean: a modal closing on top of this view
    // must not unhide the chrome while the tree is still up.
    const modes = window.ioc?.get<ModeRegistryShape>('@diamondcoreprocessor.com/ModeRegistry')
    if (active) modes?.enter('view:active', 'tree-view')
    else modes?.exit('view:active', 'tree-view')
  }
}

/** Parse a `/tree` argument into a root. Accepts a raw signature, a lineage
 *  path, or nothing (the current location). Names registered by `/branch`
 *  are resolved by the queen, which owns the registry. */
export function parseTreeTarget(raw: string): TreeRoot | null {
  const value = String(raw ?? '').trim()
  if (!value) return null
  if (SIG.test(value.toLowerCase())) return { sig: value.toLowerCase() }
  const segments = value.split('/').map(s => s.trim()).filter(Boolean)
  return { segments }
}

const _treeView = new TreeViewDrone()
window.ioc.register('@diamondcoreprocessor.com/TreeViewDrone', _treeView)
