// diamondcoreprocessor.com/presentation/tiles/entrance-pin.drone.ts
//
// EntrancePinDrone — drag a tile's ⋮ FEATURE icon up to the header bar to
// pin that entrance on the current level. Entrance icons live only INSIDE
// the ⋮ menu (the overlay's feature row) — nothing is ever drawn on the
// tile face; this drone owns just the press-to-drag choreography and the
// entrance resolution.
//
// The overlay emits `overlay:feature-press` when a pointer goes down on a
// visible feature icon. If the pressed tile is a declared launch-group
// member ROOT (a websites-menu entry today; any group whose members carry
// real tree locations tomorrow), we arm a drag: past the threshold a small
// DOM ghost rides the pointer and the pinned-entrances bar raises its drop
// slot (`entrance:drag-start`). Releasing over `[data-entrance-dropzone]`
// emits `entrance:pin`, which the shell persists for the CURRENT level. A
// plain release is untouched — the overlay's own click path runs the icon's
// action (open the view) exactly as if this drone didn't exist.

import { Drone, EffectBus, normalizeCell } from '@hypercomb/core'

const GROUP_REGISTRY_KEY = '@hypercomb.social/GroupLauncher'
const LINEAGE_KEY = '@hypercomb.social/Lineage'

// Local structural contracts — essentials must not import shared.
type GroupMemberLike = { key: string; label: string; segments: string[]; icon?: string }
type LaunchGroupLike = {
  id: string
  icon: string
  openDirectly?: boolean
  members(): GroupMemberLike[]
  open(m: GroupMemberLike): void
}
type GroupRegistryLike = EventTarget & { all(): LaunchGroupLike[] }
type LineageLike = { explorerSegments?: () => readonly string[] }

type FeaturePressPayload = {
  action?: string
  label?: string
  pointerId?: number
  clientX?: number
  clientY?: number
}

/** Pointer travel (px) that turns a feature-icon press into a pin drag. */
const DRAG_THRESHOLD_PX = 6

export class EntrancePinDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'presentation'
  public override description =
    'Drag a tile\'s ⋮ feature icon to the header bar to pin that entrance on the current level; plain clicks pass through to the overlay untouched.'

  protected override deps = {}
  protected override listens: string[] = ['overlay:feature-press']
  protected override emits: string[] = ['entrance:drag-start', 'entrance:pin', 'entrance:drag-end']

  #initialized = false
  /** pointerId whose trailing click must be swallowed (a drag happened —
   *  the release must not run the icon's action or a tile press). */
  #consumedPointerId: number | null = null

  #press: {
    pointerId: number
    startX: number
    startY: number
    group: LaunchGroupLike
    member: GroupMemberLike
    dragging: boolean
    ghost: HTMLDivElement | null
  } | null = null

  protected override sense = () => true

  protected override heartbeat = async (): Promise<void> => {
    if (this.#initialized) return
    this.#initialized = true
    this.onEffect<FeaturePressPayload>('overlay:feature-press', (p) => this.#onFeaturePress(p))
    document.addEventListener('click', this.#onClickCapture, true)
  }

  protected override dispose(): void {
    document.removeEventListener('click', this.#onClickCapture, true)
    this.#press?.ghost?.remove()
    this.#endPress()
  }

  #onFeaturePress(p: FeaturePressPayload): void {
    if (!p?.label || typeof p.pointerId !== 'number') return
    const entrance = this.#entranceForLabel(p.label)
    if (!entrance) return   // not a declared entrance root — plain click only
    this.#press?.ghost?.remove()
    this.#endPress()
    this.#press = {
      pointerId: p.pointerId,
      startX: p.clientX ?? 0, startY: p.clientY ?? 0,
      group: entrance.group, member: entrance.member,
      dragging: false, ghost: null,
    }
    document.addEventListener('pointermove', this.#onPressMove)
    document.addEventListener('pointerup', this.#onPressUp)
    document.addEventListener('pointercancel', this.#onPressCancel)
  }

  /** The entrance rooted at [...currentLevel, label], or null. Normalized
   *  per-segment so raw nav paths and normalized descent paths agree. */
  #entranceForLabel(label: string): { group: LaunchGroupLike; member: GroupMemberLike } | null {
    const registry = window.ioc.get<GroupRegistryLike>(GROUP_REGISTRY_KEY)
    if (!registry?.all) return null
    const lineage = window.ioc.get<LineageLike>(LINEAGE_KEY)
    const here = (lineage?.explorerSegments?.() ?? [])
    const key = EntrancePinDrone.#pathKey([...here, label])
    for (const group of registry.all()) {
      if (group.openDirectly) continue
      for (const member of group.members()) {
        if (!Array.isArray(member.segments) || member.segments.length !== here.length + 1) continue
        if (EntrancePinDrone.#pathKey(member.segments) === key) return { group, member }
      }
    }
    return null
  }

  static #pathKey(segments: readonly string[]): string {
    return segments
      .map(s => String(s ?? '').trim()).filter(Boolean)
      .map(s => normalizeCell(s) || s)
      .join('/')
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
      p.ghost = this.#createGhost(p.member.icon || p.group.icon || 'flag')
      EffectBus.emit('entrance:drag-start', {
        groupId: p.group.id, memberKey: p.member.key,
        icon: p.member.icon || p.group.icon || '', label: p.member.label,
      })
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
    if (under?.closest('[data-entrance-dropzone]')) {
      EffectBus.emit('entrance:pin', {
        groupId: p.group.id, memberKey: p.member.key,
        icon: p.member.icon || p.group.icon || '', label: p.member.label,
      })
    }
    EffectBus.emit('entrance:drag-end', {})
  }

  #onPressCancel = (e: PointerEvent): void => {
    const p = this.#press
    if (!p || e.pointerId !== p.pointerId) return
    this.#endPress()
    p.ghost?.remove()
    if (p.dragging) EffectBus.emit('entrance:drag-end', {})
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

  /** Small round drag ghost that rides the pointer — same quiet chrome
   *  language as the pinned bar's buttons, never a launcher tile. */
  #createGhost(glyph: string): HTMLDivElement {
    const ghost = document.createElement('div')
    ghost.style.cssText = [
      'position:fixed', 'z-index:2147483600', 'pointer-events:none',
      'width:1.9rem', 'height:1.9rem', 'margin-left:-0.95rem', 'margin-top:-0.95rem',
      'display:flex', 'align-items:center', 'justify-content:center',
      'border-radius:8px',
      'background:rgba(12,28,46,.85)', 'border:1px solid rgba(126,182,214,.55)',
      'color:#eaf5fb', "font-family:'Material Symbols Outlined'", 'font-size:1.3rem', 'line-height:1',
    ].join(';')
    ghost.textContent = glyph
    document.body.appendChild(ghost)
    return ghost
  }
}

const _entrancePin = new EntrancePinDrone()
window.ioc.register('@diamondcoreprocessor.com/EntrancePinDrone', _entrancePin)
