// revolucionstyle.com/wheel/flavor-data.ts
export type FlavorCategory = {
  id: string
  label: string
  color: number
  flavors: FlavorNote[]
}

export type FlavorNote = {
  id: string
  label: string
}

export const FLAVOR_CATEGORIES: readonly FlavorCategory[] = [
  {
    id: 'earth', label: 'Earth', color: 0x5C3D2E,
    flavors: [
      { id: 'soil', label: 'Soil' },
      { id: 'leather', label: 'Leather' },
      { id: 'mineral', label: 'Mineral' },
      { id: 'moss', label: 'Moss' },
      { id: 'mushroom', label: 'Mushroom' },
      { id: 'peat', label: 'Peat' },
    ],
  },
  {
    id: 'wood', label: 'Wood', color: 0x8B6914,
    flavors: [
      { id: 'cedar', label: 'Cedar' },
      { id: 'oak', label: 'Oak' },
      { id: 'hickory', label: 'Hickory' },
      { id: 'mesquite', label: 'Mesquite' },
      { id: 'charred-wood', label: 'Charred Wood' },
      { id: 'sandalwood', label: 'Sandalwood' },
    ],
  },
  {
    id: 'spice', label: 'Spice', color: 0xC0392B,
    flavors: [
      { id: 'black-pepper', label: 'Black Pepper' },
      { id: 'white-pepper', label: 'White Pepper' },
      { id: 'red-pepper', label: 'Red Pepper' },
      { id: 'cinnamon', label: 'Cinnamon' },
      { id: 'clove', label: 'Clove' },
      { id: 'nutmeg', label: 'Nutmeg' },
      { id: 'anise', label: 'Anise' },
    ],
  },
  {
    id: 'sweet', label: 'Sweet', color: 0xD4A017,
    flavors: [
      { id: 'caramel', label: 'Caramel' },
      { id: 'honey', label: 'Honey' },
      { id: 'vanilla', label: 'Vanilla' },
      { id: 'molasses', label: 'Molasses' },
      { id: 'maple', label: 'Maple' },
      { id: 'brown-sugar', label: 'Brown Sugar' },
    ],
  },
  {
    id: 'coffee-chocolate', label: 'Coffee & Chocolate', color: 0x4E2E1E,
    flavors: [
      { id: 'espresso', label: 'Espresso' },
      { id: 'black-coffee', label: 'Black Coffee' },
      { id: 'dark-chocolate', label: 'Dark Chocolate' },
      { id: 'cocoa', label: 'Cocoa' },
      { id: 'mocha', label: 'Mocha' },
      { id: 'roasted-bean', label: 'Roasted Bean' },
    ],
  },
  {
    id: 'cream-bread', label: 'Cream & Bread', color: 0xF5DEB3,
    flavors: [
      { id: 'butter', label: 'Butter' },
      { id: 'cream', label: 'Cream' },
      { id: 'toast', label: 'Toast' },
      { id: 'biscuit', label: 'Biscuit' },
      { id: 'brioche', label: 'Brioche' },
      { id: 'malt', label: 'Malt' },
    ],
  },
  {
    id: 'nut', label: 'Nut', color: 0x8B7355,
    flavors: [
      { id: 'almond', label: 'Almond' },
      { id: 'walnut', label: 'Walnut' },
      { id: 'cashew', label: 'Cashew' },
      { id: 'chestnut', label: 'Chestnut' },
      { id: 'hazelnut', label: 'Hazelnut' },
      { id: 'peanut', label: 'Peanut' },
      { id: 'pistachio', label: 'Pistachio' },
    ],
  },
  {
    id: 'fruit', label: 'Fruit', color: 0xE67E22,
    flavors: [
      { id: 'citrus', label: 'Citrus' },
      { id: 'dried-fruit', label: 'Dried Fruit' },
      { id: 'berry', label: 'Berry' },
      { id: 'fig', label: 'Fig' },
      { id: 'stone-fruit', label: 'Stone Fruit' },
      { id: 'raisin', label: 'Raisin' },
      { id: 'prune', label: 'Prune' },
    ],
  },
  {
    id: 'herbal-floral', label: 'Herbal & Floral', color: 0x27AE60,
    flavors: [
      { id: 'grass', label: 'Grass' },
      { id: 'hay', label: 'Hay' },
      { id: 'tea', label: 'Tea' },
      { id: 'lavender', label: 'Lavender' },
      { id: 'jasmine', label: 'Jasmine' },
      { id: 'mint', label: 'Mint' },
    ],
  },
  {
    id: 'smoke-char', label: 'Smoke & Char', color: 0x2C3E50,
    flavors: [
      { id: 'campfire', label: 'Campfire' },
      { id: 'tobacco', label: 'Tobacco' },
      { id: 'ash', label: 'Ash' },
      { id: 'burnt-caramel', label: 'Burnt Caramel' },
      { id: 'charcoal', label: 'Charcoal' },
      { id: 'incense', label: 'Incense' },
    ],
  },
]

export const FLAVOR_INDEX = new Map<string, { category: FlavorCategory; note: FlavorNote }>()
for (const cat of FLAVOR_CATEGORIES) {
  for (const note of cat.flavors) {
    FLAVOR_INDEX.set(note.id, { category: cat, note })
  }
}

export const TOTAL_FLAVORS = FLAVOR_CATEGORIES.reduce((sum, c) => sum + c.flavors.length, 0)
