// hypercomb-shared/ui/pinned-entrances/pinned-entrances.component.ts
//
// Per-LEVEL pinned quick links in the top chrome. Each icon is an entrance
// (a website, a game, …) the participant dragged up from a tile's ⋮ feature
// icon — pinned to THIS level only: navigate anywhere else and the bar shows
// that level's own pins (or nothing). The ONE exception is a CASCADING
// behavior: because it applies to the entrance's whole subtree, its pin
// stays on the header while the participant stands anywhere inside that
// subtree (see pinned-entrances.store). Quiet small glyphs — never big
// launcher tiles.
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
// pinned-entrances.store) — never layer state. Hidden in swarm mode: pinning
// is a solo-authoring affordance.
//
// This bar is the ONLY thing the top chrome puts in front of a launch group.
// There is no auto-rendered strip of aggregate meaning-icons: a group's page
// (/websites, /games, …) is reached by address or from the `/sets` landing,
// and its entrances reach the header only by an explicit drag.

import { Component, ElementRef, OnDestroy, inject, signal } from '@angular/core'
import { EffectBus } from '@hypercomb/core'
import { groupRegistry, type GroupMember, type LaunchGroup } from '../../core/group-registry'
import { pinnedEntrances, type PinnedEntrance } from '../../core/pinned-entrances.store'
import { registerProximityProvider } from '../../core/proximity-registry'
import '../../core/launch-groups'   // side-effect: registers the built-in groups

type PinView = {
  groupId: string
  memberKey: string
  icon: string
  label: string
  /** live member when the group scan has it — click routing needs it. */
  member: GroupMember | null
  /** The level this pin is STORED on — the page it was dropped on, which is
   *  not the current one for a cascaded pin. Removal must target it. */
  level: string[]
  /** Reaching us by cascade rather than by being pinned right here. */
  cascaded: boolean
}

type LineageLike = EventTarget & { explorerSegments?: () => readonly string[] }

/** Structural contract for the essentials-side registry — resolved through
 *  IoC at call time, never imported (shared must not depend on a module). */
type VisualBeeRegistryLike = EventTarget & {
  get?: (view: string) => { cascades?: boolean } | undefined
}
const VISUAL_BEE_REGISTRY_KEY = '@diamondcoreprocessor.com/VisualBeeRegistry'

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
  #bees: VisualBeeRegistryLike | null = null
  #beesBound = false
  /** member path (segments joined) → its root lineage sig, memoized so the
   *  proximity provider doesn't re-sign every navigation. */
  #rootSigByPath = new Map<string, string>()
  #unregisterProximity: (() => void) | null = null

  // ── drag-off-to-remove state ──
  #drag: { pin: PinView; startX: number; startY: number; pointerId: number; moved: boolean } | null = null

  constructor() {
    groupRegistry.addEventListener('change', this.#onChange)
    pinnedEntrances.addEventListener('change', this.#onChange)
    // The pins on THIS level are the only launch-group destinations that are
    // one tap away, so they are what the shell's nav-driven warmer pre-warms.
    this.#unregisterProximity = registerProximityProvider(this.#proximitySigs)
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
          // Which behavior it opens + where that behavior lives: together
          // they answer "does this pin reach the page I'm on now?".
          view: p.view ?? '',
          segments: Array.isArray(p.segments) ? [...p.segments] : [],
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
    this.#bees?.removeEventListener('change', this.#onChange)
    this.#unregisterProximity?.()
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
    // Dragged off the bar and let go → remove the pin. Target the level that
    // STORES it, which for a cascaded pin is an ancestor page, not the one
    // we're standing on — removing from here would silently no-op and the
    // icon would come straight back on the next refresh.
    if (wasOut) pinnedEntrances.removePin(d.pin.level, d.pin.groupId, d.pin.memberKey)
  }

  #outsideBar(x: number, y: number): boolean {
    const r = this.#host.nativeElement.getBoundingClientRect()
    return x < r.left - REMOVE_SLOP_PX || x > r.right + REMOVE_SLOP_PX
      || y < r.top - REMOVE_SLOP_PX || y > r.bottom + REMOVE_SLOP_PX
  }

  /** The shell's nav-driven warmer asks for our one-click destinations: the
   *  root subtree behind each pin on the CURRENT level. Memoized per member
   *  path; `[]` in swarm mode, where the bar is hidden. Pins whose member has
   *  no hive location (games — `segments: []`) contribute nothing. */
  #proximitySigs = async (): Promise<string[]> => {
    if (this.swarmMode()) return []
    const history = get('@diamondcoreprocessor.com/HistoryService') as
      { sign?: (l: { explorerSegments?: () => readonly string[] }) => Promise<string> } | undefined
    if (!history?.sign) return []
    const out: string[] = []
    for (const pin of this.pins()) {
      const segs = pin.member?.segments
      if (!Array.isArray(segs) || segs.length === 0) continue
      const key = segs.join(' ')
      let sig = this.#rootSigByPath.get(key)
      if (!sig) {
        sig = await history.sign({ explorerSegments: () => segs }).catch(() => '')
        if (sig) this.#rootSigByPath.set(key, sig)
      }
      if (sig) out.push(sig)
    }
    return out
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
  // bind lazily on first refresh that finds it.
  #ensureLineage(): void {
    if (this.#lineageBound) return
    const l = get<LineageLike>('@hypercomb.social/Lineage')
    if (l?.addEventListener) {
      this.#lineage = l
      l.addEventListener('change', this.#onChange)
      this.#lineageBound = true
    }
  }

  // Same lazy bind for the visual-bee registry, and for the same reason it is
  // worth listening to: a bee that registers (or unregisters) mid-session can
  // flip whether an already-pinned entrance cascades, which changes the bar.
  #ensureBeeRegistry(): void {
    if (this.#beesBound) return
    const r = get<VisualBeeRegistryLike>(VISUAL_BEE_REGISTRY_KEY)
    if (r?.addEventListener) {
      this.#bees = r
      r.addEventListener('change', this.#onChange)
      this.#beesBound = true
    }
  }

  /** Does this entrance's behavior apply to its whole subtree? Asked of the
   *  behavior's OWN declaration every render — the pin stores only which view
   *  it opens, so re-declaring a behavior's scope re-scopes existing pins with
   *  no migration. Absent registry / unknown view / undeclared = node-local. */
  #cascades(pin: PinnedEntrance): boolean {
    if (!pin.view) return false
    this.#ensureBeeRegistry()
    return this.#bees?.get?.(pin.view)?.cascades === true
  }

  /** The entrance's own root cell — where a cascade is measured from. Live
   *  member first (a rename moves it), stored path as the cold fallback. */
  #rootOf(pin: PinnedEntrance, member: GroupMember | null): readonly string[] {
    const segs = member?.segments ?? pin.segments
    return Array.isArray(segs) ? segs : []
  }

  #refresh(): void {
    const here = this.#segments()
    const hereKey = here.join('/')
    const entries = pinnedEntrances.pinsForLocation(here, (pin) => ({
      cascades: this.#cascades(pin),
      root: this.#rootOf(pin, this.#memberFor(pin)),
    }))
    this.pins.set(entries.map(({ level, pin }) => {
      const group: LaunchGroup | undefined = groupRegistry.get(pin.groupId)
      const member = this.#memberFor(pin)
      return {
        groupId: pin.groupId,
        memberKey: pin.memberKey,
        icon: member?.icon || pin.icon || group?.icon || 'flag',
        label: member?.label || pin.label || pin.memberKey,
        member,
        level,
        cascaded: level.join('/') !== hereKey,
      }
    }))
  }

  #memberFor(pin: PinnedEntrance): GroupMember | null {
    return groupRegistry.get(pin.groupId)?.members().find(m => m.key === pin.memberKey) ?? null
  }
}
