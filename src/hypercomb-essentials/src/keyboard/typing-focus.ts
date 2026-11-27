// keyboard/typing-focus.ts
//
// IS THE PARTICIPANT TYPING? — the one question every shortcut asks first.
// A key pressed while a text field has focus belongs to that field, never to
// a shortcut (jwize, 2026-11-26: "critical everywhere on all inputs that they
// don't activate the shortcuts while having focus").
//
// The question must see THROUGH SHADOW ROOTS. A field inside a custom
// element's shadow root (the shelf's search, every framework-free view) is
// invisible from outside: `document.activeElement` is the host element and a
// keyboard event's `target` is retargeted to it, so `closest('input')` on
// either says "not typing" and the shortcut fires into the middle of a word.
// The composed path's first node, and the active element followed down
// through each shadow root, are the field itself.
//
// The shell keeps a twin of this (hypercomb-shared/core/typing-focus.ts): a
// module cannot be imported by the shell, and a core export would hold every
// essentials publish until each shell carried the new core.

/** What counts as a place the participant types. */
export const TYPING_SELECTOR =
  'input:not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]):not([type=reset]):not([type=range]):not([type=color]):not([type=file]):not([type=image]), textarea, select, [contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"], [role="textbox"], [role="searchbox"], [role="combobox"]'

const isTypingElement = (node: unknown): boolean => {
  if (!node || typeof (node as Element).closest !== 'function') return false
  const el = node as HTMLElement
  if (el.isContentEditable) return true
  return !!el.closest(TYPING_SELECTOR)
}

/** The element that really has focus, followed down through shadow roots. */
export const deepActiveElement = (root: Document | ShadowRoot = document): Element | null => {
  let el: Element | null = root.activeElement
  while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement
  return el
}

/** True while focus is in a text field anywhere on the page, shadow roots
 *  included. With an event, its real origin (the composed path's first node)
 *  is asked too, so a field that has the key but not yet the focus counts. */
export const isTyping = (event?: Event): boolean => {
  if (typeof document === 'undefined') return false
  const origin = event?.composedPath?.()[0]
  if (origin && isTypingElement(origin)) return true
  return isTypingElement(deepActiveElement())
}
