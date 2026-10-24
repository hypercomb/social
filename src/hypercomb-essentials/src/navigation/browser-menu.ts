// navigation/browser-menu.ts
//
// WHO THE `contextmenu` EVENT BELONGS TO. Two questions every right-click
// handler has to ask before it acts, answered once:
//
// 1. WAS IT A FINGER? A phone fires `contextmenu` when a finger is held still
//    (Chromium, Samsung Internet, Windows touch, Firefox). Every surface that
//    read that event as "the right button" — come back out — navigated, closed
//    a close-up, or dropped the reader into the hexagons under a held thumb.
//    A long-press is not a right-click: it never navigates. The browser keeps
//    its own long-press (select, the link menu, a page's own hold gesture).
//
// 2. DOES THE BROWSER KEEP IT? A right-click on an editable field or on live
//    selected text is the browser's — paste, copy, spellcheck. Never ours.
//
// The event names its source in three dialects: `pointerType` (Chromium sends
// `contextmenu` as a PointerEvent), `sourceCapabilities.firesTouchEvents`
// (Chromium), `mozInputSource` (Firefox, 5 = touch). Where none is present
// the last press decides — a finger still down, or lifted under a second ago.
// That record lives on globalThis so every bundle that carries a copy of this
// module reads the one record.

type Press = { pointerType: string; button: number; at: number; down: boolean }
type PressRecord = { __hcLastPress?: Press; __hcPressWatch?: boolean }

const record = globalThis as unknown as PressRecord

/** A finger lifted this long ago may still be the press the menu came from. */
const RECENT_MS = 1000

const EDITABLE = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])'

/** Remember the last press. Idempotent across bundles — call it as early as
 *  the shell lets you (the back gesture does, in the boot lane). */
export function watchPresses(): void {
  if (record.__hcPressWatch || typeof window === 'undefined') return
  record.__hcPressWatch = true
  window.addEventListener('pointerdown', (e: PointerEvent) => {
    record.__hcLastPress = { pointerType: e.pointerType, button: e.button, at: performance.now(), down: true }
  }, true)
  const lift = (): void => {
    const last = record.__hcLastPress
    if (last) record.__hcLastPress = { ...last, at: performance.now(), down: false }
  }
  window.addEventListener('pointerup', lift, true)
  window.addEventListener('pointercancel', lift, true)
}

/** A pen's barrel button is its right button; any other pen press is a hold. */
const isHold = (pointerType: string, button: number): boolean =>
  pointerType === 'touch' || (pointerType === 'pen' && button !== 2)

/** Did a held finger (or pen tip) send this `contextmenu`? */
export function isLongPressMenu(e: MouseEvent): boolean {
  watchPresses()
  const last = record.__hcLastPress
  const type = (e as Partial<PointerEvent>).pointerType ?? ''
  if (type === 'touch') return true
  if (type === 'pen') return !(last?.pointerType === 'pen' && last.button === 2)
  if (type === 'mouse') return false
  if ((e as { sourceCapabilities?: { firesTouchEvents?: boolean } }).sourceCapabilities?.firesTouchEvents) return true
  if ((e as { mozInputSource?: number }).mozInputSource === 5) return true
  if (!last) return false
  const recent = last.down || performance.now() - last.at < RECENT_MS
  return recent && isHold(last.pointerType, last.button)
}

/** A right-click whose menu the browser keeps: an editable field, or live
 *  selected text under the pointer — a selection that starts in another
 *  element and runs across this one counts. A collapsed caret is not a
 *  selection. */
export function browserKeepsMenu(target: Element | null): boolean {
  if (target?.closest?.(EDITABLE)) return true
  const selection = globalThis.getSelection?.()
  if (!target || !selection || selection.isCollapsed || !selection.toString().trim()) return false
  const anchor = selection.anchorNode
  const node = anchor?.nodeType === Node.TEXT_NODE ? anchor.parentElement : (anchor as Element | null)
  if (node && (node.contains(target) || target.contains(node))) return true
  for (let i = 0; i < selection.rangeCount; i++) {
    if (selection.getRangeAt(i).intersectsNode(target)) return true
  }
  return false
}
