// /brief — attach or open the Living Brief document view.
//
// The decoration is deliberately only a declaration. Titles, pheromones and
// notes remain on their original tiles; the renderer reads them live.

import { QueenBee, EffectBus } from '@hypercomb/core'
import type { VisualBeeRegistry } from './visual-bee-registry.js'
import {
  listDecorations,
  removeDecorationAndWait,
  writeDecoration,
} from './decoration-manifest.js'
import {
  VIEW_SOURCE_SCOPES,
  viewSourceScopeFromArgs,
  writeViewSourceScope,
  type ViewSourceScope,
} from './view-source-scope.js'

export const LIVING_BRIEF_VIEW = 'living-brief'
export const LIVING_BRIEF_KIND = 'visual:document:living-brief'

type ViewModeShape = { mode: string; setMode(next: string): void }
type LineageShape = { explorerSegments?: () => readonly string[] }

const get = <T,>(key: string): T | undefined =>
  (window as { ioc?: { get?: (k: string) => T } }).ioc?.get?.(key)

export class BriefQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'brief'
  override readonly aliases = ['document', 'living-brief']
  override description = 'Living Brief — read this category and its children as a professional document'
  override options = [
    'on', 'off', 'here', 'here layer', 'here hierarchy',
    'scope layer', 'scope hierarchy',
  ]
  override examples = [
    { input: '/brief here', result: 'Makes the current category a Living Brief' },
    { input: '/brief here hierarchy', result: 'Builds the brief from the complete descendant hierarchy' },
    { input: '/brief', result: 'Opens or closes its document view' },
  ]

  protected async execute(args: string): Promise<void> {
    const action = args.trim().toLowerCase()
    const [verb = '', reach = ''] = action.split(/\s+/, 2)
    if (verb === 'scope') {
      const scope = viewSourceScopeFromArgs(reach)
      if (scope) await this.#setDeclarationScope(scope)
      return
    }
    if (verb === 'here' || verb === 'mark' || verb === 'attach') {
      await this.#toggleDeclaration(viewSourceScopeFromArgs(reach))
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

  #segments(): string[] {
    return [...(get<LineageShape>('@hypercomb.social/Lineage')?.explorerSegments?.() ?? [])]
  }

  async #toggleDeclaration(requestedScope: ViewSourceScope | null): Promise<void> {
    const segments = this.#segments()
    const existing = await listDecorations({ kind: LIVING_BRIEF_KIND, segments })
    if (existing.length && requestedScope) {
      await this.#setDeclarationScope(requestedScope)
      return
    }
    if (existing.length) {
      await Promise.all(existing.map(record =>
        removeDecorationAndWait({ sig: record.sig, segments })))
      EffectBus.emit('activity:log', { message: 'Living Brief removed from this category', icon: 'description' })
      return
    }
    await this.#attach(segments, requestedScope ?? 'layer')
  }

  async #setDeclarationScope(scope: ViewSourceScope): Promise<void> {
    const segments = this.#segments()
    const existing = await listDecorations({ kind: LIVING_BRIEF_KIND, segments })
    if (!existing.length) {
      await this.#attach(segments, scope)
      return
    }
    await writeViewSourceScope({
      kind: LIVING_BRIEF_KIND,
      segments,
      scope,
      defaults: { version: 1, layout: 'editorial' },
    })
    EffectBus.emit('activity:log', {
      message: `Living Brief now reads the ${scope === 'hierarchy' ? 'whole hierarchy' : 'current layer'}`,
      icon: scope === 'hierarchy' ? 'account_tree' : 'layers',
    })
  }

  async #attach(segments: readonly string[], scope: ViewSourceScope): Promise<void> {
    await writeDecoration({
      kind: LIVING_BRIEF_KIND,
      appliesTo: segments,
      segments,
      payload: { version: 1, layout: 'editorial', sourceScope: scope },
      mark: 'persistent',
    })
    EffectBus.emit('activity:log', {
      message: `Living Brief attached — reading the ${scope === 'hierarchy' ? 'whole hierarchy' : 'current layer'}`,
      icon: 'description',
    })
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
    sourceScopes: VIEW_SOURCE_SCOPES,
    attachable: true,
    // Opens in place when its own tile icon is clicked. The preferred/default
    // choice only accents that icon; the tile body still enters the hexagon.
    opensOnTileClick: true,
    pheromones: ['platform:mobile', 'platform:desktop'],
  }),
)
