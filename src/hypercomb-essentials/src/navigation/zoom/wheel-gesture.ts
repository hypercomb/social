// navigation/zoom/wheel-gesture.ts
//
// WHO OWNS THE WHEEL IS DECIDED ONCE PER GESTURE.
//
// A wheel gesture is a burst of events — a notch spin, a trackpad flick with
// its inertia tail — arriving a few milliseconds apart. Deciding on every one
// of them whether the pointer is over UI that scrolls meant walking the
// composed path and calling getComputedStyle on each ancestor forty times a
// second while the hive zoomed. The decision belongs to the FIRST event of the
// burst; the rest inherit it, as long as the pointer is still where it was.
//
// Two things end the inheritance: a pause longer than a gesture's gaps (a new
// gesture), and the pointer leaving the owner. A scroll region keeps a gesture
// even as its content moves under the pointer — the event target changes, the
// owner does not — so a changed target asks only "is the old owner still on
// the path?" (a walk, no styles) before it asks the full question again.

/** Longer than this between two events, and the next one begins a gesture.
 *  Mouse notches arrive 50–100 ms apart; a trackpad's inertia tail thins out
 *  towards ~100 ms before it stops. */
export const WHEEL_GESTURE_GAP_MS = 150

export class WheelGestureOwner {
  #lastAt = Number.NEGATIVE_INFINITY
  #target: EventTarget | null = null
  /** The UI element that owns the gesture; null when the canvas does;
   *  undefined before the first decision. */
  #owner: Element | null | undefined

  /** The owner of the gesture this event belongs to. `decide` — the full
   *  question, path walk and styles — runs for the first event of a gesture
   *  and whenever the pointer has left the last owner; every other event
   *  reuses the answer. */
  owner(event: WheelEvent, decide: (event: WheelEvent) => Element | null, now = event.timeStamp): Element | null {
    const continues = now - this.#lastAt < WHEEL_GESTURE_GAP_MS
    this.#lastAt = now
    if (continues && this.#owner !== undefined) {
      if (event.target === this.#target) return this.#owner
      if (this.#owner && event.composedPath().includes(this.#owner)) {
        this.#target = event.target
        return this.#owner
      }
    }
    this.#target = event.target
    this.#owner = decide(event)
    return this.#owner
  }
}
