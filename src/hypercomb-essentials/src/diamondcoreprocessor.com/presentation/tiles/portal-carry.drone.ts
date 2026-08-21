// diamondcoreprocessor.com/presentation/tiles/portal-carry.drone.ts
//
// PortalCarryDrone — a DRAG HANDLE on tiles: pull it and drop the tile onto a
// row of the Portals window to add the tile to that portal. The direct gesture
// for "this belongs in there" — no selection, no staging, no walking into the
// collection first.
//
// The handle shows ONLY while the Portals window is up (aggregate-index with
// the 'collections' view): its provider is added/removed on the window's
// `aggregate:view-state` announcements. On the band it is pinned to the LABEL
// row's left edge (`labelRow`) — beside the name, not in the icon flow.
//
// Same choreography as EntrancePinDrone (the proven press-to-drag seam): the
// overlay emits `overlay:feature-press` when a pointer goes down on a visible
// feature icon. For our handle we arm a drag; past the threshold a small DOM
// ghost rides the pointer, the Portals window is opened so there is something
// to drop on, and its rows light up as drop zones (`portal-carry:drag-start`).
// Releasing over a `[data-portal-drop]` row emits `portal-carry:drop` — the
// aggregate index (shared) owns the write, through the same collections-source
// add() every other way into a portal uses. A plain release is untouched: the
// overlay's click path runs the icon's action, which simply opens the Portals
// window.
//
// The DROP side deliberately lives in shared (aggregate-index.component): this
// drone knows nothing about rows, sources or reference minting — it only says
// "this tile was let go at this element". Essentials never imports shared;
// the contract is the EffectBus payload + the data attribute.

import { Drone, EffectBus } from '@hypercomb/core'

const LINEAGE_KEY = '@hypercomb.social/Lineage'
const ACTION_NAME = 'portal-carry'
/** The Portals view's aggregate id (PORTALS_SOURCE_ID in shared). */
const PORTALS_VIEW_ID = 'collections'

type LineageLike = { explorerSegments?: () => readonly string[] }

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
    'Drag handle on tiles: pull it onto a Portals-window row to add the tile to that portal; a plain click opens the Portals window.'

  protected override deps = {}
  protected override listens: string[] = ['overlay:feature-press', 'tile:action', 'aggregate:view-state']
  protected override emits: string[] = ['portal-carry:drag-start', 'portal-carry:drop', 'portal-carry:drag-end', 'aggregate:view-open']

  #initialized = false
  /** pointerId whose trailing click must be swallowed (a drag happened —
   *  the release must not run the icon's action or land as a tile press). */
  #consumedPointerId: number | null = null

  #press: PressState | null = null
  /** Whether the handle's icon provider is currently registered — it follows
   *  the Portals window (see the view-state subscription in heartbeat). */
  #handleShown = false

  protected override sense = () => true

  protected override heartbeat = async (): Promise<void> => {
    if (this.#initialized) return
    this.#initialized = true

    // The handle RIDES the Portals window: it shows on tiles only while the
    // aggregate index has the portals view up — a grab affordance without a
    // drop surface is just noise. The window announces its shown view
    // (`aggregate:view-state`, last-value replayed so a late-loading drone
    // still learns the current state), and the provider is added/removed to
    // follow it: the registry dispatches 'change' on both, which re-registers
    // the whole icon set and repaints the band. Before the first announcement
    // the window has never been opened — no handle.
    this.onEffect<{ id?: string | null; open?: boolean }>('aggregate:view-state', (p) => {
      this.#setHandleShown(p?.open === true && p?.id === PORTALS_VIEW_ID)
    })

    this.onEffect<FeaturePressPayload>('overlay:feature-press', (p) => this.#onFeaturePress(p))
    // Plain click (no drag): open the Portals window — the same place the drop
    // lands, so the handle teaches where the portals live.
    this.onEffect<{ action?: string }>('tile:action', (p) => {
      if (p?.action === ACTION_NAME) this.emitEffect('aggregate:view-open', { id: PORTALS_VIEW_ID })
    })
    document.addEventListener('click', this.#onClickCapture, true)
  }

  protected override dispose(): void {
    document.removeEventListener('click', this.#onClickCapture, true)
    this.#press?.ghost?.remove()
    this.#endPress()
    this.#setHandleShown(false)
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
    const lineage = window.ioc.get<LineageLike>(LINEAGE_KEY)
    const here = (lineage?.explorerSegments?.() ?? []).map(s => String(s ?? '').trim()).filter(Boolean)
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
      // Something to drop on: surface the Portals window (idempotent while
      // already up — openPanel never navigates), then light its rows.
      this.emitEffect('aggregate:view-open', { id: PORTALS_VIEW_ID })
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
    const row = under?.closest('[data-portal-drop]')
    const targetKey = row?.getAttribute('data-portal-drop')
    if (targetKey) {
      this.emitEffect('portal-carry:drop', {
        label: p.label, segments: [...p.segments], targetKey,
      })
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
