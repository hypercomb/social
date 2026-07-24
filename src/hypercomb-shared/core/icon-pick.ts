// hypercomb-shared/core/icon-pick.ts
//
// requestIconPick() — ask the shell's icon chooser for an icon and await the
// answer. This is the plug-in point for ANY window that needs an icon: one
// call, one promise, no event wiring, no guessing whether the user cancelled.
//
//     const icon = await requestIconPick({ id: 'notes:mark', store: false })
//     if (icon) applyIt(icon)          // null ⇒ the user walked away
//
// It is sugar over the ICON_PICK_REQUEST / ICON_PICK_RESULT contract in
// @hypercomb/core — drone modules (which must not import from shared) still
// emit those events directly, and get identical behaviour.
//
// The promise ALWAYS settles: on a pick, on the chooser closing, and when a
// later request supersedes this one.

import { EffectBus, ICON_PICK_REQUEST, ICON_PICK_RESULT, type IconPickRequest, type IconPickResult } from '@hypercomb/core'

/**
 * Open the icon chooser and resolve with the chosen Material symbol name, or
 * null if the user cancelled.
 *
 * @param req.id     correlation token; in write-through mode, the element id
 *                   whose override gets written
 * @param req.store  false to borrow the chooser without writing an override —
 *                   the caller owns the returned name
 * @param req.filter pre-seed the search box
 * @param req.title  chooser heading (already localized)
 */
export function requestIconPick(req: IconPickRequest): Promise<string | null> {
  if (!req?.id) return Promise.resolve(null)
  // Per-call token: two requests can share an id (one palette's "add an icon"
  // button pressed twice), and the supersede path settles the first while the
  // second's handler is already listening. Matching on id alone would resolve
  // both from one result.
  const token = `${req.id}#${++seq}`
  return new Promise<string | null>((resolve) => {
    // Subscribe BEFORE emitting — the chooser settles a superseded request
    // synchronously inside the emit below.
    const off = EffectBus.on<IconPickResult>(ICON_PICK_RESULT, (result) => {
      if (result?.token !== token) return
      off()
      resolve(result?.name ?? null)
    })
    EffectBus.emit(ICON_PICK_REQUEST, { ...req, token })
  })
}

let seq = 0
