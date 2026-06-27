// hypercomb-shared/ui/observe-viewer/observe-viewer.component.ts
//
// Right-docked "Observe" panel — the read-only view onto the swarm-as-
// observation substrate. `/observe` toggles it (ObserveDrone answers with
// `observe:render`). It lists the attributed data points at the current
// location — who is here and what they are sharing — ranked by live interest,
// and breathing: points appear and vanish as participants come and go.
//
// Shell UI, so it must NOT import essentials. It renders straight from the
// `observe:render` payload (the drone owns the read-model + filter) and sends
// intents back as effects: observe:set-filter (what I choose to see) and
// observe:close. Observation only — acting on what you observe is the SAME
// features icon you use solo, not a swarm-specific button.
//
// Neutrality is a VIEW choice: the drone omits a participant's human name when
// names are off; the panel falls back to a truncated pubkey — a neutral id that
// still distinguishes peers without revealing who.

import { Component, signal, type OnDestroy } from '@angular/core'
import { EffectBus } from '@hypercomb/core'
import { TranslatePipe } from '../../core/i18n.pipe'
import { DockInsetDirective } from '../dock-inset/dock-inset.directive'
import { HcDockedPanelDirective } from '../docked-panel/hc-docked-panel.directive'

// Mirrors of the essentials read-model shapes (shared cannot import essentials).
interface ObservedParticipant {
  pubkey: string
  label?: string
  domain?: string
}
interface ObservedPoint {
  name: string
  layerSig?: string
  participant: ObservedParticipant
  interestCount: number
  changed: boolean
}
interface ObservationGroup {
  key: string
  label: string
  points: ObservedPoint[]
}
type ObservationGrouping = 'flat' | 'participant' | 'domain'
interface ObservationFilter {
  showNames: boolean
  groupBy: ObservationGrouping
}
interface ObserveRenderPayload {
  open: boolean
  groups: ObservationGroup[]
  filter: ObservationFilter
}

@Component({
  selector: 'hc-observe-viewer',
  standalone: true,
  imports: [TranslatePipe, DockInsetDirective, HcDockedPanelDirective],
  templateUrl: './observe-viewer.component.html',
  styleUrls: ['./observe-viewer.component.scss'],
})
export class ObserveViewerComponent implements OnDestroy {

  readonly visible = signal(false)
  readonly groups = signal<ObservationGroup[]>([])
  readonly showNames = signal(true)
  readonly groupBy = signal<ObservationGrouping>('flat')

  #cleanups: (() => void)[] = []

  constructor() {
    this.#cleanups.push(EffectBus.on<ObserveRenderPayload>('observe:render', (p) => {
      if (!p) return
      this.groups.set(Array.isArray(p.groups) ? p.groups : [])
      if (p.filter) {
        this.showNames.set(p.filter.showNames !== false)
        this.groupBy.set(this.#normGrouping(p.filter.groupBy))
      }
      // Share the right-side dock — opening Observe closes the sibling panels.
      if (p.open) {
        EffectBus.emit('files:viewer-close', {})
        EffectBus.emit('features:viewer-close', {})
      }
      this.visible.set(!!p.open)
    }))
  }

  ngOnDestroy(): void {
    for (const c of this.#cleanups) c()
  }

  close(): void {
    this.visible.set(false)
    EffectBus.emit('observe:close', {})
  }

  toggleNames(): void {
    EffectBus.emit('observe:set-filter', { showNames: !this.showNames() })
  }

  setGroupBy(grouping: ObservationGrouping): void {
    EffectBus.emit('observe:set-filter', { groupBy: grouping })
  }

  /** Rotate flat → participant → domain → flat for a single chip control. */
  cycleGroupBy(): void {
    const order: ObservationGrouping[] = ['flat', 'participant', 'domain']
    const next = order[(order.indexOf(this.groupBy()) + 1) % order.length]
    this.setGroupBy(next)
  }

  /** Neutral identity for a row — the human name when shown, else a truncated
   *  pubkey that distinguishes peers without revealing who. */
  identify(participant: ObservedParticipant): string {
    if (participant?.label) return participant.label
    const pk = String(participant?.pubkey ?? '')
    return pk.length > 10 ? `${pk.slice(0, 8)}…` : (pk || '—')
  }

  hasPoints(): boolean {
    return this.groups().some(g => g.points.length > 0)
  }

  onKey(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return
    event.preventDefault()
    this.close()
  }

  #normGrouping(g: unknown): ObservationGrouping {
    return g === 'participant' || g === 'domain' ? g : 'flat'
  }
}
