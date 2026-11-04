// hypercomb-shared/ui/participants/participants-sidebar.component.ts
//
// THE PARTICIPANT VIEW — a left-hand sidebar, one row per member of the
// swarm, vertical. Click a row to toggle that member in or out of the tile
// filter; press and drag down the list to paint several at once. While any
// are selected only their tiles show on the hexagons (SwarmFilterService,
// documentation/swarm-participant-filter.md); "everyone" clears it. No
// status prose, no chips — jwize, 2026-11-04.
//
// Opens from the rail's participant badges (`participants:sidebar`), closes
// on ×, Escape, or leaving the swarm. Shell UI: essentials are reached only
// through the roster module's ioc lookups.

import { registerShellSurface } from '@hypercomb/runtime/shell-surface-registry'
import { Component, effect, signal, type OnDestroy } from '@angular/core'
import { EffectBus } from '@hypercomb/core'
import { TranslatePipe } from '../../core/i18n.pipe'
import { DockInsetDirective } from '../dock-inset/dock-inset.directive'
import { HcDockedPanelDirective } from '../docked-panel/hc-docked-panel.directive'
import { signalSession } from '../window-session'
import { clearParticipantFilter, inSwarm, participants, toggleParticipant, type Participant } from './participants-roster'

@Component({
  selector: 'hc-participants-sidebar',
  standalone: true,
  imports: [TranslatePipe, DockInsetDirective, HcDockedPanelDirective],
  templateUrl: './participants-sidebar.component.html',
  styleUrls: ['./participants-sidebar.component.scss'],
})
export class ParticipantsSidebarComponent implements OnDestroy {
  readonly open = signal(false)
  readonly inSwarm = inSwarm
  readonly participants = participants
  readonly session = signalSession(this.open, () => { /* nothing to announce */ }, { close: () => this.close() })

  readonly anySelected = (): boolean => this.participants().some(p => p.selected)

  /** The paint: the op the press decided, and the rows it already touched. */
  #paintOp: 'add' | 'remove' | null = null
  #touched = new Set<string>()

  readonly #unsubs: (() => void)[] = []
  readonly #onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' && this.open()) { this.close(); e.stopPropagation() }
  }
  readonly #onUp = (): void => { this.#paintOp = null; this.#touched.clear() }

  constructor() {
    this.#unsubs.push(EffectBus.on<{ toggle?: boolean; open?: boolean }>('participants:sidebar', (p) => {
      if (p?.toggle) this.open.update(v => !v)
      else if (typeof p?.open === 'boolean') this.open.set(p.open)
    }))
    // Leaving the swarm takes the list with it.
    effect(() => { if (!this.inSwarm()) this.open.set(false) })
    window.addEventListener('keydown', this.#onKey, true)
    window.addEventListener('pointerup', this.#onUp)
    window.addEventListener('pointercancel', this.#onUp)
  }

  ngOnDestroy(): void {
    for (const u of this.#unsubs) u()
    window.removeEventListener('keydown', this.#onKey, true)
    window.removeEventListener('pointerup', this.#onUp)
    window.removeEventListener('pointercancel', this.#onUp)
  }

  close(): void { this.open.set(false) }

  /** Press decides the op from the first row; every row the pointer crosses
   *  while it is down gets the same op, once. A plain click is a one-row paint. */
  onRowDown(e: PointerEvent, p: Participant): void {
    if (e.button !== 0 || p.where === 'self') return
    e.preventDefault()
    this.#paintOp = p.selected ? 'remove' : 'add'
    this.#touched.clear()
    this.#paint(p)
  }

  onRowEnter(p: Participant): void {
    if (this.#paintOp === null || p.where === 'self') return
    this.#paint(p)
  }

  everyone(): void { clearParticipantFilter() }

  #paint(p: Participant): void {
    if (this.#touched.has(p.key)) return
    this.#touched.add(p.key)
    if ((this.#paintOp === 'add') !== p.selected) toggleParticipant(p.key)
  }
}

// Registry-fed shell surface — mounted by <hc-shell-surfaces>, never by an
// app.html tag (see shell-surface-registry.ts).
registerShellSurface({
  name: 'hc-participants-sidebar',
  owner: '@hypercomb.shared/ParticipantsSidebarComponent',
  component: ParticipantsSidebarComponent,
  order: 141,
})
