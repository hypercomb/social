// diamondcoreprocessor.com/groups/launch-groups.ts (moved down from hypercomb-shared in the everything-is-a-beehavior Phase 1)
//
// Side-effect barrel: registers the built-in launch groups with the
// GroupRegistry. Importing this module IS the registration.
//
// The registry is what makes /websites, /games and /help resolvable —
// the `/sets` landing lists them, MixedGroupBag renders their
// pages, and EntrancePinDrone matches a pressed tile against their members to
// decide whether a ⋮ feature icon can be dragged up as a pinned entrance.
// None of that depends on any group being SHOWN in the header, which is why
// the registrations live here and not in a component: the top chrome surfaces
// an entrance only when the participant explicitly drags one up from a tile.

import './websites-group.js'   // registers the websites group
import './games-group.js'      // registers the games group
import './help-group.js'       // registers the help group
