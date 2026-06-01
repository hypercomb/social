// hypercomb-shared/ui/presence-banner/presence-banner.component.ts
//
// Quiet, top-centered strip that surfaces who else is at the current
// composedSig. Hidden when there's no swarm context. When you arrive
// somewhere alone it whispers "first one here." When others are
// present it lists their labels (or pubkey suffixes when unlabeled).
//
// Click expands an inline participant panel: one row per peer with
// two icon toggles — subscribe (data flow + consent handshake) and
// follow (navigation sync). Both bind to SwarmDrone APIs; the panel
// stays presentational and never touches localStorage directly.
//
// Source: SwarmDrone effects only. No IoC reach for the rendering
// state — the banner derives from `swarm:presence-changed` and the
// related subscription/following effects. The strip stays inert
// without a SwarmDrone in IoC, so non-swarm shells pay zero cost.

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

interface SwarmConsumerApi {
  labelFor: (pubkey: string) => string
  subscribedTo: () => string
  following: () => string
  subscribeTo: (pubkey: string | null) => Promise<void>
  follow: (pubkey: string | null) => Promise<void>
}

@Component({
  selector: 'hc-presence-banner',
  standalone: true,
  imports: [TranslatePipe],
  templateUrl: './presence-banner.component.html',
  styleUrls: ['./presence-banner.component.scss'],
})
export class PresenceBannerComponent implements OnInit, OnDestroy {

  #unsubs: (() => void)[] = []

  /** Whether the swarm has connected at any point this session.
   *  Gates rendering — until the first presence event lands, the
   *  banner stays hidden (no flashing on cold boot). */
  readonly #seen = signal(false)

  /** Pubkeys of the live participants at our location. Sorted by
   *  the swarm drone (freshest first). */
  readonly #peers = signal<readonly string[]>([])

  /** True when the swarm published a presence event and we're alone. */
  readonly #alone = signal(true)

  /** Expanded participant panel state. Toggles on banner click. */
  readonly expanded = signal(false)

  /** Live subscribe + follow targets — mirrored from swarm via
   *  EffectBus so the row indicators update without polling. */
  readonly #subscribedTo = signal('')
  readonly #following = signal('')

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

  /** Per-row participant data for the expanded panel. Labels
   *  collide-safe: when two peers share a label, we suffix the
   *  pubkey to disambiguate ("Alice • a1b2"). */
  readonly rows = computed<readonly { pubkey: string; label: string; subscribed: boolean; following: boolean }[]>(() => {
    const peers = this.#peers()
    const swarm = (window as { ioc?: { get: (k: string) => unknown } }).ioc?.get?.(
      '@diamondcoreprocessor.com/SwarmDrone',
    ) as SwarmConsumerApi | undefined
    const subscribedTo = this.#subscribedTo()
    const following = this.#following()
    // First pass: get labels.
    const raw = peers.map(pk => ({
      pubkey: pk,
      label: (swarm?.labelFor?.(pk) ?? '').trim() || `${pk.slice(0, 6)}…`,
    }))
    // Detect colliding labels — suffix with pubkey to disambiguate.
    const labelCount = new Map<string, number>()
    for (const r of raw) labelCount.set(r.label, (labelCount.get(r.label) ?? 0) + 1)
    return raw.map(r => ({
      pubkey: r.pubkey,
      label: (labelCount.get(r.label) ?? 0) > 1
        ? `${r.label} • ${r.pubkey.slice(0, 4)}`
        : r.label,
      subscribed: r.pubkey === subscribedTo && !!subscribedTo,
      following: r.pubkey === following && !!following,
    }))
  })

  ngOnInit(): void {
    // Seed both signals from the live swarm — covers the case where
    // the user already subscribed/followed someone before the panel
    // first renders.
    const swarm = (window as { ioc?: { get: (k: string) => unknown } }).ioc?.get?.(
      '@diamondcoreprocessor.com/SwarmDrone',
    ) as SwarmConsumerApi | undefined
    if (swarm) {
      try { this.#subscribedTo.set(swarm.subscribedTo() ?? '') } catch { /* default empty */ }
      try { this.#following.set(swarm.following() ?? '') } catch { /* default empty */ }
    }

    this.#unsubs.push(
      EffectBus.on<PresencePayload>('swarm:presence-changed', (payload) => {
        const peers = Array.isArray(payload?.peers) ? payload.peers : []
        const alone = payload?.alone ?? peers.length === 0
        this.#peers.set(peers)
        this.#alone.set(alone)
        this.#seen.set(true)
      }),

      // Subscribe/follow target changes — mirror into local signals
      // so row state lights up the moment the swarm flips.
      EffectBus.on<{ pubkey?: string }>('swarm:subscription-changed', (p) => {
        this.#subscribedTo.set(String(p?.pubkey ?? ''))
      }),
      EffectBus.on<{ pubkey?: string }>('swarm:following-changed', (p) => {
        this.#following.set(String(p?.pubkey ?? ''))
      }),
    )
  }

  /** Click on the banner row toggles the participant panel. Solo
   *  state ("first one here") has nothing to drill into — clicks
   *  while alone are no-ops. */
  onBannerClick(): void {
    if (this.#alone()) return
    this.expanded.set(!this.expanded())
  }

  /** Row action: flip subscribe for this pubkey. Single-target — if
   *  already subscribed to someone else, the swarm switches. Calling
   *  with the same pubkey unsubscribes (toggle semantics). */
  onSubscribeToggle(pubkey: string): void {
    const swarm = (window as { ioc?: { get: (k: string) => unknown } }).ioc?.get?.(
      '@diamondcoreprocessor.com/SwarmDrone',
    ) as SwarmConsumerApi | undefined
    if (!swarm?.subscribeTo) return
    const current = swarm.subscribedTo()
    void swarm.subscribeTo(current === pubkey ? null : pubkey)
  }

  /** Row action: flip follow (nav-sync) for this pubkey. */
  onFollowToggle(pubkey: string): void {
    const swarm = (window as { ioc?: { get: (k: string) => unknown } }).ioc?.get?.(
      '@diamondcoreprocessor.com/SwarmDrone',
    ) as SwarmConsumerApi | undefined
    if (!swarm?.follow) return
    const current = swarm.following()
    void swarm.follow(current === pubkey ? null : pubkey)
  }

  ngOnDestroy(): void {
    for (const u of this.#unsubs) u()
    this.#unsubs.length = 0
  }
}
