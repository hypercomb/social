// hypercomb-shared/ui/example-hives/example-hives-offer.component.ts
//
// The first-boot EXAMPLE HIVES card — shown by the essentials worker
// (sharing/example-hives.worker.ts) when a fresh install boots onto an
// empty hive root. Pure renderer: the worker owns detection, the roster,
// and the adopt calls; this card renders the offer and emits the two
// gestures (`examples:adopt` per example, `examples:dismiss` to close).
//
// Nothing folds without a click. Closing the card writes nothing to the
// hive — the worker just persists a local "don't offer again" flag.
//
// Driven by `examples:offer` (last-value replay), `examples:adopted`
// (per-example status), and the broker's `adopt:progress` (climbing piece
// counts while a fold pulls its closure — loaders always show counts).

import { registerShellSurface } from '../../core/shell-surface-registry'
import { Component, signal, computed, type OnDestroy, type OnInit } from '@angular/core'
import { EffectBus } from '@hypercomb/core'
import { TranslatePipe } from '../../core/i18n.pipe'

interface ExampleEntry {
  name: string
  head: string
  tiles?: number
  coverSig?: string
  description?: Record<string, string>
}
interface OfferPayload { active?: boolean; examples?: ExampleEntry[] }
interface AdoptedPayload { name?: string; status?: string }
interface AdoptProgressPayload { layers?: number; leaves?: number; failed?: number }
interface CellCountPayload { count?: number; settled?: boolean }

type RowStatus = 'idle' | 'adopting' | 'added' | 'unavailable'

@Component({
  selector: 'hc-example-hives-offer',
  standalone: true,
  imports: [TranslatePipe],
  templateUrl: './example-hives-offer.component.html',
  styleUrls: ['./example-hives-offer.component.scss'],
})
export class ExampleHivesOfferComponent implements OnInit, OnDestroy {

  #unsubs: (() => void)[] = []

  readonly #offer = signal<OfferPayload | null>(null)
  readonly #status = signal<Record<string, RowStatus>>({})
  readonly #progress = signal(0)
  readonly #hiddenCovers = signal<Record<string, boolean>>({})
  readonly #renderSettledEmpty = signal(false)

  readonly visible = computed(() =>
    this.#renderSettledEmpty()
    && this.#offer()?.active === true
    && (this.#offer()?.examples?.length ?? 0) > 0,
  )
  readonly examples = computed(() => this.#offer()?.examples ?? [])
  readonly anyAdded = computed(() => Object.values(this.#status()).includes('added'))
  readonly progressCount = computed(() => this.#progress())

  ngOnInit(): void {
    this.#unsubs.push(
      EffectBus.on<OfferPayload>('examples:offer', (p) => {
        this.#offer.set(p ?? null)
      }),
      EffectBus.on<CellCountPayload>('render:cell-count', (p) => {
        // History can report an empty root while its tiles are still hydrating.
        // Only the renderer's settled-empty result may reveal this surface.
        // Any tile count hides it immediately, even during another render pass.
        this.#renderSettledEmpty.set(p?.count === 0 && p?.settled === true)
      }),
      EffectBus.on<AdoptedPayload>('examples:adopted', (p) => {
        const name = String(p?.name ?? '')
        if (!name) return
        const status = String(p?.status ?? '')
        const row: RowStatus = status === 'adopting' ? 'adopting'
          : (status === 'committed' || status === 'exists') ? 'added'
            : 'unavailable'
        this.#status.update(s => ({ ...s, [name]: row }))
        if (row === 'adopting') this.#progress.set(0)
      }),
      EffectBus.on<AdoptProgressPayload>('adopt:progress', (p) => {
        // Counts climb only while one of our rows is folding; the broker
        // reports totals-so-far, so the latest event is the count.
        if (!Object.values(this.#status()).includes('adopting')) return
        this.#progress.set((p?.layers ?? 0) + (p?.leaves ?? 0))
      }),
    )
  }

  status(name: string): RowStatus {
    return this.#status()[name] ?? 'idle'
  }

  displayName(e: ExampleEntry): string {
    return e.name.replace(/-/g, ' ')
  }

  /** Descriptions are per-locale roster data (they must render before any
   *  catalog-bearing content exists); pick by the document locale the i18n
   *  service maintains, falling back to English. */
  description(e: ExampleEntry): string {
    const lang = (document.documentElement.lang || 'en').toLowerCase()
    const d = e.description ?? {}
    return d[lang] ?? d[lang.split('-')[0]] ?? d['en'] ?? ''
  }

  coverUrl(e: ExampleEntry): string {
    return e.coverSig ? `/@resource/${e.coverSig}` : ''
  }

  coverHidden(name: string): boolean {
    return this.#hiddenCovers()[name] === true
  }

  onCoverError(name: string): void {
    this.#hiddenCovers.update(h => ({ ...h, [name]: true }))
  }

  onAdopt(e: ExampleEntry): void {
    const s = this.status(e.name)
    if (s === 'adopting' || s === 'added') return
    EffectBus.emit('examples:adopt', { name: e.name })
  }

  onDismiss(): void {
    EffectBus.emit('examples:dismiss', {})
  }

  /** "Add a tile" and "Show me how" are the empty-hive gestures folded in from
   *  collection-empty-prompt's `root` variant. This card stays a PURE RENDERER:
   *  it closes the offer and emits, and the drone (which owns the command-line
   *  focus dance) does the work. Shared never reimplements module behaviour. */
  onAddTile(): void {
    EffectBus.emit('examples:dismiss', {})
    EffectBus.emit('hive:empty:add-tile', {})
  }

  onTour(): void {
    EffectBus.emit('examples:dismiss', {})
    EffectBus.emit('tutorial:start', {})
  }

  ngOnDestroy(): void {
    for (const u of this.#unsubs) u()
    this.#unsubs.length = 0
  }
}

// Registry-fed shell surface — mounted by <hc-shell-surfaces>, never by an
// app.html tag (see shell-surface-registry.ts).
registerShellSurface({
  name: 'hc-example-hives-offer',
  owner: '@hypercomb.shared/ExampleHivesOfferComponent',
  component: ExampleHivesOfferComponent,
  order: 350,
})
