// hypercomb-shared/ui/layer-cycle-strip/layer-cycle-strip.component.ts
//
// Floating strip overlay listing every peer publishing at the current
// swarm location. Each entry shows a glow dot in the peer's color
// (deterministic from pubkey) + a short pubkey label.
//
// Visibility: hidden when participant count is zero. When peers are
// present and a peer is spotlit, that entry has a brighter ring.
// Clicking an entry sets that peer as the spotlight target; clicking
// the currently-active entry dismisses back to default merged render.
//
// Drives in lockstep with alt+wheel via the shared SpotlightService.

import {
  Component,
  computed,
  signal,
  type OnInit,
  type OnDestroy,
} from '@angular/core'
import { EffectBus } from '@hypercomb/core'
import { HcWidgetDirective } from '../widget-zoom/hc-widget.directive'

const SPOTLIGHT_KEY = '@diamondcoreprocessor.com/SpotlightService'
const SWARM_KEY = '@diamondcoreprocessor.com/SwarmDrone'

interface SpotlightServiceLike {
  readonly activePeer: string | null
  participants(): readonly string[]
  set(pubkey: string | null): void
  dismiss(): void
}

interface SwarmDroneLike {
  participantsAtCurrentSig?: () => readonly string[]
}

/** Deterministic per-pubkey color (DJB2 → HSL → RGB). Same algorithm
 *  show-cell uses for label-derived tints, so identity color is
 *  consistent across the canvas, the strip, and any future affordance.
 *  Returns CSS rgb() string. */
function pubkeyColor(pubkey: string): string {
  if (!pubkey) return 'rgb(160, 160, 160)'
  let hash = 5381
  for (let i = 0; i < pubkey.length; i++) hash = ((hash << 5) + hash + pubkey.charCodeAt(i)) | 0
  hash = hash >>> 0
  const hue = (hash % 360) / 360
  const sat = 0.65
  const lit = 0.6
  const c = (1 - Math.abs(2 * lit - 1)) * sat
  const x = c * (1 - Math.abs(((hue * 6) % 2) - 1))
  const m = lit - c / 2
  let r = 0, g = 0, b = 0
  const sector = (hue * 6) | 0
  if (sector === 0)      { r = c; g = x; b = 0 }
  else if (sector === 1) { r = x; g = c; b = 0 }
  else if (sector === 2) { r = 0; g = c; b = x }
  else if (sector === 3) { r = 0; g = x; b = c }
  else if (sector === 4) { r = x; g = 0; b = c }
  else                   { r = c; g = 0; b = x }
  const R = Math.round((r + m) * 255)
  const G = Math.round((g + m) * 255)
  const B = Math.round((b + m) * 255)
  return `rgb(${R}, ${G}, ${B})`
}

interface PeerEntry {
  readonly pubkey: string
  readonly label: string
  readonly color: string
  readonly active: boolean
}

@Component({
  selector: 'hc-layer-cycle-strip',
  standalone: true,
  imports: [HcWidgetDirective],
  templateUrl: './layer-cycle-strip.component.html',
  styleUrls: ['./layer-cycle-strip.component.scss'],
})
export class LayerCycleStripComponent implements OnInit, OnDestroy {

  #participants = signal<readonly string[]>([])
  #activePeer = signal<string | null>(null)

  readonly entries = computed<PeerEntry[]>(() => {
    const list = this.#participants()
    const active = this.#activePeer()
    return list.map(pubkey => ({
      pubkey,
      label: pubkey.slice(0, 8),
      color: pubkeyColor(pubkey),
      active: pubkey === active,
    }))
  })

  readonly visible = computed(() => this.entries().length > 0)

  #peersUnsub: (() => void) | null = null
  #spotlightUnsub: (() => void) | null = null

  ngOnInit(): void {
    // Initial snapshot — covers the case where peers are already
    // present (publishing from another tab, relay echo on join, etc.).
    this.#refresh()

    // The swarm fires peers-changed on every join / leave / stale /
    // mode toggle. We re-snapshot the participant list and let the
    // spotlight service reconcile on its own.
    this.#peersUnsub = EffectBus.on('swarm:peers-changed', () => this.#refresh())

    // Spotlight changes — the strip rerenders so the active entry
    // highlights correctly. activePeer comes from the event payload.
    this.#spotlightUnsub = EffectBus.on<{ activePeer: string | null }>(
      'spotlight:changed',
      (payload) => this.#activePeer.set(payload?.activePeer ?? null),
    )
  }

  ngOnDestroy(): void {
    this.#peersUnsub?.()
    this.#spotlightUnsub?.()
  }

  #refresh(): void {
    const swarm = window.ioc.get<SwarmDroneLike>(SWARM_KEY)
    const list = swarm?.participantsAtCurrentSig?.() ?? []
    this.#participants.set(list)
    // If the active peer just dropped out of the participant list,
    // the SpotlightService.reconcile() (subscribed to the same event)
    // will dismiss; our #activePeer signal will follow via the
    // spotlight:changed echo.
  }

  onEntryClick(entry: PeerEntry): void {
    const spotlight = window.ioc.get<SpotlightServiceLike>(SPOTLIGHT_KEY)
    if (!spotlight) return
    if (entry.active) spotlight.dismiss()
    else spotlight.set(entry.pubkey)
  }
}
