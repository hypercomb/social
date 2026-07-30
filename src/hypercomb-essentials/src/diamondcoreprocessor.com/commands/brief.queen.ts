// /brief — attach or open the Living Brief document view.
//
// The decoration is deliberately only a declaration. Titles, pheromones and
// notes remain on their original tiles; the renderer reads them live.

import { QueenBee, EffectBus } from '@hypercomb/core'
import type { VisualBeeRegistry } from './visual-bee-registry.js'
import { listDecorations, removeDecoration, writeDecoration } from './decoration-manifest.js'

export const LIVING_BRIEF_VIEW = 'living-brief'
export const LIVING_BRIEF_KIND = 'visual:document:living-brief'
const LIBRARY_VIEW_KINDS = [
  LIVING_BRIEF_KIND,
  'visual:document:evidence-atlas',
  'visual:document:knowledge-studio',
] as const

type ViewModeShape = { mode: string; setMode(next: string): void }
type LineageShape = { explorerSegments?: () => readonly string[] }

const get = <T,>(key: string): T | undefined =>
  (window as { ioc?: { get?: (k: string) => T } }).ioc?.get?.(key)

export class BriefQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'brief'
  override readonly aliases = ['document', 'living-brief']
  override description = 'Living Brief — read this category and its children as a professional document'
  override options = ['on', 'off', 'here']
  override examples = [
    { input: '/brief here', result: 'Makes the current category a Living Brief' },
    { input: '/brief', result: 'Opens or closes its document view' },
  ]

  protected async execute(args: string): Promise<void> {
    const action = args.trim().toLowerCase()
    if (action === 'here' || action === 'mark' || action === 'attach') {
      await this.#toggleDeclaration()
      return
    }
    const vm = get<ViewModeShape>('@hypercomb.social/ViewMode')
    if (!vm) return
    if (action === 'off' || action === 'close' || action === 'hexagons') {
      vm.setMode('hexagons')
      return
    }
    vm.setMode(action === 'on' || action === 'open' || action === 'view'
      ? LIVING_BRIEF_VIEW
      : vm.mode === LIVING_BRIEF_VIEW ? 'hexagons' : LIVING_BRIEF_VIEW)
  }

  async #toggleDeclaration(): Promise<void> {
    const segments = [...(get<LineageShape>('@hypercomb.social/Lineage')?.explorerSegments?.() ?? [])]
    const existing = await listDecorations({ kind: LIVING_BRIEF_KIND, segments })
    if (existing.length) {
      for (const record of existing) removeDecoration({ sig: record.sig, segments })
      EffectBus.emit('activity:log', { message: 'Living Brief removed from this category', icon: 'description' })
      return
    }
    // A layer has one chosen document projection. Applying this one replaces
    // another library view without touching unrelated behaviours.
    for (const kind of LIBRARY_VIEW_KINDS) {
      if (kind === LIVING_BRIEF_KIND) continue
      const prior = await listDecorations({ kind, segments })
      for (const record of prior) removeDecoration({ sig: record.sig, segments })
    }
    await writeDecoration({
      kind: LIVING_BRIEF_KIND,
      appliesTo: segments,
      segments,
      payload: { version: 1, layout: 'editorial' },
      mark: 'persistent',
    })
    EffectBus.emit('activity:log', { message: 'Living Brief attached — its document now follows these tiles live', icon: 'description' })
  }
}

const _brief = new BriefQueenBee()
window.ioc.register('@diamondcoreprocessor.com/BriefQueenBee', _brief)

;(window as { ioc?: { whenReady?: <T>(k: string, cb: (v: T) => void) => void } }).ioc?.whenReady?.<VisualBeeRegistry>(
  '@diamondcoreprocessor.com/VisualBeeRegistry',
  registry => registry.register({
    view: LIVING_BRIEF_VIEW,
    slashCommand: '/brief',
    iconName: 'description',
    toggleIcon: 'description',
    behavior: 'render',
    decorationKind: LIVING_BRIEF_KIND,
    labelKey: 'view.livingBrief',
    descriptionKey: 'view.livingBrief.description',
    queenKey: '@diamondcoreprocessor.com/BriefQueenBee',
    adoptable: true,
    adoptScope: 'hierarchy',
    attachable: true,
    opensOnTileClick: true,
    pheromones: ['platform:mobile', 'platform:desktop'],
  }),
)
