// hypercomb-shared/core/launch-groups.ts
//
// Side-effect barrel: registers the built-in launch groups with the
// GroupRegistry. Importing this module IS the registration.
//
// The registry is what makes /websites, /games, /help and the dashboard
// resolvable — the `/sets` landing lists them, MixedGroupBag renders their
// pages, and EntrancePinDrone matches a pressed tile against their members to
// decide whether a ⋮ feature icon can be dragged up as a pinned entrance.
// None of that depends on any group being SHOWN in the header, which is why
// the registrations live here and not in a component: the top chrome surfaces
// an entrance only when the participant explicitly drags one up from a tile.

import './websites-group'   // registers the websites group
import './dashboard-group'  // registers the dashboard group
import './games-group'      // registers the games group
import './help-group'       // registers the help group
