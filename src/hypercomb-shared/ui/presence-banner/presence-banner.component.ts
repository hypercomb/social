// hypercomb-shared/ui/presence-banner/presence-banner.component.ts
//
// Quiet, top-centered strip that surfaces who else is at the current
// composedSig. Hidden when there's no swarm context. When you arrive
// somewhere alone it whispers "first one here." When others are
// present it lists their labels (or pubkey suffixes when unlabeled).
//
// Source: SwarmDrone effects only. No IoC reach for the rendering
// state — the banner derives from `swarm:presence-changed` payloads.
// The strip stays inert without a SwarmDrone in IoC, so non-swarm
// shells pay zero cost.

import { Component, signal, computed, type OnDestroy, type OnInit } from '@angular/core'
import { EffectBus } from '@hypercomb/core'
import { TranslatePipe } from '../../core/i18n.pipe'

interface PresencePayload {
  sig?: string
  peerCount?: number
  alone?: boolean
  peers?: readonly string[]
  reason?: string
}

interface SwarmLabelApi {
  labelFor: (pubkey: string) => string
}

@Component({
  selector: 'hc-presence-banner',
  standalone: true,
  imports: [TranslatePipe],
  templateUrl: './presence-banner.component.html',
  styleUrls: ['./presence-banner.component.scss'],
})
export class PresenceBannerComponent implements OnInit, OnDestroy {

  #unsub: (() => void) | null = null

  /** Whether the swarm has connected at any point this session.
   *  Gates rendering — until the first presence event lands, the
   *  banner stays hidden (no flashing on cold boot). */
  readonly #seen = signal(false)

  /** Pubkeys of the live participants at our location. Sorted by
   *  the swarm drone (freshest first). */
  readonly #peers = signal<readonly string[]>([])

  /** True when the swarm published a presence event and we're alone. */
  readonly #alone = signal(true)

  readonly visible = computed(() => this.#seen())
  readonly alone = computed(() => this.#alone())
  readonly peerCount = computed(() => this.#peers().length)

  /** Resolve each pubkey to its label (falls back to pubkey suffix).
   *  Re-runs whenever #peers changes — labels resolved at render time
   *  from the live swarm cache, so a peer that arrived without a
   *  label initially gets re-labelled the moment their next event
   *  carries one. */
  readonly peerLabels = computed(() => {
    const peers = this.#peers()
    const swarm = (window as { ioc?: { get: (k: string) => unknown } }).ioc?.get?.(
      '@diamondcoreprocessor.com/SwarmDrone',
    ) as SwarmLabelApi | undefined
    return peers.map(pk => {
      const label = swarm?.labelFor?.(pk) ?? ''
      return label || `${pk.slice(0, 6)}…`
    })
  })

  /** Comma-joined labels for the template — small bound visual. */
  readonly joinedLabels = computed(() => this.peerLabels().join(', '))

  ngOnInit(): void {
    this.#unsub = EffectBus.on<PresencePayload>('swarm:presence-changed', (payload) => {
      const peers = Array.isArray(payload?.peers) ? payload.peers : []
      const alone = payload?.alone ?? peers.length === 0
      this.#peers.set(peers)
      this.#alone.set(alone)
      this.#seen.set(true)
    })
  }

  ngOnDestroy(): void {
    this.#unsub?.()
  }
}
