// presentation/tiles/visual-division.ts
//
// BREAKING APART DISTRIBUTES THE VISUAL — the geometry half.
//
// Rule 10 of the website-artifact paradigm: when an artifact is broken into
// parts, its APPEARANCE is divided among them. A part that renders by falling
// through to its parent's picture, or to a substrate default, looks correct on
// the page where it was made and arrives BLANK everywhere else — shared alone,
// filed elsewhere, met by a peer who does not hold the parent. That makes it a
// DEPENDENT artifact, which rules 1 and 2 forbid. Inheriting an appearance is
// not having one.
//
// ── THE PLACEHOLDER, AND WHY DIVISION ALONE IS NOT ENOUGH ────────────────
//
// "Divide, never duplicate" is only half the law. Divide on its own implies a
// picture that got CUT UP, which quietly reverses the dependency: a whole
// missing the regions its parts took away would need them back to look
// complete. That is the same disease pointing the other way.
//
// So the whole keeps a PLACEHOLDER at every region it gave away, and its own
// picture is never modified. What it gains is a FRAME — a plan recording the
// position, size and proportion of each hole. All three directions hold at
// once:
//
//   • the whole is complete with zero parts   (its picture is untouched, and
//     an unfilled hole is a finished state, not a missing asset)
//   • each part is complete with no whole     (it carries its own bytes)
//   • together they reassemble exactly        (region k IS layout slot k)
//
// ── A PLACEHOLDER IS AN INTERFACE, NEVER A POINTER ──────────────────────
//
// A slot states a SHAPE and says nothing about who fills it. That is the one
// sanctioned dependency of rule 2: the whole may depend on the shape, a part
// may depend on the shape, and neither depends on the other.
//
// So a slot carries NO part name and NO signature — not the part's, not even
// the source picture's. Naming the part would make the whole depend on it, and
// would pin the part to exactly one whole. Seating comes from the OTHER side:
// a part is enrolled, and its membership already carries its POSITION
// (`{ sig, meaning, order }` — pheromones/enrollment.ts). Order k seats into
// slot k, so one part can seat into several wholes at a different place in
// each, and no whole knows the others exist.
//
// A plan is therefore pure geometry — a REFERENT, exactly like a group
// signature: no bytes exist behind it, so it can never drag a part's content
// into the whole's closure (core/edge-registry.ts).
//
// ── WHY THE SPIRAL IS THE DIVISION ──────────────────────────────────────
//
// The children of a tile are laid out in the AxialService spiral — centre
// first, then ring by ring. So the honest division of the whole's picture is
// that same spiral: slot k takes the piece of the picture that will sit where
// slot k sits. Walk into the whole and the parts' pictures ARE its picture,
// tiled. Nothing has to be told to line up; the layout is the alignment.
//
// Regions are the hexes' AXIS-ALIGNED BOUNDING BOXES, so they overlap at the
// corners. That is deliberate: the hex clip discards the overlap, and a rect
// is what an image crop can express. A region is normalized (0..1) against the
// whole's picture so it survives any resolution — and so a frame minted before
// there was anything to cut stays valid for a picture that arrives later.
//
// ── WHERE THERE IS NOTHING TO DIVIDE ────────────────────────────────────
//
// A pictureless whole has no appearance to distribute, and "no appearance" is
// never an acceptable answer for a part. Each part is then GIVEN one, derived
// from what that part IS — its name, deterministically. Same name, same visual
// on every host, forever; different names never collide into the same picture.
// That is the difference between a part being given a visual and a part being
// left to inherit one.
//
// This module is PURE — geometry, planning and the derived-visual spec, with no
// IoC, no canvas and no store. The raster work and the writes live in
// assistant/visual-distribution.ts, which is where they can be guarded.
//
// See documentation/website-artifact-paradigm.md (rules 10 and 11).

/** Decoration kind carrying a whole's frame — its placeholders. */
export const DIVISION_KIND = 'visual:division:plan'

/** The artifact FAMILY a division names. A tile broken apart gains a
 *  `visual:division:artifact` face and its parts enrol in it; that face is
 *  independent of any website or gallery face the same tile carries. */
export const DIVISION_FAMILY = 'division'

/** One hole in a whole's frame.
 *
 *  It names a POSITION and nothing else. There is no part field and there
 *  never may be one — see the header. An unfilled slot is not an error and
 *  never becomes one; the whole renders its own picture either way. */
export interface DivisionSlot {
  /** Layout index in the whole's spiral. Slot k is where child k sits. */
  readonly index: number
  /** Normalized region of the whole's picture, origin top-left, 0..1. */
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
}

/**
 * How a whole's holes are arranged.
 *
 *   spiral  the hex grid — holes are REGIONS of the whole's picture, and
 *           `slotAt` gives each one's rectangle. What break-apart does to a
 *           tile that carries a picture.
 *   stack   one hole per row, each the full width
 *   row     holes side by side, wrapping
 *   grid    holes in columns, wrapping by weight
 *
 * The three HTML flows deliberately have NO geometry function: a hole in them
 * has a width relative to its siblings and NO HEIGHT AT ALL. That omission is
 * the whole of what makes a part interchangeable — a hole that says "a column
 * that grows" accepts any content, a hole that says 300×200 accepts almost
 * none, and a part that only fits one whole is a part that can live in one
 * whole.
 */
export type DivisionFlow = 'spiral' | 'stack' | 'row' | 'grid'

/** The attribute that marks a hole in a container. Positional: the value is
 *  the slot index, which is the position a member's enrolment mark carries.
 *  A container never names the artifact that fills a hole. */
export const SLOT_ATTR = 'data-hc-slot'

/**
 * The frame a whole keeps after giving its appearance away.
 *
 * HOW MANY, AND HOW ARRANGED — and nothing else. Positions are a pure function
 * of those two: for `spiral`, `spiralAxial(k)` fitted to the spiral's own box.
 * Storing the positions would be caching a derivation, and a derived cache
 * written as truth is what the optimize-phase contract forbids.
 *
 * The arity is NOT derivable, and it is frozen at the moment of breaking apart
 * rather than recounted from live membership: recount, and removing a part
 * reflows every remaining hole, which is exactly how a whole stops being
 * finished. Seven holes with two parts in them is a whole with five EMPTY
 * holes, not a whole with two.
 */
export interface DivisionPlan {
  /** How many holes the whole declares. Frozen; never recounted. */
  readonly arity: number
  /** How they are arranged. Absent on a frame written before flows existed,
   *  which read back as `spiral` — the only thing they could have been. */
  readonly flow: DivisionFlow
  /** RELATIVE weight per hole, never a size. Absent = every hole equal.
   *  Ignored by `spiral`, whose hexes are all one size by construction. */
  readonly spans?: readonly number[]
}

// ── the spiral ───────────────────────────────────────────────────────────

/** Axial coordinate of layout slot `index`, centre-out, ring by ring.
 *
 *  This reproduces `AxialService.createMatrix`'s walk exactly — same start,
 *  same six directions, same order — as a pure function. It is duplicated
 *  rather than imported because that class pulls in pixi.js and Settings, and
 *  a division plan has to be computable in a test with neither. The walk is
 *  fixed by the layout the participant already sees, so it cannot drift
 *  without the tiles themselves moving. */
export function spiralAxial(index: number): { q: number; r: number } {
  if (!Number.isInteger(index) || index < 0) {
    throw new Error('[visual-division] slot index must be a non-negative integer')
  }
  if (index === 0) return { q: 0, r: 0 }

  const DIRECTIONS: ReadonlyArray<readonly [number, number]> = [
    [1, -1], [1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1],
  ]

  let seen = 0
  for (let ring = 1; ; ring++) {
    // Start of the ring: `ring` steps out along the north-west diagonal, the
    // same `subtract(n, 0, n)` the matrix builder does before walking.
    let q = -ring
    let r = 0
    for (let side = 0; side < 6; side++) {
      for (let step = 0; step < ring; step++) {
        const dir = DIRECTIONS[side]
        q += dir[0]
        r += dir[1]
        if (++seen === index) return { q, r }
      }
    }
  }
}

/** Centre of a hex, in units of the hex's SIDE. Pointy-top, matching
 *  `AxialCoordinate.getLocation`. */
export function axialCentre(q: number, r: number): { x: number; y: number } {
  return {
    x: Math.sqrt(3) * q + (Math.sqrt(3) / 2) * r,
    y: 1.5 * r,
  }
}

/** A pointy-top hexagon of side 1: √3 across the flats, 2 point to point.
 *  Exported because the raster half sizes its crops at this aspect. */
export const HEX_W = Math.sqrt(3)
export const HEX_H = 2

// ── the plan ─────────────────────────────────────────────────────────────

/**
 * The frame for a whole broken into `count` parts.
 *
 * The slots' hexes are laid out in the spiral, their union bounding box is
 * fitted to the picture, and each slot takes its own hex's bounding box as a
 * normalized region. Because the fit is over the WHOLE spiral, the regions
 * together cover the whole picture — the whole stays recoverable from its
 * parts, which is the property that makes this a division rather than a set of
 * unrelated crops.
 *
 * Nothing here needs a picture to exist. A frame is shape, and shape is what a
 * whole can declare long before anyone has drawn anything to put in it.
 */
export function divisionPlan(
  count: number,
  flow: DivisionFlow = 'spiral',
  spans?: readonly number[],
): DivisionPlan {
  const arity = Number.isInteger(count) && count > 0 ? count : 0
  const weights = spans?.length === arity && spans.every(w => Number.isFinite(w) && w > 0)
    ? [...spans]
    : undefined
  return weights ? { arity, flow, spans: weights } : { arity, flow }
}

/** The weight of hole `index` relative to its siblings. Equal by default —
 *  a frame that says nothing about proportion is saying they are the same. */
export function spanAt(plan: DivisionPlan, index: number): number {
  if (index < 0 || index >= plan.arity) return 0
  return plan.spans?.[index] ?? 1
}

/** The bounding box the whole spiral of `n` hexes occupies, in side units.
 *  Taken over the HEXES, not their centres — a slot on the rim must have its
 *  whole hex inside the picture or its crop runs off the edge. */
function frameBox(n: number): { minX: number; minY: number; spanX: number; spanY: number } {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (let i = 0; i < n; i++) {
    const { q, r } = spiralAxial(i)
    const c = axialCentre(q, r)
    minX = Math.min(minX, c.x - HEX_W / 2)
    maxX = Math.max(maxX, c.x + HEX_W / 2)
    minY = Math.min(minY, c.y - HEX_H / 2)
    maxY = Math.max(maxY, c.y + HEX_H / 2)
  }
  return { minX, minY, spanX: maxX - minX, spanY: maxY - minY }
}

/**
 * The hole at `index` — DERIVED, never stored.
 *
 * The hex sits where layout slot `index` sits, and the picture is fitted to the
 * whole spiral, so the holes together cover it exactly: the whole stays
 * recoverable from its parts, which is what makes this a division rather than a
 * set of unrelated crops.
 *
 * `null` when the frame does not reach that far. A part whose position is past
 * the end of the frame simply has no hole to seat into — a fact about the
 * frame, never an error about the part.
 */
export function slotAt(plan: DivisionPlan, index: number): DivisionSlot | null {
  const n = plan.arity
  if (!Number.isInteger(index) || index < 0 || index >= n) return null
  // Only the spiral has a rectangle. An HTML flow's hole has a width relative
  // to its siblings and NO HEIGHT — inventing one here is precisely how a hole
  // would stop accepting content that does not happen to fit it.
  if (plan.flow !== 'spiral') return null
  const { minX, minY, spanX, spanY } = frameBox(n)
  const { q, r } = spiralAxial(index)
  const c = axialCentre(q, r)
  return {
    index,
    x: (c.x - HEX_W / 2 - minX) / spanX,
    y: (c.y - HEX_H / 2 - minY) / spanY,
    w: HEX_W / spanX,
    h: HEX_H / spanY,
  }
}

/** Every hole, in order. Convenience over `slotAt`; nothing stores this. */
export function slotsOf(plan: DivisionPlan): DivisionSlot[] {
  const out: DivisionSlot[] = []
  for (let i = 0; i < plan.arity; i++) {
    const slot = slotAt(plan, i)
    if (slot) out.push(slot)
  }
  return out
}

/** What a frame is WRITTEN as. One number — see `DivisionPlan`. */
export function payloadOfPlan(
  plan: DivisionPlan,
): { arity: number; flow: DivisionFlow; spans?: readonly number[] } {
  return plan.spans
    ? { arity: plan.arity, flow: plan.flow, spans: [...plan.spans] }
    : { arity: plan.arity, flow: plan.flow }
}

/**
 * Read a frame back off a decoration payload.
 *
 * Tolerant in two directions. A malformed or absent record reads as an empty
 * frame, because a whole with no frame is a whole that was never broken apart,
 * not a whole that is broken. And a RETIRED record — the rectangles, before
 * they were understood to be derived — reads as its own length, so frames
 * already written keep their arity instead of silently becoming zero.
 */
const FLOWS: ReadonlySet<string> = new Set<DivisionFlow>(['spiral', 'stack', 'row', 'grid'])

export function planOfPayload(payload: unknown): DivisionPlan {
  const record = payload as
    { arity?: unknown; flow?: unknown; spans?: unknown; slots?: unknown } | null | undefined
  // A frame written before flows existed could only ever have been a spiral.
  const flow = FLOWS.has(String(record?.flow)) ? String(record?.flow) as DivisionFlow : 'spiral'
  const declared = Number(record?.arity)
  const arity = Number.isInteger(declared) && declared >= 0
    ? declared
    : (Array.isArray(record?.slots) ? record.slots.length : 0)
  const spans = Array.isArray(record?.spans) ? record.spans.map(Number) : undefined
  return divisionPlan(arity, flow, spans)
}

// ── the derived visual ───────────────────────────────────────────────────

/**
 * A drawing spec for a part that had nothing to inherit — deterministic in the
 * part's name, so the same part looks the same on every host and two different
 * parts never converge on one picture.
 *
 * Deliberately NOT random and NOT a hash of the whole: a visual derived from
 * the whole would be a duplicate wearing a disguise, and seven near-identical
 * tiles say nothing about which part is which. This says something about THIS
 * part and nothing about anyone else — which is the whole requirement.
 *
 * The spec is data, not pixels, so a test can assert determinism without a
 * canvas and a renderer can draw it however it likes.
 */
export interface DerivedVisualSpec {
  /** Background wash, dark → light, as CSS colours. */
  readonly from: string
  readonly to: string
  /** Ink for the mark drawn over the wash. */
  readonly ink: string
  /** Which of the six hex sectors carry the mark. Always at least one, never
   *  all six — a fully-filled tile is indistinguishable from a colour swatch. */
  readonly sectors: readonly number[]
  /** 0..1 — how far from the centre the mark sits. */
  readonly reach: number
}

/** FNV-1a over the name. Small, stable, and dependency-free; this picks
 *  colours, so it needs to be deterministic, not cryptographic. */
function nameHash(name: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

export function derivedVisualSpec(name: string): DerivedVisualSpec {
  const key = String(name ?? '').trim().toLowerCase()
  const h = nameHash(key || 'part')

  const hue = h % 360
  // A second, well-separated hue so the wash reads as a gradient rather than
  // a flat fill, without ever landing on its own complement (which muddies).
  const hue2 = (hue + 24 + ((h >>> 9) % 40)) % 360
  const sat = 42 + ((h >>> 17) % 26)

  const sectorBits = ((h >>> 5) % 62) + 1   // 1..62 — never 0, never 63
  const sectors: number[] = []
  for (let i = 0; i < 6; i++) if (sectorBits & (1 << i)) sectors.push(i)

  return {
    from: `hsl(${hue} ${sat}% 22%)`,
    to: `hsl(${hue2} ${sat}% 46%)`,
    ink: `hsl(${(hue + 180) % 360} ${Math.min(90, sat + 30)}% 78%)`,
    sectors,
    reach: 0.42 + ((h >>> 23) % 30) / 100,
  }
}
