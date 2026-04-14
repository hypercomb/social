// pointer-gesture-consumer.ts — swallow trailing events for a consumed pointer id.
//
// Use case: a button (mobile back, etc.) acts on `pointerdown` and triggers a
// view change. The same finger is still pressed; the trailing pointermove /
// pointerup / synthesized click would otherwise land on whatever is now under
// the cursor and activate it. Once a gesture is "consumed" we suppress every
// subsequent event for that pointerId at window capture-phase, before any
// descendant listener sees it. No timeouts — the gesture ends when its real
// pointerup or pointercancel arrives.

const consumedIds = new Set<number>()
let suppressNextClick = false
let installed = false

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
  }, true)

  window.addEventListener('pointercancel', (e) => {
    if (!consumedIds.delete(e.pointerId)) return
    e.stopImmediatePropagation()
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
