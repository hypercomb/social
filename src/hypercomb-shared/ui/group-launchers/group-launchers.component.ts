// hypercomb-shared/ui/group-launchers/group-launchers.component.ts
//
// Top-chrome group launchers — one meaning-icon per non-empty launch group
// (websites, games, …). A group with zero members is not rendered.
//
// ONE-STATE (2026-07-03): each icon is a PORTAL. Tapping it brings up that
// group's layer; tapping another switches to it; tapping the active one is an
// idempotent no-op. No toggle state — the highlight is DERIVED from where the
// participant is standing (GroupRegistry.currentId()), so it lights when you
// are in a group's layer and goes dark the moment you navigate anywhere else.
//
// Participates in the universal icon protocol: each icon resolves through the
// IconOverrideStore (so it can be reskinned), long-press enters icon edit mode,
// and a tap while editing routes to the icon-hive picker instead of activating.

import { Component, OnDestroy, signal } from '@angular/core'
import { EffectBus } from '@hypercomb/core'
import { groupRegistry } from '../../core/group-registry'
import { iconOverrides } from '../../core/icon-override.store'
import { iconEditMode } from '../../core/icon-edit.service'
import '../../core/websites-group'   // side-effect: registers the websites group
import '../../core/dashboard-group'  // side-effect: registers the dashboard group
import '../../core/games-group'      // side-effect: registers the games group
import '../../core/help-group'       // side-effect: registers the help group

type GroupView = { id: string; icon: string; label: string; on: boolean }
type LineageLike = EventTarget & { explorerSegments?: () => readonly string[] }

@Component({
  selector: 'hc-group-launchers',
  standalone: true,
  imports: [],
  templateUrl: './group-launchers.component.html',
  styleUrls: ['./group-launchers.component.scss'],
})
export class GroupLaunchersComponent implements OnDestroy {
  readonly groups = signal<GroupView[]>([])
  readonly iconEditOn = signal(false)

  /** True while we're in swarm (public) mode. The aggregate meaning-icons are
   *  a solo-authoring affordance — they gather YOUR launch groups (websites,
   *  games, …). In a swarm you're looking at the shared, public surface, so the
   *  whole strip is hidden. Driven by the processor's 'mesh:public-changed'
   *  broadcast (last-value replay → correct on mount, even if we subscribe
   *  after the initial emit). */
  readonly swarmMode = signal(false)

  #onChange = (): void => this.#refresh()
  #unsubs: (() => void)[] = []
  #pressTimer: ReturnType<typeof setTimeout> | null = null
  #suppressClick = false
  #lineage: LineageLike | null = null
  #lineageBound = false

  constructor() {
    groupRegistry.addEventListener('change', this.#onChange)
    iconOverrides.addEventListener('change', this.#onChange)   // reskins re-resolve live
    this.#refresh()
    this.#unsubs.push(
      EffectBus.on<{ on?: boolean }>('icon:edit-mode', ({ on }) => this.iconEditOn.set(!!on)),
      EffectBus.on<{ public?: boolean }>('mesh:public-changed', ({ public: pub }) => this.swarmMode.set(!!pub)),
    )
  }

  ngOnDestroy(): void {
    groupRegistry.removeEventListener('change', this.#onChange)
    iconOverrides.removeEventListener('change', this.#onChange)
    this.#lineage?.removeEventListener('change', this.#onChange)
    for (const u of this.#unsubs) { try { u() } catch { /* noop */ } }
    this.#clearPress()
  }

  /** Tap: edit mode → reskin this icon; else SHOW this group's layer (the one
   *  state — tapping another switches, tapping the active one is a no-op). */
  activate(id: string, ev?: Event): void {
    // A pointer click (detail ≥ 1) leaves browser focus pinned on the icon;
    // the next keystroke — Escape to leave the launch page — would promote it
    // to :focus-visible and paint a stray focus ring in the chrome. Drop the
    // focus for pointer activations only; keyboard activation (Enter/Space,
    // detail 0) keeps the ring, which a keyboard user needs to see.
    const t = ev?.currentTarget
    if ((ev as MouseEvent | undefined)?.detail && t instanceof HTMLElement) t.blur()
    if (this.#suppressClick) { this.#suppressClick = false; return }
    if (iconEditMode.on) { iconEditMode.requestPick('group:' + id); return }
    const group = groupRegistry.get(id)
    if (!group || group.members().length === 0) return
    groupRegistry.show(id)
  }

  /** Hover → warm this group's aggregator caches in the background so the click
   *  that follows is fast. Read-only + non-navigating; safe to fire on every
   *  hover (the bag de-dupes). Skipped in icon-edit mode (hover isn't intent). */
  prewarm(id: string): void {
    if (iconEditMode.on) return
    groupRegistry.prewarmGroup(id)
  }

  // ── long-press → enter icon edit mode (without picking this icon) ──
  onPressDown(): void {
    this.#clearPress()
    this.#suppressClick = false
    this.#pressTimer = setTimeout(() => {
      this.#pressTimer = null
      this.#suppressClick = true   // the trailing click must not also pick
      iconEditMode.enter()
    }, 500)
  }
  onPressUp(): void { this.#clearPress() }
  #clearPress(): void { if (this.#pressTimer) { clearTimeout(this.#pressTimer); this.#pressTimer = null } }

  // The highlight derives from location, so it must re-resolve on every
  // navigation. Lineage registers from essentials after this shell component
  // constructs — bind lazily on first refresh that finds it.
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
    this.#ensureLineage()
    const current = groupRegistry.currentId()
    this.groups.set(
      groupRegistry.all()
        .filter(g => g.members().length > 0)
        .map(g => ({ id: g.id, icon: iconOverrides.glyph('group:' + g.id, g.icon), label: g.label, on: g.id === current })),
    )
  }
}
