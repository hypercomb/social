// editor/editor-size.ts
//
// HOW BIG THE TILE UNDER THE PARTICIPANT'S HANDS IS DRAWN. One number, the
// scale the desk's own arithmetic (`diagram/layout.ts`) multiplies the stage
// by: 1 is the size the desk has always drawn, below 1 is smaller, above 1 is
// larger as far as the desk has room for it (the labels, the toolbar and the
// floating tools row always stay on screen).
//
// It is the participant's own and never replicated, so it is one participant
// DOCUMENT (pool `editor:size`) — read synchronously by the view, written
// through to the pool, never to localStorage.

import { ParticipantDocument } from '../preferences/participant-document.js'

export const EDITOR_SIZE_MEANING = 'editor:size'

export const SCALE_MIN = 0.5
export const SCALE_MAX = 1.5
export const SCALE_DEFAULT = 1
/** The slider moves in whole percent. */
export const SCALE_STEP = 0.05

export type EditorSizeRecord = { readonly scale: number }

/** A scale the desk can use: finite, and inside the slider's range. */
export const clampScale = (value: unknown): number => {
  const n = typeof value === 'number' ? value : Number.NaN
  if (!Number.isFinite(n)) return SCALE_DEFAULT
  return Math.min(SCALE_MAX, Math.max(SCALE_MIN, Math.round(n / SCALE_STEP) * SCALE_STEP))
}

/** The record as stored, or null when the bytes are not one. */
export const parseEditorSize = (raw: unknown): EditorSizeRecord | null => {
  if (!raw || typeof raw !== 'object') return null
  const scale = (raw as Record<string, unknown>)['scale']
  return typeof scale === 'number' && Number.isFinite(scale) ? { scale: clampScale(scale) } : null
}

let record: ParticipantDocument<EditorSizeRecord> | null = null

/** The record — made on first use, so nothing is read before an editor opens. */
export const editorSizeRecord = (): ParticipantDocument<EditorSizeRecord> =>
  (record ??= new ParticipantDocument<EditorSizeRecord>({
    meaning: EDITOR_SIZE_MEANING,
    parse: parseEditorSize,
    empty: { scale: SCALE_DEFAULT },
    // A slider drag is working state, not a save: only the current value is kept.
    keep: 'current',
  }))

/** The scale right now. Synchronous. */
export const editorScale = (): number => editorSizeRecord().value.scale

export const setEditorScale = (scale: number): void => {
  const next = clampScale(scale)
  if (next === editorScale()) return
  editorSizeRecord().write({ scale: next })
}
