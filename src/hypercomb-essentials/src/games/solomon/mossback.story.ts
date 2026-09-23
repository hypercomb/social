// The worked example of a story add-on, exactly as a participant would
// write one: plain data, a world and one seat. The Greenwood's signpost at
// its gate — a thing, not a door — leads up onto the ridge the sign names.
// Seeded into the game's `stories` layer the first time it opens; after
// that the tile is the story, and editing it is editing the world.
export const MOSSBACK_STORY: unknown = {
  version: 1,
  id: 'mossback',
  name: 'The Mossback',
  worlds: [
    {
      id: 'mossback', name: 'The Mossback', subtitle: 'The ridge above the Greenwood, up to its snowy crown',
      island: {
        seed: 41, cols: 48, rows: 40, edge: 'cliff',
        spine: { name: 'The Crown', points: [{ x: 14, y: 10 }, { x: 24, y: 8 }, { x: 34, y: 12 }] },
        forests: [{ x: 10, y: 30, r: 6 }],
        lakes: [{ x: 31, y: 27, r: 2 }],
        rivers: [[{ x: 31, y: 25 }, { x: 22, y: 33 }, { x: 16, y: 38 }]],
        towns: [{ id: 'shepherds-rest', name: 'Shepherds’ Rest', x: 24, y: 28, plaza: { w: 4, h: 3 } }],
        clearings: [{ id: 'foot', x: 24, y: 36, r: 3 }, { id: 'shoulder', x: 24, y: 17, r: 3 }],
        stamps: [],
        regions: [{ name: 'The Crown', x: 24, y: 9, r: 8 }, { name: 'The Shoulder', x: 24, y: 17, r: 5 }],
        roads: [['foot', 'shepherds-rest'], ['shepherds-rest', 'shoulder']],
        wilds: 'The Mossback',
      },
      start: { x: 24.5, y: 36.5 },
      residents: [
        {
          id: 'harl', name: 'Harl', role: 'Shepherd', x: 23.5, y: 27.5, color: '#8a7f5a',
          lines: [
            'Up from the Greenwood by the signpost? Then you read the sign right: this ridge is the Mossback, and the wood is under your feet.',
            'The old mine on the shoulder is shut. Whoever opens it will want a lamp.',
          ],
        },
      ],
      signs: [
        { id: 'crown-cairn', name: 'Cairn', subtitle: 'On the shoulder', x: 25.5, y: 16.5, text: 'THE MOSSBACK. Below: the Greenwood. Above: the Crown, and snow. The mine is shut.' },
      ],
      caches: [
        {
          id: 'kite-nest', name: 'Kite Nest', subtitle: 'At the crown', x: 24.5, y: 12.5,
          lore: 'A ridge-kite’s nest, with what the wind brought up.',
          items: [{ kind: 'feather', name: 'Crown feather' }, { kind: 'gem', name: 'Ridge quartz' }],
        },
      ],
      doors: [
        { id: 'old-mine', name: 'The old mine', subtitle: 'Shut, on the shoulder', x: 27.5, y: 17.5, empty: 'Timbers across the mouth. What is behind them waits for whoever makes it.' },
      ],
      plots: [],
      areas: [],
    },
  ],
  chambers: [],
  caverns: [],
  seats: [
    { entrance: 'greenwood/grove-gate-sign', place: 'mossback' },
  ],
}
