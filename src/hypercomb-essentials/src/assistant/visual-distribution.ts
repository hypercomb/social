// assistant/visual-distribution.ts
//
// BREAKING APART DISTRIBUTES THE VISUAL — the acting half.
//
// visual-division.ts works out the SHAPE of a division and can do it in a test
// with no browser. This is what actually happens to the hive: it cuts the
// bytes, writes each part its own picture, records the whole's frame, and
// enrols the parts so each one knows which hole it seats into.
//
// Rules 10 and 11 of the website-artifact paradigm, in one pass — because
// either one alone only moves the dependency:
//
//   • rule 10 alone — the parts take the picture and the whole is left with a
//     hole it needs them back to fill;
//   • rule 11 alone — the whole declares holes and the parts still have
//     nothing of their own to put in them.
//
// So one act does both, and the acceptance test is applied in both directions:
// move a part somewhere else alone and it still looks like itself; delete a
// part and the whole still looks finished.
//
// ── WHAT IS WRITTEN, AND WHERE IT LIVES ─────────────────────────────────
//
// On the WHOLE, two records and no bytes:
//
//   visual:division:plan       the FRAME — one slot per part, position and
//                              proportion only, naming nobody (the interface)
//   visual:division:artifact   the face that NAMES the relation, so the parts
//                              have something to be members OF
//
// Its picture is not touched. That is the whole point of rule 11: an unfilled
// hole is a finished state, so the whole renders complete before, during and
// after, and a tile can be broken apart long before anyone draws its parts.
//
// On each PART, its own appearance and its own position:
//
//   properties.large/.small    ITS OWN BYTES — the region of the whole's
//                              picture that is about it, or, when there was
//                              nothing to divide, a visual derived from what
//                              it IS. Never a copy of the whole's picture:
//                              seven identical tiles say nothing about which
//                              part is which.
//   group{ meaning, order:k }  the membership that seats it into slot k. The
//                              seating comes from THIS side, which is what
//                              lets one part sit in several wholes at a
//                              different place in each.
//
// ── WHAT IT REFUSES TO DO ───────────────────────────────────────────────
//
// It never overwrites a picture the tile already owns on its OWN layer. A part
// somebody has dressed is dressed; distribution fills what is empty, it does
// not redecorate. (It reads OWN properties, not the inherited composition —
// an inherited picture is exactly the fall-through rule 10 forbids relying on,
// so it reads as "no picture" and gets replaced by one of the part's own.)
//
// See documentation/website-artifact-paradigm.md (rules 10 and 11).

import { EffectBus } from '@hypercomb/core'
import {
  listDecorations,
  removeDecoration,
  replaceDecoration,
} from '../commands/decoration-manifest.js'
import {
  ensureSiteArtifact,
  siteGroupFor,
  wearEnrollment,
} from '../pheromones/enrollment-acts.js'
import { ENROLLMENT_KIND } from '../pheromones/enrollment.js'
import {
  isParticipantImage,
  readOwnTilePropertiesAt,
  tilePictureCandidates,
  writeTilePropertiesAt,
} from '../editor/tile-properties.js'
import { fetchThroughContentHop } from '../presentation/tiles/artifact-content.js'
import {
  DIVISION_FAMILY,
  DIVISION_KIND,
  HEX_H,
  HEX_W,
  derivedVisualSpec,
  divisionPlan,
  payloadOfPlan,
  slotAt,
  type DerivedVisualSpec,
  type DivisionFlow,
  type DivisionSlot,
} from '../presentation/tiles/visual-division.js'

type StoreLike = {
  putResource?: (blob: Blob) => Promise<string>
  getResource?: (sig: string) => Promise<Blob | null>
}
type HistoryLike = {
  sign(lineage: { explorerSegments: () => readonly string[] }): Promise<string>
}

/** Long edge of a part's picture, in pixels. Big enough to read as a picture
 *  in the tile editor and the lightbox, small enough that seven of them are
 *  not a burden to store or to push. */
const MIN_PART_WIDTH = 256
const MAX_PART_WIDTH = 1024

export type DistributeOutcome = {
  readonly ok: boolean
  /** Holes the whole now declares. */
  readonly slots: number
  /** Parts given a region of the whole's picture. */
  readonly divided: number
  /** Parts given a visual derived from their own name (nothing to divide). */
  readonly derived: number
  /** Parts left alone because they already own a picture. */
  readonly kept: number
  readonly reason?: string
}

/**
 * Give every part its own appearance, and give the whole its frame.
 *
 * `parts` is ORDERED — part k takes slot k, which is the layout slot child k
 * occupies, which is the region of the whole's picture that sits there. That
 * chain is what makes the parts reassemble into the whole with no seam and
 * without either side pointing at the other.
 *
 * `place` also writes each part's layout index, so the reassembly is literal
 * rather than merely intended. Only a caller that MADE these tiles may ask for
 * it — arranging somebody else's siblings is not this function's business.
 */
export async function distributeVisual(opts: {
  readonly wholeSegments: readonly string[]
  readonly parts: readonly string[]
  readonly place?: boolean
  /** How the holes are arranged. `spiral` (the default) divides a picture;
   *  the HTML flows divide a page. */
  readonly flow?: DivisionFlow
  /** Relative weight per hole. Never a size. */
  readonly spans?: readonly number[]
}): Promise<DistributeOutcome> {
  const empty = { ok: false, slots: 0, divided: 0, derived: 0, kept: 0 }
  const wholeSegments = opts.wholeSegments.map(s => String(s ?? '').trim()).filter(Boolean)
  const parts = opts.parts.map(p => String(p ?? '').trim()).filter(Boolean)
  if (wholeSegments.length === 0) return { ...empty, reason: 'nowhere' }
  if (parts.length === 0) return { ...empty, reason: 'no-parts' }

  const store = get<StoreLike>('@hypercomb.social/Store')
  if (!store?.putResource || !store?.getResource) return { ...empty, reason: 'no-store' }

  const wholeName = wholeSegments[wholeSegments.length - 1]
  const parentOfWhole = wholeSegments.slice(0, -1)
  const plan = divisionPlan(parts.length, opts.flow ?? 'spiral', opts.spans)

  // ── the whole: a frame, and a face for the parts to belong to ──
  //
  // The frame first. It is pure geometry and it is valid whether or not the
  // parts ever get filled, so writing it before touching a single part is the
  // order that leaves every intermediate state correct.
  await replaceDecoration({
    kind: DIVISION_KIND,
    appliesTo: wholeSegments,
    segments: wholeSegments,
    payload: payloadOfPlan(plan),
    mark: 'persistent',
  })

  const relation = await divisionRelationName(wholeSegments)
  const group = await ensureSiteArtifact(wholeSegments, relation, DIVISION_FAMILY)
  if (!group) return { ...empty, slots: plan.arity, reason: 'no-relation' }

  // ── the source, if there is one ──
  const source = await wholePicture(store, parentOfWhole, wholeName)

  let divided = 0
  let derived = 0
  let kept = 0

  for (let k = 0; k < parts.length; k++) {
    const part = parts[k]
    const partSegments = [...wholeSegments, part]

    // Position first. It is the seating, and it is true even for a part that
    // already has its own picture and will be left alone below.
    await seat(partSegments, group.sig, group.meaning, k)

    const own = await readOwnTilePropertiesAt(wholeSegments, part)
    // `isParticipantImage`, not `hasTileImage`. A SUBSTRATE DEFAULT is filler
    // this app chose to stop a tile being blank — and `withoutSubstrateImage`
    // strips it the moment the tile travels, so a part "already dressed" in one
    // would arrive BLANK anywhere else. That is precisely the failure rule 10
    // exists to prevent, so a default reads as no picture and gets replaced by
    // one the part actually owns. Only a picture that is the PARTICIPANT'S is
    // left alone.
    //
    // Found the hard way: the substrate dresses new tiles moments after they
    // are created, so with `hasTileImage` here whether a part ended up with an
    // appearance of its own depended on whether distribution or the substrate
    // got there first. Rule 10 held or failed on a race.
    if (isParticipantImage(own)) { kept++; continue }

    const slot = slotAt(plan, k)
    const bytes = source && slot
      ? await cropRegion(source, slot)
      : await drawDerived(derivedVisualSpec(part))
    if (!bytes) continue

    let sig: string
    try {
      sig = await store.putResource(bytes)
    } catch (err) {
      console.warn('[visual-distribution] could not store the picture for', part, err)
      continue
    }

    const updates: Record<string, unknown> = {
      large: { image: sig, x: 0, y: 0, scale: 1 },
      small: { image: sig },
      // A distributed picture is the part's OWN. Clearing the substrate mark
      // keeps a theme re-dress from treating it as filler and replacing it.
      substrate: undefined,
    }
    if (opts.place !== false) updates['index'] = k

    try {
      await writeTilePropertiesAt(wholeSegments, part, updates)
      EffectBus.emit('tile:saved', { cell: part, segments: wholeSegments })
      if (source && slot) divided++
      else derived++
    } catch (err) {
      console.warn('[visual-distribution] could not dress', part, err)
    }
  }

  console.log(
    `[visual-distribution] /${wholeSegments.join('/')}: ${plan.arity} holes,`
    + ` ${divided} divided, ${derived} derived, ${kept} already dressed`,
  )
  return { ok: true, slots: plan.arity, divided, derived, kept }
}

/**
 * Give each of these tiles a visual of its own — and declare nothing.
 *
 * The half of rule 10 that applies when NOTHING WAS DIVIDED. `/expand` widens
 * a layer, an importer lands
 * a set: in none of those did a whole's appearance get cut up, so there is no
 * frame to declare and no division to seat anybody into. What is still owed is
 * the rule's third clause — *where there is nothing to divide, each part is
 * GIVEN its own visual at creation, derived from what that part is, never left
 * absent*.
 *
 * Writing a frame here would be worse than doing nothing: it would re-declare
 * the arity of a whole that was never broken apart, and on a whole that WAS,
 * every existing part's region would silently stop lining up.
 *
 * Same refusals as `distributeVisual`: a tile that already owns its picture is
 * left alone, and an inherited one does not count as owning.
 */
export async function dressParts(opts: {
  readonly segments: readonly string[]
  readonly parts: readonly string[]
}): Promise<{ readonly dressed: number; readonly kept: number }> {
  const segments = opts.segments.map(s => String(s ?? '').trim()).filter(Boolean)
  const parts = opts.parts.map(p => String(p ?? '').trim()).filter(Boolean)
  if (parts.length === 0) return { dressed: 0, kept: 0 }

  const store = get<StoreLike>('@hypercomb.social/Store')
  if (!store?.putResource) return { dressed: 0, kept: 0 }

  let dressed = 0
  let kept = 0
  for (const part of parts) {
    try {
      if (isParticipantImage(await readOwnTilePropertiesAt(segments, part))) { kept++; continue }
      const bytes = await drawDerived(derivedVisualSpec(part))
      if (!bytes) continue
      const sig = await store.putResource(bytes)
      await writeTilePropertiesAt(segments, part, {
        large: { image: sig, x: 0, y: 0, scale: 1 },
        small: { image: sig },
        substrate: undefined,
      })
      EffectBus.emit('tile:saved', { cell: part, segments })
      dressed++
    } catch (err) {
      console.warn('[visual-distribution] could not dress', part, err)
    }
  }
  console.log(`[visual-distribution] /${segments.join('/')}: dressed ${dressed}, ${kept} already had a picture`)
  return { dressed, kept }
}

// ── the relation ────────────────────────────────────────────────────────

/**
 * The name of the relation a whole's parts enrol in.
 *
 * Derived from the whole's LOCATION, not just its label: two tiles called
 * "engine" in different branches are different wholes and must not share one
 * set. The tail of the location signature makes that so without anyone having
 * to keep a register, and the readable prefix keeps `/enroll` legible.
 */
async function divisionRelationName(wholeSegments: readonly string[]): Promise<string> {
  const label = wholeSegments[wholeSegments.length - 1] ?? 'whole'
  const history = get<HistoryLike>('@diamondcoreprocessor.com/HistoryService')
  try {
    const sig = await history?.sign({ explorerSegments: () => [...wholeSegments] })
    if (sig) return `${label}-${sig.slice(0, 12)}`
  } catch { /* history cold — the label alone still names a relation */ }
  return label
}

/**
 * Put this part at position `order` in the division.
 *
 * Deliberately NOT `ensureEnrollment`: that derives the next free position by
 * walking the hive, which is the right answer when a participant joins a set
 * and the wrong one here — the position is already known, it is the slot the
 * part occupies, and deriving it would let two parts land on one hole. A part
 * already enrolled at another position is re-seated, because the division just
 * decided where it goes.
 */
async function seat(
  partSegments: readonly string[],
  groupSig: string,
  meaning: string,
  order: number,
): Promise<void> {
  try {
    const worn = await listDecorations<{ sig?: string; order?: number }>({
      kind: ENROLLMENT_KIND,
      segments: partSegments,
    })
    const here = worn.filter(e => String(e.record.payload?.sig ?? '').toLowerCase() === groupSig)
    if (here.length === 1 && here[0].record.payload?.order === order) return
    for (const entry of here) removeDecoration({ sig: entry.sig, segments: partSegments })
    await wearEnrollment(partSegments, { sig: groupSig, meaning, order })
  } catch (err) {
    console.warn('[visual-distribution] could not seat', partSegments.join('/'), err)
  }
}

/** The group a whole's division names, for a reader that holds the whole's
 *  path. Exported so a view can ask "what seats into my holes?" without this
 *  module having to tell it. */
export async function divisionGroupOf(
  wholeSegments: readonly string[],
): Promise<{ sig: string; meaning: string } | null> {
  const relation = await divisionRelationName(wholeSegments)
  const group = await siteGroupFor(relation, DIVISION_FAMILY)
  return group ? { sig: group.sig, meaning: group.meaning } : null
}

// ── the bytes ───────────────────────────────────────────────────────────

/**
 * The whole's OWN picture, decoded, or null when it has none to divide.
 *
 * Own, not inherited: a picture the tile shows because a root default supplies
 * it is not the tile's appearance to give away, and dividing it would hand
 * every part a slice of somebody else's filler.
 *
 * Every fetch goes through the content hop — `Store.getResource` does NOT
 * follow a meta envelope, and a consumer that hands it a payload reference
 * gets the envelope's JSON and tries to decode it as an image.
 */
async function wholePicture(
  store: StoreLike,
  parentOfWhole: readonly string[],
  wholeName: string,
): Promise<ImageBitmap | null> {
  if (typeof createImageBitmap !== 'function') return null
  let props: Record<string, unknown> = {}
  try { props = await readOwnTilePropertiesAt(parentOfWhole, wholeName) } catch { return null }

  for (const candidate of tilePictureCandidates(props)) {
    try {
      const blob = await fetchThroughContentHop(candidate, sig => store.getResource!(sig))
      if (!blob || blob.size === 0) continue
      return await createImageBitmap(blob)
    } catch { /* undecodable or absent — try the next candidate */ }
  }
  return null
}

/** One region of the source, at the hexagon's own aspect. The crop is what the
 *  part OWNS from here on: it carries its own bytes and needs nothing else to
 *  be seen. */
async function cropRegion(source: ImageBitmap, slot: DivisionSlot): Promise<Blob | null> {
  if (typeof OffscreenCanvas !== 'function') return null
  const sx = slot.x * source.width
  const sy = slot.y * source.height
  const sw = slot.w * source.width
  const sh = slot.h * source.height
  if (!(sw > 0) || !(sh > 0)) return null

  const width = Math.round(Math.min(MAX_PART_WIDTH, Math.max(MIN_PART_WIDTH, sw)))
  const height = Math.round((width * HEX_H) / HEX_W)
  try {
    const canvas = new OffscreenCanvas(width, height)
    const context = canvas.getContext('2d')
    if (!context) return null
    context.imageSmoothingEnabled = true
    context.imageSmoothingQuality = 'high'
    context.drawImage(source, sx, sy, sw, sh, 0, 0, width, height)
    return await canvas.convertToBlob({ type: 'image/webp', quality: 0.9 })
  } catch (err) {
    console.warn('[visual-distribution] crop failed', err)
    return null
  }
}

/**
 * Draw the visual a part is GIVEN when there was nothing to divide.
 *
 * The spec is deterministic in the part's name, so this is too: the same part
 * looks the same on every host forever, and two parts never converge. The mark
 * is drawn in hex sectors so it reads as belonging to a tile rather than as a
 * stock placeholder, and it is never all six sectors — a fully filled tile is
 * a colour swatch, which says nothing about which part it is.
 */
async function drawDerived(spec: DerivedVisualSpec): Promise<Blob | null> {
  if (typeof OffscreenCanvas !== 'function') return null
  const width = MIN_PART_WIDTH * 2
  const height = Math.round((width * HEX_H) / HEX_W)
  try {
    const canvas = new OffscreenCanvas(width, height)
    const context = canvas.getContext('2d')
    if (!context) return null

    const wash = context.createLinearGradient(0, 0, width, height)
    wash.addColorStop(0, spec.from)
    wash.addColorStop(1, spec.to)
    context.fillStyle = wash
    context.fillRect(0, 0, width, height)

    const cx = width / 2
    const cy = height / 2
    const radius = Math.min(width, height) / 2
    context.fillStyle = spec.ink
    context.globalAlpha = 0.9
    for (const sector of spec.sectors) {
      const from = (sector * Math.PI) / 3 - Math.PI / 2
      const to = from + Math.PI / 3
      context.beginPath()
      context.moveTo(cx, cy)
      context.arc(cx, cy, radius * spec.reach, from, to)
      context.closePath()
      context.fill()
    }
    return await canvas.convertToBlob({ type: 'image/webp', quality: 0.9 })
  } catch (err) {
    console.warn('[visual-distribution] derived visual failed', err)
    return null
  }
}
