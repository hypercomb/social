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
  'protocol/simple/primitive': {
    live: [
      { shot: 'the-tile-editor', title: 'one tile, opened', caption: 'One tile in its editor: a name, a picture, a border, a link, and its words. Every tile is these same few parts.' },
    ],
    code: [
      { path: 'hypercomb-core/src/core/life-primitive.ts', from: 'export type MetaEnvelope = {', lines: 16 },
      { path: 'hypercomb-core/src/core/canonical-layer.ts', from: 'export type CanonicalLayerContent = {', lines: 5 },
    ],
    files: ['documentation/life-primitive.md', 'hypercomb-core/src/core/life-primitive.ts'],
  },

  'protocol/simple/primitive/word': {
    eyebrow: 'naming',
    headline: 'Any spelling, one *address*',
    sub: 'Letters and digits of every script are kept: café stays café, and chapter 1 is not chapter 2.',
    plate: 'simple-primitive-word',
    figcap: 'three spellings, one address',
    beats: [
      { say: 'You name a tile by typing a word, written however you like.', lit: ['you'] },
      { say: 'The hive folds it first: lower case, one hyphen between words, and stray marks dropped.', lit: ['you', 'you-fold'] },
      { say: 'Then the folded word is signed, and that signature is the word\'s address.', lit: ['you-fold', 'you-sign'] },
      { say: 'Ann and Bo type it their own way, in hives of their own, and each folds it the same.', lit: ['ann', 'bo', 'ann-fold', 'bo-fold'] },
      { say: 'Each signs it alone, and all three land on one address, with no registry to ask.', lit: ['you', 'ann', 'bo', 'you-fold', 'ann-fold', 'bo-fold', 'you-sign', 'ann-sign', 'bo-sign', 'one'] },
    ],
    try: 'word',
    code: [
      { path: 'hypercomb-core/src/core/molecule-address.ts', from: 'export const moleculeKey', lines: 2 },
      { path: 'hypercomb-core/src/core/molecule-address.ts', from: 'export const moleculeAddress', lines: 5 },
    ],
    files: ['documentation/ontology-is-the-name.md', 'documentation/hypergraph-molecule-lineage.md', 'hypercomb-core/src/core/molecule-address.ts', 'hypercomb-core/src/core/lineage-key.ts'],
  },

  'protocol/simple/primitive/signature': {
    try: 'signature',
    code: [
      { path: 'hypercomb-core/src/core/signature.service.ts', from: '  public static async sign(bytes: ArrayBuffer)', lines: 7 },
    ],
    files: ['documentation/signature-system.md', 'documentation/signature-algebra.md', 'hypercomb-core/src/core/signature.service.ts'],
  },

  'protocol/simple/primitive/layer': {
    live: [
      { tiles: ['humanity-centres', 'humanity-centres/participants', 'humanity-centres/places', 'humanity-centres/purse'], title: 'a layer', caption: 'Humanity centres and the words under it, from a hive in use. Each of them can hold a layer of its own.' },
    ],
    eyebrow: 'holding',
    headline: 'A tile, *written* down',
    sub: 'Empty fields are left out entirely, so nothing that is missing can change the bytes.',
    plate: 'simple-primitive-layer',
    figcap: 'one tile, one document',
    beats: [
      { say: 'A tile and the tiles under it are written down as one small document: its layer.', lit: ['tile', 'doc', 'prim', 'kids'] },
      { say: 'It holds the tile\'s name, then each child by a signature, never the child itself.', lit: ['doc', 'prim', 'kids'] },
      { say: 'Name first, then every field in the same order, so the same layer always gets the same signature.', lit: ['doc', 'sig'] },
      { say: 'However much its children hold, a layer stays small, and it reads complete on its own.', lit: ['tile', 'doc', 'sig', 'prim', 'kids'] },
      { say: 'To go deeper, you follow one signature to the next small document, and only when you need it.', lit: ['prim', 'deeper'] },
    ],
    code: [
      { path: 'hypercomb-core/src/core/canonical-layer.ts', from: 'export type CanonicalLayerContent = {', lines: 18 },
    ],
    files: ['documentation/life-primitive.md', 'documentation/concepts.md', 'documentation/history-sigbag-as-root.md', 'documentation/signature-system.md', 'hypercomb-core/src/core/canonical-layer.ts'],
  },

  'protocol/simple/primitive/meta': {
    eyebrow: 'meaning',
    headline: 'Meaning *wraps* the content',
    sub: 'The envelope declares its own kind. Nothing is ever guessed from the bytes.',
    plate: 'simple-primitive-meta',
    figcap: 'a reference, opened',
    beats: [
      { say: 'In a layer, a reference names not the picture itself, but a small envelope around it: the meta.', lit: ['layer', 'ref', 'env'] },
      { say: 'The envelope says what kind of thing it points at: a layer, bytes, a dependency, or a behaviour.', lit: ['env', 'k-layer', 'k-resource', 'k-other'] },
      { say: 'Exactly one of the four is filled in, and its signature is the one place to go next.', lit: ['env', 'k-resource'] },
      { say: 'It also says how the layer holds the picture: here, as its background.', lit: ['ref', 'relation'] },
      { say: 'The picture itself is never touched: meaning is wrapped around the content, never written inside it.', lit: ['k-resource', 'bytes'] },
      { say: 'A child is held the same way: an envelope around a layer, which holds envelopes of its own.', lit: ['layer', 'kids', 'kid-env'] },
    ],
    code: [
      { path: 'hypercomb-core/src/core/life-primitive.ts', from: 'export type MetaEnvelope = {', lines: 16 },
      { path: 'hypercomb-core/src/core/life-primitive.ts', from: 'export const metaPayloadOf', lines: 9 },
    ],
    files: ['documentation/life-primitive.md', 'documentation/ontology-is-the-name.md', 'hypercomb-core/src/core/life-primitive.ts'],
  },
  // ── the opening: seven moves, from one hexagon to the cube ──────────────
  // (living-presentation.md, "From one hexagon to the cube, in seven moves")

  'protocol/simple/opening': {
    eyebrow: 'the opening',
    headline: 'The cube comes *first*',
    plate: 'simple-opening',
    figcap: 'seven moves and their parts',
    beats: [
      { say: 'The opening builds a cube before anything else, and it starts from one hexagon and its word.', lit: ['m1'] },
      { say: 'Its layer gives the first direction: a row of words, then rows under rows.', lit: ['m2', 'm3'] },
      { say: 'Its signature gives the second: each word\'s versions, climbing into a column.', lit: ['m4'] },
      { say: 'Origin, where a tile came from, gives the third: the same word, held in more than one hive.', lit: ['m5'] },
      { say: 'Move six adds no part at all, and move seven turns whatever a meta says into one more direction.', lit: ['m6', 'm7'] },
      { say: 'So every tile you open after this is one point of a cube you have watched being built.', lit: ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7'] },
    ],
    files: ['documentation/living-presentation.md', 'documentation/life-primitive.md'],
  },

  'protocol/simple/opening/hexagon': {
    eyebrow: 'move one',
    headline: 'One hexagon, four *parts*',
    sub: 'A layer that holds a name and nothing else is already complete.',
    plate: 'simple-opening-hexagon',
    figcap: 'hypercomb and its four parts',
    beats: [
      { say: 'It begins with one hexagon, and the word on it is hypercomb.', lit: ['hypercomb'] },
      { say: 'Open it, and it shows four parts: its word, its signature, its meta, and its layer.', lit: ['hypercomb', 'signature', 'meta', 'layer'] },
      { say: 'Its layer is empty, and so is its meta: nothing sits under it, and nothing says what it means.', lit: ['layer', 'meta'] },
      { say: 'So its signature is worked out from the word alone.', lit: ['hypercomb', 'signature'] },
      { say: 'No other kind of thing will appear: every move after this is these four parts again.', lit: ['hypercomb', 'signature', 'meta', 'layer'] },
      { say: 'This is hypercomb, and for now it is only a name.', lit: ['hypercomb'] },
    ],
    code: [
      { path: 'hypercomb-core/src/core/life-primitive.ts', from: 'export type LifeLayer = {', lines: 5 },
    ],
    files: ['documentation/life-primitive.md', 'hypercomb-core/src/core/life-primitive.ts'],
  },

  'protocol/simple/opening/row': {
    eyebrow: 'move two',
    headline: 'The layer becomes a *row*',
    sub: 'These six words were hypercomb.io\'s original title.',
    plate: 'simple-opening-row',
    figcap: 'one word over its row',
    beats: [
      { say: 'Now hypercomb\'s layer fills, and the words under it lay out side by side.', lit: ['hypercomb', 'layer', 'simple', 'organized', 'collaborative', 'intelligent', 'accessible', 'localized'] },
      { say: 'Read across, they make a sentence: hypercomb is simple, organized, collaborative, intelligent, accessible and localized.', lit: ['hypercomb', 'simple', 'organized', 'collaborative', 'intelligent', 'accessible', 'localized'] },
      { say: 'Each one is a tile just like hypercomb, with a word, a signature, a meta and a layer of its own.', lit: ['simple', 'organized', 'collaborative', 'intelligent', 'accessible', 'localized'] },
      { say: 'Across the row is the first direction: words beside words, under the same word.', lit: ['across', 'simple', 'organized', 'collaborative', 'intelligent', 'accessible', 'localized'] },
      { say: 'A layer is the words that sit under one word.', lit: ['hypercomb', 'layer', 'simple', 'organized', 'collaborative', 'intelligent', 'accessible', 'localized'] },
    ],
    code: [
      { path: 'hypercomb-core/src/core/canonical-layer.ts', from: 'export type CanonicalLayerContent = {', lines: 5 },
    ],
    files: ['documentation/life-primitive.md', 'documentation/concepts.md', 'hypercomb-core/src/core/canonical-layer.ts'],
  },

  'protocol/simple/opening/stack': {
    eyebrow: 'move three',
    headline: 'Rows under *rows*',
    sub: 'These rows are this presentation\'s own: the page you are reading is a word on the third plane.',
    plate: 'simple-opening-stack',
    figcap: 'a stack of planes',
    beats: [
      { say: 'Tilt the row, and it becomes a plane: hypercomb\'s layer, seen from the side.', lit: ['hypercomb', 'layer', 'simple', 'name-simple', 'values', 'names'] },
      { say: 'Every word on it is a tile, so every word opens onto a row of its own.', lit: ['simple', 'name-simple', 'values', 'names', 'rows', 'primitive', 'name-primitive'] },
      { say: 'Some of those words hold rows as well, and the single plane becomes a stack of planes.', lit: ['rows', 'primitive', 'name-primitive', 'deeper', 'word', 'name-word'] },
      { say: 'Follow one path down and it reads as a phrase: hypercomb is simple, shown by the primitive, made of a word.', lit: ['hypercomb', 'simple', 'name-simple', 'primitive', 'name-primitive', 'word', 'name-word', 'path'] },
      { say: 'Going deeper adds nothing new: each level is a word holding a layer, exactly like the first.', lit: ['layer', 'values', 'rows', 'deeper'] },
      { say: 'Every word can hold a layer of its own.', lit: ['hypercomb', 'layer', 'simple', 'name-simple', 'values', 'names', 'rows', 'primitive', 'name-primitive', 'deeper', 'word', 'name-word'] },
    ],
    code: [
      { path: 'hypercomb-core/src/core/life-primitive.ts', from: '//     meta -> layer -> meta -> layer -> ...', lines: 5 },
      { path: 'hypercomb-core/src/core/level-roster.ts', from: '/** Canonical child-layer slot names', lines: 4 },
    ],
    files: ['documentation/life-primitive.md', 'documentation/the-algorithm-is-the-application.md', 'hypercomb-core/src/core/life-primitive.ts', 'hypercomb-core/src/core/level-roster.ts'],
  },

  'protocol/simple/opening/column': {
    eyebrow: 'move four',
    headline: 'Each word grows a *column*',
    sub: 'Every step is a whole layer, never a list of edits.',
    plate: 'simple-opening-column',
    figcap: 'versions stacked into columns',
    beats: [
      { say: 'Change something in simple, and its layer is written again, with a new signature.', lit: ['simple-new', 'move'] },
      { say: 'The old layer is not touched. It stays where it was, and the new one sits on top.', lit: ['simple-old', 'simple-new'] },
      { say: 'Every word changes the same way, so each one grows a column as tall as its own history.', lit: ['simple-old', 'simple-new', 'cols', 'hearts'] },
      { say: 'The top of each column is its heart: what every read lands on, and what a publish points to.', lit: ['simple-new', 'hearts'] },
      { say: 'The columns line up only for your eye. One word\'s second step has nothing to do with another\'s.', lit: ['level'] },
      { say: 'Nothing is replaced. Every change is kept, one above the other.', lit: ['simple-old', 'simple-new', 'cols', 'hearts'] },
    ],
    code: [
      { path: 'hypercomb-essentials/src/history/history.service.ts', from: '   * Commit a complete layer snapshot for a lineage.', lines: 17 },
      { path: 'hypercomb-core/src/core/directory-safety.ts', from: 'export const markerName', lines: 4 },
    ],
    files: ['documentation/history-sigbag-as-root.md', 'documentation/revision-mode.md', 'hypercomb-essentials/src/history/history.service.ts', 'hypercomb-core/src/core/directory-safety.ts'],
  },

  'protocol/simple/opening/spread': {
    eyebrow: 'move five',
    headline: 'One word, many *hands*',
    sub: 'A word\'s notes already keep each author\'s history apart; for tiles, and the origin mark, it is planned.',
    plate: 'simple-opening-spread',
    figcap: 'one word, three origins',
    beats: [
      { say: 'Here is simple again: the column you made.', lit: ['you', 'tag-you'] },
      { say: 'Someone you follow made a simple of their own, and it can stand beside yours.', lit: ['ann', 'tag-ann', 'hive-ann'] },
      { say: 'Neither replaces the other. Each keeps its own history and its own heart, at the same word.', lit: ['you', 'ann', 'bo'] },
      { say: 'Where each one came from is a mark it wears, called its origin.', lit: ['tag-you', 'tag-ann', 'tag-bo'] },
      { say: 'An origin can be a chain: bo\'s simple reached you through ann, and its thread runs back through both.', lit: ['bo', 'tag-bo', 'thread', 'hive-ann', 'hive-bo'] },
      { say: 'The same word can come from many hands.', lit: ['you', 'ann', 'bo', 'tag-you', 'tag-ann', 'tag-bo'] },
    ],
    code: [
      { path: 'hypercomb-core/src/core/head-claim.ts', from: 'export interface HeadClaimAddress {', lines: 6 },
      { path: 'hypercomb-essentials/src/notes/notes-facet.ts', from: '// Decided 2026-09-04: a tile\'s notes are a FACET OF ITS WORD,', lines: 8 },
    ],
    files: ['documentation/hypergraph-molecule-lineage.md', 'documentation/pools-across-hosts.md', 'hypercomb-core/src/core/head-claim.ts', 'hypercomb-essentials/src/notes/notes-facet.ts'],
  },

  'protocol/simple/opening/fill': {
    eyebrow: 'move six',
    headline: 'A cube nobody *drew*',
    sub: 'Nothing stores the cube; it is read from the points. A viewer that draws it in the hive is planned.',
    plate: 'simple-opening-fill',
    figcap: 'points in three directions',
    beats: [
      { say: 'Shrink each tile to a point: one word, at one version, from one hand.', lit: ['simple'] },
      { say: 'The words still run across, and each word\'s versions still climb above it.', lit: ['simple', 'front', 'ax-words', 'ax-versions'] },
      { say: 'Behind simple, the other hands\' columns stand where they stood.', lit: ['simple', 'spread', 'ax-origins'] },
      { say: 'Do the same for every word, and every hand behind it, and the points fill a cube.', lit: ['simple', 'front', 'spread', 'rest', 'ax-words', 'ax-versions', 'ax-origins'] },
      { say: 'Nobody drew that cube. It is the primitive, repeated in three directions.', lit: ['hull', 'simple', 'front', 'spread', 'rest'] },
    ],
    files: ['documentation/living-presentation.md', 'documentation/superimposition.md'],
  },

  'protocol/simple/opening/tesseract': {
    eyebrow: 'move seven',
    headline: 'A fourth *direction*',
    sub: 'Marks and the meta layer are built; drawing them as directions, the picker and the tesseract are planned.',
    plate: 'simple-opening-tesseract',
    figcap: 'a cube inside a cube',
    beats: [
      { say: 'Open one point, and its meta layer says more about it.', lit: ['point', 'card', 'three', 'fourth', 'traits'] },
      { say: 'Locale, platform and audience are marks a point can wear, just as origin is, and each can divide the points.', lit: ['card', 'fourth', 'traits'] },
      { say: 'Any three can be drawn as the cube\'s directions. Here they are word, version and origin.', lit: ['card', 'three', 'outer'] },
      { say: 'Add a fourth, and a second cube appears inside the first, each point joined to its twin.', lit: ['card', 'fourth', 'outer', 'joins', 'inner'] },
      { say: 'That is a tesseract. Every further mark is one more direction of the same shape.', lit: ['outer', 'joins', 'inner'] },
      { say: 'Everything here is the same thing, used again.', lit: ['point', 'card', 'three', 'fourth', 'traits', 'outer', 'joins', 'inner'] },
    ],
    code: [
      { path: 'hypercomb-core/src/core/life-primitive.ts', from: '  agent?: string', lines: 5 },
      { path: 'hypercomb-core/src/core/group-signature.ts', from: '// The primitive: a group is named by a MEANING', lines: 6 },
    ],
    files: ['documentation/life-primitive.md', 'documentation/superimposition.md', 'documentation/living-presentation.md', 'hypercomb-core/src/core/life-primitive.ts', 'hypercomb-core/src/core/group-signature.ts'],
  },

  // ── the top: the protocol and its six values ──────────────────────

  'protocol': {
    code: [],
    files: ['documentation/living-presentation.md'],
  },

  'protocol/simple': {
    figures: {
      3: {
        tiles: ['revolucion', 'knowledge', 'room-host', 'scratch-organize', 'play', 'work', 'misc', 'behavior-where-visual'],
        title: 'tiles from a hive in use',
        say: 'Here is what it looks like. Your work sits on a grid of tiles. A tile can hold anything: a note, a picture, a document, a game, a whole website. Open a tile and you step inside it, and every tile can hold a grid of its own. These tiles come from a hive in use: a cigar journal, a library of knowledge, a room for hosting. Tiles inside tiles, as deep as you need.',
      },
    },
    code: [{ path: 'hypercomb-core/src/core/life-primitive.ts', from: 'export type LifeLayer = {', lines: 5 }],
    files: ['documentation/life-primitive.md', 'documentation/the-algorithm-is-the-application.md'],
  },

  'protocol/organized': {
    code: [{ path: 'hypercomb-essentials/src/commands/layout.ts', from: 'export function leftOut', lines: 3 }],
    files: ['documentation/history-sigbag-as-root.md', 'documentation/traits.md', 'documentation/layout-templates.md', 'hypercomb-essentials/src/commands/layout.ts'],
  },

  'protocol/collaborative': {
    code: [],
    files: ['documentation/domain-claim.md', 'documentation/publishing-a-revision.md', 'documentation/pools-across-hosts.md'],
  },

  'protocol/intelligent': {
    code: [],
    files: ['documentation/every-act-has-a-word.md', 'documentation/speak-dont-bridge.md', 'documentation/agents.md'],
  },

  'protocol/accessible': {
    live: [
      { shot: 'tutorials-beside-the-hive', title: 'lessons beside the hive', caption: 'Forty-five lessons, open beside the hive itself. Each one opens the real thing, and puts it away again.' },
    ],
    code: [],
    files: ['documentation/read-only-deployment.md', 'documentation/no-third-party-requests.md', 'documentation/mobile-one-column.md'],
  },

  'protocol/localized': {
    live: [
      { shot: 'hive-in-japanese', title: 'the hive in Japanese', caption: 'After language ja, the hive’s own reference speaks Japanese, here filtered to the words about tiles.' },
    ],
    eyebrow: 'value six',
    headline: 'Your language, in *layers*',
    sub: 'Shown here in Japanese. Every language the hive speaks is read the same way.',
    plate: 'localized',
    figcap: 'three words, three layers',
    beats: [
      { say: 'Every word the hive itself shows you is looked up in your language, each time it is drawn.', lit: ['seen'] },
      { say: 'Beneath lie the words the hive ships with, and where your language has a gap, English shows through.', lit: ['shipped', 'share'] },
      { say: 'The community fills those gaps, and only those, with words its translators publish.', lit: ['community', 'shipped', 'share'] },
      { say: 'Any word you set for yourself lies on top of everything else.', lit: ['yours'] },
      { say: 'Read down each column, and the first word found is the one you see.', lit: ['yours', 'community', 'share', 'seen'] },
    ],
    code: [
      { path: 'hypercomb-runtime/src/i18n.service.ts', from: '    // Check overrides first (user/community layer takes priority)', lines: 9 },
      { path: 'hypercomb-runtime/src/i18n.service.ts', from: '    // Try current locale first, then fallback', lines: 4 },
    ],
    files: ['documentation/community-translations.md', 'documentation/cell-localization.md', 'hypercomb-runtime/src/i18n.service.ts'],
  },

  // ── the rest of simple, and organized ─────────────────────────────────

  'protocol/simple/act': {
    figures: {
      10: {
        tiles: ['revolucion', 'revolucion/journal', 'revolucion/experience', 'revolucion/cigars', 'revolucion/flavor-wheel', 'revolucion/discovery', 'revolucion/community', 'revolucion/insights', 'revolucion/collaborations', 'revolucion/humidor', 'revolucion/mission', 'revolucion/lounge', 'revolucion/store', 'revolucion/meetup', 'revolucion/wholesale'],
        title: 'revolucion, and the names typed under it',
      },
    },
    live: [
      { shot: 'a-tile-and-its-acts', title: 'a tile and its acts', caption: 'Hover a tile and its acts appear: shelf, edit, website, notes, link, remove. Each is also a word you can type.' },
    ],
    code: [
      { path: 'hypercomb-core/src/core/molecule-address.ts', from: 'export const moleculeAddress', lines: 5 },
      { path: 'hypercomb-essentials/src/history/history.service.ts', from: '  public readonly currentLayerAt = async (', lines: 4 },
    ],
    files: ['documentation/the-algorithm-is-the-application.md', 'documentation/speak-dont-bridge.md', 'hypercomb-core/src/core/molecule-address.ts'],
  },

  'protocol/organized/heart': {
    code: [{ path: 'hypercomb-essentials/src/history/history.service.ts', from: ' * One history entry.', lines: 9 }],
    files: ['documentation/history-sigbag-as-root.md', 'documentation/revision-mode.md'],
  },

  'protocol/organized/history': {
    live: [
      { shot: 'history-of-a-layer', title: 'history, open', caption: 'One layer with 478 versions, newest on top. Each is a step you can go back to, and none is ever removed.' },
    ],
    code: [{ path: 'hypercomb-essentials/src/history/history-cursor.service.ts', from: '// Layer-based history cursor.', lines: 6 }],
    files: ['documentation/universal-history-plan.md', 'documentation/hive-snapshots.md', 'documentation/revision-mode.md'],
  },

  'protocol/organized/build': {
    eyebrow: 'one pass',
    headline: 'Many tiles, one *signature*',
    sub: 'A site builder that writes many pages records one on its own, at the end of its pass.',
    plate: 'organized-build',
    figcap: 'a branch sealed as one build',
    beats: [
      { say: 'One pass of work often changes many tiles at once: here, three of the opening\'s seven moves.', lit: ['branch', 'changed'] },
      { say: 'Say builds and a name, and the whole branch is sealed into one signature that covers every tile in it.', lit: ['branch', 'changed', 'say', 'seal'] },
      { say: 'The name and that signature are kept on the branch itself, as one record in its list of builds.', lit: ['seal', 'seven-moves'] },
      { say: 'Seal it again with nothing changed, and nothing is added, because the same tiles give the same signature.', lit: ['seal', 'again', 'seven-moves'] },
      { say: 'Builds revert brings an older build back, after it first records where you are now.', lit: ['first-cut', 'revert'] },
      { say: 'It lands as the newest step, and the build you left stays in the list, ready to bring back.', lit: ['first-cut', 'steps', 'seven-moves', 'revert'] },
    ],
    code: [
      { path: 'hypercomb-essentials/src/history/builds-slot.ts', from: '  const existing = await readBuildsAt(segments)', lines: 10 },
      { path: 'hypercomb-essentials/src/commands/builds.queen.ts', from: '    // The way back is one gesture', lines: 6 },
    ],
    files: ['documentation/build-revisions.md', 'documentation/publishing-a-revision.md', 'hypercomb-essentials/src/commands/builds.queen.ts', 'hypercomb-essentials/src/history/builds-slot.ts'],
  },

  'protocol/organized/layout': {
    live: [
      { shot: 'layout-on-off', title: 'layout on, then off', caption: 'Layout on shows the six named words in order; layout off shows every child again. Nothing was deleted or moved.' },
    ],
    eyebrow: 'what shows',
    headline: 'Named in order, *shown* in order',
    sub: 'The words are the tile\'s trait markers, placed in order with the trait word.',
    plate: 'organized-layout',
    figcap: 'a word list over a layer',
    beats: [
      { say: 'A layout is a short list of words, kept on a tile: the words its layer shows, in order.', lit: ['list'] },
      { say: 'Say layout on, and only the children those words name are shown, seated in the list\'s order.', lit: ['list', 'layer', 'seats'] },
      { say: 'The rest are left out, untouched: say layout off, and every child shows again.', lit: ['out'] },
      { say: 'Every switch is a new version of the layer, so a layout undoes like any other change.', lit: ['list', 'versions'] },
      { say: 'The list has a signature of its own, so another tile can take the same layout, word for word.', lit: ['list', 'from'] },
    ],
    code: [
      { path: 'hypercomb-essentials/src/commands/layout.ts', from: 'export function layoutSeats', lines: 9 },
      { path: 'hypercomb-essentials/src/commands/layout.ts', from: 'export function leftOut', lines: 3 },
    ],
    files: ['documentation/layout-templates.md', 'documentation/template-addressing.md', 'hypercomb-essentials/src/commands/layout.ts', 'hypercomb-essentials/src/commands/layout.queen.ts'],
  },

  'protocol/organized/trait': {
    live: [
      { shot: 'trait-silhouette', title: 'a trait waiting', caption: 'Three traits given, one tile hidden: contact stays as a silhouette, a place still open for whatever fills it.' },
    ],
    eyebrow: 'left open',
    headline: 'Named before it is *filled*',
    sub: 'The same word is the same trait on every server; gathering fillers from the hosts you follow is planned.',
    plate: 'organized-trait',
    figcap: 'three places, three answers',
    beats: [
      { say: 'A trait is a word a tile leaves open, so you can see what it wants before anything fills it.', lit: ['marks', 'card'] },
      { say: 'A child with that name fills it: here, the card\'s own child called portrait.', lit: ['card', 'portrait'] },
      { say: 'Or you choose a filler yourself, from anywhere in your hive, and your choice comes first.', lit: ['card', 'tagline', 'motto'] },
      { say: 'Hide contact\'s tile, and its place stays: a silhouette waits there, and pressing it makes the tile again.', lit: ['contact'] },
      { say: 'A trait is a mark, never a parent, so the portrait stands on its own and can fill another creation too.', lit: ['portrait', 'badge'] },
    ],
    code: [
      { path: 'hypercomb-core/src/core/trait.ts', from: 'export interface TraitWant', lines: 2 },
      { path: 'hypercomb-core/src/core/trait.ts', from: '  const fill = sources.fills.find(', lines: 5 },
    ],
    files: ['documentation/traits.md', 'documentation/tag-pools.md', 'hypercomb-core/src/core/trait.ts'],
  },

  'protocol/organized/organization': {
    live: [
      { shot: 'a-tile-as-its-website', title: 'a tile as its website', caption: 'The same tile opened as a website: a card made of its own pieces. Switch back, and the hexagons are all still there.' },
    ],
    eyebrow: 'many at once',
    headline: 'Gathered, never *contained*',
    sub: 'Keeping a question as a tile, to ask it again later, is planned.',
    plate: 'organized-organization',
    figcap: 'two readings, one set of pieces',
    beats: [
      { say: 'Here are four pieces, each kept where it was made, and each one standing on its own.', lit: ['photo', 'slide', 'note', 'map'] },
      { say: 'A website is one way to organize them: it shows three of them, in an order of its own.', lit: ['site', 'slide', 'photo', 'map'] },
      { say: 'Each piece wears a small mark for that website, holding its place, so the order lives on the mark.', lit: ['site-marks', 'slide', 'photo', 'map'] },
      { say: 'A question is another way: every piece that carries a word, gathered in one flat list.', lit: ['ask', 'ask-marks', 'photo', 'note', 'map'] },
      { say: 'The photo and the map sit in both at once, and neither the website nor the question owns them.', lit: ['site', 'site-marks', 'ask', 'ask-marks', 'photo', 'map'] },
      { say: 'Make a new organization any time: the old one can stay beside it, and removing either removes no piece.', lit: ['photo', 'slide', 'note', 'map'] },
    ],
    code: [
      { path: 'hypercomb-essentials/src/pheromones/enrollment.ts', from: 'export type Enrollment = {', lines: 6 },
    ],
    files: ['documentation/website-artifact-paradigm.md', 'documentation/known-location-pools.md', 'hypercomb-essentials/src/pheromones/enrollment.ts'],
  },

  // ── collaborative ─────────────────────────────────────────────────────

  'protocol/collaborative/workbench': {
    code: [],
    files: ['documentation/becoming-a-host.md', 'documentation/hosting-from-a-machine.md'],
  },

  'protocol/collaborative/domain': {
    live: [
      { shot: 'a-community-domain', title: 'a community on its domain', caption: 'Revolución, a cigar journal built as a hive for its own domain: the journal, the flavour wheel, the lounge and the store are all tiles.' },
    ],
    code: [],
    files: ['documentation/domain-claim.md', 'documentation/domain-folder-sharing.md', 'documentation/showcase.md'],
  },

  'protocol/collaborative/trial': {
    eyebrow: 'a trial address',
    headline: 'Try first, then *promote*',
    sub: 'Proven on a local hive; on a public domain, a trial opens only for a publisher that domain approves.',
    plate: 'collaborative-trial',
    figcap: 'a sealed trial, one pointer',
    beats: [
      { say: 'A change you want people to try opens at its own address: the word try, a dash, and the site\'s name.', lit: ['door', 'files'] },
      { say: 'That address is its own origin, so nothing it does can reach anyone\'s hive.', lit: ['sealed', 'door'] },
      { say: 'The host refuses every write from it, and it holds no keys to sign with.', lit: ['sealed', 'refused'] },
      { say: 'Meanwhile the live name keeps pointing at what people run today.', lit: ['live', 'was'] },
      { say: 'Only you, the publisher, can promote it, and promoting moves the live name to the files the trial already ran.', lit: ['live', 'promote', 'files'] },
      { say: 'Nothing is rebuilt or sent again, so the site now runs exactly what was tried.', lit: ['live', 'promote', 'files', 'door'] },
    ],
    code: [
      { path: 'hypercomb-essentials/src/files/try-page.ts', from: 'export const trialLabel', lines: 7 },
      { path: 'hypercomb-essentials/src/assistant/module.queen.ts', from: '      const root = await ownHiveRoot(host, `${INSTALL_CHANNEL_PREFIX}${name}`)', lines: 9 },
    ],
    files: ['documentation/module-sandbox.md', 'hypercomb-essentials/src/files/try-page.ts', 'hypercomb-core/src/core/sandbox-door.ts', 'hypercomb-essentials/src/assistant/module.queen.ts', 'hypercomb-essentials/src/sharing/hive-pointer.ts'],
  },

  'protocol/collaborative/publishing': {
    live: [
      { tiles: ['work/domains', 'knowledge/replication', 'knowledge/diagrams', 'knowledge/behaviors'], title: 'domains, replication, the shared pieces', caption: 'From a hive in use: its domains, how replication works, and the shared pieces it is built from, each one a tile.' },
    ],
    code: [{ path: 'hypercomb-essentials/src/sharing/hive-pointer.ts', from: '// Client for the per-publisher hive index', lines: 12 }],
    files: ['documentation/read-only-deployment.md', 'documentation/deployment-stages.md', 'documentation/derivations.md', 'hypercomb-essentials/src/sharing/hive-pointer.ts'],
  },

  'protocol/collaborative/participant': {
    eyebrow: 'your choice',
    headline: 'Take it whole, or a *piece*',
    sub: 'Whole packages, and single pieces taken into your own build, work today; the same for every published creation is planned.',
    plate: 'collaborative-participant',
    figcap: 'whole, or one piece',
    beats: [
      { say: 'Ann serves a creation from her own domain: one tile, and the pieces under it.', lit: ['ann'] },
      { say: 'Bo takes it whole, every piece as she made it, so it runs for him exactly as it runs for her.', lit: ['ann', 'bo', 'whole'] },
      { say: 'You have your own build of cards, and you take only the one piece of hers you want.', lit: ['ann', 'you', 'piece'] },
      { say: 'It lands at its own place in your build, and every other piece stays exactly as it was.', lit: ['you', 'landed'] },
      { say: 'When you commit, your mix becomes a build of its own, with its own signature, ready to share.', lit: ['you', 'landed', 'commit'] },
      { say: 'So everyone mixes the pieces that suit them, and each mix still says which piece came from whom.', lit: ['ann', 'bo', 'you', 'whole', 'piece', 'landed', 'commit'] },
    ],
    code: [
      { path: 'hypercomb-runtime/src/acquire.ts', from: ' * TAKE ONE REVISION AT ONE PATH.', lines: 9 },
      { path: 'hypercomb-runtime/src/module-drafts.ts', from: '  // WHAT CHANGES: every pick that shapes what runs here', lines: 9 },
    ],
    files: ['documentation/using-a-creation.md', 'hypercomb-runtime/src/acquire.ts', 'hypercomb-runtime/src/module-drafts.ts'],
  },

  'protocol/collaborative/sharing': {
    eyebrow: 'no dependencies',
    headline: 'Parts meet at a *word*',
    sub: 'The hive\'s own look works this way today; a theme kept as a layer, for the pages you publish, is planned.',
    plate: 'collaborative-sharing',
    figcap: 'parts, words, two themes',
    beats: [
      { say: 'Look inside a card: it holds no colors of its own, only the words it needs, surface and primary.', lit: ['card'] },
      { say: 'A menu needs primary and outline, and neither part knows the other is there.', lit: ['card', 'menu'] },
      { say: 'Those words belong to neither side, so anything that answers them will fit.', lit: ['words'] },
      { say: 'A theme is simply a set of answers, one for every word.', lit: ['words', 'honey'] },
      { say: 'Choose another theme, and that one choice is all that changes, with no part opened or rewired.', lit: ['swap', 'bloom'] },
      { say: 'Everything that names those words follows at once, dressed in the new answers.', lit: ['card', 'menu', 'words', 'bloom', 'swap'] },
    ],
    code: [
      { path: 'hypercomb-core/src/theme.types.ts', from: '// A "theme" is nothing more than a named value-set', lines: 7 },
    ],
    files: ['documentation/website-artifact-paradigm.md', 'documentation/background-themes.md', 'hypercomb-core/src/theme.types.ts'],
  },

  'protocol/collaborative/discovery': {
    code: [],
    files: ['documentation/pools-across-hosts.md', 'documentation/traits.md', 'documentation/signature-algebra.md'],
  },

  'protocol/collaborative/hosting': {
    eyebrow: 'what a host adds',
    headline: 'One word, one address, on *every host*',
    sub: 'Hosts list packages, offerings and attestations this way today; pictures for a tile name are next.',
    plate: 'collaborative-hosting',
    figcap: 'no host, and three hosts',
    beats: [
      { say: 'Without a host, your hive sees only what the people online beside it are showing, for as long as they stay.', lit: ['you', 'online'] },
      { say: 'A host keeps pools of meaning: a word, answered at one address that every host derives the same way.', lit: ['hosts', 'address'] },
      { say: 'Ask any host for that address, and it lists what it holds there, from whoever made it.', lit: ['hosts', 'address', 'pool'] },
      { say: 'Your hive asks every host it follows, and finds those pieces whether or not their makers are online.', lit: ['you', 'found', 'hosts', 'pool'] },
      { say: 'Each piece is checked by its signature and each maker by their own signed index, so no host can make one up.', lit: ['pool', 'address'] },
      { say: 'Running a host, or joining one, is what gives your hive that reach.', lit: ['you', 'found', 'hosts', 'address', 'pool'] },
    ],
    files: ['documentation/pools-across-hosts.md', 'documentation/becoming-a-host.md', 'documentation/hosting-from-a-machine.md'],
  },

  'protocol/collaborative/tapestry': {
    eyebrow: 'the larger picture',
    headline: 'Joined by the same *signature*',
    sub: 'The threads already exist wherever signatures match; drawing the whole tapestry as one view you can turn is planned.',
    plate: 'collaborative-tapestry',
    figcap: 'hives joined by signatures',
    beats: [
      { say: 'Every hive has the same shape, and each one holds pieces of its own.', lit: ['you', 'ann', 'bo', 'cy'] },
      { say: 'Your hive and Ann\'s both hold this piece: the same bytes, so the same signature.', lit: ['you', 'ann', 's1'] },
      { say: 'That match is the thread, and nobody has to draw it, store it, or keep it up.', lit: ['s1', 't1'] },
      { say: 'Ann shares another piece with Bo, Bo shares one with Cy, and every match is one more thread.', lit: ['ann', 'bo', 'cy', 's2', 't2', 's3', 't3', 's4', 't4', 's5', 't5'] },
      { say: 'Followed outward from your hive, the threads weave one picture, larger than any hive, that nobody owns.', lit: ['you', 'ann', 'bo', 'cy', 's1', 's2', 's3', 's4', 's5', 't1', 't2', 't3', 't4', 't5'] },
      { say: 'And a new hive is woven in the moment it takes a single piece from anyone.', lit: ['more', 's1', 's2', 's3', 's4', 's5', 't1', 't2', 't3', 't4', 't5'] },
    ],
    files: ['documentation/pools-across-hosts.md', 'documentation/superimposition.md'],
  },


  'road': {
    eyebrow: 'the road',
    headline: 'Where it *leads*',
    sub: 'One scene per tile, in the order the tour tells them.',
    picture: hub('road', ['question', 'creations', 'market', 'computer', 'yours', 'first-day'], 'The road and its six tiles'),
    beats: [
      { say: 'This is the road: where Hypercomb leads, and how to begin.', lit: ['road'] },
      { say: 'It starts with a question: who decides where your work lives, and who it reaches?', lit: lit('road', 'question') },
      { say: 'Then what people already make with it.', lit: lit('road', 'creations') },
      { say: 'Along the way: an open exchange of ideas, and the hive as a computer.', lit: lit('road', 'market', 'computer') },
      { say: 'And it ends where you begin: the hive is yours, and your first day.', lit: lit('road', 'yours', 'first-day') },
    ],
    files: ['documentation/living-presentation.md'],
  },

  'road/market': {
    eyebrow: 'an exchange of ideas',
    headline: 'Free, or sealed for those you *choose*',
    sub: 'Asking one word across your hosts is built; combining words with and, or and not across them is planned.',
    plate: 'road-market',
    figcap: 'free, sealed, found by word',
    beats: [
      { say: 'This is an open exchange of ideas, and each maker offers theirs from their own domain.', lit: ['maker'] },
      { say: 'Publishing for free is built: it puts a creation at your domain\'s root, and anyone who follows you can take it.', lit: ['maker', 'free'] },
      { say: 'Finding is by word: a word has one address on every host, so asking a word asks every host you follow.', lit: ['word', 'hosts'] },
      { say: 'Nobody\'s list is ranked above another\'s, and nothing is recommended to you.', lit: ['hosts'] },
      { say: 'A sealed branch stays closed until a key opens it, and then it is taken like anything else.', lit: ['sealed', 'key'] },
      { say: 'The word that seals a page to the people you name is built, and it has not yet been run on a live host.', lit: ['maker', 'sealed'] },
      { say: 'Nothing in the hive moves money and no platform takes a cut, so paying a maker happens outside the hive.', lit: ['money'] },
    ],
    code: [
      { path: 'hypercomb-essentials/src/sharing/sealed-publish.ts', from: '//   publish:  closure of the head', lines: 5 },
    ],
    files: ['documentation/presentation-blueprint.md', 'documentation/sealed-audiences.md', 'documentation/pools-across-hosts.md', 'documentation/bee-story/the-economy.md', 'hypercomb-essentials/src/sharing/sealed-publish.ts'],
  },

  'road/computer/machine': {
    eyebrow: 'no shared machine',
    headline: 'A program runs where it is *used*',
    sub: 'A host holds only what was sent to it, so a version lasts because it is copied.',
    plate: 'road-computer-machine',
    figcap: 'one machine, or your own',
    beats: [
      { say: 'A blockchain is one machine that everybody runs: every node repeats every program.', lit: ['chain'] },
      { say: 'And all of them must agree on one order of events before anything counts, which is the cost.', lit: ['chain', 'order'] },
      { say: 'Here there is no shared machine: a program runs where it is used, in your own browser, under your own permissions.', lit: ['own'] },
      { say: 'The only thing everyone agrees on is arithmetic: a file is named by the SHA-256 hash of its bytes, and you check it yourself.', lit: ['own', 'hash'] },
      { say: 'A host serves those bytes and runs nothing for you, so more people do not mean more shared work.', lit: ['host', 'hash'] },
      { say: 'Each person keeps their own version, and two versions simply exist side by side.', lit: ['own', 'versions'] },
      { say: 'The honest limit: with nothing agreed globally, there is no global ledger, so the hive cannot say by itself who paid whom.', lit: ['ledger'] },
    ],
    code: [
      { path: 'hypercomb-core/src/core/signature.service.ts', from: '  public static async sign(bytes: ArrayBuffer): Promise<Signature> {', lines: 7 },
    ],
    files: ['documentation/presentation-blueprint.md', 'documentation/signature-system.md', 'documentation/hosting-from-a-machine.md', 'documentation/collapsed-compute.md', 'hypercomb-core/src/core/signature.service.ts'],
  },

  'road/computer/system': {
    eyebrow: 'in words you know',
    headline: 'An operating system with no *centre*',
    sub: 'Each familiar word points at something real in the hive.',
    plate: 'road-computer-system',
    figcap: 'familiar words, hive words',
    beats: [
      { say: 'Think of the hive as an operating system, where every familiar part points at something real.', lit: ['files', 'folders', 'programs', 'command', 'installing', 'updates', 'network'] },
      { say: 'Files are atoms: bytes stored once, each named by its own signature.', lit: ['files'] },
      { say: 'Folders are layers: a word, and the words under it.', lit: ['folders'] },
      { say: 'Programs are bees: signed modules that a tile turns on.', lit: ['programs'] },
      { say: 'The command line is plain sentences, the same for people and for agents.', lit: ['command'] },
      { say: 'Installing is replication from a host you follow, and updates are notices you take or skip.', lit: ['installing', 'updates'] },
      { say: 'The network is the hosts you chose to follow, and it has no centre.', lit: ['network'] },
      { say: 'Planned, and not built: a single rules screen for accepting code from another domain.', lit: ['rules'] },
    ],
    code: [
      { path: 'hypercomb-essentials/src/sharing/update-scout.service.ts', from: '// Demand-driven by doctrine: one check per boot, no push channel, no', lines: 3 },
    ],
    files: ['documentation/presentation-blueprint.md', 'documentation/code-admission.md', 'documentation/install-by-replication.md', 'documentation/every-act-has-a-word.md', 'hypercomb-essentials/src/sharing/update-scout.service.ts'],
  },


  'protocol/localized/translating': {
    eyebrow: 'the community',
    headline: 'Gaps that *heal*',
    sub: 'What sync fills is kept in your own hive, so it survives a reload, and a host that goes away.',
    plate: 'localized-translating',
    figcap: 'offer, sync, missing',
    beats: [
      { say: 'A translator writes the words her language is missing, in her own hive, as her own.', lit: ['ann'] },
      { say: 'She says language offer, names a host, and her words travel there as one catalog, signed under her key.', lit: ['ann', 'offer'] },
      { say: 'The host lists every catalog for that language, checking each translator\'s signature again before it lists one.', lit: ['offer', 'host'] },
      { say: 'You say language sync, and your hive reads the hosts you follow, keeping a catalog only if every byte matches its name.', lit: ['host', 'sync', 'you'] },
      { say: 'Say language missing and name a host, and it learns which words you still lack, so translators see where they are needed.', lit: ['you', 'missing', 'host', 'ann'] },
      { say: 'Only a person can say these words, so nothing is sent or placed until someone chooses to.', lit: ['ann', 'offer', 'host', 'sync', 'you', 'missing'] },
    ],
    code: [
      { path: 'hypercomb-essentials/src/sharing/community-translations.ts', from: 'export const readCatalog = async', lines: 9 },
      { path: 'hypercomb-runtime/src/i18n.service.ts', from: '    for (const [key, value] of Object.entries(catalog)) {', lines: 6 },
    ],
    files: ['documentation/community-translations.md', 'hypercomb-essentials/src/commands/language.queen.ts', 'hypercomb-essentials/src/sharing/community-translations.ts', 'hypercomb-runtime/src/i18n.service.ts'],
  },

  'protocol/localized/locale': {
    eyebrow: 'a direction',
    headline: 'One name, many *readings*',
    sub: 'Words you give a tile live on the tile itself, so they travel with it, and undo like any change.',
    plate: 'localized-locale',
    figcap: 'names against languages',
    beats: [
      { say: 'A tile has one name, and it keeps that name in every language.', lit: ['names'] },
      { say: 'Lay the languages down the side, and each place a name meets a language holds one reading.', lit: ['names', 'en', 'ja', 'es', 'own', 'meadow'] },
      { say: 'Say language, then Japanese, and every tile is drawn again in its Japanese reading, in a single pass.', lit: ['pick', 'ja', 'own', 'meadow', 'hive'] },
      { say: 'A tile can carry its own words for a language, and they come before anyone else\'s.', lit: ['own', 'hive'] },
      { say: 'Where no reading exists, the tile simply shows its name, so nothing is ever left blank.', lit: ['names', 'meadow', 'hive'] },
      { say: 'Your language changes how the hive reads to you, never what anything is.', lit: ['names', 'pick', 'ja', 'own', 'meadow', 'hive'] },
    ],
    code: [
      { path: 'hypercomb-essentials/src/presentation/tiles/show-cell.drone.ts', from: '  public readonly displayNameFor = (directoryName: string): string => {', lines: 7 },
      { path: 'hypercomb-essentials/src/presentation/tiles/show-cell.drone.ts', from: '    this.onEffect<{ locale: string }>(\'locale:changed\', () => {', lines: 8 },
    ],
    files: ['documentation/cell-localization.md', 'hypercomb-essentials/src/commands/title.queen.ts', 'hypercomb-essentials/src/commands/language.queen.ts', 'hypercomb-runtime/src/i18n.service.ts'],
  },

  'protocol/intelligent/debugging': {
    eyebrow: 'when it breaks',
    headline: 'Debugging is *spoken* too',
    sub: 'Only you can say take, audit or drop: a model never brings someone else\'s code into your hive.',
    plate: 'intelligent-debugging',
    figcap: 'five words, one place',
    beats: [
      { say: 'When something breaks, say module trials, and see every change people are already trying, and what each touches.', lit: ['trials', 'pick'] },
      { say: 'Say module changes and its name, and read that one change file by file: what went out, what came in.', lit: ['pick', 'changes', 'diff'] },
      { say: 'Say module audit, and your own A.I. reads what it would bring beside what you run, and runs none of it.', lit: ['diff', 'audit'] },
      { say: 'Say module take, and that change comes into your own hive, held until you accept it.', lit: ['diff', 'take'] },
      { say: 'If it was the wrong guess, say module drop, and after a reload, that place runs as it did before.', lit: ['drop'] },
      { say: 'You try one change at a time, so when it works, you know exactly which change fixed it.', lit: ['take', 'rest'] },
    ],
    code: [
      { path: 'hypercomb-essentials/src/assistant/module.queen.ts', from: '//   module take <change> [<path>] [@<host>]', lines: 19 },
      { path: 'hypercomb-essentials/src/assistant/module.queen.ts', from: '    if (word === \'drop\') {', lines: 7 },
    ],
    files: ['documentation/module-sandbox.md', 'documentation/living-presentation.md', 'hypercomb-essentials/src/assistant/module.queen.ts'],
  },

  'protocol/intelligent/merging': {
    eyebrow: 'planned',
    headline: 'Two changes, one *choice*',
    sub: 'Planned, not built. Only the clash is named today.',
    plate: 'intelligent-merging',
    figcap: 'three versions, one draft',
    beats: [
      { say: 'You and someone else each changed the same file, starting from the same version.', lit: ['base', 'yours', 'theirs'] },
      { say: 'Today both stay whole, side by side, and since one place runs one version, only one can run there.', lit: ['yours', 'theirs'] },
      { say: 'Say module focus, and the hive already names two trials that change the same file as a clash.', lit: ['yours', 'theirs', 'clash'] },
      { say: 'What is planned: the A.I. reads all three versions, and drafts one that keeps both changes.', lit: ['base', 'yours', 'theirs', 'draft'] },
      { say: 'Like any draft, it would wait for you to accept it, or to keep your own.', lit: ['draft', 'accept', 'keep'] },
      { say: 'Either way, nothing is overwritten: every version, and the draft, keeps its own signature.', lit: ['base', 'yours', 'theirs', 'draft'] },
    ],
    code: [
      { path: 'hypercomb-essentials/src/assistant/module-review.ts', from: 'export const trialClashes', lines: 7 },
    ],
    files: ['documentation/module-sandbox.md', 'documentation/using-a-creation.md', 'hypercomb-essentials/src/assistant/module-review.ts'],
  },

  'protocol/accessible/reader': {
    eyebrow: 'read only',
    headline: 'Reading calls *one* host',
    sub: 'A reader\'s page never even loads the parts its publisher keeps for the people who make things.',
    plate: 'accessible-reader',
    figcap: 'one host, the rest refused',
    beats: [
      { say: 'Open a published presentation, and your browser asks one host for it: the one whose address you opened.', lit: ['host', 'reader'] },
      { say: 'Everything the page shows comes back from that host: its words, its typefaces, its voice and its pictures.', lit: ['host', 'page'] },
      { say: 'An ordinary page would also call out to a font service, a script library and a visitor counter.', lit: ['others'] },
      { say: 'Here, the door a reader comes in by refuses them: it fetches nothing from any host but its own.', lit: ['door', 'others'] },
      { say: 'And the presentation\'s own check fails any page that names another host for even one of its parts.', lit: ['check', 'page'] },
      { say: 'So reading tells no one but the host you chose to read.', lit: ['host', 'reader', 'page'] },
    ],
    code: [
      { path: 'hypercomb-web/src/setup/readonly-network.ts', from: '    if ((target.protocol === \'http:\' || target.protocol === \'https:\') && target.origin !== location.origin) {', lines: 3 },
      { path: 'scripts/bridge/living-presentation/blocks/check.cjs', from: '  for (const m of html.matchAll(/\\b(?:src|data-src)=', lines: 3 },
    ],
    files: ['documentation/no-third-party-requests.md', 'documentation/read-only-deployment.md', 'hypercomb-web/src/setup/readonly-network.ts', 'scripts/bridge/living-presentation/blocks/check.cjs'],
  },

  'protocol/accessible/listening': {
    eyebrow: 'the narration',
    headline: 'Written to be *heard*',
    sub: 'The arrow keys step through the beats, and the space bar plays and pauses.',
    plate: 'accessible-listening',
    figcap: 'one sentence, three ways',
    beats: [
      { say: 'Every page here is told in beats, and each beat is one plain sentence.', lit: ['sentence'] },
      { say: 'When a beat has been recorded, you hear it in the same voice that tells the tour.', lit: ['sentence', 'voice'] },
      { say: 'You read it too: the caption says the same words, and a screen reader announces each one.', lit: ['sentence', 'caption'] },
      { say: 'And the part of the picture it speaks of lights up while it is said.', lit: ['sentence', 'part'] },
      { say: 'Turn the voice off, and the words stay; each one waits as long as it takes to read.', lit: ['mute', 'caption'] },
      { say: 'So every sentence is written for the ear: no symbols, no tables, nothing a voice would stumble on.', lit: ['sentence', 'voice', 'caption', 'part'] },
    ],
    code: [
      { path: 'scripts/bridge/living-presentation/blocks/page.cjs', from: '    const hold = () => { timer = setTimeout(next, readTime(s.say)) }', lines: 7 },
      { path: 'scripts/bridge/living-presentation/blocks/page.cjs', from: '      <div class="caption" aria-live="polite">', lines: 1 },
    ],
    files: ['documentation/living-presentation.md', 'scripts/bridge/living-presentation/blocks/narrate.cjs', 'scripts/bridge/living-presentation/blocks/page.cjs'],
  },

  'protocol/accessible/phone': {
    eyebrow: 'one column',
    headline: 'The same page, *narrower*',
    plate: 'accessible-phone',
    figcap: 'wide screen, then phone',
    beats: [
      { say: 'On a wide screen, a second panel, like a picture from the hive, stands beside the figure.', lit: ['wide', 'figure', 'panel'] },
      { say: 'Its words are sized from the page\'s own width, not the window\'s, so it fits alone or inside a hive.', lit: ['wide', 'phone'] },
      { say: 'When that width narrows to a phone, the panel moves under the figure, into one column.', lit: ['phone', 'figure', 'panel'] },
      { say: 'There the caption is given more room, and the step counter gives way to the controls.', lit: ['caption'] },
      { say: 'The presentation\'s own check opens every page at a phone\'s width, and fails any page that scrolls sideways.', lit: ['phone', 'check'] },
      { say: 'So a phone gets the whole page, not a lesser one: the same words and pictures, one column at a time.', lit: ['phone', 'figure', 'panel', 'caption'] },
    ],
    code: [
      { path: 'scripts/bridge/living-presentation/blocks/page.cjs', from: '@container (max-width:700px){', lines: 11 },
      { path: 'scripts/bridge/living-presentation/blocks/check.cjs', from: '      for (const width of [1280, 390]) {', lines: 13 },
    ],
    files: ['scripts/bridge/living-presentation/blocks/page.cjs', 'scripts/bridge/living-presentation/blocks/check.cjs', 'documentation/living-presentation.md'],
  },

  'protocol/accessible/motion': {
    eyebrow: 'reduced motion',
    headline: 'Less motion, nothing *lost*',
    sub: 'Clips stop playing on their own as well: they move only when you press play.',
    plate: 'accessible-motion',
    figcap: 'one beat, frame by frame',
    beats: [
      { say: 'Some people feel unwell when things slide and fade, so their device can ask every page for less motion.', lit: ['motion', 'still'] },
      { say: 'With motion, the lit part fades up, a line draws itself, and the caption rises into place.', lit: ['motion'] },
      { say: 'With less motion, the same part is simply lit, the line is already whole, and the caption is just there.', lit: ['still'] },
      { say: 'Nothing is lost: the last picture is the same either way, and only the in-between is gone.', lit: ['same'] },
      { say: 'And a page that would play by itself waits instead, for you to step through at your own pace.', lit: ['auto', 'step'] },
      { say: 'Every page in this presentation keeps this rule, and the narrated tour stops its sliding and fading too.', lit: ['still', 'step'] },
    ],
    code: [
      { path: 'scripts/bridge/living-presentation/blocks/page.cjs', from: '@media (prefers-reduced-motion:reduce){', lines: 5 },
      { path: 'scripts/bridge/living-presentation/blocks/page.cjs', from: '  if (!voiced && !still && !returning) setTimeout(', lines: 2 },
    ],
    files: ['scripts/bridge/living-presentation/blocks/page.cjs', 'scripts/presentation/template.html', 'documentation/living-presentation.md'],
  },

  'protocol/intelligent/sentence': {
    live: [
      { shot: 'sentence-before-it-runs', title: 'a sentence, waiting', caption: 'An agent asks to say three lines. They wait on the command line in plain words until a person presses Enter.' },
    ],
  },

  'protocol/intelligent/agent': {
    live: [
      { shot: 'an-agents-sentences-in-chat', title: 'an agent’s sentences, on the record', caption: 'A side session asked to add three meetups. Its lines were shown first, a person pressed Enter, and every line is kept.' },
    ],
  },

  'road/yours': {
    figures: {
      24: {
        tiles: ['knowledge/pheromone-workflow', 'knowledge/ai-inside', 'knowledge/camelflage'],
        title: 'three tiles from a hive in use',
      },
    },
  },
}
