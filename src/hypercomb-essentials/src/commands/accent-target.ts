// commands/accent-target.ts
//
// THE ACCENT PRESETS AND `<cell> = <preset>`, the named form of /accent. The
// word and the slash drone's machine gate read them through one reader, and a
// bee is never imported for a value (atomic-modules-plan.md), so they live
// here.

// Accent preset names → neon color index (maps to NEON_PRESETS in hex-overlay.shader)
export const ACCENT_NAMES: Record<string, number> = {
  glacier: 0,
  bloom: 1,
  aurora: 2,
  ember: 3,
  nebula: 4,
}

/** `<cell> = <preset>` — the named form, or undefined when the line uses none.
 *  One reader for the parser and for the machine gate, so the two can never
 *  disagree about what a line means. */
export const readAccentTarget = (
  args: string,
): { cell: string; preset: string } | { refuse: string } | undefined => {
  const equals = args.indexOf('=')
  if (equals === -1) return undefined
  const cell = args.slice(0, equals).trim()
  const preset = args.slice(equals + 1).trim()
  if (!cell || cell.includes('/') || cell.includes(String.fromCharCode(92))) {
    return { refuse: 'the named form is /accent <cell> = <preset>, one tile on this page' }
  }
  if (!(preset in ACCENT_NAMES)) {
    return { refuse: `"${preset || '(nothing)'}" is not a known accent preset` }
  }
  return { cell, preset }
}
