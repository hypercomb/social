// hypercomb-shared/ui/layout-designer/select-walk.ts
//
// MOVING THE SELECTION WITH THE KEYBOARD.
//
// Two ways to move, because there are two questions.
//
//   TAB     "show me the next one" — document order, wrapping. It reaches
//           EVERY container eventually, which is the property that makes it
//           the honest fallback: whatever the arrangement, tab gets you there.
//   ARROWS  "the one over THERE" — geometry, because the participant is
//           pointing at a picture. A layout can be a row, a column, a
//           wrapping grid, or any of those nested inside the others, so the
//           only answer that survives every arrangement is the one the eye
//           gives: nearest, in the direction asked for.
//
// Deriving the arrow move from the TREE instead — first child, next sibling —
// looked simpler and is wrong the moment a layout is a column: pressing Right
// would walk down the screen. The shape of the arrangement is data, and it
// changes under you; where the boxes actually are is not.
//
// Pure — rectangles in, a path out. No DOM, so the arithmetic can be argued
// with in a test rather than in a browser.

/** Where something is. The four numbers a DOMRect gives, and nothing else. */
export interface Box {
  readonly left: number
  readonly top: number
  readonly right: number
  readonly bottom: number
}

/** One thing the keyboard can land on: a container, and where it is drawn. */
export interface Selectable {
  /** The hole path that reaches this container. Empty is the root. */
  readonly path: readonly string[]
  readonly rect: Box
}

export type Step = 'next' | 'previous' | 'up' | 'down' | 'left' | 'right'

const centre = (box: Box): { x: number; y: number } => ({
  x: (box.left + box.right) / 2,
  y: (box.top + box.bottom) / 2,
})

const key = (path: readonly string[]): string => path.join('/')

/**
 * Where the selection goes next, or null when it does not move.
 *
 * Null is a real answer and never an error: pressing Right at the right-hand
 * edge should do nothing at all rather than wrap to the far side, because a
 * wrap in a spatial move reads as the selection teleporting.
 */
export function walkSelection(
  items: readonly Selectable[],
  currentPath: readonly string[] | null,
  step: Step,
): readonly string[] | null {
  if (items.length === 0) return null

  const index = currentPath === null
    ? -1
    : items.findIndex(item => key(item.path) === key(currentPath))

  // Nothing selected yet: any key lands on the first thing there is. A
  // participant who presses an arrow is asking to start somewhere.
  if (index < 0) return items[0].path

  if (step === 'next' || step === 'previous') {
    // Document order, wrapping — the one move that always goes somewhere.
    const delta = step === 'next' ? 1 : -1
    const next = (index + delta + items.length) % items.length
    return next === index ? null : items[next].path
  }

  return nearestInDirection(items, index, step)
}

/** Is `outer` an enclosing container of `path`? A hole path names the way in,
 *  so every strict prefix of a path is one of its ancestors — no geometry
 *  needed, and no chance of disagreeing with the arrangement. */
function encloses(outer: readonly string[], path: readonly string[]): boolean {
  if (outer.length >= path.length) return false
  return outer.every((step, i) => step === path[i])
}

/**
 * The nearest box in the direction asked for.
 *
 * A candidate qualifies only if its centre is genuinely PAST the current
 * centre on the asked axis — "to the right" has to mean to the right, or a
 * press lands on something beside you and the selection appears to jump
 * sideways.
 *
 * AN ANCESTOR IS NEVER A CANDIDATE. The container you are in is around you,
 * not over there, and its centre is usually past yours on some axis — so
 * without this the root, which encloses everything, wins nearly every press
 * and the arrows do nothing but climb out. Ancestors are what Shift+Tab is
 * for. Containers you are INSIDE of, by contrast, stay in: pressing Down on a
 * container split top and bottom should land in its lower half, and that is
 * exactly what the geometry says once the enclosing boxes are out of the way.
 *
 * Among the survivors it is scored by distance along the axis plus TWICE the
 * drift across it. The doubling is what makes the move feel deliberate: of two
 * boxes equally far to the right, the one nearly level with you is the one you
 * meant, and without the weighting a box further away but perfectly aligned
 * loses to one that is barely to the right and half a screen up.
 *
 * A consequence worth knowing: moving toward a nest lands on the nest ITSELF
 * before anything inside it, because the whole region is the box most level
 * with you. You arrive at the region, then step into it. That is the reading
 * order a person uses on a page, and it falls out rather than being arranged.
 */
function nearestInDirection(
  items: readonly Selectable[],
  index: number,
  step: Exclude<Step, 'next' | 'previous'>,
): readonly string[] | null {
  const here = items[index].path
  const from = centre(items[index].rect)
  const horizontal = step === 'left' || step === 'right'
  const sign = step === 'right' || step === 'down' ? 1 : -1

  let best: { path: readonly string[]; score: number } | null = null
  for (let i = 0; i < items.length; i++) {
    if (i === index) continue
    if (encloses(items[i].path, here)) continue
    const to = centre(items[i].rect)
    const along = horizontal ? (to.x - from.x) * sign : (to.y - from.y) * sign
    // Strictly past, and by more than a hair: two containers sharing a centre
    // on this axis are not "in that direction" from one another.
    if (along <= 0.5) continue
    const across = horizontal ? Math.abs(to.y - from.y) : Math.abs(to.x - from.x)
    const score = along + across * 2
    if (!best || score < best.score) best = { path: items[i].path, score }
  }
  return best?.path ?? null
}

/**
 * CLICKING THE SAME PLACE AGAIN GOES ONE LAYER IN.
 *
 * A point in the pane is not over one container, it is over a STACK of them —
 * the root, the region inside it, the region inside that. A single click has
 * to pick one, and any choice it makes is wrong for somebody: the outermost
 * ignores the nesting you built, the innermost makes the outer regions
 * unreachable by pointing at them.
 *
 * So a click does not choose, it ADVANCES. The first lands on the outermost
 * container over that point; each one after it steps one layer deeper along
 * the same stack. Nothing to learn and nothing to hold down — you keep
 * clicking until the thing you meant is ringed.
 *
 * At the bottom it returns to the top rather than stopping. A stack you can
 * only descend strands you at the deepest level with no way back out by the
 * gesture that got you there, and a participant who overshoots by one click
 * should be able to fix it with one more.
 *
 * `chain` is outermost first. A selection that is not in the stack means the
 * pointer has moved somewhere unrelated, and the walk starts over.
 */
export function drillSelection(
  chain: readonly (readonly string[])[],
  currentPath: readonly string[] | null,
): readonly string[] | null {
  if (chain.length === 0) return null
  if (currentPath === null) return chain[0]
  const at = chain.findIndex(path => key(path) === key(currentPath))
  if (at < 0) return chain[0]
  return chain[(at + 1) % chain.length]
}

/** Which way along the stack. `in` is deeper, `out` is back toward the whole. */
export type Drill = 'in' | 'out'

/**
 * THE WHEEL GOES IN AND OUT OF THE STACK, AND STOPS AT BOTH ENDS.
 *
 * Point anywhere in the design and scroll: down goes in, up comes back out.
 * Nothing has to be selected first — the wheel enters the stack from whichever
 * end it is heading away from, so scrolling down starts at the whole and works
 * inward, and scrolling up starts at the innermost and works back out. That is
 * the same motion as reading a list of layers with the wheel, which is what
 * the stack is.
 *
 * IT DOES NOT WRAP, unlike a click. A click has one direction, so returning to
 * the top is the only way back; the wheel has two, and a wrap would mean
 * scrolling one notch too far dropped you from the whole design into the
 * deepest corner of it. Clamped, the ends are ends: keep scrolling and nothing
 * happens, which is what a person expects when they have run out of layers.
 *
 * Null means the selection does not move.
 */
export function drillByWheel(
  chain: readonly (readonly string[])[],
  currentPath: readonly string[] | null,
  direction: Drill,
): readonly string[] | null {
  if (chain.length === 0) return null
  const at = currentPath === null
    ? -1
    : chain.findIndex(path => key(path) === key(currentPath))
  // Not in this stack: enter it from the far end of the way you are going.
  if (at < 0) return direction === 'in' ? chain[0] : chain[chain.length - 1]
  const next = direction === 'in' ? at + 1 : at - 1
  if (next < 0 || next >= chain.length) return null
  return chain[next]
}

/** How far a wheel has to turn before it counts as one step. A notch of a
 *  mouse wheel is usually 100; a trackpad sends a stream of small deltas, and
 *  without a threshold one flick would fall through every layer at once. */
const NOTCH = 50

/**
 * Fold one wheel event into a running total and say whether a step came out.
 *
 * Kept pure and separate so the smoothing can be argued about without a mouse.
 * The total carries between events; a change of direction discards it, because
 * you meant the new direction rather than the leftovers of the old one.
 *
 * ONE EVENT IS AT MOST ONE LAYER, however hard the wheel was turned. Every
 * whole notch in the total is consumed and only one step comes out, so a flick
 * cannot fall through a nesting — and the carry stays under a notch instead of
 * growing for as long as somebody keeps scrolling one way.
 */
export function wheelNotch(carried: number, delta: number): { carried: number; step: -1 | 0 | 1 } {
  if (delta === 0) return { carried, step: 0 }
  const total = (carried !== 0 && Math.sign(carried) !== Math.sign(delta) ? 0 : carried) + delta
  const notches = Math.trunc(total / NOTCH)
  if (notches === 0) return { carried: total, step: 0 }
  return { carried: total - notches * NOTCH, step: notches > 0 ? 1 : -1 }
}

/** The step a key asks for, or null when the key is none of our business.
 *
 *  Kept here so the component never grows a switch on `event.key`, and so the
 *  set of keys this surface claims is one readable list. */
export function stepForKey(key: string, shift: boolean): Step | null {
  switch (key) {
    case 'Tab': return shift ? 'previous' : 'next'
    case 'ArrowUp': return 'up'
    case 'ArrowDown': return 'down'
    case 'ArrowLeft': return 'left'
    case 'ArrowRight': return 'right'
    default: return null
  }
}
