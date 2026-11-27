// sharing/room-qr.view.ts
//
// THE ROOM, AS A CODE TO POINT A PHONE AT (jwize 2026-11-24: "when in real life
// we need a QR code to join the swarm"). The leader puts it on the screen
// everyone can see; a phone's camera reads it and opens the room's link, which
// asks once before joining. The code is the link and nothing more (T7: nothing
// here is fetched), so it carries exactly what `/invite` would have copied.
//
// It is drawn large on purpose: a code read from the back of a room has to be
// most of the screen. It stays until it is closed, because a room's link does
// not run out the way a device invite does (invite-qr.view.ts is that one).
//
// IT IS A MODAL DIALOG. While it is up the keyboard is its own: Escape closes
// it and nothing else, Enter presses its focused button and nothing else, Tab
// goes round its buttons, and no key reaches the hive or the room selector it
// may have been opened over. Closing gives the focus back to what opened it.
//
// THE ROOM'S NAME IS NEVER MARKUP. It can arrive verbatim from a meeting link
// somebody else wrote, so it is only ever set as text or as an attribute value
// on an element that already exists. The drawing is asked for with the link
// alone.
//
// Pure DOM and no state beyond the one open window. It registers nothing.

import { EffectBus } from '@hypercomb/core'
import { qrSvg } from './qr-code.js'

const STYLE_ID = 'hc-room-qr-styles'
/** The name the hive's keymap is held under while the code is up. */
const KEYMAP_REASON = 'room-qr'

export interface RoomQrWords {
  /** The heading: which room this joins. */
  readonly title: string
  /** One line under the code: what opening it does. */
  readonly note: string
  readonly copy: string
  readonly copied: string
  readonly close: string
}

let open: HTMLElement | null = null
let offKey: (() => void) | null = null
/** What held the focus when the code opened: where it goes back to. */
let opener: HTMLElement | null = null

export function closeRoomQr(): void {
  if (!open) return
  offKey?.()
  offKey = null
  open.remove()
  open = null
  EffectBus.emitTransient('keymap:release', { reason: KEYMAP_REASON })
  const back = opener
  opener = null
  if (back?.isConnected) back.focus()
}

/**
 * Show `link` as a code until it is closed. False when it cannot be drawn: a
 * link too long for a code, or no page to draw on. `onCopy` is the same copy
 * `/invite` makes, for whoever is at the keyboard and not holding a phone.
 */
export function showRoomQr(link: string, words: RoomQrWords, onCopy?: () => Promise<unknown> | void): boolean {
  // The link and nothing else: a label handed to the drawing becomes markup.
  const svg = typeof document === 'undefined' ? null : qrSvg(link)
  if (!svg) return false
  closeRoomQr()
  const focused = document.activeElement
  const returnTo = focused instanceof HTMLElement && focused !== document.body ? focused : null
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement('style')
    style.id = STYLE_ID
    style.textContent = `
.hc-room-qr{position:fixed;inset:0;z-index:100001;display:grid;place-items:center;padding:1rem;background:rgba(4,7,11,.82);
  font-family:var(--hc-font,system-ui,sans-serif);color:#eef4fa;outline:none}
.hc-room-qr-card{width:min(34rem,100%);max-height:100%;overflow:auto;padding:1.25rem;display:grid;gap:.9rem;justify-items:center;
  background:rgba(7,10,15,.98);border:1px solid rgba(111,211,154,.5);border-radius:var(--hc-radius-floating,4px);
  box-shadow:0 1.5rem 5rem rgba(0,0,0,.6)}
.hc-room-qr-title{margin:0;font-size:1.5rem;font-weight:600;text-align:center;overflow-wrap:anywhere}
.hc-room-qr-code{width:min(100%,70vh);line-height:0}
.hc-room-qr-code svg{width:100%;height:auto;border-radius:2px}
.hc-room-qr-note{margin:0;color:#b8c7d1;text-align:center;font-size:1rem;line-height:1.4;overflow-wrap:anywhere}
.hc-room-qr-actions{display:flex;gap:.6rem;flex-wrap:wrap;justify-content:center}
.hc-room-qr-actions button{min-height:2.75rem;padding:.4rem 1.1rem;border-radius:var(--hc-radius-control,2px);
  border:1px solid rgba(255,255,255,.2);background:rgba(255,255,255,.06);color:inherit;font:inherit;cursor:pointer}
.hc-room-qr-actions button:hover,.hc-room-qr-actions button:focus-visible{background:rgba(111,211,154,.18);border-color:rgba(111,211,154,.7);outline:none}`
    document.head.appendChild(style)
  }

  const box = document.createElement('div')
  box.className = 'hc-room-qr'
  box.setAttribute('role', 'dialog')
  box.setAttribute('aria-modal', 'true')
  box.setAttribute('aria-label', words.title)
  box.setAttribute('data-consumes-wheel', '')
  // It can hold the focus itself, so a press on the card's words leaves the
  // focus in the dialog and not on the page behind it.
  box.tabIndex = -1
  // A press outside the card closes it, the way the room selector's backdrop does.
  box.addEventListener('click', event => { if (event.target === box) closeRoomQr() })

  const card = document.createElement('div')
  card.className = 'hc-room-qr-card'
  const title = document.createElement('h2')
  title.className = 'hc-room-qr-title'
  title.textContent = words.title
  const art = document.createElement('div')
  art.className = 'hc-room-qr-code'
  // The one markup set here is the drawing made from the link's bytes: two
  // shapes of digits and path commands, under a label that is not ours to
  // choose. The room's name goes on the drawn element afterwards, as a value.
  art.innerHTML = svg
  art.querySelector('svg')?.setAttribute('aria-label', words.title)
  const note = document.createElement('p')
  note.className = 'hc-room-qr-note'
  note.textContent = words.note

  const actions = document.createElement('div')
  actions.className = 'hc-room-qr-actions'
  if (onCopy) {
    const copy = document.createElement('button')
    copy.type = 'button'
    copy.textContent = words.copy
    copy.addEventListener('click', () => {
      void Promise.resolve(onCopy()).then(() => { copy.textContent = words.copied }, () => undefined)
    })
    actions.appendChild(copy)
  }
  const close = document.createElement('button')
  close.type = 'button'
  close.textContent = words.close
  close.addEventListener('click', closeRoomQr)
  actions.appendChild(close)

  card.append(title, art, note, actions)
  box.appendChild(card)
  document.body.appendChild(box)
  open = box
  opener = returnTo

  // THE KEYBOARD IS THE DIALOG'S WHILE IT IS UP. The hive's keymap has listened
  // on the window since boot, so it hears a press before this does and would
  // turn Escape into the escape cascade and the room selector's dismiss: it is
  // held, and released on every close. Every key then stops here, so nothing
  // added later or further down (the selector's own Enter is START) hears one.
  // Stopping a key does not cancel what it does to the focused control: Enter
  // and Space still press this dialog's buttons.
  EffectBus.emitTransient('keymap:hold', { reason: KEYMAP_REASON })
  const onKey = (event: KeyboardEvent): void => {
    event.stopImmediatePropagation()
    if (event.key === 'Escape') {
      event.preventDefault()
      closeRoomQr()
      return
    }
    const at = document.activeElement
    // Focus that has left the dialog comes back, and that press does nothing
    // to whatever it was sitting on.
    if (!box.contains(at)) {
      event.preventDefault()
      close.focus()
      return
    }
    if (event.key !== 'Tab') return
    // Tab goes round the dialog's own buttons and never out to the page.
    const stops = [...actions.querySelectorAll('button')]
    const last = stops[stops.length - 1]!
    if (at !== box && at !== (event.shiftKey ? stops[0] : last)) return
    event.preventDefault()
    ;(event.shiftKey ? last : stops[0]!).focus()
  }
  window.addEventListener('keydown', onKey, true)
  offKey = () => window.removeEventListener('keydown', onKey, true)
  close.focus()
  return true
}
