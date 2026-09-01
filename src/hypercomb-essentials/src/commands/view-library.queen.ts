// The analytical and editorial siblings of Living Brief.

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

export const EVIDENCE_ATLAS_VIEW = 'evidence-atlas'
export const EVIDENCE_ATLAS_KIND = 'visual:document:evidence-atlas'
export const KNOWLEDGE_STUDIO_VIEW = 'knowledge-studio'
export const KNOWLEDGE_STUDIO_KIND = 'visual:document:knowledge-studio'

type Mode = { mode: string; setMode(next: string): void }
type Lineage = { explorerSegments?: () => readonly string[] }
const get = <T,>(key: string): T | undefined => window.ioc?.get<T>(key)

abstract class LibraryViewQueen extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  abstract readonly view: string
  abstract readonly kind: string
  abstract readonly label: string

  protected async execute(args: string): Promise<void> {
    const action = args.trim().toLowerCase()
    const [verb = '', reach = ''] = action.split(/\s+/, 2)
    if (verb === 'scope') {
      const scope = viewSourceScopeFromArgs(reach)
      if (scope) await this.#setScope(scope)
      return
    }
    if (verb === 'here' || verb === 'mark' || verb === 'attach') {
      await this.#toggle(viewSourceScopeFromArgs(reach))
      return
    }
    const vm = get<Mode>('@hypercomb.social/ViewMode')
    if (!vm) return
    if (['off', 'close', 'hexagons'].includes(action)) vm.setMode('hexagons')
    else vm.setMode(vm.mode === this.view && !['on', 'open', 'view'].includes(action) ? 'hexagons' : this.view)
  }

  #segments(): string[] {
    return [...(get<Lineage>('@hypercomb.social/Lineage')?.explorerSegments?.() ?? [])]
  }

  async #toggle(requestedScope: ViewSourceScope | null): Promise<void> {
    const segments = this.#segments()
    const existing = await listDecorations({ kind: this.kind, segments })
    if (existing.length && requestedScope) {
      await this.#setScope(requestedScope)
      return
    }
    if (existing.length) {
      await Promise.all(existing.map(record =>
        removeDecorationAndWait({ sig: record.sig, segments })))
      EffectBus.emit('activity:log', { message: `${this.label} removed from this category`, icon: 'view_quilt' })
      return
    }
    await this.#attach(segments, requestedScope ?? 'layer')
  }

  async #setScope(scope: ViewSourceScope): Promise<void> {
    const segments = this.#segments()
    const existing = await listDecorations({ kind: this.kind, segments })
    if (!existing.length) {
      await this.#attach(segments, scope)
      return
    }
    await writeViewSourceScope({
      kind: this.kind,
      segments,
      scope,
      defaults: { version: 1 },
    })
    EffectBus.emit('activity:log', {
      message: `${this.label} now reads the ${scope === 'hierarchy' ? 'whole hierarchy' : 'current layer'}`,
      icon: scope === 'hierarchy' ? 'account_tree' : 'layers',
    })
  }

  async #attach(segments: readonly string[], scope: ViewSourceScope): Promise<void> {
    await writeDecoration({
      kind: this.kind, appliesTo: segments, segments,
      payload: { version: 1, sourceScope: scope }, mark: 'persistent',
    })
    EffectBus.emit('activity:log', {
      message: `${this.label} attached — reading the ${scope === 'hierarchy' ? 'whole hierarchy' : 'current layer'}`,
      icon: 'view_quilt',
    })
  }
}

export class AtlasQueenBee extends LibraryViewQueen {
  readonly command = 'atlas'
  readonly view = EVIDENCE_ATLAS_VIEW
  readonly kind = EVIDENCE_ATLAS_KIND
  readonly label = 'Evidence Atlas'
  override description = 'Evidence Atlas — organize notes into questions, evidence, decisions, and open issues'
  override options = ['on', 'off', 'here', 'here layer', 'here hierarchy', 'scope layer', 'scope hierarchy']
}

export class StudioQueenBee extends LibraryViewQueen {
  readonly command = 'studio'
  readonly view = KNOWLEDGE_STUDIO_VIEW
  readonly kind = KNOWLEDGE_STUDIO_KIND
  readonly label = 'Knowledge Studio'
  override description = 'Knowledge Studio — turn categories into a guided editorial sequence'
  override options = ['on', 'off', 'here', 'here layer', 'here hierarchy', 'scope layer', 'scope hierarchy']
}

const atlas = new AtlasQueenBee()
const studio = new StudioQueenBee()
window.ioc.register('@diamondcoreprocessor.com/AtlasQueenBee', atlas)
window.ioc.register('@diamondcoreprocessor.com/StudioQueenBee', studio)

;(window as { ioc?: { whenReady?: <T>(k: string, cb: (v: T) => void) => void } }).ioc?.whenReady?.<VisualBeeRegistry>(
  '@diamondcoreprocessor.com/VisualBeeRegistry',
  registry => {
    registry.register({
      view: EVIDENCE_ATLAS_VIEW, slashCommand: '/atlas', iconName: 'account_tree',
      toggleIcon: 'hub', behavior: 'render', decorationKind: EVIDENCE_ATLAS_KIND,
      labelKey: 'view.evidenceAtlas', descriptionKey: 'view.evidenceAtlas.description',
      queenKey: '@diamondcoreprocessor.com/AtlasQueenBee', adoptable: true,
      adoptScope: 'hierarchy', sourceScopes: VIEW_SOURCE_SCOPES,
      attachable: true, opensOnTileClick: true,
      pheromones: ['platform:mobile', 'platform:desktop'],
    })
    registry.register({
      view: KNOWLEDGE_STUDIO_VIEW, slashCommand: '/studio', iconName: 'view_carousel',
      toggleIcon: 'view_carousel', behavior: 'render', decorationKind: KNOWLEDGE_STUDIO_KIND,
      labelKey: 'view.knowledgeStudio', descriptionKey: 'view.knowledgeStudio.description',
      queenKey: '@diamondcoreprocessor.com/StudioQueenBee', adoptable: true,
      adoptScope: 'hierarchy', sourceScopes: VIEW_SOURCE_SCOPES,
      attachable: true, opensOnTileClick: true,
      pheromones: ['platform:mobile', 'platform:desktop'],
    })
  },
)
