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

const TILE_PROPERTIES_FILE = '0000'

interface StoreHandle {
  putResource(blob: Blob): Promise<string>
}

interface LineageHandle {
  explorerDir(): Promise<FileSystemDirectoryHandle | null>
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

    const currentDir = await lineage.explorerDir()
    if (!currentDir) { this.#toast('navigate into a hive first'); return }

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
    const rootDir = await currentDir.getDirectoryHandle(rootName, { create: true })

    await writeTileProperties(rootDir, {
      'miro.boardId': board.id,
      'miro.boardName': board.name,
      'miro.viewLink': board.viewLink ?? '',
      'miro.importedAt': new Date().toISOString(),
      'miro.itemCount': items.length,
    })

    const { topLevel, framedBy } = groupByFrame(items)

    let resourcesFetched = 0
    let resourceErrors = 0
    const usedAtLevel = new Map<string, Set<string>>()
    const uniqueKey = (dir: FileSystemDirectoryHandle) => {
      const key = (dir as any).name ?? String(Math.random())
      if (!usedAtLevel.has(key)) usedAtLevel.set(key, new Set())
      return usedAtLevel.get(key)!
    }
    const claim = (dir: FileSystemDirectoryHandle, base: string): string => {
      const used = uniqueKey(dir)
      let candidate = base
      let n = 2
      while (used.has(candidate)) candidate = `${base}-${n++}`
      used.add(candidate)
      return candidate
    }

    for (const item of topLevel) {
      if (item.type === 'connector') continue
      const tileName = claim(rootDir, tileNameForItem(item))
      const tileDir = await rootDir.getDirectoryHandle(tileName, { create: true })
      const result = await attachItem(api, store, tileDir, item)
      if (result === 'fetched') resourcesFetched++
      else if (result === 'errored') resourceErrors++

      if (item.type === 'frame') {
        const children = framedBy.get(item.id) ?? []
        for (const child of children) {
          if (child.type === 'connector') continue
          const childName = claim(tileDir, tileNameForItem(child))
          const childDir = await tileDir.getDirectoryHandle(childName, { create: true })
          const childResult = await attachItem(api, store, childDir, child)
          if (childResult === 'fetched') resourcesFetched++
          else if (childResult === 'errored') resourceErrors++
        }
      }
    }

    this.#toast(`miro import done: ${items.length} item${items.length === 1 ? '' : 's'}, ${resourcesFetched} asset${resourcesFetched === 1 ? '' : 's'}${resourceErrors ? `, ${resourceErrors} failed` : ''}`)

    EffectBus.emit('cell:added', { cell: rootName })
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

async function attachItem(
  api: MiroApiService,
  store: StoreHandle,
  tileDir: FileSystemDirectoryHandle,
  item: MiroItem,
): Promise<'none' | 'fetched' | 'errored'> {
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

  await writeTileProperties(tileDir, properties)
  return status
}

async function writeTileProperties(
  dir: FileSystemDirectoryHandle,
  updates: Record<string, unknown>,
): Promise<void> {
  let existing: Record<string, unknown> = {}
  try {
    const fileHandle = await dir.getFileHandle(TILE_PROPERTIES_FILE)
    const file = await fileHandle.getFile()
    existing = JSON.parse(await file.text()) as Record<string, unknown>
  } catch {
    existing = {}
  }
  const merged = { ...existing, ...updates }
  const fileHandle = await dir.getFileHandle(TILE_PROPERTIES_FILE, { create: true })
  const writable = await fileHandle.createWritable()
  await writable.write(JSON.stringify(merged))
  await writable.close()
}

const _instance = new MiroImportQueenBee()
;(window as any).ioc?.register?.('@miro.com/MiroImportQueenBee', _instance)
