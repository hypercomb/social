// The living presentation's tile tree (documentation/living-presentation.md).
//
// The presentation welcomes people into Hypercomb. Its first layer is the
// values layer under one tile called hypercomb. The tree is planted ONE LAYER
// AT A TIME: plant.cjs takes a route and creates only that tile's children, so
// each layer is looked at before the next goes in. Every piece stands alone,
// so the arrangement can be rebuilt later without breaking anything.
//
// `note` is the working note filed on a tile when it is planted. Where a tile
// needs its meaning stated for good, that belongs in its meta layer.

module.exports = {
  name: 'hypercomb',
  note: 'Welcome to Hypercomb. This tile opens the living presentation: a visual, interactive welcome into this world. Read flat, the values below are its first view. Plan: documentation/living-presentation.md',
  children: [
    {
      name: 'simple',
      note: 'Everything is a tile, and every tile is a word you can say. One idea, used everywhere.',
    },
    {
      name: 'organized',
      note: 'Everything has its place by its name, and every version is kept by its signature. Nothing is ever lost.',
    },
    {
      name: 'collaborative',
      note: 'Share what you make from your own domain. Take what others make, whole or one piece at a time.',
    },
    {
      name: 'intelligent',
      note: 'People and AI use the same words under the same rules, and every change waits for a person to accept it.',
    },
    {
      name: 'accessible',
      note: 'Plain words, free and open source, and your work lives on your own device.',
    },
    {
      name: 'localized',
      note: 'The hive speaks your language: the community translates it, and anyone can add their own.',
    },
  ],
}
