// Content: the eight cavern/interior chambers plus the Hollow Grove, built on
// ChamberModel (chamber.ts). Pure data — no DOM, no storage, no randomness.
// Zero enemies, zero combat, ever (M11) — that lives entirely in engine.ts's
// separate labyrinth substrate. See src/documentation for the full doctrine;
// this file is the content role's Phase 2 deliverable (final-spec.md §6).
import type { ChamberDefinition } from './chamber.js'

export interface GroupRecord { readonly id: string; readonly name: string }
export const GROUPS: readonly GroupRecord[] = [
  { id: 'wayfarer-cavern', name: 'Wayfarer Cavern' },
  { id: 'highland-cavern', name: 'Highland Cavern' },
  { id: 'chandlery', name: 'Wenna’s House' },
]

export const CENTER_MEMORY = 'The center is a meeting place, never a payment. Carry it through every doorway; its light belongs to you.'

const ALCOVE_LOCKED = 'A tiny hexagon rests in the carving. Return with the central hexagon to hear this quiet memory.'

// ---------------------------------------------------------------------------
// Wayfarer Cavern · B1 · wet-steps "The Wet Steps"
// ---------------------------------------------------------------------------
export const WET_STEPS: ChamberDefinition = {
  id: 'wet-steps', name: 'The Wet Steps', subtitle: 'A dripping hall under the hill',
  look: 'cavern', torch: 3.6, sconces: true, group: 'wayfarer-cavern',
  map: [
    '##########################',
    '##........###....#########',
    '##..K.....###.K..#...k...#',
    '##........###....#.......#',
    '##........###....#.f.>.f.#',
    '##........####:###.......#',
    '######B#######:###.......#',
    '#........#....o..#.......#',
    '#..t..~..#.t.....#.......#',
    '#.....~..#.......#..t....#',
    '<@....~.:D:.....:R:......#',
    '#.....~..#.......#.......#',
    '#........#.......#.......#',
    '##########################',
  ],
  exits: [
    { id: 'daylight-arch', col: 0, row: 10, style: 'arch', label: 'Daylight', landing: { col: 1, row: 10 }, facing: 'right' },
  ],
  entrances: [
    { id: 'stairs-down', col: 21, row: 4, style: 'stairs-down', empty: 'Fallen rock fills the stair.', landing: { col: 21, row: 5 } },
  ],
  tablets: [
    { id: 'drip-line', col: 3, row: 8, title: 'The Drip-Line', text: 'Water finds every crack given time. Follow the drip long enough and it will show you where the stone has already given way.' },
    { id: 'garden', col: 11, row: 8, title: 'Gate of the Garden', knowledgeId: 'wayfarer-cavern-cycle', text: 'First the rain wakes the seed. Then the sun warms its leaves. Last the bloom greets the traveller. Let the garden grow.', pointsAt: ['cycle'] },
    { id: 'stair-lamps', col: 20, row: 9, title: 'The Stair Lamps', text: 'Twin lamps flank the stair. Light them both and whatever waits above the steps will no longer hide in shadow.', pointsAt: ['stair-lamp-west', 'stair-lamp-east', 'stair-chest'] },
  ],
  gates: [
    {
      id: 'cycle', name: 'Gate of the Garden', col: 17, row: 10, tablet: 'garden',
      question: 'Touch the garden’s gifts in the order the inscription teaches.',
      options: [
        { id: 'bloom', glyph: '✿', label: 'Bloom' },
        { id: 'rain', glyph: '≋', label: 'Rain' },
        { id: 'sun', glyph: '☀', label: 'Sun' },
      ],
      answer: ['rain', 'sun', 'bloom'],
    },
  ],
  chests: [
    { id: 'rusted-key-chest', col: 4, row: 2, name: 'Rusted Chest', subtitle: 'Behind the cracked brick', items: [{ kind: 'key', name: 'Rusted key' }], lore: 'A rusted key, kept dry behind the cracked brick for longer than anyone remembers.' },
    { id: 'map-chest', col: 14, row: 2, name: 'Surveyor’s Chest', subtitle: 'In the nook above the hall', items: [{ kind: 'map', name: 'Map of Wayfarer Cavern' }], lore: 'A surveyor’s careful map, its ink still sharp despite the damp.', grants: [{ id: 'map:wayfarer-cavern', text: 'A hand-inked map of Wayfarer Cavern. Its halls now show on your minimap wherever you carry it.' }] },
    { id: 'stair-chest', col: 21, row: 2, name: 'Stair Niche', subtitle: 'Above the stair', items: [{ kind: 'gem', name: 'Uncut gem' }, { kind: 'coins', name: 'A handful of coins' }], lore: 'A gem and a handful of coins, tucked into the niche the stair lamps revealed.', hiddenUntil: 'stair-lamp-pair' },
  ],
  doors: [
    { id: 'hall-door', col: 9, row: 10, name: 'Iron-bound door', lock: 'small' },
  ],
  shutters: [],
  plates: [],
  blocks: [
    { id: 'nook-block', col: 14, row: 7, look: 'stone' },
  ],
  levers: [],
  lamps: [
    { id: 'stair-lamp-west', col: 19, row: 4, name: 'West stair lamp' },
    { id: 'stair-lamp-east', col: 23, row: 4, name: 'East stair lamp' },
  ],
  lampSets: [
    { id: 'stair-lamp-pair', lamps: ['stair-lamp-west', 'stair-lamp-east'], ordered: false },
  ],
  sigils: [],
  alcoves: [],
  residents: [],
  furniture: [],
  effects: [
    { col: 6, row: 8, kind: 'drip' },
  ],
}

// ---------------------------------------------------------------------------
// Wayfarer Cavern · B2 · cistern "The Cistern"
// ---------------------------------------------------------------------------
export const CISTERN: ChamberDefinition = {
  id: 'cistern', name: 'The Cistern', subtitle: 'Still water and a keeper’s court',
  look: 'cavern', torch: 3.6, sconces: true, group: 'wayfarer-cavern',
  map: [
    '######################',
    '###..L.......K..K.####',
    '###.....:.......:.####',
    '########|#######|#####',
    '#...~~~.:.##....:....#',
    '#...~~~...##....P....#',
    '<@........#t..o...o..#',
    '#.........:::........#',
    '#.........#s.........#',
    '#...:.....##.~~~~~P..#',
    '####D#################',
    '####:#################',
    '#...........#........#',
    '#.....t....:R:.....>.#',
    '#...........#........#',
    '######################',
  ],
  exits: [
    { id: 'stairs-up', col: 0, row: 6, style: 'stairs-up', label: 'Stairs up', landing: { col: 1, row: 6 }, facing: 'right' },
  ],
  entrances: [
    { id: 'stairs-down', col: 19, row: 13, style: 'stairs-down', empty: 'The lower stair is flooded to the roof.', landing: { col: 18, row: 13 } },
  ],
  tablets: [
    { id: 'keeper-door', col: 11, row: 6, title: 'The Keeper’s Door', text: 'Two stones on two plates open the keeper’s shutter. Neither plate answers a stone left standing on the doorway itself.', pointsAt: ['keeper-shutter', 'door-plate', 'water-plate'] },
    { id: 'returning-water', col: 6, row: 13, title: 'Gate of Returning Water', knowledgeId: 'wayfarer-cavern-meaning', text: 'The stream bends home. Its end greets its beginning, without a corner or a break. Which mark remembers its journey?', pointsAt: ['meaning'] },
  ],
  gates: [
    {
      id: 'meaning', name: 'Gate of Returning Water', col: 12, row: 13, tablet: 'returning-water',
      question: 'Choose the mark that carries the inscription’s meaning.',
      options: [
        { id: 'triangle', glyph: '△', label: 'Triangle' },
        { id: 'circle', glyph: '○', label: 'Circle' },
        { id: 'hexagon', glyph: '⬡', label: 'Hexagon' },
      ],
      answer: ['circle'],
    },
  ],
  chests: [
    { id: 'iron-key-chest', col: 13, row: 1, name: 'Keeper’s Strongbox', subtitle: 'In the keeper’s vault', items: [{ kind: 'key', name: 'Iron key' }], lore: 'An iron key, waiting in the keeper’s own strongbox.' },
    { id: 'lodestone-chest', col: 16, row: 1, name: 'Lodestone Case', subtitle: 'In the keeper’s vault', items: [{ kind: 'lodestone', name: 'Lodestone chip' }, { kind: 'coins', name: 'A handful of coins' }], lore: 'A lodestone chip beside a scatter of coins, both left in the keeper’s care.', grants: [{ id: 'lodestone:wayfarer-cavern', text: 'A lodestone tuned to Wayfarer Cavern’s own stone. Its needle steadies whenever you carry it here.' }] },
  ],
  doors: [
    { id: 'south-door', col: 4, row: 10, name: 'Iron-bound door', lock: 'small' },
  ],
  shutters: [
    { id: 'shortcut-shutter', col: 8, row: 3, name: 'Cistern shutter', lever: 'shortcut-lever' },
    { id: 'keeper-shutter', col: 16, row: 3, name: 'Keeper’s shutter', plates: ['door-plate', 'water-plate'] },
  ],
  plates: [
    { id: 'door-plate', col: 16, row: 5 },
    { id: 'water-plate', col: 18, row: 9 },
  ],
  blocks: [
    { id: 'west-stone', col: 14, row: 6, look: 'stone' },
    { id: 'east-stone', col: 18, row: 6, look: 'stone' },
  ],
  levers: [
    { id: 'shortcut-lever', col: 5, row: 1, name: 'Rusted lever', shutter: 'shortcut-shutter' },
  ],
  lamps: [],
  lampSets: [],
  sigils: [
    { id: 'court-sigil', col: 11, row: 8, blocks: ['west-stone', 'east-stone'], shutters: ['keeper-shutter'] },
  ],
  alcoves: [],
  residents: [],
  furniture: [],
  effects: [
    { col: 13, row: 9, kind: 'drip' },
  ],
}

// ---------------------------------------------------------------------------
// Wayfarer Cavern · B3 · spring-heart "The Spring Heart"
// ---------------------------------------------------------------------------
export const SPRING_HEART: ChamberDefinition = {
  id: 'spring-heart', name: 'The Spring Heart', subtitle: 'Where the spring begins',
  look: 'cavern', torch: 3.6, sconces: true, group: 'wayfarer-cavern', heart: true,
  map: [
    '########################',
    '#####..............#####',
    '#####.......f......#####',
    '#####~~............#####',
    '#####~~f...~~~..f..#####',
    '#####......~A~.....#####',
    '#####......~.~.....#####',
    '#####.........u....#####',
    '#####.....t.:......#####',
    '############G###########',
    '#~~K.~~~#...:...#....W##',
    '#~~~m~m~#.....t.#....W##',
    '#~~mmmm~#.......#....BK#',
    '#h~~~~m~#............W##',
    '#....t..........#....W##',
    '#.......#...@...#....W##',
    '############<###########',
  ],
  exits: [
    { id: 'stairs-up', col: 12, row: 16, style: 'stairs-up', label: 'Stairs up', landing: { col: 12, row: 15 }, facing: 'up' },
  ],
  entrances: [],
  tablets: [
    { id: 'way-home', col: 10, row: 8, title: 'The Way Home', text: 'Bloom, then sun, then rain returning: the garden’s order walked backward leads the traveller home to the spring.', pointsAt: ['bloom-brazier', 'sun-brazier', 'rain-brazier'] },
    { id: 'last-door', col: 14, row: 11, title: 'The Last Door', text: 'The great door has a great key, no other way through. Somewhere near still water, an islet keeps it safe.' },
    { id: 'ripples', col: 5, row: 14, title: 'The Sleeping Springs', text: 'The springs sleep until woken. A cast stone stirs the water and raises a stepping stone in its place.' },
  ],
  gates: [],
  chests: [
    { id: 'great-key-chest', col: 3, row: 10, name: 'Islet Chest', subtitle: 'On the islet in the spring pool', items: [{ kind: 'great-key', name: 'The Great Key' }], lore: 'The Great Key, resting on the islet where the spring rises.' },
    { id: 'seam-chest', col: 22, row: 12, name: 'Seam Chest', subtitle: 'Behind the cracked brick', items: [{ kind: 'note', name: 'Folded note' }, { kind: 'feather', name: 'A single feather' }], lore: 'A folded note and a single feather, hidden behind the cracked brick.' },
  ],
  doors: [
    { id: 'great-door', col: 12, row: 9, name: 'Great door', lock: 'great' },
  ],
  shutters: [],
  plates: [],
  blocks: [],
  levers: [],
  lamps: [
    { id: 'rain-brazier', col: 12, row: 2, name: '≋ Rain brazier' },
    { id: 'bloom-brazier', col: 7, row: 4, name: '✿ Bloom brazier' },
    { id: 'sun-brazier', col: 16, row: 4, name: '☀ Sun brazier' },
  ],
  lampSets: [
    { id: 'homeward-braziers', lamps: ['bloom-brazier', 'sun-brazier', 'rain-brazier'], ordered: true },
  ],
  sigils: [],
  alcoves: [
    { id: 'center-alcove', col: 1, row: 13, memoryId: 'wayfarer-cavern-center-memory', text: CENTER_MEMORY, locked: ALCOVE_LOCKED },
  ],
  residents: [],
  furniture: [],
  effects: [
    { col: 12, row: 1, kind: 'drip' },
    { col: 16, row: 4, kind: 'daylight' },
  ],
  artifact: { id: 'spring-crystal', col: 12, row: 5, name: 'Spring crystal', knowledgeId: 'wayfarer-spring', appearsWith: 'homeward-braziers', lore: 'Above Sunseed Porch’s highest left shelf, a memory waits in the empty square over the shelf’s left end. Make a stone there, then break that same stone: the hidden treasure will appear.' },
  risingLight: { id: 'rising-light', col: 14, row: 7, landing: { col: 13, row: 7 } },
  finale: { when: { set: 'homeward-braziers' }, fills: [{ col: 11, row: 4 }, { col: 12, row: 4 }, { col: 13, row: 4 }, { col: 11, row: 5 }, { col: 13, row: 5 }, { col: 11, row: 6 }, { col: 13, row: 6 }] },
}

// ---------------------------------------------------------------------------
// Highland Cavern · B1 · hall-of-hours "The Hall of Hours"
// ---------------------------------------------------------------------------
export const HALL_OF_HOURS: ChamberDefinition = {
  id: 'hall-of-hours', name: 'The Hall of Hours', subtitle: 'A sundial kept by fire',
  look: 'cavern', torch: 3.2, sconces: false, group: 'highland-cavern',
  map: [
    '##########################',
    '#########k####..........K#',
    '#.t..........#..t........#',
    '#.....f.....:D:..........#',
    '#............#...........#',
    '#.....t......#.....:.....#',
    '<@.f..W..f...######R######',
    '#............#.....:.....#',
    '#............#...........#',
    '#.....f......#.........WW#',
    '#............#....>....BK#',
    '#............#.........WW#',
    '##########################',
  ],
  exits: [
    { id: 'highland-arch', col: 0, row: 6, style: 'arch', label: 'Daylight', landing: { col: 1, row: 6 }, facing: 'right' },
  ],
  entrances: [
    { id: 'stairs-down', col: 18, row: 10, style: 'stairs-down', empty: 'The stair ends in fallen rock.', landing: { col: 18, row: 9 } },
  ],
  tablets: [
    { id: 'sundial', col: 2, row: 2, title: 'The Sundial', text: 'A sundial without a sun. Four braziers stand for the hours it once told: sunrise, noon, sunset — and one that lies.', pointsAt: ['sunrise-brazier', 'noon-brazier', 'sunset-brazier', 'midnight-brazier'] },
    { id: 'hours', col: 16, row: 2, title: 'Gate of Hours', knowledgeId: 'highland-cavern-cycle', text: 'Dawn opens the eye. Noon fills it with light. Dusk lets it rest. Give the gate one whole day.', pointsAt: ['cycle'] },
    { id: 'gnomon', col: 6, row: 5, title: 'The Gnomon', text: 'The pillar’s shadow once marked true time. Light the hours in their honest order; the false hour only gutters what you have lit.', pointsAt: ['sunrise-brazier', 'noon-brazier', 'sunset-brazier', 'midnight-brazier'] },
  ],
  gates: [
    {
      id: 'cycle', name: 'Gate of Hours', col: 19, row: 6, tablet: 'hours',
      question: 'Touch the hours in their natural order.',
      options: [
        { id: 'dusk', glyph: '◕', label: 'Dusk' },
        { id: 'dawn', glyph: '◔', label: 'Dawn' },
        { id: 'noon', glyph: '☀', label: 'Noon' },
      ],
      answer: ['dawn', 'noon', 'dusk'],
    },
  ],
  chests: [
    { id: 'hour-key-chest', col: 9, row: 1, name: 'Hour Niche', subtitle: 'Above the hall', items: [{ kind: 'key', name: 'Hour key' }], lore: 'A key set into the niche the four braziers, lit in their true order, brought to light.', hiddenUntil: 'sun-walk' },
    { id: 'map-chest', col: 24, row: 1, name: 'Climber’s Pack', subtitle: 'Left beside the eastern hall', items: [{ kind: 'map', name: 'Map of Highland Cavern' }], lore: 'A climber’s pack, its chart still folded to Highland Cavern’s own passages.', grants: [{ id: 'map:highland-cavern', text: 'A climber’s chart of Highland Cavern, already marking its passages on your minimap.' }] },
    { id: 'hour-nook-chest', col: 24, row: 10, name: 'Hour Nook', subtitle: 'Behind the cracked brick', items: [{ kind: 'gem', name: 'Uncut gem' }, { kind: 'coins', name: 'A handful of coins' }], lore: 'A gem and a scatter of coins, left behind the cracked brick in the eastern hall.' },
  ],
  doors: [
    { id: 'hour-door', col: 13, row: 3, name: 'Iron-bound door', lock: 'small' },
  ],
  shutters: [],
  plates: [],
  blocks: [],
  levers: [],
  lamps: [
    { id: 'midnight-brazier', col: 6, row: 3, name: '☾ Midnight brazier' },
    { id: 'sunset-brazier', col: 3, row: 6, name: '◕ Sunset brazier' },
    { id: 'sunrise-brazier', col: 9, row: 6, name: '◔ Sunrise brazier' },
    { id: 'noon-brazier', col: 6, row: 9, name: '☀ Noon brazier' },
  ],
  lampSets: [
    { id: 'sun-walk', lamps: ['sunrise-brazier', 'noon-brazier', 'sunset-brazier'], ordered: true, decoys: ['midnight-brazier'], wrong: 'midnight-brazier' },
  ],
  sigils: [],
  alcoves: [],
  residents: [],
  furniture: [],
  effects: [],
}

// ---------------------------------------------------------------------------
// Highland Cavern · B2 · six-roads "The Six Roads"
// ---------------------------------------------------------------------------
export const SIX_ROADS: ChamberDefinition = {
  id: 'six-roads', name: 'The Six Roads', subtitle: 'Six roads around one courtyard',
  look: 'cavern', torch: 3.6, sconces: true, group: 'highland-cavern',
  map: [
    '###########################',
    '#####......#####t.....W####',
    '#####.K....#####......BK###',
    '#####......#####......W####',
    '##########.#####.##########',
    '##########.#####.##########',
    '#########t........#########',
    '#...#####.........######..#',
    '<@.......:...t....:D::R:.>#',
    '#...#####.........######..#',
    '#########.........#########',
    '##########.#####.##########',
    '##########.#####.#####k####',
    '##W.r.W....#####..........#',
    '#KS...r....#####..f.....f.#',
    '##W.r.W.t..#####.....t....#',
    '###########################',
  ],
  exits: [
    { id: 'stairs-up', col: 0, row: 8, style: 'stairs-up', label: 'Stairs up', landing: { col: 1, row: 8 }, facing: 'right' },
  ],
  entrances: [
    { id: 'stairs-down', col: 25, row: 8, style: 'stairs-down', empty: 'The stair is choked with fallen stone.', landing: { col: 24, row: 8 } },
  ],
  tablets: [
    { id: 'rest', col: 16, row: 1, title: 'A Traveller’s Rest', text: 'Even a well-worn road needs a place to rest. A traveller’s box waits behind the cracked brick, for whoever pauses here.', pointsAt: ['rest-chest'] },
    { id: 'six-roads', col: 9, row: 6, title: 'The Six Roads', text: 'Six roads meet at this courtyard and every one returns. Walk them all before you decide which one carries you onward.', pointsAt: ['lodestone-chest', 'rest-chest', 'east-door', 'meaning', 'warden-key-chest', 'unlit-chest'] },
    { id: 'center', col: 13, row: 8, title: 'Gate of the Center', knowledgeId: 'highland-cavern-meaning', text: 'Six roads surround the courtyard. Each face meets its neighbour; each road returns to one center. Which shape holds them together?', pointsAt: ['meaning'] },
    { id: 'three-plates', col: 8, row: 15, title: 'The Three Plates', text: 'Three rune plates, and a gap between two of them. The warden’s chest opens only once every plate holds a brick.', pointsAt: ['warden-key-chest'] },
    { id: 'unlit-road', col: 21, row: 15, title: 'The Unlit Road', text: 'One road stays dark. Light the lamps at either end together and the niche between them will no longer hide.', pointsAt: ['unlit-chest'] },
  ],
  gates: [
    {
      id: 'meaning', name: 'Gate of the Center', col: 22, row: 8, tablet: 'center',
      question: 'Choose the mark that carries the inscription’s meaning.',
      options: [
        { id: 'triangle', glyph: '△', label: 'Triangle' },
        { id: 'circle', glyph: '○', label: 'Circle' },
        { id: 'hexagon', glyph: '⬡', label: 'Hexagon' },
      ],
      answer: ['hexagon'],
    },
  ],
  chests: [
    { id: 'lodestone-chest', col: 6, row: 2, name: 'Lodestone Case', subtitle: 'Tucked beside the western road', items: [{ kind: 'lodestone', name: 'Lodestone chip' }], lore: 'A second lodestone, tucked beside the western road for whoever passes this way.', grants: [{ id: 'lodestone:highland-cavern', text: 'A lodestone tuned to Highland Cavern’s own stone, its needle true wherever you walk these halls.' }] },
    { id: 'rest-chest', col: 23, row: 2, name: 'Travellers’ Box', subtitle: 'Behind the cracked brick', items: [{ kind: 'coins', name: 'A handful of coins' }], lore: 'A traveller’s box: nothing valuable, only what a tired walker might need.' },
    { id: 'warden-key-chest', col: 1, row: 14, name: 'Warden’s Chest', subtitle: 'Behind the sealed arch', items: [{ kind: 'key', name: 'Warden’s key' }], lore: 'The warden’s own key, sealed behind stone until the runes agreed to open.' },
    { id: 'unlit-chest', col: 22, row: 12, name: 'Lamp Niche', subtitle: 'Between two lamps', items: [{ kind: 'coins', name: 'A handful of coins' }], lore: 'Left in the dark until the lamps either side of it agreed to shine.', hiddenUntil: 'road-lamp-pair' },
  ],
  doors: [
    { id: 'east-door', col: 19, row: 8, name: 'Iron-bound door', lock: 'small' },
  ],
  shutters: [],
  plates: [],
  blocks: [],
  levers: [],
  lamps: [
    { id: 'west-lamp', col: 18, row: 14, name: 'West lamp' },
    { id: 'east-lamp', col: 24, row: 14, name: 'East lamp' },
  ],
  lampSets: [
    { id: 'road-lamp-pair', lamps: ['west-lamp', 'east-lamp'], ordered: false },
  ],
  sigils: [],
  alcoves: [],
  residents: [],
  furniture: [],
  effects: [],
}

// ---------------------------------------------------------------------------
// Highland Cavern · B3 · accord-sanctum "The Accord Sanctum"
// ---------------------------------------------------------------------------
export const ACCORD_SANCTUM: ChamberDefinition = {
  id: 'accord-sanctum', name: 'The Accord Sanctum', subtitle: 'Six plates around one center',
  look: 'cavern', torch: 3.4, sconces: true, group: 'highland-cavern', heart: true,
  map: [
    '#########################',
    '####.................####',
    '####.t....r...r......####',
    '####.......WWW.......####',
    '####....r..WAW..r....####',
    '####.......WSW.......####',
    '##t#......q.:.q......####',
    '#h|:...P....u.......s####',
    '######......:......######',
    '#####K######G############',
    '#####|####..:..##########',
    '##...:...#.....##########',
    '##..P.P..t.....##########',
    '##.W.o.W::.....##########',
    '##...o...s.....##########',
    '##.......#.....##########',
    '##########..@..##########',
    '############<############',
  ],
  exits: [
    { id: 'stairs-up', col: 12, row: 17, style: 'stairs-up', label: 'Stairs up', landing: { col: 12, row: 16 }, facing: 'up' },
  ],
  entrances: [],
  tablets: [
    { id: 'six-plates', col: 5, row: 2, title: 'The Six Plates', text: 'Six plates ring the crystal, three above and three below a settling stone. Every plate must hold a brick before the center opens.', pointsAt: ['accord-crystal'] },
    { id: 'pale-plate', col: 2, row: 6, title: 'The Pale Plate', text: 'A pale plate remembers a step long past. Press it and a shutter somewhere in this hall will answer.', pointsAt: ['memory-plate', 'center-alcove'] },
    { id: 'two-suns', col: 9, row: 12, title: 'The Two Suns', text: 'Two suns, one court. Settle both stones on their plates together and the shutter above the great door’s key will open.', pointsAt: ['west-sun', 'east-sun', 'court-sigil'] },
  ],
  gates: [],
  chests: [
    { id: 'great-key-chest', col: 5, row: 9, name: 'Sun Vault', subtitle: 'Behind its own shutter', items: [{ kind: 'great-key', name: 'The Great Key' }], lore: 'The Great Key, kept safe in the Sun Vault behind its own shutter.' },
  ],
  doors: [
    { id: 'great-door', col: 12, row: 9, name: 'Great door', lock: 'great' },
  ],
  shutters: [
    { id: 'memory-shutter', col: 2, row: 7, name: 'Memory shutter', plates: ['memory-plate'] },
    { id: 'sun-shutter', col: 5, row: 10, name: 'Sun shutter', plates: ['west-sun', 'east-sun'] },
  ],
  plates: [
    { id: 'memory-plate', col: 7, row: 7 },
    { id: 'west-sun', col: 4, row: 12 },
    { id: 'east-sun', col: 6, row: 12 },
  ],
  blocks: [
    { id: 'west-stone', col: 10, row: 6, look: 'stone' },
    { id: 'east-stone', col: 14, row: 6, look: 'stone' },
    { id: 'north-stone', col: 5, row: 13, look: 'stone' },
    { id: 'south-stone', col: 5, row: 14, look: 'stone' },
  ],
  levers: [],
  lamps: [],
  lampSets: [],
  sigils: [
    { id: 'sanctum-sigil', col: 20, row: 7, blocks: ['west-stone', 'east-stone'], shutters: ['memory-shutter'] },
    { id: 'court-sigil', col: 9, row: 14, blocks: ['north-stone', 'south-stone'], shutters: ['sun-shutter'] },
  ],
  alcoves: [
    { id: 'center-alcove', col: 1, row: 7, memoryId: 'highland-cavern-center-memory', text: CENTER_MEMORY, locked: ALCOVE_LOCKED },
  ],
  residents: [],
  furniture: [],
  effects: [],
  artifact: { id: 'accord-crystal', col: 12, row: 4, name: 'Accord crystal', knowledgeId: 'highland-accord', lore: 'Above Tideglass Porch’s highest left shelf, a memory waits in the empty square over the shelf’s left end. Make a stone there, then break that same stone: the hidden treasure will appear.' },
  risingLight: { id: 'rising-light', col: 12, row: 7, landing: { col: 13, row: 7 } },
  finale: { when: { seal: true }, fills: [{ col: 10, row: 2 }, { col: 14, row: 2 }, { col: 8, row: 4 }, { col: 16, row: 4 }, { col: 10, row: 6 }, { col: 14, row: 6 }] },
}

// ---------------------------------------------------------------------------
// Interior chain: chandler-house -> chandler-cellar
// ---------------------------------------------------------------------------
export const CHANDLER_HOUSE: ChamberDefinition = {
  id: 'chandler-house', name: 'Wenna’s House', subtitle: 'A chandler’s house by the harbour',
  look: 'house', torch: 0, sconces: false, group: 'chandlery',
  map: [
    '############',
    '#==.......=#',
    '#.......>..#',
    '#=t........#',
    '#..........#',
    '#.......n..#',
    '#..........#',
    '#....@.....#',
    '#####<######',
  ],
  exits: [
    { id: 'front-door', col: 5, row: 8, style: 'house-door', label: 'Front door', landing: { col: 5, row: 7 }, facing: 'up' },
  ],
  entrances: [
    { id: 'trapdoor', col: 8, row: 2, style: 'trapdoor', empty: 'The trapdoor is bolted from below.', landing: { col: 8, row: 3 } },
  ],
  tablets: [
    { id: 'wenna-list', col: 2, row: 3, title: 'Wenna’s List', text: 'Wenna’s grocery list, pinned by the door: candle wax, salted fish, and something heavy enough to hold down a cellar draught.' },
  ],
  gates: [],
  chests: [],
  doors: [],
  shutters: [],
  plates: [],
  blocks: [],
  levers: [],
  lamps: [],
  lampSets: [],
  sigils: [],
  alcoves: [],
  residents: [
    {
      id: 'wenna', col: 8, row: 5, name: 'Wenna', role: 'Chandler', color: '#c98a3c',
      lines: [
        'Wenna glances up from her ledger. “Beeswax and lamp oil, that’s my trade. Mind the cellar stair — it wants a lantern.”',
        '“The cold plate keeps the cheese sweet down below,” she says, “if you can find something heavy enough to hold it there.”',
        '“My grandmother’s list is pinned by the door. Read it before you go poking round in my cellar.”',
      ],
      linesWith: {
        knowledge: 'keepsake:lantern',
        lines: [
          'Wenna smiles at the lantern swinging from your belt. “That was my grandfather’s. Carry it well.”',
          '“Light enough to see the dark corners now, I’d wager,” she says, nodding at your lantern.',
        ],
      },
    },
  ],
  furniture: [
    { col: 1, row: 1, look: 'shelf' },
    { col: 2, row: 1, look: 'shelf' },
    { col: 10, row: 1, look: 'counter' },
    { col: 1, row: 3, look: 'shelf' },
  ],
  effects: [],
}

export const CHANDLER_CELLAR: ChamberDefinition = {
  id: 'chandler-cellar', name: 'Wenna’s Cellar', subtitle: 'Barrels, a wine rack and a cold draught',
  look: 'cellar', torch: 3.0, sconces: false, group: 'chandlery',
  map: [
    '#<##########',
    '#@...t....P#',
    '#s.........#',
    '#==..o.....#',
    '#......o...#',
    '#........:.#',
    '#########|##',
    '########.:K#',
    '############',
  ],
  exits: [
    { id: 'cellar-steps', col: 1, row: 0, style: 'ladder', label: 'Steps up', landing: { col: 1, row: 1 }, facing: 'down' },
  ],
  entrances: [],
  tablets: [
    { id: 'chalk-beam', col: 5, row: 1, title: 'The Chalk Beam', text: 'Chalk marks on the beam: “cold plate under the grate, rack shutter needs the barrel”. Wenna’s own hand, by the look of it.', pointsAt: ['cold-plate', 'rack-shutter'] },
  ],
  gates: [],
  chests: [
    { id: 'lantern-chest', col: 10, row: 7, name: 'Wine Rack Cubby', subtitle: 'Behind the rack shutter', items: [{ kind: 'lantern', name: 'Brass lantern' }, { kind: 'coins', name: 'A handful of coins' }], lore: 'A brass lantern, still full of oil, tucked into the wine rack’s cubby.', grants: [{ id: 'keepsake:lantern', text: 'A brass lantern with clean oil. Its light reaches a little further than torchlight alone, anywhere dark.' }] },
  ],
  doors: [],
  shutters: [
    { id: 'rack-shutter', col: 9, row: 6, name: 'Rack shutter', plates: ['cold-plate'] },
  ],
  plates: [
    { id: 'cold-plate', col: 10, row: 1 },
  ],
  blocks: [
    { id: 'near-barrel', col: 5, row: 3, look: 'barrel' },
    { id: 'far-barrel', col: 7, row: 4, look: 'barrel' },
  ],
  levers: [],
  lamps: [],
  lampSets: [],
  sigils: [
    { id: 'cellar-sigil', col: 1, row: 2, blocks: ['near-barrel', 'far-barrel'], shutters: ['rack-shutter'] },
  ],
  alcoves: [],
  residents: [],
  furniture: [
    { col: 1, row: 3, look: 'barrels' },
    { col: 2, row: 3, look: 'rack' },
  ],
  effects: [],
}

// ---------------------------------------------------------------------------
// The Hollow Grove: island/valley-grove -> hollow-grove
// ---------------------------------------------------------------------------
export const HOLLOW_GROVE: ChamberDefinition = {
  id: 'hollow-grove', name: 'The Hollow Grove', subtitle: 'Where the valley’s trees close over',
  look: 'wood', torch: 0, sconces: false,
  map: [
    '############<###########',
    '###.........@........###',
    '##...WWW....~~~......###',
    '##...WKW...~~~~~......##',
    '##...WBW...~~K~~......##',
    '##.........~~m~~......##',
    '<@..........~.~.......@<',
    '##......t...........n.##',
    '##....................##',
    '###......WW....WW....###',
    '####.....W......W...####',
    '#####..............#####',
    '######.............#####',
    '#######....@.......#####',
    '###########<############',
  ],
  exits: [
    { id: 'north-edge', col: 12, row: 0, style: 'arch', label: 'North edge', landing: { col: 12, row: 1 }, facing: 'down' },
    { id: 'south-edge', col: 11, row: 14, style: 'arch', label: 'South edge', landing: { col: 11, row: 13 }, facing: 'up' },
    { id: 'west-edge', col: 0, row: 6, style: 'arch', label: 'West edge', landing: { col: 1, row: 6 }, facing: 'right' },
    { id: 'east-edge', col: 23, row: 6, style: 'arch', label: 'East edge', landing: { col: 22, row: 6 }, facing: 'left' },
  ],
  entrances: [],
  tablets: [
    { id: 'bark-marks', col: 8, row: 7, title: 'Bark Marks', knowledgeId: 'hollow-grove-bark-marks', text: 'Old bark marks show a boulder split by force and a spring stirred by a thrown stone. Both hide something worth finding.', pointsAt: ['boulder-chest', 'pool-chest'] },
  ],
  gates: [],
  chests: [
    { id: 'boulder-chest', col: 6, row: 3, name: 'Boulder Hollow', subtitle: 'Behind the cracked boulder', items: [{ kind: 'coins', name: 'A handful of coins' }], lore: 'Whatever the boulder hid, it kept it dry for a very long time.' },
    { id: 'pool-chest', col: 13, row: 4, name: 'Islet Chest', subtitle: 'On the islet in the pool', items: [{ kind: 'note', name: 'Gatherer’s list' }, { kind: 'feather', name: 'A single feather' }], lore: 'A gatherer’s list and a single feather, found on the small islet in the pool.' },
  ],
  doors: [],
  shutters: [],
  plates: [],
  blocks: [],
  levers: [],
  lamps: [],
  lampSets: [],
  sigils: [],
  alcoves: [],
  residents: [
    {
      id: 'nettle', col: 20, row: 7, name: 'Nettle', role: 'Herb-gatherer', color: '#6a9c53',
      lines: [
        'Nettle kneels among the roots. “Careful of the boulder — something’s cracked its face open before.”',
        '“The spring under the leaves answers a stone cast well,” she murmurs, not looking up.',
        '“I’ve gathered here for years. The grove keeps its own secrets, same as the caverns do.”',
      ],
    },
  ],
  furniture: [],
  effects: [],
}

export const CHAMBERS: readonly ChamberDefinition[] = [
  WET_STEPS, CISTERN, SPRING_HEART, HALL_OF_HOURS, SIX_ROADS, ACCORD_SANCTUM, CHANDLER_HOUSE, CHANDLER_CELLAR, HOLLOW_GROVE,
]
