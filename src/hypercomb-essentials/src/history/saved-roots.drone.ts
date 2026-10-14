// history/saved-roots.drone.ts
//
// Wires the saved-roots record (saved-roots.ts) into IoC at boot, so every
// naming gesture — the shell's command line included, which reaches essentials
// only through IoC — can ask "is this a saved root?" before `save as` or `use`
// has ever been typed (both queens load on first use). The bee wires; the
// dependency exports.

import { SAVED_ROOTS_KEY, sharedSavedRoots } from './saved-roots.js'

window.ioc.register(SAVED_ROOTS_KEY, sharedSavedRoots)
