// Shared source-reach contract for document views.
//
// The declaration lives in the view decoration, so scope is authored content:
// it survives reload, adoption, and history exactly like the view itself.

import { listDecorations, replaceDecoration } from './decoration-manifest.js'
import { resolveLayerAt, type PlacementHistory } from '../history/layer-placement.js'

export type ViewSourceScope = 'layer' | 'hierarchy'

export type ViewSourcePayload = Record<string, unknown> & {
  sourceScope?: ViewSourceScope
  /** Relative tile paths selected during hierarchy curation. Absent means the
   * complete live hierarchy; an empty array deliberately means no tiles. */
  includedPaths?: readonly (readonly string[])[]
}

export type ViewSourceConfig = {
  readonly scope: ViewSourceScope
  readonly includedPaths?: readonly (readonly string[])[]
}

export const DEFAULT_VIEW_SOURCE_SCOPE: ViewSourceScope = 'layer'
export const VIEW_SOURCE_SCOPES = ['layer', 'hierarchy'] as const

export function viewSourceScope(value: unknown): ViewSourceScope {
  return value === 'hierarchy' ? 'hierarchy' : DEFAULT_VIEW_SOURCE_SCOPE
}

export function viewSourceScopeFromArgs(value: string): ViewSourceScope | null {
  const token = String(value ?? '').trim().toLowerCase()
  if (token === 'hierarchy' || token === 'hierarchical' || token === 'tree' || token === 'all') {
    return 'hierarchy'
  }
  if (token === 'layer' || token === 'current' || token === 'current-layer' || token === 'local') {
    return 'layer'
  }
  return null
}

function includedPaths(value: unknown): readonly (readonly string[])[] | undefined {
  if (!Array.isArray(value)) return undefined
  const seen = new Set<string>()
  const out: string[][] = []
  for (const raw of value) {
    if (!Array.isArray(raw)) continue
    const path = raw.map(String).map(part => part.trim()).filter(Boolean)
    if (!path.length) continue
    const key = path.join('\u0000')
    if (seen.has(key)) continue
    seen.add(key)
    out.push(path)
  }
  return out
}

async function viewSourcePayloadAt(
  kind: string,
  segments: readonly string[],
): Promise<ViewSourcePayload | undefined> {
  const records = await listDecorations<ViewSourcePayload>({ kind, segments })
  if (records.length) {
    return records.at(-1)?.record.payload
  }

  // An in-place tile view can open before the tile has an own history bag.
  // `listDecorations` intentionally reads that bag, so fall back through the
  // parent-held layer and parse only this view's declaration.
  const history = window.ioc?.get<PlacementHistory>('@diamondcoreprocessor.com/HistoryService')
  const store = window.ioc?.get<{ getResource(sig: string): Promise<Blob | null> }>('@hypercomb.social/Store')
  const lineage = window.ioc?.get<{ domain?: unknown }>('@hypercomb.social/Lineage')
  if (!history || !store) return undefined
  const layer = await resolveLayerAt(history, lineage?.domain, segments).catch(() => null)
  const decorations = layer?.['decorations']
  const sigs = Array.isArray(decorations) ? decorations.map(String) : []
  for (let index = sigs.length - 1; index >= 0; index--) {
    try {
      const sig = sigs[index]
      if (!sig) continue
      const blob = await store.getResource(sig)
      if (!blob) continue
      const record = JSON.parse(await blob.text()) as {
        kind?: string
        payload?: ViewSourcePayload
      }
      if (record.kind === kind) return record.payload
    } catch {
      // Ignore malformed or cold decoration resources.
    }
  }
  return undefined
}

export async function viewSourceConfigAt(
  kind: string,
  segments: readonly string[],
): Promise<ViewSourceConfig> {
  const payload = await viewSourcePayloadAt(kind, segments)
  return {
    scope: viewSourceScope(payload?.sourceScope),
    includedPaths: includedPaths(payload?.includedPaths),
  }
}

export async function viewSourceScopeAt(
  kind: string,
  segments: readonly string[],
): Promise<ViewSourceScope> {
  return (await viewSourceConfigAt(kind, segments)).scope
}

/** Rewrite one view declaration while preserving every view-specific payload
 * field (layout, version, and future additions). */
export async function writeViewSourceScope(opts: {
  kind: string
  segments: readonly string[]
  scope: ViewSourceScope
  defaults?: ViewSourcePayload
}): Promise<string> {
  const previous = await viewSourcePayloadAt(opts.kind, opts.segments)
  return replaceDecoration({
    kind: opts.kind,
    appliesTo: opts.segments,
    segments: opts.segments,
    payload: {
      ...(opts.defaults ?? {}),
      ...(previous && typeof previous === 'object' ? previous : {}),
      sourceScope: opts.scope,
    },
    mark: 'persistent',
  })
}

/** Commit the Done gesture from hierarchy curation. Relative paths keep the
 * selection meaningful when the owning branch is moved or adopted. */
export async function writeViewSourceSelection(opts: {
  kind: string
  segments: readonly string[]
  includedPaths: readonly (readonly string[])[] | undefined
  defaults?: ViewSourcePayload
}): Promise<string> {
  const previous = await viewSourcePayloadAt(opts.kind, opts.segments)
  return replaceDecoration({
    kind: opts.kind,
    appliesTo: opts.segments,
    segments: opts.segments,
    payload: {
      ...(opts.defaults ?? {}),
      ...(previous && typeof previous === 'object' ? previous : {}),
      sourceScope: 'hierarchy',
      includedPaths: opts.includedPaths,
    },
    mark: 'persistent',
  })
}
