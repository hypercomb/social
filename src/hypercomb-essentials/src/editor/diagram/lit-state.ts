// editor/diagram/lit-state.ts
//
// THE LIGHTING MACHINE. It knows part ids and nothing else: four slots, each a
// part id or null. Hover is soft; focus, an open card and a touch pin are
// strong. Pure and timer-free — the hover grace (so the gap between a tab and
// its leader never flickers) is an INPUT: the shell starts its own 120ms timer
// on `pointer-leave` and feeds `grace-elapsed` when it fires.

export interface LightState { hover: string | null; focus: string | null; open: string | null; pin: string | null }

export const HOVER_GRACE_MS = 120

export type PointerKind = 'mouse' | 'pen' | 'touch'

export type LightEvent =
  /** Touch fires enter on press, so a touch enter never lights anything. */
  | { type: 'pointer-enter'; part: string; pointer?: PointerKind }
  /** Leaving keeps the light; the shell times the grace and then sends grace-elapsed. */
  | { type: 'pointer-leave'; part?: string }
  /** The grace ran out. With `part`, a stale timer for another part does nothing. */
  | { type: 'grace-elapsed'; part?: string }
  | { type: 'focus-in'; part: string }
  | { type: 'focus-out'; part?: string }
  /** A tab was clicked / Enter / Space: toggle its card, closing any other. */
  | { type: 'toggle-open'; part: string }
  | { type: 'open'; part: string | null }
  /** A click outside every callout, the figure and the toolbar. */
  | { type: 'outside-click' }
  /** First touch tap on a part pins it; a second tap on the same part acts (see tapActs). null = empty ground. */
  | { type: 'touch-tap'; part: string | null }
  /** A pan or pinch began: hover is suspended. */
  | { type: 'gesture-start' }
  | { type: 'escape' }
  /** The shell's own say (the name input has focus, a card is closed from outside). */
  | { type: 'set'; patch: Partial<LightState> }

export const idle = (): LightState => ({ hover: null, focus: null, open: null, pin: null })

export function reduce(s: LightState, e: LightEvent): LightState {
  switch (e.type) {
    case 'pointer-enter':
      if (e.pointer === 'touch') return s
      return s.hover === e.part ? s : { ...s, hover: e.part }
    case 'pointer-leave':
      return s
    case 'grace-elapsed':
      if (s.hover === null || (e.part !== undefined && e.part !== s.hover)) return s
      return { ...s, hover: null }
    case 'focus-in':
      return s.focus === e.part ? s : { ...s, focus: e.part }
    case 'focus-out':
      if (s.focus === null || (e.part !== undefined && e.part !== s.focus)) return s
      return { ...s, focus: null }
    case 'toggle-open':
      return { ...s, open: s.open === e.part ? null : e.part }
    case 'open':
      return s.open === e.part ? s : { ...s, open: e.part }
    case 'outside-click':
      return s.open === null ? s : { ...s, open: null }
    case 'touch-tap':
      // a tap on empty ground unpins; the second tap on the pinned part leaves it pinned (it acts)
      return s.pin === e.part ? s : { ...s, pin: e.part }
    case 'gesture-start':
      return s.hover === null ? s : { ...s, hover: null }
    case 'escape': {
      // one rung per press: the open card first, then the pin
      const r = escapeRung(s)
      if (r === 'open') return { ...s, open: null }
      if (r === 'pin') return { ...s, pin: null }
      return s
    }
    case 'set':
      return { ...s, ...e.patch }
  }
}

/** Which rung of the ladder this machine owns an Escape press would take, if any. */
export const escapeRung = (s: LightState): 'open' | 'pin' | null => (s.open !== null ? 'open' : s.pin !== null ? 'pin' : null)

/** True when a touch tap on `part` is the SECOND tap (the part is already pinned): the shell acts. */
export const tapActs = (s: LightState, part: string | null): boolean => part !== null && s.pin === part

/**
 * strong if focus, an open card or a pin is on it (or it is in the alert tone,
 * which always reads strong); else soft if hovered. Strong reads stronger than
 * soft, so a part both hovered and focused is strong.
 */
export function litOf(s: LightState, part: string, tone?: 'alert'): 'soft' | 'strong' | null {
  if (tone === 'alert') return 'strong'
  if (s.focus === part || s.open === part || s.pin === part) return 'strong'
  if (s.hover === part) return 'soft'
  return null
}

/** The part the header and aria care about: open, else focus, else pin. */
export const activeOf = (s: LightState): string | null => s.open ?? s.focus ?? s.pin

/** Every lit part, for the shell's mirror of the machine. */
export function litMap(s: LightState, parts: readonly string[], alert?: string | null): Map<string, 'soft' | 'strong'> {
  const out = new Map<string, 'soft' | 'strong'>()
  for (const id of parts) {
    const l = litOf(s, id, alert === id ? 'alert' : undefined)
    if (l) out.set(id, l)
  }
  return out
}

/**
 * The outside fade lifts (what will be cut off shows through) while the part
 * that owns the picture is lit, or while a pan is in progress. The shell finds
 * that part by its field kind; this module never names one.
 */
export const lifted = (s: LightState, imagePart: string | null, gesturing: boolean): boolean =>
  gesturing || (imagePart !== null && litOf(s, imagePart) !== null)
