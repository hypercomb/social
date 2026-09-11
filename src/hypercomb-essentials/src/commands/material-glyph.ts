// commands/material-glyph.ts — does the shipped icon font draw this name?
//
// The icon font ships SUBSET (scripts/icon-names.cjs + icon-names.extra.txt),
// so it carries only the names the source and the icon picker use. A glyph a
// record names in its DATA — a website's decoration `icon` — can be anything,
// and a name the subset lacks does not go quietly missing: the font spells it
// out as a word in the middle of the UI (`LOCAL_FIRE_DEPARTMENT` where a site's
// exit button should be).
//
// A Material ligature is one square glyph, exactly one em wide; a name the font
// cannot ligate is several letters wide. That is the check
// scripts/check-icon-render.cjs runs over the shipped bytes, made here at the
// point a data-named glyph is about to be shown.

const FONT_PX = 100
const FONT = `${FONT_PX}px "Material Symbols Outlined"`
const verdicts = new Map<string, boolean>()
let context: CanvasRenderingContext2D | null | undefined

/** True when the icon font draws `name` as one glyph, false when it would spell
 *  the name out, undefined when it can't tell yet (the font has not loaded, or
 *  there is no canvas) — a caller keeps the name then, no worse than before. */
export function drawsAsGlyph(name: string): boolean | undefined {
  if (!/^[a-z0-9_]+$/.test(name)) return false
  const known = verdicts.get(name)
  if (known !== undefined) return known
  try {
    if (!document.fonts?.check(FONT, name)) return undefined
    context ??= document.createElement('canvas').getContext('2d')
    if (!context) return undefined
    context.font = FONT
    const verdict = Math.abs(context.measureText(name).width - FONT_PX) < 2
    verdicts.set(name, verdict)
    return verdict
  } catch {
    return undefined
  }
}
