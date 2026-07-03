// diamondcoreprocessor.com/commands/view-current.queen.ts

import { QueenBee, EffectBus } from '@hypercomb/core'
import type { LayerContent } from '../history/history.service.js'

type Lineage = {
  domain?: () => string
  explorerSegments?: () => readonly string[]
}

type History = {
  sign: (lineage: unknown) => Promise<string>
  currentLayerAt: (locSig: string) => Promise<LayerContent | null>
  getLayerBySig: (layerSig: string) => Promise<LayerContent | null>
}

type Store = {
  deepResolve: <T = unknown>(value: unknown) => Promise<T>
}

/**
 * /view-current — show the current branch as a fully-expanded object.
 *
 * Pulls the head LayerContent at the user's location, then runs the
 * platform's recursive expander (`Store.deepResolve`) over it. Every
 * sig that points at a resource (body content, projection sigs, slot
 * payloads, etc.) is inlined to its parsed value. As a second pass,
 * any sig still appearing in `children` arrays — those point at layer
 * markers in `__history__/`, which `Store.deepResolve` doesn't follow
 * — is resolved through `HistoryService.getLayerBySig`, recursively.
 *
 * Optional argument: integer depth cap on the children walk.
 *   /current        → expand everything (default)
 *   /current 0      → just the current layer; children stay as raw sigs
 *   /current 2      → expand two levels; deeper children stay as raw sigs
 *
 * Each expanded child node carries `_sig` so the original pointer is
 * still visible. Children that fail to resolve appear as
 * `{ _sig, _missing: true }`.
 */
export class ViewCurrentQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'view-current'
  override readonly aliases = ['view-layer', 'current']

  override description = 'Show the current branch as a fully-expanded object'
  override options = ['<depth>']
  override examples = [
    { input: '/view-current', result: 'Logs the current branch fully expanded' },
    { input: '/view-current 2', result: 'Expands two levels; deeper children stay sigs' },
  ]

  protected async execute(args: string): Promise<void> {
    const lineage = get<Lineage>('@hypercomb.social/Lineage')
    const history = get<History>('@diamondcoreprocessor.com/HistoryService')
    const store = get<Store>('@hypercomb.social/Store')

    if (!lineage || !history || !store) {
      console.warn('[view-current] lineage, history, or store service not available')
      return
    }

    const rootSegments = (lineage.explorerSegments?.() ?? [])
      .map(s => String(s ?? '').trim())
      .filter(Boolean)

    const parsedDepth = parseInt(args.trim(), 10)
    const maxDepth = Number.isFinite(parsedDepth) && parsedDepth >= 0
      ? parsedDepth
      : Infinity

    const rootLocSig = await history.sign({
      domain: lineage.domain,
      explorerSegments: () => rootSegments,
    })
    const rootLayer = await history.currentLayerAt(rootLocSig)
    const path = rootSegments.length === 0 ? '(root)' : rootSegments.join('/')

    if (!rootLayer) {
      console.log(`%c[view-current] no layer at ${path}`, 'color: #888; font-style: italic')
      EffectBus.emit('queen:view-current', { path, layer: null })
      return
    }

    const SIG_RE = /^[a-f0-9]{64}$/

    const expandLayerNode = async (
      layer: LayerContent,
      depth: number,
    ): Promise<Record<string, unknown>> => {
      const resolved = await store.deepResolve<Record<string, unknown>>(layer)
      const rawChildren = resolved['children']
      if (!Array.isArray(rawChildren) || rawChildren.length === 0) return resolved
      if (depth <= 0) return resolved

      const expandedChildren = await Promise.all(
        rawChildren.map(async (entry): Promise<unknown> => {
          if (typeof entry !== 'string' || !SIG_RE.test(entry)) return entry
          const childLayer = await history.getLayerBySig(entry)
          if (!childLayer) return { _sig: entry, _missing: true }
          const node = await expandLayerNode(childLayer, depth - 1)
          return { ...node, _sig: entry }
        }),
      )
      return { ...resolved, children: expandedChildren }
    }

    const tree = await expandLayerNode(rootLayer, maxDepth)
    console.log(`%c[view-current] ${path}`, 'color: #4af; font-weight: bold')
    console.log(tree)
    EffectBus.emit('queen:view-current', { path, layer: tree })
  }
}

const _viewCurrent = new ViewCurrentQueenBee()
window.ioc.register('@diamondcoreprocessor.com/ViewCurrentQueenBee', _viewCurrent)
