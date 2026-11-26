// core/typing-focus.ts — the shell's twin of the module's
// keyboard/typing-focus.ts (the shell cannot import a module, and a core
// export would hold every essentials publish until each shell carried it).
// Keep the two in step: a key pressed while a text field has focus belongs to
// that field, never to a shortcut, and the question must see THROUGH SHADOW
// ROOTS — from outside one, the active element and an event's target are the
// host, not the field inside it.

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
 *  included; with an event, its real origin is asked too. */
export const isTyping = (event?: Event): boolean => {
  if (typeof document === 'undefined') return false
  const origin = event?.composedPath?.()[0]
  if (origin && isTypingElement(origin)) return true
  return isTypingElement(deepActiveElement())
}
