// diamondcoreprocessor.com/presentation/screensaver/motions.ts
//
// The list of built-in screensaver MOTIONS. Importing this module registers
// them all (each motion file self-registers on import), mirroring styles.ts.
// The drone imports this for its side effect so the motions are bundled +
// registered; the queen lists whatever the registry holds.
//
// To add a motion: create `<name>.motion.ts` (call registerMotion) and add one
// import line here. Nothing else changes.

import './bounce.motion.js'
import './shooting-stars.motion.js'

/** Fallback when no preference is stored / a stored name no longer exists. */
export const DEFAULT_MOTION = 'bounce'
