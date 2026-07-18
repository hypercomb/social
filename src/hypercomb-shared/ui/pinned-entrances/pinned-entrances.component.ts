// hypercomb-shared/ui/pinned-entrances/pinned-entrances.component.ts
//
// Per-LEVEL pinned quick links in the top chrome. Each icon is an entrance
// (a website, a game, …) the participant dragged up from a tile's entrance
// badge — pinned to THIS level only: navigate anywhere else and the bar
// shows that level's own pins (or nothing). Same quiet icon language as the
// group launchers — never big launcher tiles.
//
//   click a pin      → open the entrance (the owning group's own routing)
//   drag a pin OFF   → let go to remove it
//   drop-target      → while an entrance badge drag is in flight
//                      (EffectBus `entrance:drag-start` / `entrance:drag-end`,
//                      emitted by the essentials badge drone), the bar raises
//                      a dashed drop slot; the drone finds it at release via
//                      elementFromPoint on `data-entrance-dropzone` and emits
//                      `entrance:pin`, which we persist for the CURRENT level.
//
// Pins are personal chrome arrangement (localStorage via
// pinned-entrances.store) — never layer state. Hidden in swarm mode, like
// the launcher strip: pinning is a solo-authoring affordance.

import { Component, ElementRef, OnDestroy, inject, signal } from '@angular/core'
import { EffectBus } from '@hypercomb/core'
import { groupRegistry, type GroupMember, type LaunchGroup } from '../../core/group-registry'
import { pinnedEntrances, type PinnedEntrance } from '../../core/pinned-entrances.store'

type PinView = {
  groupId: string
  memberKey: string
  icon: string
  label: string
  /** live member when the group scan has it — click routing needs it. */
  member: GroupMember | null
}

type LineageLike = EventTarget & { explorerSegments?: () => readonly string[] }

/** Pointer travel (px) that turns a press on a pin into a removal drag. */
const DRAG_THRESHOLD_PX = 8
/** How far outside the bar the pointer must be released to remove. */
const REMOVE_SLOP_PX = 24

@Component({
  selector: 'hc-pinned-entrances',
  standalone: true,
  imports: [],
  templateUrl: './pinned-entrances.component.html',
  styleUrls: ['./pinned-entrances.component.scss'],
  host: { 'data-entrance-dropzone': '' },
})
export class PinnedEntrancesComponent implements OnDestroy {
  readonly pins = signal<PinView[]>([])
  /** An entrance-badge drag is in flight — raise the drop slot. */
  readonly dropArmed = signal(false)
  readonly swarmMode = signal(false)
  /** memberKey of the pin currently being dragged off ('' = none). */
  readonly draggingKey = signal('')
  /** Dragged pin has left the bar — releasing now removes it. */
  readonly draggingOut = signal(false)

  readonly #host = inject<ElementRef<HTMLElement>>(ElementRef)
  #onChange = (): void => this.#refresh()
  #unsubs: (() => void)[] = []
  #lineage: LineageLike | null = null
  #lineageBound = false

  // ── drag-off-to-remove state ──
  #drag: { pin: PinView; startX: number; startY: number; pointerId: number; moved: boolean } | null = null

  constructor() {
    groupRegistry.addEventListener('change', this.#onChange)
    pinnedEntrances.addEventListener('change', this.#onChange)
    this.#refresh()
    this.#unsubs.push(
      EffectBus.on('entrance:drag-start', () => this.dropArmed.set(true)),
      EffectBus.on('entrance:drag-end', () => this.dropArmed.set(false)),
      // The badge drone found this bar under the release point — pin the
      // dragged entrance to the CURRENT level.
      EffectBus.on<PinnedEntrance>('entrance:pin', (p) => {
        if (!p?.groupId || !p?.memberKey) return
        pinnedEntrances.addPin(this.#segments(), {
          groupId: p.groupId, memberKey: p.memberKey,
          icon: p.icon ?? '', label: p.label ?? '',
        })
      }),
      EffectBus.on<{ public?: boolean }>('mesh:public-changed', ({ public: pub }) => this.swarmMode.set(!!pub)),
    )
    document.addEventListener('pointermove', this.#onDocMove)
    document.addEventListener('pointerup', this.#onDocUp)
  }

  ngOnDestroy(): void {
    groupRegistry.removeEventListener('change', this.#onChange)
    pinnedEntrances.removeEventListener('change', this.#onChange)
    this.#lineage?.removeEventListener('change', this.#onChange)
    for (const u of this.#unsubs) { try { u() } catch { /* noop */ } }
    document.removeEventListener('pointermove', this.#onDocMove)
    document.removeEventListener('pointerup', this.#onDocUp)
  }

  /** Press on a pin: arm a possible drag-off; a plain release is a click. */
  onPinDown(pin: PinView, ev: PointerEvent): void {
    if (ev.button !== 0) return
    this.#drag = { pin, startX: ev.clientX, startY: ev.clientY, pointerId: ev.pointerId, moved: false }
  }

  #onDocMove = (ev: PointerEvent): void => {
    const d = this.#drag
    if (!d || ev.pointerId !== d.pointerId) return
    if (!d.moved) {
      const dx = ev.clientX - d.startX
      const dy = ev.clientY - d.startY
      if (dx * dx + dy * dy < DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX) return
      d.moved = true
      this.draggingKey.set(d.pin.memberKey)
    }
    this.draggingOut.set(this.#outsideBar(ev.clientX, ev.clientY))
  }

  #onDocUp = (ev: PointerEvent): void => {
    const d = this.#drag
    if (!d || ev.pointerId !== d.pointerId) return
    this.#drag = null
    const wasDrag = d.moved
    const wasOut = this.draggingOut()
    this.draggingKey.set('')
    this.draggingOut.set(false)
    if (!wasDrag) { this.#open(d.pin); return }
    // Dragged off the bar and let go → remove the pin from THIS level.
    if (wasOut) pinnedEntrances.removePin(this.#segments(), d.pin.groupId, d.pin.memberKey)
  }

  #outsideBar(x: number, y: number): boolean {
    const r = this.#host.nativeElement.getBoundingClientRect()
    return x < r.left - REMOVE_SLOP_PX || x > r.right + REMOVE_SLOP_PX
      || y < r.top - REMOVE_SLOP_PX || y > r.bottom + REMOVE_SLOP_PX
  }

  #open(pin: PinView): void {
    const group = groupRegistry.get(pin.groupId)
    if (!group) return
    const member = pin.member
      ?? group.members().find(m => m.key === pin.memberKey)
      ?? null
    if (member) group.open(member)
  }

  #segments(): readonly string[] {
    this.#ensureLineage()
    return (this.#lineage?.explorerSegments?.() ?? [])
      .map(s => String(s ?? '').trim()).filter(Boolean)
  }

  // Lineage registers from essentials after this shell component constructs —
  // bind lazily on first refresh that finds it (same as group-launchers).
  #ensureLineage(): void {
    if (this.#lineageBound) return
    const l = get<LineageLike>('@hypercomb.social/Lineage')
    if (l?.addEventListener) {
      this.#lineage = l
      l.addEventListener('change', this.#onChange)
      this.#lineageBound = true
    }
  }

  #refresh(): void {
    const pins = pinnedEntrances.pinsAt(this.#segments())
    this.pins.set(pins.map(p => {
      const group: LaunchGroup | undefined = groupRegistry.get(p.groupId)
      const member = group?.members().find(m => m.key === p.memberKey) ?? null
      return {
        groupId: p.groupId,
        memberKey: p.memberKey,
        icon: member?.icon || p.icon || group?.icon || 'flag',
        label: member?.label || p.label || p.memberKey,
        member,
      }
    }))
  }
}
