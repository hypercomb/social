// diamondcoreprocessor.com/presentation/screensaver/styles.ts
//
// The list of built-in screensaver visuals. Importing this module registers
// them all (each style file self-registers on import). The drone imports this
// for its side effect, so the styles are guaranteed bundled + registered.
//
// To add a visual: create `<name>.style.ts` (call registerBubbleStyle) and add
// one import line here. Nothing else changes — the queen lists whatever the
// registry holds, and the drone draws with whatever the participant picked.

import './hexagon.style.js'
import './circle.style.js'
import './thought.style.js'

/** Fallback when no preference is stored / a stored name no longer exists. */
export const DEFAULT_BUBBLE_STYLE = 'hexagon'
