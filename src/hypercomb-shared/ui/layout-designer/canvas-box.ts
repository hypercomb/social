// hypercomb-shared/ui/layout-designer/canvas-box.ts
//
// THE CANVAS STAYS IN THE MIDDLE.
//
// The layout designer's canvas is a box in the centre of the screen that you
// resize by dragging any of its four corners. It does not move: dragging a
// corner outward grows it in ALL FOUR directions, because the box is centred
// and only its SIZE is yours to set.
//
// That is deliberate and it is the whole gesture. A corner drag that moved one
// edge would make the canvas wander off-centre, and then "make it bigger" and
// "put it back" become two separate chores. Here there is one: how big.
//
// ── SIZE IS A FRACTION, NOT PIXELS ──────────────────────────────────────
//
// Stored as a fraction of the viewport, so the canvas keeps its PROPORTION
// across a window resize, a monitor change and a reload. Pixels would mean a
// canvas set on a wide screen arrives off the edge of a narrow one.
//
// Pure — numbers in, numbers out. No DOM, so the arithmetic can be argued with
// in a test instead of in a browser.

/** A centred box, as fractions of the viewport. */
export interface CanvasBox {
  /** Width as a fraction of viewport width, 0..1. */
  readonly w: number
  /** Height as a fraction of viewport height, 0..1. */
  readonly h: number
}

/**
 * Which handle is being dragged — a corner or an edge.
 *
 * The signs say which way the pointer has to travel to make the box bigger:
 * `se` grows on +x/+y, `nw` on -x/-y. A ZERO means that axis is not this
 * handle's business, which is the whole difference between an edge and a
 * corner: dragging the right edge widens the box and leaves its height exactly
 * where it was.
 */
export type Handle = 'nw' | 'ne' | 'se' | 'sw' | 'n' | 'e' | 's' | 'w'

/** Kept for callers that only ever pass a corner. */
export type Corner = Extract<Handle, 'nw' | 'ne' | 'se' | 'sw'>

const SIGNS: Readonly<Record<Handle, readonly [number, number]>> = {
  nw: [-1, -1],
  ne: [+1, -1],
  se: [+1, +1],
  sw: [-1, +1],
  n: [0, -1],
  s: [0, +1],
  w: [-1, 0],
  e: [+1, 0],
}

/** Small enough that the canvas can be tucked away, large enough that the
 *  holes are still legible when it is. */
export const MIN_FRACTION = 0.2
/** The pane may go edge to edge. It sits INSIDE the workspace — the area left
 *  over once the docked panel has pushed in from the left — so filling it
 *  completely covers no chrome and hides nothing. The handles live inside the
 *  border for the same reason: at full size there is no outside left to put
 *  them in. */
export const MAX_FRACTION = 1

export const DEFAULT_BOX: CanvasBox = { w: 0.62, h: 0.62 }

const clamp = (value: number): number =>
  Math.min(MAX_FRACTION, Math.max(MIN_FRACTION, value))

/**
 * The box after dragging `corner` by `dx`/`dy` pixels.
 *
 * The factor of two is the centring: the box grows away from the middle in
 * both directions at once, so the pointer — which moves one corner — has to
 * account for the opposite corner moving the same distance the other way.
 * Without it the canvas trails the pointer at half speed, which reads as lag
 * rather than as a design.
 */
export function resizeCentred(
  box: CanvasBox,
  corner: Handle,
  dx: number,
  dy: number,
  viewport: { width: number; height: number },
): CanvasBox {
  const [sx, sy] = SIGNS[corner]
  const width = Math.max(1, viewport.width)
  const height = Math.max(1, viewport.height)
  return {
    w: clamp(box.w + (2 * sx * dx) / width),
    h: clamp(box.h + (2 * sy * dy) / height),
  }
}

/** Read a stored box back, falling through to the default for anything that is
 *  not one — a corrupted preference must never leave the canvas unusable. */
export function parseBox(raw: string | null): CanvasBox {
  try {
    const parsed = JSON.parse(String(raw ?? '')) as Partial<CanvasBox>
    const w = Number(parsed?.w)
    const h = Number(parsed?.h)
    if (!Number.isFinite(w) || !Number.isFinite(h)) return DEFAULT_BOX
    return { w: clamp(w), h: clamp(h) }
  } catch {
    return DEFAULT_BOX
  }
}

/** The CSS the canvas element wears. Percentages, so the browser does the
 *  centring arithmetic and a viewport resize needs no listener.
 *
 *  Named fields rather than a record: an index signature reaches an Angular
 *  template as "must be accessed with ['width']" (TS4111), and a style binding
 *  written that way is one nobody will keep writing. */
export const boxStyle = (box: CanvasBox): { width: string; height: string } => ({
  width: `${(box.w * 100).toFixed(2)}%`,
  height: `${(box.h * 100).toFixed(2)}%`,
})
