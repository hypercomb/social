// recipe/recipe-slot.ts
//
// WHERE A RECIPE LIVES ON A TILE. The tile's layer holds a `recipe` slot: an
// array of signatures whose newest entry is the current recipe document
// (recipe-template.ts). Every save is a new layer, so a recipe has history and
// undo like everything else on a tile (H2), and the tile stays complete alone
// (L1). The decoration is what lights the view's icon on the tile.
//
// Pure: names only. The view's drone declares the slot; the queen registers the view.

/** The layer slot holding the recipe document's signature, newest last. */
export const RECIPE_SLOT = 'recipe'
/** What the layer-slot registry is told. No triggers: a recipe changes only when its cook saves it. */
export const RECIPE_SLOT_DECLARATION = Object.freeze({ slot: RECIPE_SLOT, triggers: [] as string[] })
/** The view-mode token, and the view's name in the visual-bee registry. */
export const RECIPE_VIEW = 'recipe'
/** The decoration a tile with a recipe wears: `visual:<view>:<noun>`. */
export const RECIPE_KIND = 'visual:recipe:card'
/**
 * The effect that opens the view on a tile. `{ view, segments, at }`. Sent with
 * emit, not as a transient: the view's drone sleeps until this effect names it,
 * and it hears the press only through the bus's replay when it wakes. The `at`
 * stamp is what keeps an old replay from opening anything.
 */
export const RECIPE_OPEN_FOR_TILE = 'view:open-for-tile'
