// hypercomb-shared/ui/preview-banner/preview-banner.component.ts
//
// The "adopt for review" banner — the visible face of a static-hive
// preview (essentials sharing/hive-visit.drone.ts). While a preview is
// active the visitor is browsing a FOREIGN branch rendered from a
// session-only virtual head: nothing is written, commits are refused, a
// refresh forgets it. This strip names that state and carries the ONLY
// two exits: Adopt (fold it into your hive — the one real adopt gesture)
// and Dismiss (walk away, nothing kept).
//
// Driven entirely by the `preview:mode` effect (last-value replay makes
// mount order irrelevant). It has no buttons: a visitor shell has no hive to
// adopt into, and a participant's link is an OFFER (hive-visit.drone.ts) —
// the swarm model, never a whole-branch adopt.

import { registerShellSurface } from '@hypercomb/runtime/shell-surface-registry'
import { Component, signal, computed, type OnDestroy, type OnInit } from '@angular/core'
import { EffectBus } from '@hypercomb/core'
import { TranslatePipe } from '../../core/i18n.pipe'

interface PreviewModePayload {
  active?: boolean
  label?: string
  pubkey?: string
  hosts?: readonly string[]
  tiles?: number
}

/** Who a key is, at its host (essentials NameService), consumed via IoC at
 *  runtime — shared never imports modules. */
interface NameApi {
  nameOf: (pubkey: string, host?: string) => { display: string } | null
  label: (pubkey: string, host?: string, unverifiedFallback?: string) => string
}

const NAMES_KEY = '@diamondcoreprocessor.com/NameService'
const ioc = () => (window as { ioc?: { get?: (k: string) => unknown; whenReady?: (k: string, cb: (v: unknown) => void) => void } }).ioc

@Component({
  selector: 'hc-preview-banner',
  standalone: true,
  imports: [TranslatePipe],
  templateUrl: './preview-banner.component.html',
  styleUrls: ['./preview-banner.component.scss'],
})
export class PreviewBannerComponent implements OnInit, OnDestroy {

  #unsubs: (() => void)[] = []

  readonly #state = signal<PreviewModePayload | null>(null)
  /** Bumped when a host vouches for a name, or the name service arrives. */
  readonly #namesVersion = signal(0)

  readonly visible = computed(() => this.#state()?.active === true)
  readonly label = computed(() => String(this.#state()?.label ?? ''))
  readonly tiles = computed(() => Number(this.#state()?.tiles ?? 0))
  /** Who published it: a name one of the preview's byte hosts vouches for
   *  (`jwize@jwize.com`), else one a host the key itself advertised vouches
   *  for, else a short npub. Each byte host is asked for this banner only —
   *  the link that named them is not the key's word, so they are never
   *  recorded as its hosts elsewhere — and only the first few (the primary
   *  leads). Without the name service, the pubkey's first 8 hex chars. */
  readonly publisherShort = computed(() => {
    this.#namesVersion()
    const state = this.#state()
    const pubkey = String(state?.pubkey ?? '')
    const names = ioc()?.get?.(NAMES_KEY) as NameApi | undefined
    if (!names || !pubkey) return pubkey.slice(0, 8)
    for (const host of (state?.hosts ?? []).slice(0, 4)) {
      const verified = names.nameOf(pubkey, String(host))
      if (verified) return verified.display
    }
    return names.label(pubkey)
  })

  ngOnInit(): void {
    this.#unsubs.push(
      EffectBus.on<PreviewModePayload>('preview:mode', (p) => {
        this.#state.set(p ?? null)
      }),
      EffectBus.on('names:changed', () => {
        this.#namesVersion.update(v => v + 1)
      }),
    )
    ioc()?.whenReady?.(NAMES_KEY, () => this.#namesVersion.update(v => v + 1))
  }

  ngOnDestroy(): void {
    for (const u of this.#unsubs) u()
    this.#unsubs.length = 0
  }
}

// Registry-fed shell surface — mounted by <hc-shell-surfaces>, never by an
// app.html tag (see shell-surface-registry.ts).
registerShellSurface({
  name: 'hc-preview-banner',
  owner: '@hypercomb.shared/PreviewBannerComponent',
  component: PreviewBannerComponent,
  order: 340,
})
