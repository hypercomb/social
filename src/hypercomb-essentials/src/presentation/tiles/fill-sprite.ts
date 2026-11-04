// presentation/tiles/fill-sprite.ts
//
// FILL SHEETS — small hexagon sprite sheets that fill up as thumbnails are made.
//
// A sheet is laid out exactly like the hive's own grid: hexagons on the normal
// axial matrix, slot i at layout slot i of the spiral, spacing = circumradius
// + gap, so the gap a real layer leaves between
// tiles is the gutter that keeps one cell's pixels out of the next. Sheets come
// in PAIRS with the same slot numbers — one on the pointy-top grid, one on the
// flat-top grid — so a picture is ready in either orientation from one slot.
//
// Every hex thumbnail the optimizer mints is APPENDED to the pair that is
// filling, in the next slot. A pair holds FILL_CAPACITY pictures; when it is
// full the next picture opens a new pair. A picture never moves slots, so a
// reader holding a slot record cuts its frame from any later version.
//
// Readers DIVIDE what they need by sheet: a sheet holding two or more of the
// wanted pictures is decoded once and cut; everything else loads as a single
// thumbnail. A frame is the hexagon's bounding box, so its corners hold the
// neighbours: a reader MUST clip to the hexagon (scale the frame so the cell's
// circumradius meets the clip — see `FILL_HEX_R`). A tile drawn square never
// reads a sheet; it reads its single thumbnail.
//
// Derived cache, never truth. Everything lives in the sign('sprites:boot')
// pool (already recycled by the heat ledger), under keys that hash the
// function's name with distinct material:
//   sheet     sha(F + orientation + members in slot order)  → webp
//   manifest  sha(F + 'members' + point sheet)              → { members }
//   slot      sha(F + 'slot' + imageSig)                    → { sheets, slot }
//   tail      sha(F + 'tail')                               → { sheets }
// Appending writes both sheets first, then the manifest, then the slot
// records, then the tail — a slot only ever names sheets that were written.
// The pair it replaces is left alone and goes cold; the reap takes it.

import type { ThumbnailStore } from './thumbnails.js'
import { THUMBNAIL_SIZE } from './thumbnails.js'
import { readBootSprite, writeBootSprite } from './boot-sprite.js'
import { spiralAxial } from './visual-division.js'

export type FillOrientation = 'point' | 'flat'
export const FILL_ORIENTATIONS: readonly FillOrientation[] = ['point', 'flat']

/** Pictures per pair: the centre, ring one, and nine of ring two. Small on
 *  purpose — an append redraws at most this many cells. */
export const FILL_CAPACITY = 16
/** Circumradius of one cell: the hexagon is the thumbnail's own height. */
export const FILL_HEX_R = THUMBNAIL_SIZE / 2
/** The grid's gap between tiles — the gutter between cells. */
export const FILL_GAP = 2
/** Centre-to-centre, as the hive's grid: circumradius + gap. */
const SPACING = FILL_HEX_R + FILL_GAP
const ROOT3 = Math.sqrt(3)

/** The function every fill key names (documentation/instant-computing.md: "the
 *  key must name the function"). Change how a sheet is cut or drawn and bump
 *  it — every record minted before is simply never asked for again. */
export const FILL_FUNCTION = `fill-sprite/2/hex-pair/spiral${FILL_CAPACITY}/r${FILL_HEX_R}g${FILL_GAP}`

const SIG = /^[0-9a-f]{64}$/

export type FillSheets = Record<FillOrientation, string>
export type FillSlot = { sheets: FillSheets; slot: number }
export type FillFrame = { x: number; y: number; width: number; height: number }

const hash = async (text: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

export const fillSheetKey = (members: readonly string[], orientation: FillOrientation): Promise<string> =>
  hash(`${FILL_FUNCTION}\n${orientation}\n${members.join('\n')}`)
export const fillManifestKey = (pointSheet: string): Promise<string> => hash(`${FILL_FUNCTION}\nmembers\n${pointSheet}`)
export const fillSlotKey = (imageSig: string): Promise<string> => hash(`${FILL_FUNCTION}\nslot\n${imageSig}`)
export const fillTailKey = (): Promise<string> => hash(`${FILL_FUNCTION}\ntail`)

/** Half extents of one cell's hexagon. */
const halfExtents = (orientation: FillOrientation): { w: number; h: number } =>
  orientation === 'point'
    ? { w: (ROOT3 * FILL_HEX_R) / 2, h: FILL_HEX_R }
    : { w: FILL_HEX_R, h: (ROOT3 * FILL_HEX_R) / 2 }

/** Slot → pixel on the hive's own matrix, before the sheet's origin shift. */
const axialPixel = (slot: number, orientation: FillOrientation): { x: number; y: number } => {
  const { q, r } = spiralAxial(slot)
  return orientation === 'point'
    ? { x: ROOT3 * SPACING * (q + r / 2), y: 1.5 * SPACING * r }
    : { x: 1.5 * SPACING * q, y: ROOT3 * SPACING * (r + q / 2) }
}

/** The shift that puts every slot of a FULL sheet on the canvas. Fixed by the
 *  capacity, never by how full a sheet is, so a slot's pixels never move. */
const ORIGIN: Record<FillOrientation, { x: number; y: number }> = (() => {
  const origin = {} as Record<FillOrientation, { x: number; y: number }>
  for (const orientation of FILL_ORIENTATIONS) {
    const half = halfExtents(orientation)
    let minX = Infinity
    let minY = Infinity
    for (let slot = 0; slot < FILL_CAPACITY; slot++) {
      const p = axialPixel(slot, orientation)
      minX = Math.min(minX, p.x)
      minY = Math.min(minY, p.y)
    }
    origin[orientation] = { x: FILL_GAP + half.w - minX, y: FILL_GAP + half.h - minY }
  }
  return origin
})()

/** Centre of slot `slot` on the sheet. Slot i is layout slot i of the normal
 *  hexagon matrix — the spiral every layer is drawn on (`spiralAxial`, the same
 *  walk `AxialService` builds) — so a sheet is a small honeycomb, centre out. */
export function fillCentre(slot: number, orientation: FillOrientation): { x: number; y: number } {
  const p = axialPixel(Math.max(0, Math.floor(slot)), orientation)
  const origin = ORIGIN[orientation]
  return { x: p.x + origin.x, y: p.y + origin.y }
}

/** The hexagon's bounding box on the sheet, in whole pixels. Its corners belong
 *  to the neighbours — clip to the hexagon. */
export function fillFrame(slot: number, orientation: FillOrientation): FillFrame {
  const c = fillCentre(slot, orientation)
  const half = halfExtents(orientation)
  const x = Math.floor(c.x - half.w)
  const y = Math.floor(c.y - half.h)
  return { x, y, width: Math.ceil(c.x + half.w) - x, height: Math.ceil(c.y + half.h) - y }
}

/** Sheet pixel size: the full honeycomb, whatever is filled (empty cells are
 *  transparent and cost next to nothing in webp). One size per orientation,
 *  so every version of a sheet lines up pixel for pixel. */
export function fillSheetSize(orientation: FillOrientation): { width: number; height: number } {
  let width = 0
  let height = 0
  for (let slot = 0; slot < FILL_CAPACITY; slot++) {
    const frame = fillFrame(slot, orientation)
    width = Math.max(width, frame.x + frame.width + FILL_GAP)
    height = Math.max(height, frame.y + frame.height + FILL_GAP)
  }
  return { width, height }
}

const readJson = async <T>(store: ThumbnailStore, key: string): Promise<T | null> => {
  const blob = await readBootSprite(store, key)
  if (!blob) return null
  try { return JSON.parse(await blob.text()) as T } catch { return null }
}

const writeJson = (store: ThumbnailStore, key: string, value: unknown): Promise<boolean> =>
  writeBootSprite(store, key, new TextEncoder().encode(JSON.stringify(value)).buffer as ArrayBuffer)

const validSheets = (value: unknown): value is FillSheets => {
  const sheets = value as Partial<FillSheets> | undefined
  return !!sheets && SIG.test(String(sheets.point)) && SIG.test(String(sheets.flat))
}

export async function readFillSlot(store: ThumbnailStore, imageSig: string): Promise<FillSlot | null> {
  if (!SIG.test(imageSig)) return null
  const record = await readJson<FillSlot>(store, await fillSlotKey(imageSig))
  if (!record || !validSheets(record.sheets) || !Number.isInteger(record.slot)) return null
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

export async function divideBySheet(
  store: ThumbnailStore,
  sigs: readonly string[],
  orientation: FillOrientation,
): Promise<FillDivision> {
  const unique = [...new Set(sigs.filter(sig => SIG.test(sig)))]
  const slots = await Promise.all(unique.map(sig => readFillSlot(store, sig).catch(() => null)))
  const grouped = new Map<string, { sig: string; slot: number }[]>()
  const singles: string[] = []
  unique.forEach((sig, index) => {
    const record = slots[index]
    if (!record) { singles.push(sig); return }
    const sheet = record.sheets[orientation]
    const group = grouped.get(sheet) ?? []
    group.push({ sig, slot: record.slot })
    grouped.set(sheet, group)
  })
  const sheets = new Map<string, { sig: string; slot: number }[]>()
  for (const [sheet, members] of grouped) {
    if (members.length >= 2) sheets.set(sheet, members)
    else singles.push(...members.map(member => member.sig))
  }
  return { sheets, singles }
}

/** Trace a hexagon about (cx, cy). */
const hexPath = (context: OffscreenCanvasRenderingContext2D, cx: number, cy: number, r: number, orientation: FillOrientation): void => {
  const start = orientation === 'point' ? -Math.PI / 2 : 0
  context.beginPath()
  for (let i = 0; i < 6; i++) {
    const angle = start + (Math.PI / 3) * i
    const x = cx + r * Math.cos(angle)
    const y = cy + r * Math.sin(angle)
    if (i === 0) context.moveTo(x, y)
    else context.lineTo(x, y)
  }
  context.closePath()
}

/** Draw `bitmap` into one cell: cover-cropped to the cell's 2r square, clipped
 *  to the hexagon, so nothing spills into the gutter. */
const drawCell = (context: OffscreenCanvasRenderingContext2D, bitmap: ImageBitmap, slot: number, orientation: FillOrientation): void => {
  const side = Math.min(bitmap.width, bitmap.height)
  if (side <= 0) return
  const c = fillCentre(slot, orientation)
  context.save()
  hexPath(context, c.x, c.y, FILL_HEX_R, orientation)
  context.clip()
  context.drawImage(
    bitmap,
    (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side,
    c.x - FILL_HEX_R, c.y - FILL_HEX_R, FILL_HEX_R * 2, FILL_HEX_R * 2,
  )
  context.restore()
}

/** One orientation's next sheet: the previous version's pixels where they
 *  were, and the new picture in its slot. */
const composeSheet = async (
  previous: Blob | null,
  picture: ImageBitmap,
  slot: number,
  orientation: FillOrientation,
): Promise<ArrayBuffer | null> => {
  const size = fillSheetSize(orientation)
  const canvas = new OffscreenCanvas(size.width, size.height)
  const context = canvas.getContext('2d')
  if (!context) return null
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  let old: ImageBitmap | null = null
  try {
    if (previous) {
      // Every earlier cell keeps its pixels and its place.
      old = await createImageBitmap(previous)
      context.drawImage(old, 0, 0)
    }
    drawCell(context, picture, slot, orientation)
    const bytes = await (await canvas.convertToBlob({ type: 'image/webp', quality: 0.82 })).arrayBuffer()
    return bytes.byteLength ? bytes : null
  } catch {
    return null
  } finally {
    old?.close()
  }
}

/**
 * Put one picture on the pair that is filling. `cell` is its thumbnail (or
 * the source itself when it is already that small). Already on a pair that
 * still exists → nothing to do. Full, missing or unreadable tail → a new pair.
 * Returns true when the picture is on a pair afterwards.
 *
 * Call one at a time per tab (the optimize phase does): two appends racing
 * on one tail would fork it, which wastes a slot but never breaks a reader.
 */
export async function appendToFill(store: ThumbnailStore, imageSig: string, cell: Blob): Promise<boolean> {
  if (!SIG.test(imageSig)) return false
  if (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas !== 'function') return false

  const existing = await readFillSlot(store, imageSig)
  if (existing && await readFillSheet(store, existing.sheets.point) && await readFillSheet(store, existing.sheets.flat)) return true

  const tailKey = await fillTailKey()
  const tail = await readJson<{ sheets?: unknown }>(store, tailKey)
  let members: string[] = []
  let previous: Record<FillOrientation, Blob | null> = { point: null, flat: null }
  if (tail && validSheets(tail.sheets)) {
    const manifest = await readJson<{ members?: unknown }>(store, await fillManifestKey(tail.sheets.point))
    const listed = Array.isArray(manifest?.members) ? manifest.members.map(String).filter(sig => SIG.test(sig)) : []
    const point = listed.length ? await readFillSheet(store, tail.sheets.point) : null
    const flat = listed.length ? await readFillSheet(store, tail.sheets.flat) : null
    if (point && flat && listed.length < FILL_CAPACITY && !listed.includes(imageSig)) {
      members = listed
      previous = { point, flat }
    }
  }

  const slot = members.length
  const next = [...members, imageSig]
  let picture: ImageBitmap | null = null
  const bytes: Partial<Record<FillOrientation, ArrayBuffer>> = {}
  try {
    picture = await createImageBitmap(cell)
    for (const orientation of FILL_ORIENTATIONS) {
      const sheet = await composeSheet(previous[orientation], picture, slot, orientation)
      if (!sheet) return false
      bytes[orientation] = sheet
    }
  } catch {
    return false
  } finally {
    picture?.close()
  }

  const sheets: FillSheets = {
    point: await fillSheetKey(next, 'point'),
    flat: await fillSheetKey(next, 'flat'),
  }
  // Complete-or-absent: both sheets land before anything names them.
  for (const orientation of FILL_ORIENTATIONS) {
    if (!await writeBootSprite(store, sheets[orientation], bytes[orientation]!)) return false
  }
  if (!await writeJson(store, await fillManifestKey(sheets.point), { members: next })) return false
  // Every member now lives on the new version of the pair, in the same slot.
  for (let index = 0; index < next.length; index++) {
    await writeJson(store, await fillSlotKey(next[index]), { sheets, slot: index })
  }
  await writeJson(store, tailKey, { sheets })
  return true
}
