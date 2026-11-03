// The blocks' content, by route (tree.cjs names the tiles; page.cjs draws each
// block). The pilot is the primitive and its four parts.
//
// For every block:
//   title, lede   the page's own words
//   picture       nodes and edges a beat can light (see page.cjs)
//   beats         the short video: one sentence each, and what it lights
//   try           a live part, computed in the page, asking nothing of the network
//   code          excerpts quoted from the repo at plant time: { path, from, lines }
//                 (`from` is the first line's text, so an excerpt follows the code)
//   files         the documents and source the block explains, attached to its
//                 tile as included files (paths from src/)

const PRIMITIVE_NODES = [
  { id: 'hypercomb', label: 'hypercomb', x: 320, y: 180, r: 56 },
  { id: 'word', label: 'word', x: 140, y: 80 },
  { id: 'signature', label: 'signature', x: 500, y: 80 },
  { id: 'layer', label: 'layer', x: 140, y: 280 },
  { id: 'meta', label: 'meta', x: 500, y: 280 },
]
const PRIMITIVE_EDGES = [['hypercomb', 'word'], ['hypercomb', 'signature'], ['hypercomb', 'layer'], ['hypercomb', 'meta']]
const ALL = ['hypercomb', 'word', 'signature', 'layer', 'meta', 'hypercomb-word', 'hypercomb-signature', 'hypercomb-layer', 'hypercomb-meta']


/** A tile and its children: the tile above, the children in one or two rows. */
const hub = (top, children, label) => {
  const rows = children.length > 6 ? [children.slice(0, Math.ceil(children.length / 2)), children.slice(Math.ceil(children.length / 2))] : [children]
  const nodes = [{ id: top, label: top, x: 320, y: rows.length > 1 ? 68 : 80, r: 48 }]
  rows.forEach((row, ri) => row.forEach((name, i) => {
    nodes.push({ id: name, label: name, x: Math.round(640 / (row.length + 1) * (i + 1)), y: rows.length > 1 ? 190 + ri * 110 : 260, r: rows.length > 1 ? 32 : 38 })
  }))
  return { label, nodes, edges: children.map(c => [top, c]) }
}
/** Light a tile with some of its children, and the lines between. */
const lit = (top, ...names) => [top, ...names, ...names.map(n => `${top}-${n}`)]

module.exports = {
  'presentation/simple/primitive': {
    code: [
      { path: 'hypercomb-core/src/core/life-primitive.ts', from: 'export type MetaEnvelope = {', lines: 16 },
      { path: 'hypercomb-core/src/core/canonical-layer.ts', from: 'export type CanonicalLayerContent = {', lines: 5 },
    ],
    files: ['documentation/life-primitive.md', 'hypercomb-core/src/core/life-primitive.ts'],
  },

  'presentation/simple/primitive/word': {
    eyebrow: 'word',
    headline: 'Word',
    sub: 'A tile\'s name. A word is an address: the same word finds the same place, anywhere.',
    picture: {
      label: 'A typed word folded into a key, then signed into an address',
      nodes: [
        { id: 'typed', label: 'My Tile', sub: 'typed', kind: 'box', x: 110, y: 180, w: 150 },
        { id: 'key', label: 'my-tile', sub: 'folded', kind: 'box', x: 320, y: 180, w: 150 },
        { id: 'address', label: '9f…c1', sub: 'address', kind: 'box', x: 530, y: 180, w: 150 },
        { id: 'others', label: 'my tile', sub: 'typed elsewhere', kind: 'box', x: 110, y: 300, w: 150 },
      ],
      edges: [['typed', 'key'], ['key', 'address'], ['others', 'key']],
    },
    beats: [
      { say: 'A word is a name you can say.', lit: ['typed'] },
      { say: 'The hive folds it the same way for everyone: letters and digits kept, every other run one hyphen, lower case.', lit: ['typed', 'key', 'typed-key'] },
      { say: 'The folded word is signed. That signature is its address.', lit: ['key', 'address', 'key-address'] },
      { say: 'Someone else types it their own way, and lands on the same address.', lit: ['others', 'key', 'address', 'others-key', 'key-address'] },
      { say: 'So a word needs no registry. Saying it is finding it. Try one below.', lit: ['typed', 'key', 'address', 'others', 'typed-key', 'key-address', 'others-key'] },
    ],
    try: 'word',
    code: [
      { path: 'hypercomb-core/src/core/lineage-key.ts', from: 'export const canonicalizeLineageSegment', lines: 2 },
      { path: 'hypercomb-core/src/core/molecule-address.ts', from: 'export const moleculeKey', lines: 2 },
      { path: 'hypercomb-core/src/core/molecule-address.ts', from: 'export const moleculeAddress', lines: 5 },
    ],
    files: ['documentation/ontology-is-the-name.md', 'documentation/hypergraph-molecule-lineage.md', 'hypercomb-core/src/core/molecule-address.ts', 'hypercomb-core/src/core/lineage-key.ts'],
  },

  'presentation/simple/primitive/signature': {
    try: 'signature',
    code: [
      { path: 'hypercomb-core/src/core/signature.service.ts', from: '  public static async sign(bytes: ArrayBuffer)', lines: 7 },
    ],
    files: ['documentation/signature-system.md', 'documentation/signature-algebra.md', 'hypercomb-core/src/core/signature.service.ts'],
  },

  'presentation/simple/primitive/layer': {
    eyebrow: 'layer',
    headline: 'Layer',
    sub: 'The words under a word. Every tile can hold a layer of its own.',
    picture: {
      label: 'A layer: a name and its ordered children, kept in versions',
      nodes: [
        { id: 'name', label: 'simple', sub: 'name', x: 320, y: 80 },
        { id: 'c1', label: 'primitive', x: 170, y: 222, r: 42 },
        { id: 'c2', label: 'act', x: 320, y: 222, r: 42 },
        { id: 'c3', label: 'opening', x: 470, y: 222, r: 42 },
        { id: 'v', label: '00000000 · 00000001 · 00000002', sub: 'versions, newest is the heart', kind: 'box', x: 320, y: 318, w: 330 },
      ],
      edges: [['name', 'c1'], ['name', 'c2'], ['name', 'c3']],
    },
    beats: [
      { say: 'A layer is a name and the words under it.', lit: ['name', 'c1', 'c2', 'c3', 'name-c1', 'name-c2', 'name-c3'] },
      { say: 'The children are one ordered list. Their order is the first layout.', lit: ['c1', 'c2', 'c3'] },
      { say: 'It is always written the same way, keys in order, so the same layer has the same signature.', lit: ['name'] },
      { say: 'Change it, and a new version is written above the old one. Nothing is replaced.', lit: ['v'] },
      { say: 'The newest version is the heart: what you see now. Every earlier one stays, one undo away.', lit: ['v', 'name'] },
    ],
    code: [
      { path: 'hypercomb-core/src/core/canonical-layer.ts', from: 'export type CanonicalLayerContent = {', lines: 18 },
    ],
    files: ['documentation/concepts.md', 'documentation/history-sigbag-as-root.md', 'hypercomb-core/src/core/canonical-layer.ts'],
  },

  'presentation/simple/primitive/meta': {
    eyebrow: 'meta',
    headline: 'Meta',
    sub: 'What a tile means, said where it is needed, and kept in versions like everything else.',
    picture: {
      label: 'A reference is a meta envelope pointing at exactly one payload',
      nodes: [
        { id: 'meta', label: 'meta', sub: 'the envelope', kind: 'box', x: 120, y: 180, w: 150 },
        { id: 'layer', label: 'layer', kind: 'box', x: 400, y: 70, w: 150 },
        { id: 'resource', label: 'resource', sub: 'bytes', kind: 'box', x: 400, y: 150, w: 150 },
        { id: 'dependency', label: 'dependency', kind: 'box', x: 400, y: 230, w: 150 },
        { id: 'bee', label: 'bee', sub: 'a behaviour', kind: 'box', x: 400, y: 310, w: 150 },
      ],
      edges: [['meta', 'layer'], ['meta', 'resource'], ['meta', 'dependency'], ['meta', 'bee']],
    },
    beats: [
      { say: 'Every reference in Hypercomb is the signature of a small envelope: the meta.', lit: ['meta'] },
      { say: 'It points at exactly one thing, and says which kind: a layer, bytes, a dependency, or a behaviour.', lit: ['meta', 'layer', 'resource', 'dependency', 'bee', 'meta-layer', 'meta-resource', 'meta-dependency', 'meta-bee'] },
      { say: 'Meaning is wrapped around the content, never written inside it.', lit: ['meta', 'resource', 'meta-resource'] },
      { say: 'So a layer\'s meta can point at another layer, and that one at another: the same shape, all the way down.', lit: ['meta', 'layer', 'meta-layer'] },
      { say: 'A tile that needs its meaning said says it here, in versions, without touching anything else.', lit: ['meta'] },
    ],
    code: [
      { path: 'hypercomb-core/src/core/life-primitive.ts', from: 'export type MetaEnvelope = {', lines: 16 },
    ],
    files: ['documentation/life-primitive.md', 'documentation/ontology-is-the-name.md', 'hypercomb-core/src/core/life-primitive.ts'],
  },
  // ── the opening: seven moves, from one hexagon to the cube ──────────────
  // (living-presentation.md, "From one hexagon to the cube, in seven moves")

  'presentation/simple/opening': {
    eyebrow: 'opening',
    headline: 'The opening',
    sub: 'Seven moves, from one hexagon to a cube that was never drawn.',
    picture: {
      label: 'The seven moves in order',
      nodes: [
        { id: 'm1', label: 'hexagon', sub: '1', x: 62, y: 120, r: 36 },
        { id: 'm2', label: 'row', sub: '2', x: 148, y: 250, r: 36 },
        { id: 'm3', label: 'stack', sub: '3', x: 234, y: 120, r: 36 },
        { id: 'm4', label: 'column', sub: '4', x: 320, y: 250, r: 36 },
        { id: 'm5', label: 'spread', sub: '5', x: 406, y: 120, r: 36 },
        { id: 'm6', label: 'fill', sub: '6', x: 492, y: 250, r: 36 },
        { id: 'm7', label: 'tesseract', sub: '7', x: 578, y: 120, r: 36 },
      ],
      edges: [['m1', 'm2'], ['m2', 'm3'], ['m3', 'm4'], ['m4', 'm5'], ['m5', 'm6'], ['m6', 'm7']],
    },
    beats: [
      { say: 'The cube is not saved for later. It is built first, on screen, from the primitive.', lit: ['m1'] },
      { say: 'Each part of the primitive gives a direction, so no axis has to be invented.', lit: ['m1', 'm2', 'm3', 'm1-m2', 'm2-m3'] },
      { say: 'The layer gives breadth and depth of words; the signature gives versions; origin gives width.', lit: ['m2', 'm3', 'm4', 'm5', 'm2-m3', 'm3-m4', 'm4-m5'] },
      { say: 'Then the points fill a cube, and every trait is one more direction.', lit: ['m6', 'm7', 'm5-m6', 'm6-m7'] },
      { say: 'Each move ends on one plain sentence. Step into a move to see it.', lit: ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm1-m2', 'm2-m3', 'm3-m4', 'm4-m5', 'm5-m6', 'm6-m7'] },
    ],
    code: [],
    files: ['documentation/living-presentation.md'],
  },

  'presentation/simple/opening/hexagon': {
    eyebrow: 'hexagon',
    headline: 'Move one: one hexagon',
    sub: 'One hexagon, named hypercomb. For now it is only a name.',
    picture: { label: 'Hypercomb alone, then opening into its four parts', nodes: PRIMITIVE_NODES, edges: PRIMITIVE_EDGES },
    beats: [
      { say: 'Hypercomb sits alone.', lit: ['hypercomb'] },
      { say: 'It opens into its four parts: word, signature, layer, and meta.', lit: ALL },
      { say: 'Nothing else is introduced, now or later. Every move after this is the same tile again.', lit: ['hypercomb'] },
      { say: 'This is hypercomb, and for now it is only a name.', lit: ['hypercomb', 'word', 'hypercomb-word'] },
    ],
    code: [{ path: 'hypercomb-core/src/core/life-primitive.ts', from: 'export type LifeLayer = {', lines: 5 }],
    files: ['documentation/life-primitive.md', 'hypercomb-core/src/core/life-primitive.ts'],
  },

  'presentation/simple/opening/row': {
    eyebrow: 'row',
    headline: 'Move two: a row',
    sub: 'A layer is the words that sit under one word.',
    picture: {
      label: 'Hypercomb with its six values in a row beneath it',
      nodes: [
        { id: 'top', label: 'hypercomb', x: 320, y: 80, r: 44 },
        { id: 'v1', label: 'simple', x: 70, y: 260, r: 40 },
        { id: 'v2', label: 'organized', x: 170, y: 260, r: 40 },
        { id: 'v3', label: 'collab…', x: 270, y: 260, r: 40 },
        { id: 'v4', label: 'intelligent', x: 370, y: 260, r: 40 },
        { id: 'v5', label: 'accessible', x: 470, y: 260, r: 40 },
        { id: 'v6', label: 'localized', x: 570, y: 260, r: 40 },
      ],
      edges: [['top', 'v1'], ['top', 'v2'], ['top', 'v3'], ['top', 'v4'], ['top', 'v5'], ['top', 'v6']],
    },
    beats: [
      { say: 'Under the tile, its layer lays out as a row.', lit: ['top'] },
      { say: 'Six values, side by side: simple, organized, collaborative, intelligent, accessible, localized.', lit: ['top', 'v1', 'v2', 'v3', 'v4', 'v5', 'v6', 'top-v1', 'top-v2', 'top-v3', 'top-v4', 'top-v5', 'top-v6'] },
      { say: 'Each one opens to the same four parts. The same shape, six more times, proves the shape.', lit: ['v1', 'v2', 'v3', 'v4', 'v5', 'v6'] },
      { say: 'This is the word direction: a row of words under one word.', lit: ['top', 'v1', 'v6', 'top-v1', 'top-v6'] },
      { say: 'A layer is the words that sit under one word.', lit: ['top', 'v1', 'v2', 'v3', 'v4', 'v5', 'v6', 'top-v1', 'top-v2', 'top-v3', 'top-v4', 'top-v5', 'top-v6'] },
    ],
    code: [{ path: 'hypercomb-core/src/core/canonical-layer.ts', from: 'export type CanonicalLayerContent = {', lines: 5 }],
    files: ['documentation/concepts.md', 'hypercomb-core/src/core/canonical-layer.ts'],
  },

  'presentation/simple/opening/stack': {
    eyebrow: 'stack',
    headline: 'Move three: rows under rows',
    sub: 'Every word can hold a layer of its own.',
    picture: {
      label: 'Values, each with a row of its own beneath it',
      nodes: [
        { id: 'a', label: 'simple', x: 130, y: 90, r: 38 },
        { id: 'b', label: 'organized', x: 320, y: 90, r: 38 },
        { id: 'c', label: 'collab…', x: 510, y: 90, r: 38 },
        { id: 'a1', label: 'primitive', x: 80, y: 260, r: 30 },
        { id: 'a2', label: 'act', x: 180, y: 260, r: 30 },
        { id: 'b1', label: 'heart', x: 270, y: 260, r: 30 },
        { id: 'b2', label: 'history', x: 370, y: 260, r: 30 },
        { id: 'c1', label: 'domain', x: 460, y: 260, r: 30 },
        { id: 'c2', label: 'sharing', x: 560, y: 260, r: 30 },
      ],
      edges: [['a', 'a1'], ['a', 'a2'], ['b', 'b1'], ['b', 'b2'], ['c', 'c1'], ['c', 'c2']],
    },
    beats: [
      { say: 'Each value opens into a row of its own.', lit: ['a', 'a1', 'a2', 'a-a1', 'a-a2'] },
      { say: 'And each of those is a tile with a layer, so there are rows under rows.', lit: ['a', 'b', 'c', 'a1', 'a2', 'b1', 'b2', 'c1', 'c2', 'a-a1', 'a-a2', 'b-b1', 'b-b2', 'c-c1', 'c-c2'] },
      { say: 'The plane becomes a stack of planes.', lit: ['a1', 'a2', 'b1', 'b2', 'c1', 'c2'] },
      { say: 'A path from the top reads aloud: simple, primitive, word.', lit: ['a', 'a1', 'a-a1'] },
      { say: 'Every word can hold a layer of its own.', lit: ['a', 'b', 'c', 'a1', 'a2', 'b1', 'b2', 'c1', 'c2', 'a-a1', 'a-a2', 'b-b1', 'b-b2', 'c-c1', 'c-c2'] },
    ],
    code: [{ path: 'hypercomb-core/src/core/lineage-key.ts', from: 'export const lineageKey', lines: 4 }],
    files: ['documentation/concepts.md', 'hypercomb-core/src/core/lineage-key.ts'],
  },

  'presentation/simple/opening/column': {
    eyebrow: 'column',
    headline: 'Move four: a column',
    sub: 'Nothing is replaced. Every change is kept, and the newest is the heart.',
    picture: {
      label: 'One tile\'s versions stacked into a column, the newest on top',
      nodes: [
        { id: 'v0', label: '00000000', sub: 'first', kind: 'box', x: 320, y: 300, w: 170 },
        { id: 'v1', label: '00000001', kind: 'box', x: 320, y: 220, w: 170 },
        { id: 'v2', label: '00000002', kind: 'box', x: 320, y: 140, w: 170 },
        { id: 'heart', label: 'heart', sub: 'what answers now', x: 540, y: 140, r: 40 },
        { id: 'tile', label: 'primitive', x: 110, y: 220, r: 40 },
      ],
      edges: [['v2', 'heart'], ['tile', 'v0'], ['tile', 'v1'], ['tile', 'v2']],
    },
    beats: [
      { say: 'One tile changes, and gets a new signature.', lit: ['tile', 'v0', 'v1', 'tile-v0', 'tile-v1'] },
      { say: 'The old one does not vanish. It stays, and the new one sits above it.', lit: ['v0', 'v1'] },
      { say: 'Every change adds a marker on top, and the stack becomes a column.', lit: ['v0', 'v1', 'v2', 'tile', 'tile-v2'] },
      { say: 'The top of the column is the heart: what a read lands on, what a publish points at.', lit: ['v2', 'heart', 'v2-heart'] },
      { say: 'Versions belong to each tile; two tiles\' second versions are not the same thing.', lit: ['v1'] },
      { say: 'Nothing is replaced. Every change is kept, one above the other.', lit: ['v0', 'v1', 'v2', 'heart', 'v2-heart'] },
    ],
    code: [
      { path: 'hypercomb-core/src/core/directory-safety.ts', from: 'export const markerName', lines: 4 },
      { path: 'hypercomb-essentials/src/history/history.service.ts', from: ' * One history entry.', lines: 9 },
    ],
    files: ['documentation/history-sigbag-as-root.md', 'documentation/revision-mode.md', 'hypercomb-core/src/core/directory-safety.ts', 'hypercomb-essentials/src/history/history.service.ts'],
  },

  'presentation/simple/opening/spread': {
    eyebrow: 'spread',
    headline: 'Move five: spread',
    sub: 'The same word can come from many hands.',
    picture: {
      label: 'One word answered by tiles from different origins, one a chain',
      nodes: [
        { id: 'word', label: 'simple', sub: 'one word', x: 320, y: 70, r: 40 },
        { id: 'mine', label: 'yours', sub: 'origin: you', kind: 'box', x: 120, y: 205, w: 150 },
        { id: 'ann', label: 'from ann', sub: 'origin: ann', kind: 'box', x: 320, y: 205, w: 150 },
        { id: 'bo', label: 'from bo', sub: 'via ann', kind: 'box', x: 520, y: 205, w: 150 },
        { id: 'thread', label: 'bo → ann → you', sub: 'a thread', kind: 'box', x: 420, y: 312, w: 190 },
      ],
      edges: [['word', 'mine'], ['word', 'ann'], ['word', 'bo'], ['bo', 'thread'], ['ann', 'thread']],
    },
    beats: [
      { say: 'The same word can be answered by a tile from somewhere else.', lit: ['word', 'mine', 'word-mine'] },
      { say: 'Your own, or one replicated from someone you follow.', lit: ['word', 'mine', 'ann', 'word-mine', 'word-ann'] },
      { say: 'Where a tile came from is a trait it wears, like any other mark: its origin.', lit: ['ann', 'bo'] },
      { say: 'An origin can be a chain, drawn as a thread running back through other hives.', lit: ['bo', 'ann', 'thread', 'bo-thread', 'ann-thread'] },
      { say: 'The same word can come from many hands.', lit: ['word', 'mine', 'ann', 'bo', 'word-mine', 'word-ann', 'word-bo'] },
    ],
    code: [{ path: 'hypercomb-core/src/core/molecule-address.ts', from: 'export const moleculeKey', lines: 2 }],
    files: ['documentation/pools-across-hosts.md', 'documentation/hypergraph-molecule-lineage.md', 'hypercomb-core/src/core/molecule-address.ts'],
  },

  'presentation/simple/opening/fill': {
    eyebrow: 'fill',
    headline: 'Move six: the cube fills',
    sub: 'Every tile is a point, and the points fill a cube. We never drew the cube.',
    picture: {
      label: 'Three directions, words, versions and origins, filling a cube',
      nodes: [
        { id: 'cube', label: 'cube', sub: 'never drawn', x: 320, y: 190, r: 52 },
        { id: 'words', label: 'words', sub: 'the layer', kind: 'box', x: 110, y: 300, w: 150 },
        { id: 'versions', label: 'versions', sub: 'the signature', kind: 'box', x: 320, y: 60, w: 150 },
        { id: 'origins', label: 'origins', sub: 'where from', kind: 'box', x: 530, y: 300, w: 150 },
      ],
      edges: [['words', 'cube'], ['versions', 'cube'], ['origins', 'cube']],
    },
    beats: [
      { say: 'Every tile is now a point: a word, at a version, from an origin.', lit: ['words', 'versions', 'origins'] },
      { say: 'The words run one way, the versions another, the origins a third.', lit: ['words', 'versions', 'origins', 'words-cube', 'versions-cube', 'origins-cube'] },
      { say: 'The points fill a cube.', lit: ['cube', 'words-cube', 'versions-cube', 'origins-cube'] },
      { say: 'No cube was drawn. The primitive was repeated in three directions, and this is what that looks like.', lit: ['cube'] },
    ],
    code: [],
    files: ['documentation/superimposition.md'],
  },

  'presentation/simple/opening/tesseract': {
    eyebrow: 'tesseract',
    headline: 'Move seven: every other direction',
    sub: 'Meaning and traits add more directions. Everything here is the same thing, used again.',
    picture: {
      label: 'More traits as more directions, a fourth making a tesseract',
      nodes: [
        { id: 'cube', label: 'cube', x: 200, y: 190, r: 46 },
        { id: 'tess', label: 'tesseract', sub: 'a fourth trait', x: 460, y: 190, r: 54 },
        { id: 'locale', label: 'locale', kind: 'box', x: 110, y: 60, w: 120 },
        { id: 'platform', label: 'platform', kind: 'box', x: 290, y: 60, w: 120 },
        { id: 'audience', label: 'audience', kind: 'box', x: 110, y: 320, w: 120 },
        { id: 'reviews', label: 'reviews', kind: 'box', x: 290, y: 320, w: 120 },
      ],
      edges: [['locale', 'cube'], ['platform', 'cube'], ['audience', 'cube'], ['reviews', 'cube'], ['cube', 'tess']],
    },
    beats: [
      { say: 'One point opens its meta layer. Whatever it says is another word that can divide the points.', lit: ['cube'] },
      { say: 'Locale, platform, audience, reviews: traits, exactly as origin is.', lit: ['locale', 'platform', 'audience', 'reviews', 'locale-cube', 'platform-cube', 'audience-cube', 'reviews-cube'] },
      { say: 'A trait picker chooses any three to draw as the cube\'s directions.', lit: ['cube', 'locale', 'platform', 'locale-cube', 'platform-cube'] },
      { say: 'Add a fourth, and the cube becomes a tesseract: a cube inside a cube.', lit: ['cube', 'tess', 'cube-tess'] },
      { say: 'Everything here is the same thing, used again.', lit: ['cube', 'tess', 'locale', 'platform', 'audience', 'reviews', 'cube-tess', 'locale-cube', 'platform-cube', 'audience-cube', 'reviews-cube'] },
    ],
    code: [{ path: 'hypercomb-core/src/core/trait.ts', from: 'export interface TraitWant', lines: 2 }],
    files: ['documentation/traits.md', 'documentation/superimposition.md', 'hypercomb-core/src/core/trait.ts'],
  },

  // ── the top: the presentation and its six values ──────────────────────

  'presentation': {
    code: [],
    files: ['documentation/living-presentation.md'],
  },

  'presentation/simple': {
    code: [{ path: 'hypercomb-core/src/core/life-primitive.ts', from: 'export type LifeLayer = {', lines: 5 }],
    files: ['documentation/life-primitive.md', 'documentation/the-algorithm-is-the-application.md'],
  },

  'presentation/organized': {
    code: [{ path: 'hypercomb-essentials/src/commands/layout.ts', from: 'export function leftOut', lines: 3 }],
    files: ['documentation/history-sigbag-as-root.md', 'documentation/traits.md', 'documentation/layout-templates.md', 'hypercomb-essentials/src/commands/layout.ts'],
  },

  'presentation/collaborative': {
    code: [],
    files: ['documentation/domain-claim.md', 'documentation/publishing-a-revision.md', 'documentation/pools-across-hosts.md'],
  },

  'presentation/intelligent': {
    code: [],
    files: ['documentation/every-act-has-a-word.md', 'documentation/speak-dont-bridge.md', 'documentation/agents.md'],
  },

  'presentation/accessible': {
    code: [],
    files: ['documentation/read-only-deployment.md', 'documentation/no-third-party-requests.md', 'documentation/mobile-one-column.md'],
  },

  'presentation/localized': {
    eyebrow: 'localized',
    headline: 'Localized',
    sub: 'The hive speaks your language: the community translates it, and anyone can add their own.',
    picture: hub('localized', ['translating', 'locale'], 'Localized and its two parts'),
    beats: [
      { say: 'Localized means the hive speaks your language.', lit: ['localized'] },
      { say: 'Translations come from the community, and a hive fills in the words it is missing.', lit: lit('localized', 'translating') },
      { say: 'Your language is one more direction you can choose, like any other trait.', lit: lit('localized', 'locale') },
    ],
    code: [],
    files: ['documentation/community-translations.md', 'documentation/cell-localization.md'],
  },

  // ── the rest of simple, and organized ─────────────────────────────────

  'presentation/simple/act': {
    code: [
      { path: 'hypercomb-core/src/core/molecule-address.ts', from: 'export const moleculeAddress', lines: 5 },
      { path: 'hypercomb-essentials/src/history/history.service.ts', from: '  public readonly currentLayerAt = async (', lines: 4 },
    ],
    files: ['documentation/the-algorithm-is-the-application.md', 'documentation/speak-dont-bridge.md', 'hypercomb-core/src/core/molecule-address.ts'],
  },

  'presentation/organized/heart': {
    code: [{ path: 'hypercomb-essentials/src/history/history.service.ts', from: ' * One history entry.', lines: 9 }],
    files: ['documentation/history-sigbag-as-root.md', 'documentation/revision-mode.md'],
  },

  'presentation/organized/history': {
    code: [{ path: 'hypercomb-essentials/src/history/history-cursor.service.ts', from: '// Layer-based history cursor.', lines: 6 }],
    files: ['documentation/universal-history-plan.md', 'documentation/hive-snapshots.md', 'documentation/revision-mode.md'],
  },

  'presentation/organized/build': {
    eyebrow: 'build',
    headline: 'Build',
    sub: 'A piece of work is sealed as one build, with a name you can return to.',
    picture: {
      label: 'A pass of work sealed as one named build, which can be returned to',
      nodes: [
        { id: 'work', label: 'a pass of work', sub: 'many changes', kind: 'box', x: 130, y: 180, w: 170 },
        { id: 'build', label: 'builds', sub: 'one name', x: 330, y: 180, r: 44 },
        { id: 'named', label: 'opening-v2', sub: 'sealed', kind: 'box', x: 530, y: 110, w: 150 },
        { id: 'revert', label: 'builds revert', sub: 'live again', kind: 'box', x: 530, y: 260, w: 150 },
      ],
      edges: [['work', 'build'], ['build', 'named'], ['named', 'revert']],
    },
    beats: [
      { say: 'Working on a branch makes many small changes.', lit: ['work'] },
      { say: 'Saying builds with a name seals the whole branch as one build.', lit: ['work', 'build', 'named', 'work-build', 'build-named'] },
      { say: 'Sealing an unchanged branch changes nothing; the same build has the same name.', lit: ['named'] },
      { say: 'Builds revert makes an old build live again, as a new step: nothing rewinds.', lit: ['named', 'revert', 'named-revert'] },
    ],
    code: [{ path: 'hypercomb-essentials/src/commands/builds.queen.ts', from: '  async #record(label: string): Promise<void> {', lines: 12 }],
    files: ['documentation/build-revisions.md', 'documentation/publishing-a-revision.md', 'hypercomb-essentials/src/commands/builds.queen.ts'],
  },

  'presentation/organized/layout': {
    eyebrow: 'layout',
    headline: 'Layout',
    sub: 'A layout decides what shows. A child left out is hidden, never deleted.',
    picture: {
      label: 'A layout naming three of four children, in order; the fourth left out',
      nodes: [
        { id: 'layout', label: 'layout', sub: 'a list of words', kind: 'box', x: 320, y: 70, w: 190 },
        { id: 'a', label: 'primitive', sub: 'seat 0', x: 130, y: 230, r: 40 },
        { id: 'b', label: 'act', sub: 'seat 1', x: 270, y: 230, r: 40 },
        { id: 'c', label: 'opening', sub: 'seat 2', x: 410, y: 230, r: 40 },
        { id: 'x', label: 'extra', sub: 'left out', x: 550, y: 230, r: 40 },
      ],
      edges: [['layout', 'a'], ['layout', 'b'], ['layout', 'c']],
    },
    beats: [
      { say: 'A layout is a list of the words a layer shows, in order.', lit: ['layout'] },
      { say: 'The children those words name are shown, and seated in that order.', lit: ['layout', 'a', 'b', 'c', 'layout-a', 'layout-b', 'layout-c'] },
      { say: 'Anything else stays where it is, untouched. It is only left out.', lit: ['x'] },
      { say: 'Every layout is a version of the layer, so changing it can be undone.', lit: ['layout'] },
      { say: 'And one layout can be given to many tiles, by its signature: layout from another tile.', lit: ['layout', 'a', 'b', 'c', 'layout-a', 'layout-b', 'layout-c'] },
    ],
    code: [{ path: 'hypercomb-essentials/src/commands/layout.ts', from: 'export function layoutSeats', lines: 9 }],
    files: ['documentation/layout-templates.md', 'documentation/template-addressing.md', 'hypercomb-essentials/src/commands/layout.ts', 'hypercomb-essentials/src/commands/layout.queen.ts'],
  },

  'presentation/organized/trait': {
    eyebrow: 'trait',
    headline: 'Trait',
    sub: 'A trait is a place a tile leaves open, waiting for whatever fills it.',
    picture: {
      label: 'A tile with open traits, one filled by a child, one by a choice, one still waiting',
      nodes: [
        { id: 'tile', label: 'card', sub: 'a creation', x: 320, y: 80, r: 44 },
        { id: 'portrait', label: 'portrait', sub: 'a child fills it', x: 140, y: 260, r: 42 },
        { id: 'tagline', label: 'tagline', sub: 'your choice', x: 320, y: 260, r: 42 },
        { id: 'contact', label: 'contact', sub: 'waiting', x: 500, y: 260, r: 42 },
      ],
      edges: [['tile', 'portrait'], ['tile', 'tagline'], ['tile', 'contact']],
    },
    beats: [
      { say: 'A trait is a word a tile leaves open: a place for something to go.', lit: ['tile'] },
      { say: 'A child with that name fills it.', lit: ['tile', 'portrait', 'tile-portrait'] },
      { say: 'Or you choose a filler from anywhere, and that choice wins.', lit: ['tile', 'tagline', 'tile-tagline'] },
      { say: 'Unfilled, it waits as a silhouette: a finished state, not a missing piece.', lit: ['contact'] },
      { say: 'A trait is a mark, never a parent: whatever fills it still stands on its own.', lit: lit('tile', 'portrait', 'tagline', 'contact') },
    ],
    code: [
      { path: 'hypercomb-core/src/core/trait.ts', from: 'export interface TraitWant', lines: 2 },
      { path: 'hypercomb-core/src/core/trait.ts', from: 'export const sameTraitWord', lines: 4 },
    ],
    files: ['documentation/traits.md', 'documentation/tag-pools.md', 'hypercomb-core/src/core/trait.ts'],
  },

  'presentation/organized/organization': {
    eyebrow: 'organization',
    headline: 'Organization',
    sub: 'The same pieces can be organized in many ways at once, and none of them moves anything.',
    picture: {
      label: 'The same pieces, read by a layout and by a saved question',
      nodes: [
        { id: 'p1', label: 'photo', kind: 'box', x: 120, y: 150, w: 110 },
        { id: 'p2', label: 'slide', kind: 'box', x: 320, y: 150, w: 110 },
        { id: 'p3', label: 'note', kind: 'box', x: 520, y: 150, w: 110 },
        { id: 'site', label: 'a website', sub: 'a layout of words', x: 200, y: 296, r: 40 },
        { id: 'ask', label: 'a question', sub: 'and · or · not', x: 440, y: 296, r: 40 },
      ],
      edges: [['site', 'p1'], ['site', 'p2'], ['ask', 'p2'], ['ask', 'p3']],
    },
    beats: [
      { say: 'Pieces stand on their own, each with its own look.', lit: ['p1', 'p2', 'p3'] },
      { say: 'A website is one way to organize them: a layout of words.', lit: ['site', 'p1', 'p2', 'site-p1', 'site-p2'] },
      { say: 'A saved question is another: the pieces that answer it.', lit: ['ask', 'p2', 'p3', 'ask-p2', 'ask-p3'] },
      { say: 'Make as many as you like. None of them owns a piece, and nothing moves.', lit: ['site', 'ask', 'p1', 'p2', 'p3', 'site-p1', 'site-p2', 'ask-p2', 'ask-p3'] },
    ],
    code: [],
    files: ['documentation/website-artifact-paradigm.md', 'documentation/known-location-pools.md'],
  },

  // ── collaborative ─────────────────────────────────────────────────────

  'presentation/collaborative/workbench': {
    code: [],
    files: ['documentation/becoming-a-host.md', 'documentation/hosting-from-a-machine.md'],
  },

  'presentation/collaborative/domain': {
    code: [],
    files: ['documentation/domain-claim.md', 'documentation/domain-folder-sharing.md', 'documentation/showcase.md'],
  },

  'presentation/collaborative/trial': {
    eyebrow: 'trial',
    headline: 'Trial',
    sub: 'A trial address lets you try a change in public, on its own, before anyone depends on it.',
    picture: {
      label: 'A change tried at its own try- address, then promoted by one move',
      nodes: [
        { id: 'change', label: 'a change', sub: 'in your hive', kind: 'box', x: 110, y: 180, w: 140 },
        { id: 'trial', label: 'try-name', sub: 'its own address', x: 320, y: 180, r: 50 },
        { id: 'live', label: 'the live name', sub: 'one pointer move', kind: 'box', x: 530, y: 180, w: 160 },
      ],
      edges: [['change', 'trial'], ['trial', 'live']],
    },
    beats: [
      { say: 'A change can be tried before anyone relies on it.', lit: ['change'] },
      { say: 'It opens at its own trial address, on its own origin: no writes, no keys.', lit: ['change', 'trial', 'change-trial'] },
      { say: 'Anyone you show it to can look, and nothing they rely on moves.', lit: ['trial'] },
      { say: 'When it is ready, promoting it is one pointer move.', lit: ['trial', 'live', 'trial-live'] },
    ],
    code: [{ path: 'hypercomb-essentials/src/files/try-page.ts', from: 'export const trialLabel', lines: 7 }],
    files: ['documentation/module-sandbox.md', 'hypercomb-essentials/src/files/try-page.ts'],
  },

  'presentation/collaborative/publishing': {
    code: [{ path: 'hypercomb-essentials/src/sharing/hive-pointer.ts', from: '// Client for the per-publisher hive index', lines: 12 }],
    files: ['documentation/read-only-deployment.md', 'documentation/deployment-stages.md', 'documentation/derivations.md', 'hypercomb-essentials/src/sharing/hive-pointer.ts'],
  },

  'presentation/collaborative/participant': {
    eyebrow: 'participant',
    headline: 'Participant',
    sub: 'Each participant serves their own domain. You can take a whole creation or just one piece of it.',
    picture: {
      label: 'Participants on their own domains; you take a whole creation or one piece',
      nodes: [
        { id: 'ann', label: 'ann', sub: 'her domain', x: 120, y: 110, r: 40 },
        { id: 'bo', label: 'bo', sub: 'his domain', x: 320, y: 110, r: 40 },
        { id: 'cy', label: 'cy', sub: 'their domain', x: 520, y: 110, r: 40 },
        { id: 'whole', label: 'take it whole', kind: 'box', x: 200, y: 290, w: 160 },
        { id: 'piece', label: 'take one piece', kind: 'box', x: 440, y: 290, w: 160 },
      ],
      edges: [['ann', 'whole'], ['bo', 'piece'], ['cy', 'piece']],
    },
    beats: [
      { say: 'Everyone serves their own work, from their own domain.', lit: ['ann', 'bo', 'cy'] },
      { say: 'You can take a creation whole, and it runs as its publisher made it.', lit: ['ann', 'whole', 'ann-whole'] },
      { say: 'Or take just one piece of it, and use it in your own.', lit: ['bo', 'piece', 'bo-piece'] },
      { say: 'When a shared piece changes, you choose whether to take the new version.', lit: ['cy', 'piece', 'cy-piece'] },
    ],
    code: [],
    files: ['documentation/using-a-creation.md', 'documentation/collections-sharing.md'],
  },

  'presentation/collaborative/sharing': {
    eyebrow: 'sharing',
    headline: 'Sharing',
    sub: 'Themes, styles and code are shared without dependencies: parts name words, never each other.',
    picture: {
      label: 'Parts naming theme words; a theme answering them; no part naming another',
      nodes: [
        { id: 'card', label: 'card', sub: 'a part', kind: 'box', x: 120, y: 100, w: 130 },
        { id: 'menu', label: 'menu', sub: 'a part', kind: 'box', x: 120, y: 280, w: 130 },
        { id: 'ink', label: 'ink', sub: 'a word', x: 320, y: 100, r: 38 },
        { id: 'accent', label: 'accent', sub: 'a word', x: 320, y: 280, r: 38 },
        { id: 'theme', label: 'a theme', sub: 'answers the words', kind: 'box', x: 530, y: 190, w: 160 },
      ],
      edges: [['card', 'ink'], ['menu', 'accent'], ['card', 'accent'], ['theme', 'ink'], ['theme', 'accent']],
    },
    beats: [
      { say: 'Parts never name each other. They name only the words they need.', lit: ['card', 'menu'] },
      { say: 'A card asks for ink and accent; a menu asks for accent.', lit: ['card', 'menu', 'ink', 'accent', 'card-ink', 'card-accent', 'menu-accent'] },
      { say: 'A theme is a layer that answers those words.', lit: ['theme', 'ink', 'accent', 'theme-ink', 'theme-accent'] },
      { say: 'Change the theme and everything that names its words follows, with nothing rewired.', lit: ['theme', 'ink', 'accent', 'card', 'menu', 'theme-ink', 'theme-accent', 'card-ink', 'card-accent', 'menu-accent'] },
    ],
    code: [],
    files: ['documentation/website-artifact-paradigm.md', 'documentation/background-themes.md'],
  },

  'presentation/collaborative/discovery': {
    code: [],
    files: ['documentation/pools-across-hosts.md', 'documentation/traits.md', 'documentation/signature-algebra.md'],
  },

  'presentation/collaborative/tapestry': {
    eyebrow: 'tapestry',
    headline: 'Tapestry',
    sub: 'Where two hives hold the same piece, they are joined. Together they form one larger picture.',
    picture: {
      label: 'Hives joined wherever they hold the same signature',
      nodes: [
        { id: 'you', label: 'your hive', x: 120, y: 200, r: 46 },
        { id: 'ann', label: 'ann', x: 320, y: 100, r: 40 },
        { id: 'bo', label: 'bo', x: 320, y: 300, r: 40 },
        { id: 'cy', label: 'cy', x: 520, y: 200, r: 40 },
      ],
      edges: [['you', 'ann'], ['you', 'bo'], ['ann', 'cy'], ['bo', 'cy']],
    },
    beats: [
      { say: 'Every hive is the same shape: the primitive, repeated.', lit: ['you', 'ann', 'bo', 'cy'] },
      { say: 'Wherever two hold the same piece, by the same signature, there is a thread between them.', lit: ['you', 'ann', 'you-ann'] },
      { say: 'Threads run from your root outward, hive to hive.', lit: ['you', 'ann', 'bo', 'cy', 'you-ann', 'you-bo', 'ann-cy', 'bo-cy'] },
      { say: 'Together they weave one larger picture that nobody owns.', lit: ['you', 'ann', 'bo', 'cy', 'you-ann', 'you-bo', 'ann-cy', 'bo-cy'] },
    ],
    code: [],
    files: ['documentation/pools-across-hosts.md', 'documentation/superimposition.md'],
  },

}
