// hypercomb-shared/ui/group-launchers/group-launchers.component.ts
//
// Top-chrome group launchers — one meaning-icon per non-empty launch group
// (websites, games, …). A group with zero members is not rendered. Selection is
// MUTUALLY EXCLUSIVE: tapping an icon makes that group the only one shown (the
// shared aggregator page renders just its members); tapping another switches to
// it; tapping the active one closes. The enabled set is owned by GroupRegistry
// (the bag still supports a union, but the launcher drives it one-at-a-time).
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

  #onChange = (): void => this.#refresh()
  #unsubs: (() => void)[] = []
  #pressTimer: ReturnType<typeof setTimeout> | null = null
  #suppressClick = false

  constructor() {
    groupRegistry.addEventListener('change', this.#onChange)
    iconOverrides.addEventListener('change', this.#onChange)   // reskins re-resolve live
    this.#refresh()
    this.#unsubs.push(
      EffectBus.on<{ on?: boolean }>('icon:edit-mode', ({ on }) => this.iconEditOn.set(!!on)),
    )
  }

  ngOnDestroy(): void {
    groupRegistry.removeEventListener('change', this.#onChange)
    iconOverrides.removeEventListener('change', this.#onChange)
    for (const u of this.#unsubs) { try { u() } catch { /* noop */ } }
    this.#clearPress()
  }

  /** Tap: edit mode → reskin this icon; else select this group EXCLUSIVELY (one
   *  group at a time — tapping another switches, tapping the active one closes).
   *  The registry owns the bag + enter/exit. */
  activate(id: string): void {
    if (this.#suppressClick) { this.#suppressClick = false; return }
    if (iconEditMode.on) { iconEditMode.requestPick('group:' + id); return }
    const group = groupRegistry.get(id)
    if (!group || group.members().length === 0) return
    groupRegistry.selectExclusive(id)
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

  #refresh(): void {
    this.groups.set(
      groupRegistry.all()
        .filter(g => g.members().length > 0)
        .map(g => ({ id: g.id, icon: iconOverrides.glyph('group:' + g.id, g.icon), label: g.label, on: groupRegistry.isEnabled(g.id) })),
    )
  }
}
