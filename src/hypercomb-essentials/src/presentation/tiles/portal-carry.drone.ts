// presentation/tiles/portal-carry.drone.ts
//
// PortalCarryDrone — the DRAG HANDLE on tiles, and the way onto the QUICK
// TRAY (documentation/recents-and-the-quick-tray.md, codex A9). A plain click
// on the handle, or a drag let go anywhere, sends a REFERENCE to the tray at
// the top of the screen: the tile's name, the page it stands on, and the sig
// that page lists it by. Nothing is written — no cut, no marker; the source
// page is untouched until the tray's own drop says otherwise.
//
// The gesture it carried before is still here, one step later: a drag let go
// over a row of the Portals window adds the tile to that portal
// (`portal-carry:drop`, the aggregate index owns the write), and over the
// window itself stages it there. The tray's rows do the same, so the handle
// no longer has to be the only way into a portal — which is why it shows on
// every tile now, not only while the Portals window is up.
//
// Same choreography as EntrancePinDrone (the proven press-to-drag seam): the
// overlay emits `overlay:feature-press` when a pointer goes down on a visible
// feature icon; past the threshold a small DOM ghost rides the pointer. What
// a release MEANS is the pure `planHandleRelease` (portal-carry.plan.ts). On
// the band the handle is pinned to the LABEL row's left edge (`labelRow`) —
// beside the name, not in the icon flow.
//
// Essentials never imports shared: the contract with the tray and the index
// is the EffectBus payload + the `[data-portal-drop]` attribute.

import { Drone, EffectBus } from '@hypercomb/core'
import { childEntriesOf, type PlacementHistory } from '../../history/layer-placement.js'
import { planHandleRelease, takePayload } from './portal-carry.plan.js'

const LINEAGE_KEY = '@hypercomb.social/Lineage'
const HISTORY_KEY = '@diamondcoreprocessor.com/HistoryService'
const ACTION_NAME = 'portal-carry'
/** The icon registry mounts with the shell; a module that loads before it
 *  asks again shortly rather than never showing the handle. */
const REGISTRY_RETRY_MS = 200

type LineageLike = { explorerSegments?: () => readonly string[]; readonly domain?: unknown }

type FeaturePressPayload = {
  action?: string
  label?: string
  pointerId?: number
  clientX?: number
  clientY?: number
}

/** An armed press on the handle — a drag candidate until it passes the
 *  threshold, at which point it becomes a carry. */
type PressState = {
  pointerId: number
  startX: number
  startY: number
  label: string
  /** Captured at press time — the tile names itself even if navigation or a
   *  map rebuild happens under the drag. */
  segments: string[]
  dragging: boolean
  ghost: HTMLDivElement | null
}

/** Pointer travel (px) that turns a handle press into a carry drag. */
const DRAG_THRESHOLD_PX = 6

// drag_indicator — Material Icons Filled. Six dots: the universal drag handle.
const HANDLE_ICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="white"><path d="M11 18c0 1.1-.9 2-2 2s-2-.9-2-2 .9-2 2-2 2 .9 2 2zm-2-8c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0-6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm6 4c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/></svg>'

/** The shell-side icon registry contract (defined locally — essentials must
 *  not import shared). Same shape contact.drone.ts declares. */
type IconProviderRegistryLike = {
  add(p: {
    name: string
    owner?: string
    svgMarkup: string
    profiles?: readonly string[]
    defaultActive?: boolean
    featureRow?: boolean
    labelRow?: boolean
    hoverTint?: number
    labelKey?: string
    descriptionKey?: string
  }): void
  remove(name: string): void
}

export class PortalCarryDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'presentation'
  public override description =
    'Drag handle on tiles: a click or a drag sends a reference to the quick tray at the top; let go on a Portals-window row to add the tile to that portal.'

  protected override deps = {}
  protected override listens: string[] = ['overlay:feature-press', 'tile:action']
  protected override emits: string[] = ['quick-tray:take', 'portal-carry:drag-start', 'portal-carry:drop', 'portal-carry:drag-end']

  #initialized = false
  /** pointerId whose trailing click must be swallowed (a drag happened —
   *  the release must not run the icon's action or land as a tile press). */
  #consumedPointerId: number | null = null

  #press: PressState | null = null
  /** Whether the handle's icon provider is currently registered. */
  #handleShown = false
  #registryRetry: ReturnType<typeof setTimeout> | null = null

  protected override sense = () => true

  protected override heartbeat = async (): Promise<void> => {
    if (this.#initialized) return
    this.#initialized = true

    // The tray is always there to drop into, so the handle shows on every
    // tile from the start — a grab affordance with a surface to land on.
    this.#showHandle()

    this.onEffect<FeaturePressPayload>('overlay:feature-press', (p) => this.#onFeaturePress(p))
    // Plain click (no drag): the take. The overlay runs the icon's action on
    // the release; the same reference a drag would send goes to the tray.
    this.onEffect<{ action?: string; label?: string }>('tile:action', (p) => {
      if (p?.action === ACTION_NAME && p?.label) void this.#take(p.label, this.#here())
    })
    document.addEventListener('click', this.#onClickCapture, true)
  }

  protected override dispose(): void {
    document.removeEventListener('click', this.#onClickCapture, true)
    if (this.#registryRetry) { clearTimeout(this.#registryRetry); this.#registryRetry = null }
    this.#press?.ghost?.remove()
    this.#endPress()
    this.#setHandleShown(false)
  }

  /** The page the participant is standing on — a take's SOURCE. */
  #here(): string[] {
    const lineage = window.ioc.get<LineageLike>(LINEAGE_KEY)
    return (lineage?.explorerSegments?.() ?? []).map(s => String(s ?? '').trim()).filter(Boolean)
  }

  #showHandle(): void {
    this.#setHandleShown(true)
    if (this.#handleShown) return
    this.#registryRetry = setTimeout(() => { this.#registryRetry = null; this.#showHandle() }, REGISTRY_RETRY_MS)
  }

  /** THE TAKE. Sends the reference to the tray: the label, the source page,
   *  and — read, never written — the sig the source page lists the tile by,
   *  manifest-first through the parent's head. A cold parent sends the
   *  reference without a sig; the tray's drop seals the live subtree anyway,
   *  so nothing is lost but a thumbnail until then. */
  async #take(label: string, source: readonly string[]): Promise<void> {
    let sig: string | null = null
    try {
      const history = window.ioc.get<PlacementHistory>(HISTORY_KEY)
      const lineage = window.ioc.get<LineageLike>(LINEAGE_KEY)
      if (history) {
        const locSig = await history.sign({ domain: lineage?.domain, explorerSegments: () => source })
        const parent = locSig ? await history.currentLayerAt(locSig) : null
        if (parent) {
          const { entries } = await childEntriesOf(history, parent)
          sig = entries.find(e => e.name === label)?.sig ?? null
        }
      }
    } catch { /* cold — the reference still goes */ }
    this.emitEffect('quick-tray:take', takePayload(label, source, sig))
  }

  /** Add/remove the handle's icon provider through the ONE declarative
   *  extension point — no edit to tile-actions' core catalog. `featureRow`
   *  keeps the overlay's `overlay:feature-press` seam (the drag arm);
   *  `labelRow` pins the icon to the label row's left edge, beside the name,
   *  instead of the wrapping feature-row flow. */
  #setHandleShown(show: boolean): void {
    if (show === this.#handleShown) return
    const iconRegistry = (window as { ioc?: { get?: (k: string) => unknown } })
      .ioc?.get?.('@hypercomb.social/IconProviderRegistry') as IconProviderRegistryLike | undefined
    if (!iconRegistry) return
    this.#handleShown = show
    if (!show) {
      iconRegistry.remove(ACTION_NAME)
      return
    }
    iconRegistry.add({
      name: ACTION_NAME,
      owner: this.iocKey,
      svgMarkup: HANDLE_ICON_SVG,
      profiles: ['private', 'public-own'],
      defaultActive: true,
      featureRow: true,
      labelRow: true,
      hoverTint: 0xa8c8ff,
      labelKey: 'action.portal-carry',
      descriptionKey: 'action.portal-carry.description',
    })
  }

  #onFeaturePress(p: FeaturePressPayload): void {
    if (p?.action !== ACTION_NAME || !p?.label || typeof p.pointerId !== 'number') return
    const here = this.#here()
    this.#press?.ghost?.remove()
    this.#endPress()
    this.#press = {
      pointerId: p.pointerId,
      startX: p.clientX ?? 0, startY: p.clientY ?? 0,
      label: p.label,
      segments: [...here, p.label],
      dragging: false, ghost: null,
    }
    document.addEventListener('pointermove', this.#onPressMove)
    document.addEventListener('pointerup', this.#onPressUp)
    document.addEventListener('pointercancel', this.#onPressCancel)
  }

  #onPressMove = (e: PointerEvent): void => {
    const p = this.#press
    if (!p || e.pointerId !== p.pointerId) return
    if (!p.dragging) {
      const dx = e.clientX - p.startX
      const dy = e.clientY - p.startY
      if (dx * dx + dy * dy < DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX) return
      p.dragging = true
      // From here on the gesture is a DRAG: the trailing click must not run
      // the icon's action (or land as a tile press) when the pointer lets go.
      this.#consumedPointerId = p.pointerId
      p.ghost = this.#createGhost(p.label)
      // If the Portals window happens to be up, its rows light as drop zones;
      // the tray needs no opening — it is always there to land in.
      this.emitEffect('portal-carry:drag-start', { label: p.label, segments: [...p.segments] })
    }
    if (p.ghost) {
      p.ghost.style.left = `${e.clientX}px`
      p.ghost.style.top = `${e.clientY}px`
    }
  }

  #onPressUp = (e: PointerEvent): void => {
    const p = this.#press
    if (!p || e.pointerId !== p.pointerId) return
    this.#endPress()
    if (!p.dragging) return   // plain click — the overlay runs the action
    p.ghost?.remove()
    // Ghost is pointer-events:none, so elementFromPoint sees through it.
    const under = document.elementFromPoint(e.clientX, e.clientY)
    const plan = planHandleRelease({
      portalKey: under?.closest('[data-portal-drop]')?.getAttribute('data-portal-drop'),
      overIndex: !!under?.closest('hc-aggregate-index'),
    })
    if (plan.kind === 'portal') {
      this.emitEffect('portal-carry:drop', { label: p.label, segments: [...p.segments], targetKey: plan.targetKey })
    } else if (plan.kind === 'stage') {
      // The panel surface is a valid first half of the gesture: stage the
      // carried tile in the references window, whose + buttons name the
      // target pool explicitly, so the pool can be inspected before the
      // reference commits.
      this.emitEffect('portal-carry:drop', { label: p.label, segments: [...p.segments] })
    } else {
      // Let go anywhere else: the reference goes to the tray. `p.segments` is
      // the tile's own path; its SOURCE is the page above it.
      void this.#take(p.label, p.segments.slice(0, -1))
    }
    this.emitEffect('portal-carry:drag-end', {})
  }

  #onPressCancel = (e: PointerEvent): void => {
    const p = this.#press
    if (!p || e.pointerId !== p.pointerId) return
    this.#endPress()
    p.ghost?.remove()
    if (p.dragging) this.emitEffect('portal-carry:drag-end', {})
  }

  #onClickCapture = (e: MouseEvent): void => {
    if (this.#consumedPointerId === null) return
    this.#consumedPointerId = null
    e.preventDefault()
    e.stopPropagation()
  }

  #endPress(): void {
    this.#press = null
    document.removeEventListener('pointermove', this.#onPressMove)
    document.removeEventListener('pointerup', this.#onPressUp)
    document.removeEventListener('pointercancel', this.#onPressCancel)
  }

  /** Small drag ghost naming the tile it carries — quiet chrome, same language
   *  as the entrance-pin ghost, never a rendered tile. */
  #createGhost(label: string): HTMLDivElement {
    const ghost = document.createElement('div')
    ghost.style.cssText = [
      'position:fixed', 'z-index:2147483600', 'pointer-events:none',
      'max-width:14rem', 'padding:0.3rem 0.6rem', 'margin-left:0.8rem', 'margin-top:-0.9rem',
      'display:flex', 'align-items:center', 'gap:0.4rem',
      'border-radius:var(--hc-radius-floating, 4px)', 'white-space:nowrap', 'overflow:hidden', 'text-overflow:ellipsis',
      'background:rgba(12,28,46,.85)', 'border:1px solid rgba(126,182,214,.55)',
      'color:#eaf5fb', 'font-size:0.8rem', 'line-height:1.2',
    ].join(';')
    ghost.textContent = label
    document.body.appendChild(ghost)
    return ghost
  }
}

const _portalCarry = new PortalCarryDrone()
window.ioc.register('@diamondcoreprocessor.com/PortalCarryDrone', _portalCarry)
