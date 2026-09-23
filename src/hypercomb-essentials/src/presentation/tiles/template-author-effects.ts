// presentation/tiles/template-author-effects.ts
//
// The template designer's and the targets window's effect names — shared by
// the template-author bee and the targets view, so a dependency atom
// (atomic-modules-plan.md).

/** Published when the designer is open, and again after every intent lands.
 *  Sticky on the bus, so a panel opening mid-session hydrates at once. */
export const TEMPLATE_STATE = 'template:state'
/** The selected level, with a live preview of it under every value of every
 *  flex axis. The flex editor renders this and nothing else. */
export const TEMPLATE_SELECTED = 'template:selected'
/** The panel says whether it is showing; nothing is computed while it is not. */
export const TEMPLATE_VIEW_STATE = 'template:view-state'

/** THE OTHER QUESTION ABOUT AN ARRANGEMENT.
 *
 *  The designer asks what shape this container is. The targets window asks
 *  what BELONGS in it — every hole, what it is named, what that name addresses,
 *  and who is answering. Published on its own channel because it is a separate
 *  window with a separate cost: the seating read walks the hive, and nothing
 *  should pay for it to draw a palette chip. */
export const TARGETS_STATE = 'targets:state'
/** The targets window says whether it is showing. Same contract as the
 *  designer's: nothing is computed while it is not. */
export const TARGETS_VIEW_STATE = 'targets:view-state'
/** Ask the targets window to show itself, or to put itself away — `{ open, at }`.
 *  An INTENT, never a toggle, for the reason TEMPLATE_OPEN states. */
export const TARGETS_OPEN = 'targets:open'
