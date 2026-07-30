// The analytical and editorial siblings of Living Brief.

import { QueenBee, EffectBus } from '@hypercomb/core'
import type { VisualBeeRegistry } from './visual-bee-registry.js'
import { listDecorations, removeDecoration, writeDecoration } from './decoration-manifest.js'

export const EVIDENCE_ATLAS_VIEW = 'evidence-atlas'
export const EVIDENCE_ATLAS_KIND = 'visual:document:evidence-atlas'
export const KNOWLEDGE_STUDIO_VIEW = 'knowledge-studio'
export const KNOWLEDGE_STUDIO_KIND = 'visual:document:knowledge-studio'
const LIBRARY_VIEW_KINDS = [
  'visual:document:living-brief',
  EVIDENCE_ATLAS_KIND,
  KNOWLEDGE_STUDIO_KIND,
] as const

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
    if (action === 'here' || action === 'mark' || action === 'attach') {
      const segments = [...(get<Lineage>('@hypercomb.social/Lineage')?.explorerSegments?.() ?? [])]
      const existing = await listDecorations({ kind: this.kind, segments })
      if (existing.length) {
        existing.forEach(record => removeDecoration({ sig: record.sig, segments }))
        EffectBus.emit('activity:log', { message: `${this.label} removed from this category`, icon: 'view_quilt' })
      } else {
        // The toolwindow is a chooser, not a stack: one document projection
        // per layer. Leave websites, slides, and other unrelated behaviours
        // alone; exclusivity belongs only to this view library.
        for (const kind of LIBRARY_VIEW_KINDS) {
          if (kind === this.kind) continue
          const prior = await listDecorations({ kind, segments })
          for (const record of prior) removeDecoration({ sig: record.sig, segments })
        }
        await writeDecoration({
          kind: this.kind, appliesTo: segments, segments,
          payload: { version: 1 }, mark: 'persistent',
        })
        EffectBus.emit('activity:log', { message: `${this.label} attached`, icon: 'view_quilt' })
      }
      return
    }
    const vm = get<Mode>('@hypercomb.social/ViewMode')
    if (!vm) return
    if (['off', 'close', 'hexagons'].includes(action)) vm.setMode('hexagons')
    else vm.setMode(vm.mode === this.view && !['on', 'open', 'view'].includes(action) ? 'hexagons' : this.view)
  }
}

export class AtlasQueenBee extends LibraryViewQueen {
  readonly command = 'atlas'
  override readonly aliases = ['evidence', 'evidence-atlas']
  readonly view = EVIDENCE_ATLAS_VIEW
  readonly kind = EVIDENCE_ATLAS_KIND
  readonly label = 'Evidence Atlas'
  override description = 'Evidence Atlas — organize notes into questions, evidence, decisions, and open issues'
  override options = ['on', 'off', 'here']
}

export class StudioQueenBee extends LibraryViewQueen {
  readonly command = 'studio'
  override readonly aliases = ['knowledge-studio']
  readonly view = KNOWLEDGE_STUDIO_VIEW
  readonly kind = KNOWLEDGE_STUDIO_KIND
  readonly label = 'Knowledge Studio'
  override description = 'Knowledge Studio — turn categories into a guided editorial sequence'
  override options = ['on', 'off', 'here']
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
      toggleIcon: 'account_tree', behavior: 'render', decorationKind: EVIDENCE_ATLAS_KIND,
      labelKey: 'view.evidenceAtlas', descriptionKey: 'view.evidenceAtlas.description',
      queenKey: '@diamondcoreprocessor.com/AtlasQueenBee', adoptable: true,
      adoptScope: 'hierarchy', attachable: true, opensOnTileClick: true,
      pheromones: ['platform:mobile', 'platform:desktop'],
    })
    registry.register({
      view: KNOWLEDGE_STUDIO_VIEW, slashCommand: '/studio', iconName: 'view_carousel',
      toggleIcon: 'view_carousel', behavior: 'render', decorationKind: KNOWLEDGE_STUDIO_KIND,
      labelKey: 'view.knowledgeStudio', descriptionKey: 'view.knowledgeStudio.description',
      queenKey: '@diamondcoreprocessor.com/StudioQueenBee', adoptable: true,
      adoptScope: 'hierarchy', attachable: true, opensOnTileClick: true,
      pheromones: ['platform:mobile', 'platform:desktop'],
    })
  },
)
