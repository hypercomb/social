// miro.com/import/miro-import.queen.ts
//
// /miro-import — queen bee that turns a Miro board into a tile hierarchy.
//
// Syntax:
//   /miro-import <boardId>            — import board into current hive
//   /miro-import                      — reuse last-used board id
//
// Hierarchy mapping:
//   board                 → one root tile (named after the board)
//     frame               → child tile
//       framed items      → grandchild tiles
//     unframed items      → child tiles
//   connectors            → skipped (v1)
//   images / documents    → fetched and stored as signature-addressed resources;
//                            the tile's 0000 properties file references them so
//                            the image paints as the tile background.
//
// Pattern for others to adapt: this queen is self-contained — API client,
// hierarchy walk, resource attach. Copy the folder, swap out the API calls,
// keep the tile-writing shape.

import { QueenBee, EffectBus, normalizeCell, hypercomb } from '@hypercomb/core'
import type { MiroApiService, MiroBoard, MiroItem } from './miro-api.service.js'

const ioc = (key: string) => (window as any).ioc?.get?.(key)

interface StoreHandle {
  putResource(blob: Blob): Promise<string>
}

interface LineageHandle {
  explorerSegments?(): readonly string[]
}

interface LayerCommitterHandle {
  importTree?(
    updates: { segments: readonly string[]; layer: { name?: string } & { [slot: string]: unknown } }[],
    nameSlots?: ReadonlySet<string>,
  ): Promise<void>
}

const TILE_PROPERTIES_SLOT = 'properties'

/** Serialise the properties bag with sorted keys and store it as a
 *  content-addressed resource. Returns the resource sig that the tile's
 *  layer should reference in its `properties` slot — same canonical
 *  bytes that writeTilePropertiesAt produces, just without the per-tile
 *  commitSlotSet so we can batch the whole import into one cascade. */
async function computePropertyResourceSig(
  store: StoreHandle,
  properties: Record<string, unknown>,
): Promise<string> {
  const sortedKeys = Object.keys(properties).sort()
  const canonical: Record<string, unknown> = {}
  for (const k of sortedKeys) canonical[k] = properties[k]
  const blob = new Blob([JSON.stringify(canonical)], { type: 'application/json' })
  return store.putResource(blob)
}

export class MiroImportQueenBee extends QueenBee {
  readonly namespace = 'miro.com'
  readonly command = 'miro-import'
  override description = 'Import a Miro board as a tile hierarchy; images become tile backgrounds'

  protected async execute(args: string): Promise<void> {
    const api = ioc('@miro.com/MiroApiService') as MiroApiService | undefined
    const store = ioc('@hypercomb.social/Store') as StoreHandle | undefined
    const lineage = ioc('@hypercomb.social/Lineage') as LineageHandle | undefined

    if (!api) { this.#toast('miro api service not loaded'); return }
    if (!store || !lineage) { this.#toast('store or lineage not ready'); return }

    if (!api.token) {
      this.#toast('no miro token. run /miro-token <your-token> first')
      return
    }

    const boardId = args.trim() || api.lastBoardId
    if (!boardId) {
      this.#toast('usage: /miro-import <boardId>')
      return
    }

    const baseSegments = (lineage.explorerSegments?.() ?? []).map(s => String(s ?? ''))

    api.rememberBoard(boardId)
    this.#toast(`fetching miro board ${boardId}...`)

    let board: MiroBoard
    try {
      board = await api.getBoard(boardId)
    } catch (error: any) {
      this.#toast(this.#formatFetchError(error))
      return
    }

    const items: MiroItem[] = []
    try {
      for await (const item of api.listItems(boardId)) items.push(item)
    } catch (error: any) {
      this.#toast(`miro items failed: ${error?.message ?? error}`)
      return
    }

    this.#toast(`importing ${items.length} item${items.length === 1 ? '' : 's'} from "${board.name}"`)

    const rootName = normalizeCell(board.name) || `miro-${boardId.replace(/[^a-z0-9]/gi, '').slice(0, 12)}`
    const rootSegments = [...baseSegments, rootName]

    const { topLevel, framedBy } = groupByFrame(items)

    let resourcesFetched = 0
    let resourceErrors = 0

    // Name de-duplication: track names used at each lineage depth via
    // the segments-joined key. Equivalent to the old per-dir map but
    // keyed off the parent path rather than a directory handle.
    const usedByParent = new Map<string, Set<string>>()
    const claim = (parent: readonly string[], base: string): string => {
      const key = parent.join('/')
      let used = usedByParent.get(key)
      if (!used) { used = new Set(); usedByParent.set(key, used) }
      let candidate = base
      let n = 2
      while (used.has(candidate)) candidate = `${base}-${n++}`
      used.add(candidate)
      return candidate
    }

    // ── Build the import as ONE atomic layer-tree ────────────────────
    // Every tile (root, top-level, framed children) is rendered into a
    // single (segments, layer) update with its `properties` slot already
    // populated. We compute each property bag's content-addressed sig
    // up-front (no commit), then ship the whole batch through
    // committer.importTree — one shared cascade, one marker per affected
    // ancestor depth, not N markers per tile.
    const updates: { segments: readonly string[]; layer: { name: string; [slot: string]: unknown } }[] = []
    const uiEvents: { cell: string; segments: readonly string[] }[] = []

    // Root tile
    const rootPropSig = await computePropertyResourceSig(store, {
      'miro.boardId': board.id,
      'miro.boardName': board.name,
      'miro.viewLink': board.viewLink ?? '',
      'miro.importedAt': new Date().toISOString(),
      'miro.itemCount': items.length,
    })
    updates.push({
      segments: rootSegments,
      layer: { name: rootName, [TILE_PROPERTIES_SLOT]: [rootPropSig] },
    })
    uiEvents.push({ cell: rootName, segments: baseSegments.slice() })

    for (const item of topLevel) {
      if (item.type === 'connector') continue
      const tileName = claim(rootSegments, tileNameForItem(item))
      const { properties, status } = await buildItemProperties(api, store, item)
      const propSig = await computePropertyResourceSig(store, properties)
      updates.push({
        segments: [...rootSegments, tileName],
        layer: { name: tileName, [TILE_PROPERTIES_SLOT]: [propSig] },
      })
      uiEvents.push({ cell: tileName, segments: rootSegments.slice() })
      if (status === 'fetched') resourcesFetched++
      else if (status === 'errored') resourceErrors++

      if (item.type === 'frame') {
        const frameSegments = [...rootSegments, tileName]
        const children = framedBy.get(item.id) ?? []
        for (const child of children) {
          if (child.type === 'connector') continue
          const childName = claim(frameSegments, tileNameForItem(child))
          const { properties: childProps, status: childStatus } = await buildItemProperties(api, store, child)
          const childPropSig = await computePropertyResourceSig(store, childProps)
          updates.push({
            segments: [...frameSegments, childName],
            layer: { name: childName, [TILE_PROPERTIES_SLOT]: [childPropSig] },
          })
          uiEvents.push({ cell: childName, segments: frameSegments.slice() })
          if (childStatus === 'fetched') resourcesFetched++
          else if (childStatus === 'errored') resourceErrors++
        }
      }
    }

    // UI subscribers (show-cell incremental mount, activity log) receive
    // their events BEFORE the commit so visual mount runs instantly;
    // viaUpdate suppresses the LayerCommitter per-event commit since
    // importTree below IS the atomic commit for the whole import.
    for (const evt of uiEvents) {
      EffectBus.emit('cell:added', { cell: evt.cell, segments: evt.segments, viaUpdate: true })
    }

    const committer = ioc('@diamondcoreprocessor.com/LayerCommitter') as LayerCommitterHandle | undefined
    if (committer?.importTree) await committer.importTree(updates)

    this.#toast(`miro import done: ${items.length} item${items.length === 1 ? '' : 's'}, ${resourcesFetched} asset${resourcesFetched === 1 ? '' : 's'}${resourceErrors ? `, ${resourceErrors} failed` : ''}`)

    await new hypercomb().act()
  }

  #formatFetchError(error: any): string {
    const msg = error?.message ?? String(error)
    if (msg === 'UNAUTHORIZED') return 'miro token rejected. update with /miro-token <new-token>'
    if (msg === 'NOT_FOUND') return 'board not found. check the id and that your app is installed on the board\'s team'
    if (msg === 'NO_TOKEN') return 'no miro token. run /miro-token <your-token> first'
    return `miro fetch failed: ${msg}`
  }

  #toast(message: string): void {
    EffectBus.emit('activity:log', { message, icon: '◈' })
  }
}

function tileNameForItem(item: MiroItem): string {
  const raw = item.data?.title ?? item.data?.content ?? ''
  const normalized = normalizeCell(stripHtml(raw))
  if (normalized) return normalized
  const shortId = item.id.replace(/[^a-z0-9]/gi, '').slice(-6).toLowerCase()
  return `${item.type.replace(/_/g, '-')}-${shortId}`
}

function stripHtml(input: string): string {
  return input.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()
}

function groupByFrame(items: readonly MiroItem[]): {
  topLevel: MiroItem[]
  framedBy: Map<string, MiroItem[]>
} {
  const frameIds = new Set<string>()
  for (const item of items) {
    if (item.type === 'frame') frameIds.add(item.id)
  }

  const topLevel: MiroItem[] = []
  const framedBy = new Map<string, MiroItem[]>()

  for (const item of items) {
    const parentId = item.parent?.id
    if (parentId && frameIds.has(parentId) && item.type !== 'frame') {
      const list = framedBy.get(parentId) ?? []
      list.push(item)
      framedBy.set(parentId, list)
    } else {
      topLevel.push(item)
    }
  }

  return { topLevel, framedBy }
}

async function buildItemProperties(
  api: MiroApiService,
  store: StoreHandle,
  item: MiroItem,
): Promise<{ properties: Record<string, unknown>; status: 'none' | 'fetched' | 'errored' }> {
  const properties: Record<string, unknown> = {
    'miro.id': item.id,
    'miro.type': item.type,
  }

  const textPayload = stripHtml(item.data?.content ?? item.data?.title ?? '')
  if (textPayload) properties['miro.text'] = textPayload

  const externalLink = item.data?.url ?? item.data?.providerUrl
  if (externalLink) {
    properties['miro.url'] = externalLink
    properties['link'] = externalLink
  }

  const assetUrl = item.data?.imageUrl ?? item.data?.documentUrl ?? item.data?.previewUrl
  let status: 'none' | 'fetched' | 'errored' = 'none'
  if (assetUrl) {
    try {
      const blob = await api.fetchAsset(assetUrl)
      const signature = await store.putResource(blob)
      properties['miro.assetSignature'] = signature
      properties['miro.assetMime'] = blob.type || ''
      properties['large'] = { image: signature, x: 0, y: 0, scale: 1 }
      properties['small'] = { image: signature }
      properties['flat'] = { small: { image: signature }, large: { x: 0, y: 0, scale: 1 } }
      status = 'fetched'
    } catch (error: any) {
      properties['miro.assetError'] = String(error?.message ?? error)
      status = 'errored'
    }
  }

  return { properties, status }
}

const _instance = new MiroImportQueenBee()
;(window as any).ioc?.register?.('@miro.com/MiroImportQueenBee', _instance)
