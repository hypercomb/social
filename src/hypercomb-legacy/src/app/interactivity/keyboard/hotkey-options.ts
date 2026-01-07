// hotkey-options

export type HotkeyHandler = (ev: KeyboardEvent) => void
export interface HotkeyOptions {
  keys: string[]                 // e.g., ['ctrl','r'] or ['r']
  onDown?: HotkeyHandler         // optional: fire on keydown
  onUp?: HotkeyHandler           // optional: fire on keyup
  when?: () => boolean           // optional guard: must return true to allow
  preventDefault?: boolean       // default true
  stopPropagation?: boolean      // default true
}


