// quickmenu/quick-menu.backgrounds.ts
//
// The quick menu's ten crafted backgrounds, in order: honey-01 .. honey-10.
// Each file in backgrounds/ is one variation (quick-menu.honey-art.ts states the
// contract it keeps); this list is the only place that names them all, and its
// order is their number: HONEY_BACKGROUNDS[i] is variation i, which is what
// backgroundFor hands out and what the atlas column holds.
//
// Not backgrounds/index.ts: every index.ts under src/ is a barrel the prepare
// script regenerates (and git ignores), so a hand-written one would be wiped.

import { HONEY_BACKGROUND_01 } from './backgrounds/honey-01-capped-comb.js'
import { HONEY_BACKGROUND_02 } from './backgrounds/honey-02-dipper-ribbon.js'
import { HONEY_BACKGROUND_03 } from './backgrounds/honey-03-pour-curtain.js'
import { HONEY_BACKGROUND_04 } from './backgrounds/honey-04-sugar-geode.js'
import { HONEY_BACKGROUND_05 } from './backgrounds/honey-05-amber-inclusion.js'
import { HONEY_BACKGROUND_06 } from './backgrounds/honey-06-wax-seal.js'
import { HONEY_BACKGROUND_07 } from './backgrounds/honey-07-caustic-plate.js'
import { HONEY_BACKGROUND_08 } from './backgrounds/honey-08-wildflower.js'
import { HONEY_BACKGROUND_09 } from './backgrounds/honey-09-wing-filigree.js'
import { HONEY_BACKGROUND_10 } from './backgrounds/honey-10-buckwheat-marble.js'
import type { HoneyBackground } from './quick-menu.honey-art.js'

export const HONEY_BACKGROUNDS: readonly HoneyBackground[] = [
  HONEY_BACKGROUND_01,
  HONEY_BACKGROUND_02,
  HONEY_BACKGROUND_03,
  HONEY_BACKGROUND_04,
  HONEY_BACKGROUND_05,
  HONEY_BACKGROUND_06,
  HONEY_BACKGROUND_07,
  HONEY_BACKGROUND_08,
  HONEY_BACKGROUND_09,
  HONEY_BACKGROUND_10,
]
