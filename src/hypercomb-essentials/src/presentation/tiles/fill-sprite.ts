// presentation/tiles/fill-sprite.ts
//
// FILL SHEETS — small sprite sheets that fill up as thumbnails are made.
//
// The boot sprite is one sheet per screen, rebuilt whenever that screen's set
// of pictures changes. A fill sheet is the other half: every hex thumbnail the
// optimizer mints is APPENDED to the sheet that is filling, in the next slot.
// A sheet holds FILL_CAPACITY pictures; when it is full the next picture opens
// a new one. A picture never moves slots, so a reader holding a slot record
// can cut its frame from any later version of the same sheet.
//
// Readers DIVIDE what they need by sheet: a sheet that holds two or more of
// the wanted pictures is decoded once and cut; everything else loads as a
// single thumbnail. Sheets and singles mix freely on one screen.
//
// Derived cache, never truth. Everything lives in the sign('sprites:boot')
// pool (already recycled by the heat ledger), under keys that hash the
// function's name with distinct material, so a fill record can never collide
// with a boot sheet or with a source signature:
//   sheet     sha(F + 'sheet' + members in slot order)  → webp
//   manifest  sha(F + 'members' + sheetKey)             → { members }
//   slot      sha(F + 'slot' + imageSig)                → { sheet, slot }
//   tail      sha(F + 'tail')                           → { sheet }
// Appending writes the new sheet first, then its manifest, then the slot
// records, then the tail — a slot only ever names a sheet that was written.
// The sheet it replaces is left alone and goes cold; the reap takes it.

import type { ThumbnailStore } from './thumbnails.js'
import { THUMBNAIL_SIZE } from './thumbnails.js'
import { readBootSprite, writeBootSprite } from './boot-sprite.js'

/** Pictures per sheet. Small on purpose: an append redraws at most this many cells. */
export const FILL_CAPACITY = 16
/** Cells across a sheet. Rows are added as the sheet fills. */
export const FILL_COLS = 4
/** Edge of one cell — the stored thumbnail's own size. */
export const FILL_CELL = THUMBNAIL_SIZE

const SIG = /^[0-9a-f]{64}$/

export type FillSlot = { sheet: string; slot: number }
export type FillFrame = { x: number; y: number; width: number; height: number }

const hash = async (text: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

/** The function every fill key names (documentation/instant-computing.md: "the
 *  key must name the function"). Change how a sheet is cut or drawn and bump
 *  it — every record minted before is simply never asked for again. */
export const FILL_FUNCTION = `fill-sprite/1/${FILL_CAPACITY}x${FILL_COLS}x${THUMBNAIL_SIZE}`

export const fillSheetKey = (members: readonly string[]): Promise<string> => hash(`${FILL_FUNCTION}\nsheet\n${members.join('\n')}`)
export const fillManifestKey = (sheet: string): Promise<string> => hash(`${FILL_FUNCTION}\nmembers\n${sheet}`)
export const fillSlotKey = (imageSig: string): Promise<string> => hash(`${FILL_FUNCTION}\nslot\n${imageSig}`)
export const fillTailKey = (): Promise<string> => hash(`${FILL_FUNCTION}\ntail`)

/** Where slot `slot` sits on its sheet. Fixed by the slot alone, so it holds
 *  across every version of the sheet as it fills. */
export function fillFrame(slot: number): FillFrame {
  const at = Math.max(0, Math.floor(slot))
  return { x: (at % FILL_COLS) * FILL_CELL, y: Math.floor(at / FILL_COLS) * FILL_CELL, width: FILL_CELL, height: FILL_CELL }
}

/** Sheet pixel size for `count` members: full width, only the rows in use. */
export function fillSheetSize(count: number): { width: number; height: number } {
  const n = Math.max(1, Math.min(FILL_CAPACITY, Math.floor(count)))
  return { width: Math.min(n, FILL_COLS) * FILL_CELL, height: Math.ceil(n / FILL_COLS) * FILL_CELL }
}

const readJson = async <T>(store: ThumbnailStore, key: string): Promise<T | null> => {
  const blob = await readBootSprite(store, key)
  if (!blob) return null
  try { return JSON.parse(await blob.text()) as T } catch { return null }
}

const writeJson = (store: ThumbnailStore, key: string, value: unknown): Promise<boolean> =>
  writeBootSprite(store, key, new TextEncoder().encode(JSON.stringify(value)).buffer as ArrayBuffer)

export async function readFillSlot(store: ThumbnailStore, imageSig: string): Promise<FillSlot | null> {
  if (!SIG.test(imageSig)) return null
  const record = await readJson<FillSlot>(store, await fillSlotKey(imageSig))
  if (!record || !SIG.test(String(record.sheet)) || !Number.isInteger(record.slot)) return null
  if (record.slot < 0 || record.slot >= FILL_CAPACITY) return null
  return record
}

export const readFillSheet = (store: ThumbnailStore, sheet: string): Promise<Blob | null> =>
  readBootSprite(store, sheet)

/** What a reader needs, divided: the sheets worth decoding (two or more wanted
 *  pictures on one sheet) with each picture's slot, and the rest as singles. */
export type FillDivision = {
  sheets: Map<string, { sig: string; slot: number }[]>
  singles: string[]
}

export async function divideBySheet(store: ThumbnailStore, sigs: readonly string[]): Promise<FillDivision> {
  const unique = [...new Set(sigs.filter(sig => SIG.test(sig)))]
  const slots = await Promise.all(unique.map(sig => readFillSlot(store, sig).catch(() => null)))
  const grouped = new Map<string, { sig: string; slot: number }[]>()
  const singles: string[] = []
  unique.forEach((sig, index) => {
    const record = slots[index]
    if (!record) { singles.push(sig); return }
    const group = grouped.get(record.sheet) ?? []
    group.push({ sig, slot: record.slot })
    grouped.set(record.sheet, group)
  })
  const sheets = new Map<string, { sig: string; slot: number }[]>()
  for (const [sheet, members] of grouped) {
    if (members.length >= 2) sheets.set(sheet, members)
    else singles.push(...members.map(member => member.sig))
  }
  return { sheets, singles }
}

/** Draw `bitmap` cover-cropped into one cell. */
const drawCell = (context: OffscreenCanvasRenderingContext2D, bitmap: ImageBitmap, frame: FillFrame): void => {
  const side = Math.min(bitmap.width, bitmap.height)
  if (side <= 0) return
  context.drawImage(
    bitmap,
    (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side,
    frame.x, frame.y, frame.width, frame.height,
  )
}

/**
 * Put one picture on the sheet that is filling. `cell` is its thumbnail (or
 * the source itself when it is already that small). Already on a sheet that
 * still exists → nothing to do. Full, missing or unreadable tail → a new
 * sheet. Returns true when the picture is on a sheet afterwards.
 *
 * Call one at a time per tab (the optimize phase does): two appends racing
 * on one tail would fork it, which wastes a slot but never breaks a reader.
 */
export async function appendToFill(store: ThumbnailStore, imageSig: string, cell: Blob): Promise<boolean> {
  if (!SIG.test(imageSig)) return false
  if (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas !== 'function') return false

  const existing = await readFillSlot(store, imageSig)
  if (existing && await readFillSheet(store, existing.sheet)) return true

  const tailKey = await fillTailKey()
  const tail = await readJson<{ sheet?: string }>(store, tailKey)
  let members: string[] = []
  let previous: Blob | null = null
  if (tail?.sheet && SIG.test(tail.sheet)) {
    const manifest = await readJson<{ members?: unknown }>(store, await fillManifestKey(tail.sheet))
    const listed = Array.isArray(manifest?.members) ? manifest.members.map(String).filter(sig => SIG.test(sig)) : []
    previous = listed.length ? await readFillSheet(store, tail.sheet) : null
    if (previous && listed.length < FILL_CAPACITY && !listed.includes(imageSig)) members = listed
    else previous = null
  }

  const slot = members.length
  const next = [...members, imageSig]
  const size = fillSheetSize(next.length)
  const canvas = new OffscreenCanvas(size.width, size.height)
  const context = canvas.getContext('2d')
  if (!context) return false
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'

  let old: ImageBitmap | null = null
  let picture: ImageBitmap | null = null
  try {
    if (previous) {
      // Every earlier cell keeps its pixels and its place.
      old = await createImageBitmap(previous)
      context.drawImage(old, 0, 0)
    }
    picture = await createImageBitmap(cell)
    drawCell(context, picture, fillFrame(slot))
  } catch {
    return false
  } finally {
    old?.close()
    picture?.close()
  }

  let bytes: ArrayBuffer
  try {
    bytes = await (await canvas.convertToBlob({ type: 'image/webp', quality: 0.82 })).arrayBuffer()
  } catch { return false }
  if (bytes.byteLength === 0) return false

  const sheet = await fillSheetKey(next)
  if (!await writeBootSprite(store, sheet, bytes)) return false
  if (!await writeJson(store, await fillManifestKey(sheet), { members: next })) return false
  // Every member now lives on the new version of the sheet, in the same slot.
  for (let index = 0; index < next.length; index++) {
    await writeJson(store, await fillSlotKey(next[index]), { sheet, slot: index })
  }
  await writeJson(store, tailKey, { sheet })
  return true
}
