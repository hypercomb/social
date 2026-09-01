// input/escape-cascade.ts
import { EffectBus } from '@hypercomb/core'
import type { BackGesture } from '../navigation/back-gesture.service.js'

// ── reactive state (tracked via effects already emitted by services) ──

let editorActive = false
let clipboardActive = false

EffectBus.on<{ active: boolean }>('editor:mode', ({ active }) => {
  editorActive = active
})

// The clipboard side panel announces its open/close state here so RIGHT-CLICK
// still closes it (the back-gesture entry at the foot of this file). Escape
// does not read it any more: the panel is a docked window like any other, so
// the sweep below takes it with everything else.
EffectBus.on<{ open: boolean }>('clipboard:open', ({ open }) => {
  clipboardActive = open
})

// ── ONE PRESS TAKES EVERYTHING, THE NEXT ONE GIVES IT BACK ────────────
//
// Escape means "show me the hexagons again", and it now means it in ONE press.
// It used to be a ladder — a viewer, then a pinned card, then a panel's inner
// level, then the panel — so getting back to the tiles could cost four presses
// while the hive stayed covered the whole way down. What is up is rarely one
// thing: the one-window rule leaves a companion palette beside a panel, a
// pinned card floats over both, the notes reader is its own surface again.
// So the press takes the LOT: every showing surface goes at once.
//
// And it is not a one-way door any more. The press REMEMBERS what it took, and
// if the very next press follows IMMEDIATELY it puts all of it back exactly as
// it was. Press again and it is gone again — a toggle between whatever you are
// doing and the tiles underneath it.
//
//     press          → the tiles
//     press (at once)→ everything back, exactly as it was
//     press          → the tiles again
//
// IMMEDIATELY IS THE WHOLE POINT. A memory that survived a walk around the
// hive would make Escape reopen a panel you had finished with minutes ago, so
// it is dropped after a few seconds AND the moment you do anything else at all
// — a click, any other key. The put-back is for the press you make because the
// last one was a mistake; nothing else.
//
// ONE SLOT, deliberately not a stack: "press it again" means what just went.
//
// The slot is PLACED. What was up belonged to the page you were standing on,
// and a window brought back over a different page would be showing one tile's
// contents under another tile's name.
//
// A put-back reports whether it LANDED. False means everything it held is
// already back — reopened by hand — and the press carries on down the cascade
// instead of being swallowed by a memory of something no longer missing.

/** How long "immediately after" lasts. Long enough for the second press of a
 *  deliberate double-tap and for "wait, no — bring that back", short enough
 *  that a press which is about something else can never find it. */
const REMEMBERED_FOR_MS = 3000

type PutBack = { page: string; at: number; put(): boolean }

let memory: PutBack | null = null

/** The page a memory belongs to. Empty when there is no lineage to ask, which
 *  makes every memory agree: with nowhere to have travelled to, nothing here
 *  can be stale. */
const currentPage = (): string => {
  const lineage = window.ioc?.get<{ explorerSegments?(): readonly string[] }>('@hypercomb.social/Lineage')
  return (lineage?.explorerSegments?.() ?? []).join('/')
}

/** Record how to undo the take-away this press just did. */
const remember = (put: () => boolean): void => {
  memory = { page: currentPage(), at: Date.now(), put }
}

/** Put back what the last press took away. True = the press was consumed.
 *  The slot is spent either way — a memory that did not land is a memory of
 *  something no longer missing, and keeping it would make the NEXT press mean
 *  something stale. */
const putBackLast = (): boolean => {
  const held = memory
  memory = null
  if (!held) return false
  if (Date.now() - held.at > REMEMBERED_FOR_MS) return false
  if (held.page !== currentPage()) return false
  return held.put()
}

// Anything else at all ends "immediately after". Capture phase so it is seen
// however the press is routed, and Escape itself is exempt — that press IS the
// put-back, and the keymap turns it into `keymap:invoke` from this same event.
const forget = (): void => { memory = null }
window.addEventListener('pointerdown', forget, true)
window.addEventListener('keydown', (e: KeyboardEvent) => { if (e.key !== 'Escape') forget() }, true)

// ── cascade handler ───────────────────────────────────────────────────

EffectBus.on<{ cmd: string }>('keymap:invoke', ({ cmd }) => {
  if (cmd !== 'global.escape') return

  // Priority 0: command line owns Escape when focused (select mode collapse, etc.)
  const focused = document.activeElement
  if (focused instanceof HTMLInputElement && focused.classList.contains('command-input')) return

  // Priority 1: close editor
  //
  // NOTHING IS REMEMBERED HERE. Cancelling an edit throws the draft away, so a
  // put-back could only reopen the editor on the text that was there BEFORE —
  // and an editor that comes back looking almost right is a worse answer than
  // one that does not come back at all. Escape's memory is about what was
  // COVERING the hive, not about what you had typed into it.
  if (editorActive) {
    const drone = window.ioc.get<{ cancelEditing(): void }>('@diamondcoreprocessor.com/TileEditorDrone')
    drone?.cancelEditing()
    return
  }

  const windows = window.ioc.get<{
    dismissFocused(): boolean
    putAwayAll?(): (() => boolean) | null
    closeFocused(): boolean
  }>('@hypercomb.social/ToolWindows')

  // Priority 2: unwind ONE level of the window the focus is INSIDE — its open
  // settings popover, else whatever it considers its own innermost state (a
  // naming field, an armed mode, a drill-down).
  //
  // FOCUS ONLY, and that is the whole of this rung: a press inside a field
  // belongs to that field and to nothing else. A press anywhere else is not
  // about one window at all — it falls to the sweep, which takes the lot,
  // which is why this rung no longer needs a fallback to "the newest window"
  // for panels opened by a command (they leave the focus on <body>).
  //
  // NOTHING IS REMEMBERED HERE either. This unwinds one level inside a window
  // that is still on screen, and the window itself — what the memory is for —
  // has not gone anywhere. Nor is anything lost by skipping it: the sweep
  // PARKS, so a half-typed field comes back with everything else.
  if (windows?.dismissFocused()) return

  // Priority 3: THE SWEEP — every showing surface goes, in one press. Panels,
  // the companion palette, the notes reader, pinned cards, the clipboard
  // window: all of it is parked, so all of it can come back.
  //
  // `closeFocused` is what an older shell around this bundle offers instead —
  // essentials is loaded at runtime from a signed bundle and can be newer than
  // the shell it lands in. There the press stays one-way, which is what that
  // shell has always done.
  if (windows?.putAwayAll) {
    const put = windows.putAwayAll()
    if (put) { remember(put); return }
  } else if (windows?.closeFocused()) return

  // Priority 4: PUT BACK what the last press took away. Nothing above answered,
  // so the tiles are already showing — and pressed straight after the press
  // that cleared them, that is what this key means.
  //
  // ABOVE the selection clear on purpose: with a selection standing and a
  // memory a moment old, the second press of a double-tap is about the double
  // tap. The clear is one press away either way — the slot is spent here.
  if (putBackLast()) return

  // Priority 5: clear selection (both service state and pixi overlays)
  const selection = window.ioc.get<{
    count: number
    selected: ReadonlySet<string>
    add(label: string): void
    clear(): void
  }>('@diamondcoreprocessor.com/SelectionService')
  const pixi = window.ioc.get<{ selectedAxialKeys: ReadonlySet<string>; clearSelection(): void }>('@diamondcoreprocessor.com/TileSelectionDrone')

  if ((selection && selection.count > 0) || (pixi && pixi.selectedAxialKeys.size > 0)) {
    // Held BEFORE the clear, by name — a selection is a thing you built up one
    // tile at a time, and losing it to a stray press was the most expensive
    // thing this key could do. The pixi overlay redraws itself off
    // `selection:changed`, so putting the names back puts the highlights back.
    //
    // BELOW the sweep, which is why a press never costs you both: whatever was
    // covering the hive goes first, and the selection is still there when you
    // get back to it.
    const had = [...(selection?.selected ?? [])]
    selection?.clear()
    pixi?.clearSelection()
    remember(() => {
      if (!had.length) return false
      const svc = window.ioc.get<{ count: number; add(label: string): void }>('@diamondcoreprocessor.com/SelectionService')
      if (!svc) return false
      for (const label of had) svc.add(label)
      return svc.count > 0
    })
    return
  }

  // Priority 6: force-clear the InputGate as last-resort recovery. Any
  // leaked claim (touch momentum aborted mid-coast, drag canceled outside
  // a release path) or unmatched lock would otherwise permanently block
  // wheel zoom with no user-visible recovery. Escape clears the slate.
  const gate = window.ioc.get<{ active: boolean; clear?(): void }>('@diamondcoreprocessor.com/InputGate')
  if (gate?.active) {
    gate.clear?.()
    return
  }

  // Priority 7: generic fallback for future consumers
  EffectBus.emit('global:escape', undefined)
})

// ── right-click exits clipboard mode ──────────────────────────────────
// Same parity as the X button: right-click anywhere closes the clipboard view.
//
// Registered as an entry in the ONE thing that decides what the right button
// means (navigation/back-gesture.service.ts) instead of a listener of its own.
// Two window listeners for the same gesture is how you get a right-click that
// both closes the clipboard AND navigates the hive out from under it; the
// registry orders them instead. Clipboard mode covers the page without being a
// view, which is exactly what `active` is for.

const whenReady = (window as unknown as {
  ioc?: { whenReady?<T>(key: string, callback: (value: T) => void): void }
}).ioc?.whenReady

whenReady?.<BackGesture>('@diamondcoreprocessor.com/BackGesture', gesture => {
  gesture.register({
    owner: 'clipboard-mode',
    active: () => clipboardActive,
    back: () => EffectBus.emit('clipboard:close', undefined),
  })
})
