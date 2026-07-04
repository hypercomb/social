// diamondcoreprocessor.com/commands/home.queen.ts
//
// `/home` — the home view behaviour, the homely sibling of `/website` and
// `/tutor`. Renders the current tile area as a warm home surface: children
// become widget cards and doorways, and an empty area invites you to seed
// starter widgets and begin your first collection.
//
// Syntax:
//   /home                       — toggle hexagons ↔ home view
//   /home on | open | go        — switch to home view
//   /home off | hex | hexagons  — back to hexagons
//   /home here | mark           — mark THIS cell as a home (writes the
//                                 `visual:home:page` decoration so the view
//                                 toggle appears on it; re-run to unmark)
//
// The render itself is HomeViewDrone (presentation/tiles/home-view.drone.ts);
// widget tiles carry `visual:home:widget` decorations and render through the
// home-widget registry (see home-widgets.ts).

import { QueenBee, EffectBus } from '@hypercomb/core'
import type { VisualBeeRegistry } from './visual-bee-registry.js'
import { writeDecoration, listDecorations, removeDecoration } from './decoration-manifest.js'

/** Marks a cell as a home page — the ViewBee toggle gates on this. */
export const HOME_PAGE_KIND = 'visual:home:page'

const get = <T,>(key: string): T | undefined => (window as { ioc?: { get?: (k: string) => T } }).ioc?.get?.(key)

const ON_KEYWORDS = new Set(['on', 'open', 'go', 'view'])
const OFF_KEYWORDS = new Set(['off', 'hex', 'hexagons', 'hexagon', 'close'])

type ViewModeShape = { mode: string; setMode(next: string): void }
type LineageShape = { explorerSegments?: () => readonly string[] }

export class HomeQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'home'
  override readonly aliases = []
  override description = 'Home view — render this tile area as your home; children become widgets and doorways'
  override descriptionKey = 'slash.home'
  override options = ['on', 'off', 'here']
  override examples = [
    { input: '/home', result: 'Toggles the home view over the current tile area' },
    { input: '/home here', result: 'Marks this cell as a home page (toggle appears)' },
  ]

  override slashComplete(args: string): readonly string[] {
    const q = args.trim().toLowerCase()
    return ['on', 'off', 'here'].filter(o => o.startsWith(q))
  }

  protected async execute(args: string): Promise<void> {
    const a = args.trim().toLowerCase()

    if (a === 'here' || a === 'mark') { await this.#markHere(); return }

    const vm = get<ViewModeShape>('@hypercomb.social/ViewMode')
    if (!vm) { this.#log('Home view unavailable'); return }

    if (ON_KEYWORDS.has(a)) { vm.setMode('home'); this.#log('Home view — on', '⌂'); return }
    if (OFF_KEYWORDS.has(a)) { vm.setMode('hexagons'); this.#log('Home view — off', '○'); return }

    // Bare /home (or 'toggle') — flip.
    const next = vm.mode === 'home' ? 'hexagons' : 'home'
    vm.setMode(next)
    this.#log(next === 'home' ? 'Home view — on' : 'Home view — off', next === 'home' ? '⌂' : '○')
  }

  #segments(): string[] {
    const lineage = get<LineageShape>('@hypercomb.social/Lineage')
    return (lineage?.explorerSegments?.() ?? []).map(s => String(s ?? '').trim()).filter(Boolean)
  }

  /** Mark the current cell as a home page; re-run clears the mark. */
  async #markHere(): Promise<void> {
    const segments = this.#segments()
    const where = segments.length ? `/${segments.join('/')}` : '/'
    try {
      const existing = await listDecorations({ kind: HOME_PAGE_KIND, segments })
      if (existing.length) {
        for (const e of existing) removeDecoration({ sig: e.sig, segments })
        this.#log(`Home — ${where} is no longer marked as a home`, '○')
        return
      }
      await writeDecoration({
        kind: HOME_PAGE_KIND,
        appliesTo: segments,
        segments,
        payload: { icon: 'cottage' },
        mark: 'persistent',
      })
      this.#log(`Home — ${where} marked; toggle /home to live in it`, '⌂')
    } catch (err) {
      console.warn('[/home here] failed', err)
      this.#log('Home — could not mark this cell (see console)')
    }
  }

  #log(message: string, icon = '⌂'): void {
    EffectBus.emit('activity:log', { message, icon })
  }
}

const _home = new HomeQueenBee()
window.ioc.register('@diamondcoreprocessor.com/HomeQueenBee', _home)

// Visual-bee registration — declares the view identity so the renderer +
// ViewBee toggle + adoption UI can discover the home behaviour. The toggle
// surfaces on any cell carrying a `visual:home:page` decoration; clicking it
// flips ViewMode (hexagons ⇄ home).
;(window as { ioc?: { whenReady?: <T>(k: string, cb: (v: T) => void) => void } }).ioc?.whenReady?.<VisualBeeRegistry>(
  '@diamondcoreprocessor.com/VisualBeeRegistry',
  (registry) => {
    registry.register({
      view: 'home',
      slashCommand: '/home',
      iconName: 'home',
      toggleIcon: 'cottage',
      behavior: 'render',
      decorationKind: HOME_PAGE_KIND,
      labelKey: 'view.home',
      descriptionKey: 'view.home.description',
      queenKey: '@diamondcoreprocessor.com/HomeQueenBee',
      adoptable: true,
    })
  },
)
