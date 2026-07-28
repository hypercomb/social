// pointer-gesture-consumer.ts — swallow trailing events for a consumed pointer id.
//
// Use case: a button (mobile back, etc.) acts on `pointerdown` and triggers a
// view change. The same finger is still pressed; the trailing pointermove /
// pointerup / synthesized click would otherwise land on whatever is now under
// the cursor and activate it. Once a gesture is "consumed" we suppress every
// subsequent event for that pointerId at window capture-phase, before any
// descendant listener sees it. No timeouts — the gesture ends when its real
// pointerup or pointercancel arrives.

// A consumed gesture still ENDS, and the swallow is total — the trailing
// pointerup dies at window capture before any other listener sees it. Anything
// holding state keyed to that pointer (a long-press timer, a claimed gate)
// would otherwise wait forever for a release that is never delivered, which is
// how a consumed press can strand an input lock. So the end is re-announced on
// this event: suppressed for everyone who would have ACTED on it, still audible
// to anyone who only needs to know the finger is gone.
export const POINTER_GESTURE_END = 'hc:pointer-gesture-end'

const consumedIds = new Set<number>()
let suppressNextClick = false
let installed = false

function announceEnd(pointerId: number): void {
  window.dispatchEvent(new CustomEvent(POINTER_GESTURE_END, { detail: { pointerId } }))
}

function install(): void {
  if (installed) return
  installed = true

  window.addEventListener('pointermove', (e) => {
    if (!consumedIds.has(e.pointerId)) return
    e.stopImmediatePropagation()
  }, true)

  window.addEventListener('pointerup', (e) => {
    if (!consumedIds.has(e.pointerId)) return
    consumedIds.delete(e.pointerId)
    suppressNextClick = true
    e.stopImmediatePropagation()
    e.preventDefault()
    announceEnd(e.pointerId)
  }, true)

  window.addEventListener('pointercancel', (e) => {
    if (!consumedIds.delete(e.pointerId)) return
    e.stopImmediatePropagation()
    announceEnd(e.pointerId)
  }, true)

  // Click is synthesized after pointerup; swallow exactly one if it arrives.
  // Cleared on the next pointerdown so a stranded flag can't eat a future click.
  window.addEventListener('click', (e) => {
    if (!suppressNextClick) return
    suppressNextClick = false
    e.stopImmediatePropagation()
    e.preventDefault()
  }, true)

  window.addEventListener('pointerdown', () => {
    suppressNextClick = false
  }, true)
}

export function consumePointerGesture(pointerId: number): void {
  install()
  consumedIds.add(pointerId)
}

/** Has this pointer already been claimed by a gesture that acted on the press?
 *  A long-press waiting to summon something of its own asks this before it
 *  fires: the press is already spoken for, and a second surface arriving on top
 *  of the first one's result is never what the hand meant. */
export function isPointerConsumed(pointerId: number): boolean {
  return consumedIds.has(pointerId)
}
