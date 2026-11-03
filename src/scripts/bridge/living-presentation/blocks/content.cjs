// The blocks' content, by route (tree.cjs names the tiles; page.cjs draws each
// block). The narrated tour is the standard (tour.cjs): a tile one of its
// scenes explains SHOWS THAT SCENE, so its block here says nothing the scene
// says — no headline, no narration, no figure — and build.cjs refuses one that
// would. It may add only what the scene does not:
//
//   live          pictures taken in a running hive: [{ shot, title, caption, alt }]
//                 (blocks/captures/<shot>.webp: captures.cjs stages the ones a
//                 sentence can show in an empty hive; the pictures of a lived-in
//                 hive were taken by hand in the author's own, in Edge)
//   try           a live part, computed in the page, asking nothing of the network
//   code          excerpts quoted from the repo at plant time: { path, from, lines }
//                 (`from` is the first line's text, so an excerpt follows the code)
//   files         the documents and source the block explains, attached to its
//                 tile as included files (paths from src/)
//
// A tile no scene explains speaks in the tour's voice, in the same parts:
//
//   eyebrow       a few words over the headline, as the tour's ("move one")
//   headline      one line, its key word in *emphasis*
//   sub           one sentence under the figure
//   plate         its figure, drawn by hand (blocks/plates/<plate>.cjs)
//   beats         the narration: one sentence each, and the plate parts it lights

/** Light a tile with some of its parts, and the wires between. */
const lit = (top, ...names) => [top, ...names, ...names.map(n => `${top}-${n}`)]

const PRIMITIVE_ALL = ['hypercomb', 'word', 'signature', 'layer', 'meta', 'hypercomb-word', 'hypercomb-signature', 'hypercomb-layer', 'hypercomb-meta']
const MOVES = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7']
const MOVE_WIRES = MOVES.slice(1).map((m, i) => `${MOVES[i]}-${m}`)

module.exports = {
  // ── the top: scenes 1 and 2 open it, 20 to 25 close it ─────────────────

  'presentation': {
    live: [
      { shot: 'presentation-in-your-hive', title: 'the presentation, as tiles', caption: 'The six values as hexagons in the hive this presentation was written in, beside the pictures it is still collecting. Every page here is one of these tiles, opened.' },
    ],
    files: ['documentation/living-presentation.md'],
  },

  // ── simple ─────────────────────────────────────────────────────────────

  'presentation/simple': {
    live: [
      { shot: 'hive-of-pictures', title: 'a hive of picture tiles', caption: 'A hive in use: every hexagon a tile, most of them wearing a picture, each one a word you can step into.' },
    ],
    code: [{ path: 'hypercomb-core/src/core/life-primitive.ts', from: 'export type LifeLayer = {', lines: 5 }],
    files: ['documentation/life-primitive.md', 'documentation/the-algorithm-is-the-application.md'],
  },

  'presentation/simple/primitive': {
    live: [
      { shot: 'the-tile-editor', title: 'one tile, opened', caption: 'One tile in its editor: a name, a picture, a border, a link, and the words beside it in the rail. Every tile in the hive is these same few parts.' },
    ],
    code: [
      { path: 'hypercomb-core/src/core/life-primitive.ts', from: 'export type MetaEnvelope = {', lines: 16 },
      { path: 'hypercomb-core/src/core/canonical-layer.ts', from: 'export type CanonicalLayerContent = {', lines: 5 },
    ],
    files: ['documentation/life-primitive.md', 'hypercomb-core/src/core/life-primitive.ts'],
  },

  'presentation/simple/primitive/word': {
    eyebrow: 'the name',
    headline: 'A word is an *address*',
    sub: 'The same word finds the same place, anywhere.',
    plate: 'word-to-address',
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
    eyebrow: 'the children',
    headline: 'Words under a *word*',
    sub: 'Every tile can hold a layer of its own.',
    plate: 'layer-and-versions',
    live: [
      { shot: 'a-layer-of-pictures', title: 'a layer', caption: 'The words under one word, laid out as picture tiles. Each of them can hold a layer of its own.' },
    ],
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
    eyebrow: 'the meaning',
    headline: 'Meaning, *wrapped* around',
    sub: 'What a tile means is said where it is needed, and kept in versions like everything else.',
    plate: 'meta-envelope',
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

  'presentation/simple/act': {
    live: [
      { shot: 'a-tile-and-its-acts', title: 'a tile and its acts', caption: 'Hover a tile and its acts appear: shelf, edit, website, notes, link, remove. Each is also a word you can type.' },
    ],
    code: [
      { path: 'hypercomb-core/src/core/molecule-address.ts', from: 'export const moleculeAddress', lines: 5 },
      { path: 'hypercomb-essentials/src/history/history.service.ts', from: '  public readonly currentLayerAt = async (', lines: 4 },
    ],
    files: ['documentation/the-algorithm-is-the-application.md', 'documentation/speak-dont-bridge.md', 'hypercomb-core/src/core/molecule-address.ts'],
  },

  // ── the opening: seven moves, from one hexagon to the cube ──────────────
  // (living-presentation.md, "From one hexagon to the cube, in seven moves")

  'presentation/simple/opening': {
    eyebrow: 'the opening',
    headline: 'From one hexagon to a *cube*',
    sub: 'Seven moves, and a cube that was never drawn.',
    plate: 'seven-moves',
    beats: [
      { say: 'The cube is not saved for later. It is built first, on screen, from the primitive.', lit: ['m1'] },
      { say: 'Each part of the primitive gives a direction, so no axis has to be invented.', lit: ['m1', 'm2', 'm3', 'm1-m2', 'm2-m3'] },
      { say: 'The layer gives breadth and depth of words; the signature gives versions; origin gives width.', lit: ['m2', 'm3', 'm4', 'm5', 'm2-m3', 'm3-m4', 'm4-m5'] },
      { say: 'Then the points fill a cube, and every trait is one more direction.', lit: ['m6', 'm7', 'm5-m6', 'm6-m7'] },
      { say: 'Each move ends on one plain sentence. Step into a move to see it.', lit: [...MOVES, ...MOVE_WIRES] },
    ],
    files: ['documentation/living-presentation.md'],
  },

  'presentation/simple/opening/hexagon': {
    eyebrow: 'move one',
    headline: 'Only a *name*',
    sub: 'One hexagon, named hypercomb.',
    plate: 'one-hexagon',
    beats: [
      { say: 'Hypercomb sits alone.', lit: ['hypercomb'] },
      { say: 'It opens into its four parts: word, signature, layer, and meta.', lit: PRIMITIVE_ALL },
      { say: 'Nothing else is introduced, now or later. Every move after this is the same tile again.', lit: ['hypercomb'] },
      { say: 'This is hypercomb, and for now it is only a name.', lit: ['hypercomb', 'word', 'hypercomb-word'] },
    ],
    code: [{ path: 'hypercomb-core/src/core/life-primitive.ts', from: 'export type LifeLayer = {', lines: 5 }],
    files: ['documentation/life-primitive.md', 'hypercomb-core/src/core/life-primitive.ts'],
  },

  'presentation/simple/opening/row': {
    eyebrow: 'move two',
    headline: 'A *row* of words',
    sub: 'A layer is the words that sit under one word.',
    plate: 'six-in-a-row',
    beats: [
      { say: 'Under the tile, its layer lays out as a row.', lit: ['top'] },
      { say: 'Six values, side by side: simple, organized, collaborative, intelligent, accessible, localized.', lit: lit('top', 'v1', 'v2', 'v3', 'v4', 'v5', 'v6') },
      { say: 'Each one opens to the same four parts. The same shape, six more times, proves the shape.', lit: ['v1', 'v2', 'v3', 'v4', 'v5', 'v6'] },
      { say: 'This is the word direction: a row of words under one word.', lit: lit('top', 'v1', 'v6') },
      { say: 'A layer is the words that sit under one word.', lit: lit('top', 'v1', 'v2', 'v3', 'v4', 'v5', 'v6') },
    ],
    code: [{ path: 'hypercomb-core/src/core/canonical-layer.ts', from: 'export type CanonicalLayerContent = {', lines: 5 }],
    files: ['documentation/concepts.md', 'hypercomb-core/src/core/canonical-layer.ts'],
  },

  'presentation/simple/opening/stack': {
    eyebrow: 'move three',
    headline: 'Rows under *rows*',
    sub: 'Every word can hold a layer of its own.',
    plate: 'rows-under-rows',
    beats: [
      { say: 'Each value opens into a row of its own.', lit: lit('a', 'a1', 'a2') },
      { say: 'And each of those is a tile with a layer, so there are rows under rows.', lit: [...lit('a', 'a1', 'a2'), ...lit('b', 'b1', 'b2'), ...lit('c', 'c1', 'c2')] },
      { say: 'The plane becomes a stack of planes.', lit: ['a1', 'a2', 'b1', 'b2', 'c1', 'c2'] },
      { say: 'A path from the top reads aloud: simple, primitive, word.', lit: lit('a', 'a1') },
      { say: 'Every word can hold a layer of its own.', lit: [...lit('a', 'a1', 'a2'), ...lit('b', 'b1', 'b2'), ...lit('c', 'c1', 'c2')] },
    ],
    code: [{ path: 'hypercomb-core/src/core/lineage-key.ts', from: 'export const lineageKey', lines: 4 }],
    files: ['documentation/concepts.md', 'hypercomb-core/src/core/lineage-key.ts'],
  },

  'presentation/simple/opening/column': {
    eyebrow: 'move four',
    headline: 'A *column* of versions',
    sub: 'Nothing is replaced. Every change is kept, and the newest is the heart.',
    plate: 'versions-in-a-column',
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
    eyebrow: 'move five',
    headline: 'One word, many *hands*',
    sub: 'The same word can come from many hands.',
    plate: 'one-word-many-origins',
    beats: [
      { say: 'The same word can be answered by a tile from somewhere else.', lit: lit('word', 'mine') },
      { say: 'Your own, or one replicated from someone you follow.', lit: lit('word', 'mine', 'ann') },
      { say: 'Where a tile came from is a trait it wears, like any other mark: its origin.', lit: ['ann', 'bo'] },
      { say: 'An origin can be a chain, drawn as a thread running back through other hives.', lit: ['bo', 'ann', 'thread', 'bo-thread', 'ann-thread'] },
      { say: 'The same word can come from many hands.', lit: lit('word', 'mine', 'ann', 'bo') },
    ],
    code: [{ path: 'hypercomb-core/src/core/molecule-address.ts', from: 'export const moleculeKey', lines: 2 }],
    files: ['documentation/pools-across-hosts.md', 'documentation/hypergraph-molecule-lineage.md', 'hypercomb-core/src/core/molecule-address.ts'],
  },

  'presentation/simple/opening/fill': {
    eyebrow: 'move six',
    headline: 'The cube *fills*',
    sub: 'Every tile is a point, and the points fill a cube. We never drew the cube.',
    plate: 'points-fill-a-cube',
    beats: [
      { say: 'Every tile is now a point: a word, at a version, from an origin.', lit: ['words', 'versions', 'origins'] },
      { say: 'The words run one way, the versions another, the origins a third.', lit: ['words', 'versions', 'origins', 'words-cube', 'versions-cube', 'origins-cube'] },
      { say: 'The points fill a cube.', lit: ['cube', 'words-cube', 'versions-cube', 'origins-cube'] },
      { say: 'No cube was drawn. The primitive was repeated in three directions, and this is what that looks like.', lit: ['cube'] },
    ],
    files: ['documentation/superimposition.md'],
  },

  'presentation/simple/opening/tesseract': {
    eyebrow: 'move seven',
    headline: 'Every other *direction*',
    sub: 'Meaning and traits add more directions. Everything here is the same thing, used again.',
    plate: 'cube-to-tesseract',
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

  // ── organized ──────────────────────────────────────────────────────────

  'presentation/organized': {
    code: [{ path: 'hypercomb-essentials/src/commands/layout.ts', from: 'export function leftOut', lines: 3 }],
    files: ['documentation/history-sigbag-as-root.md', 'documentation/traits.md', 'documentation/layout-templates.md', 'hypercomb-essentials/src/commands/layout.ts'],
  },

  'presentation/organized/heart': {
    code: [{ path: 'hypercomb-essentials/src/history/history.service.ts', from: ' * One history entry.', lines: 9 }],
    files: ['documentation/history-sigbag-as-root.md', 'documentation/revision-mode.md'],
  },

  'presentation/organized/history': {
    live: [
      { shot: 'history-of-a-layer', title: 'history, open', caption: 'One layer with 478 versions, newest on top: every tile added, every reorder, every website change. Each is a step you can go back to, and none of them is ever removed.' },
    ],
    code: [{ path: 'hypercomb-essentials/src/history/history-cursor.service.ts', from: '// Layer-based history cursor.', lines: 6 }],
    files: ['documentation/universal-history-plan.md', 'documentation/hive-snapshots.md', 'documentation/revision-mode.md'],
  },

  'presentation/organized/build': {
    eyebrow: 'sealed work',
    headline: 'A build you can *return* to',
    sub: 'A piece of work is sealed as one build, with a name you can come back to.',
    plate: 'work-sealed-as-a-build',
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
    eyebrow: 'what shows',
    headline: 'Left out, never *deleted*',
    sub: 'A layout decides what shows, and in what order.',
    plate: 'layout-seats',
    live: [
      { shot: 'layout-on', title: 'layout on', caption: 'Layout on: the six words the layout names, seated in its order. The tile called notes is still there.' },
      { shot: 'layout-off', title: 'layout off', caption: 'Layout off: every child shows, notes among them. Nothing was deleted, and nothing was moved.' },
    ],
    beats: [
      { say: 'A layout is a list of the words a layer shows, in order.', lit: ['layout'] },
      { say: 'The children those words name are shown, and seated in that order.', lit: lit('layout', 'a', 'b', 'c') },
      { say: 'Anything else stays where it is, untouched. It is only left out.', lit: ['x'] },
      { say: 'Every layout is a version of the layer, so changing it can be undone.', lit: ['layout'] },
      { say: 'And one layout can be given to many tiles, by its signature: layout from another tile.', lit: lit('layout', 'a', 'b', 'c') },
    ],
    code: [{ path: 'hypercomb-essentials/src/commands/layout.ts', from: 'export function layoutSeats', lines: 9 }],
    files: ['documentation/layout-templates.md', 'documentation/template-addressing.md', 'hypercomb-essentials/src/commands/layout.ts', 'hypercomb-essentials/src/commands/layout.queen.ts'],
  },

  'presentation/organized/trait': {
    eyebrow: 'an open place',
    headline: 'A place left *open*',
    sub: 'A trait waits for whatever fills it.',
    plate: 'open-traits',
    live: [
      { shot: 'trait-silhouette', title: 'a trait waiting', caption: 'Three traits given, one tile hidden: contact stays as a silhouette, a place still open for whatever fills it.' },
    ],
    beats: [
      { say: 'A trait is a word a tile leaves open: a place for something to go.', lit: ['tile'] },
      { say: 'A child with that name fills it.', lit: lit('tile', 'portrait') },
      { say: 'Or you choose a filler from anywhere, and that choice wins.', lit: lit('tile', 'tagline') },
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
    eyebrow: 'many ways at once',
    headline: 'Organized, and nothing *moves*',
    sub: 'The same pieces can be organized many ways at once.',
    plate: 'two-ways-to-organize',
    live: [
      { shot: 'a-tile-as-its-website', title: 'a tile as its website', caption: 'The same tile opened as a website: a card made of its own pieces. Switch back and the hexagons are all still there.' },
    ],
    beats: [
      { say: 'Pieces stand on their own, each with its own look.', lit: ['p1', 'p2', 'p3'] },
      { say: 'A website is one way to organize them: a layout of words.', lit: lit('site', 'p1', 'p2') },
      { say: 'A saved question is another: the pieces that answer it.', lit: lit('ask', 'p2', 'p3') },
      { say: 'Make as many as you like. None of them owns a piece, and nothing moves.', lit: [...lit('site', 'p1', 'p2'), ...lit('ask', 'p2', 'p3'), 'p3'] },
    ],
    files: ['documentation/website-artifact-paradigm.md', 'documentation/known-location-pools.md'],
  },

  // ── collaborative ──────────────────────────────────────────────────────

  'presentation/collaborative': {
    files: ['documentation/domain-claim.md', 'documentation/publishing-a-revision.md', 'documentation/pools-across-hosts.md'],
  },

  'presentation/collaborative/workbench': {
    files: ['documentation/becoming-a-host.md', 'documentation/hosting-from-a-machine.md'],
  },

  'presentation/collaborative/domain': {
    live: [
      { shot: 'a-community-domain', title: 'a community on its domain', caption: 'Revolución, a cigar journal built as a hive for its own domain: the journal, the flavour wheel, the lounge and the store are all tiles.' },
    ],
    files: ['documentation/domain-claim.md', 'documentation/domain-folder-sharing.md', 'documentation/showcase.md'],
  },

  'presentation/collaborative/trial': {
    eyebrow: 'before anyone depends on it',
    headline: 'Try it in *public*',
    sub: 'A trial address shows a change on its own, before anyone relies on it.',
    plate: 'trial-address',
    beats: [
      { say: 'A change can be tried before anyone relies on it.', lit: ['change'] },
      { say: 'It opens at its own trial address, on its own origin: no writes, no keys.', lit: lit('change', 'trial') },
      { say: 'Anyone you show it to can look, and nothing they rely on moves.', lit: ['trial'] },
      { say: 'When it is ready, promoting it is one pointer move.', lit: lit('trial', 'live') },
    ],
    code: [{ path: 'hypercomb-essentials/src/files/try-page.ts', from: 'export const trialLabel', lines: 7 }],
    files: ['documentation/module-sandbox.md', 'hypercomb-essentials/src/files/try-page.ts'],
  },

  'presentation/collaborative/publishing': {
    code: [{ path: 'hypercomb-essentials/src/sharing/hive-pointer.ts', from: '// Client for the per-publisher hive index', lines: 12 }],
    files: ['documentation/read-only-deployment.md', 'documentation/deployment-stages.md', 'documentation/derivations.md', 'hypercomb-essentials/src/sharing/hive-pointer.ts'],
  },

  'presentation/collaborative/participant': {
    eyebrow: 'whole or in part',
    headline: 'Take it whole, or one *piece*',
    sub: 'Each participant serves their own domain.',
    plate: 'whole-or-one-piece',
    beats: [
      { say: 'Everyone serves their own work, from their own domain.', lit: ['ann', 'bo', 'cy'] },
      { say: 'You can take a creation whole, and it runs as its publisher made it.', lit: ['ann', 'whole', 'ann-whole'] },
      { say: 'Or take just one piece of it, and use it in your own.', lit: ['bo', 'piece', 'bo-piece'] },
      { say: 'When a shared piece changes, you choose whether to take the new version.', lit: ['cy', 'piece', 'cy-piece'] },
    ],
    files: ['documentation/using-a-creation.md', 'documentation/collections-sharing.md'],
  },

  'presentation/collaborative/sharing': {
    eyebrow: 'no dependencies',
    headline: 'Parts name *words*, never each other',
    sub: 'Themes, styles and code are shared without dependencies.',
    plate: 'parts-name-words',
    beats: [
      { say: 'Parts never name each other. They name only the words they need.', lit: ['card', 'menu'] },
      { say: 'A card asks for ink and accent; a menu asks for accent.', lit: ['card', 'menu', 'ink', 'accent', 'card-ink', 'card-accent', 'menu-accent'] },
      { say: 'A theme is a layer that answers those words.', lit: lit('theme', 'ink', 'accent') },
      { say: 'Change the theme and everything that names its words follows, with nothing rewired.', lit: ['theme', 'ink', 'accent', 'card', 'menu', 'theme-ink', 'theme-accent', 'card-ink', 'card-accent', 'menu-accent'] },
    ],
    files: ['documentation/website-artifact-paradigm.md', 'documentation/background-themes.md'],
  },

  'presentation/collaborative/discovery': {
    files: ['documentation/pools-across-hosts.md', 'documentation/traits.md', 'documentation/signature-algebra.md'],
  },

  'presentation/collaborative/tapestry': {
    eyebrow: 'the larger picture',
    headline: 'One larger *picture*',
    sub: 'Where two hives hold the same piece, they are joined.',
    plate: 'hives-joined',
    beats: [
      { say: 'Every hive is the same shape: the primitive, repeated.', lit: ['you', 'ann', 'bo', 'cy'] },
      { say: 'Wherever two hold the same piece, by the same signature, there is a thread between them.', lit: lit('you', 'ann') },
      { say: 'Threads run from your root outward, hive to hive.', lit: ['you', 'ann', 'bo', 'cy', 'you-ann', 'you-bo', 'ann-cy', 'bo-cy'] },
      { say: 'Together they weave one larger picture that nobody owns.', lit: ['you', 'ann', 'bo', 'cy', 'you-ann', 'you-bo', 'ann-cy', 'bo-cy'] },
    ],
    files: ['documentation/pools-across-hosts.md', 'documentation/superimposition.md'],
  },

  // ── intelligent and accessible: their scenes say it ────────────────────

  'presentation/intelligent/sentence': {
    live: [
      { shot: 'sentence-before-it-runs', title: 'a sentence, waiting', caption: 'An agent asks to say three lines. They wait on the command line, in plain words, until a person presses Enter; Escape declines them, and nothing runs.' },
    ],
  },

  'presentation/intelligent/agent': {
    live: [
      { shot: 'an-agents-sentences-in-chat', title: 'an agent’s sentences, on the record', caption: 'A side session asked to add three meetups. Its lines were shown first, a person pressed Enter, and the conversation keeps every line and what the hive answered.' },
    ],
  },

  'presentation/intelligent': {
    files: ['documentation/every-act-has-a-word.md', 'documentation/speak-dont-bridge.md', 'documentation/agents.md'],
  },

  'presentation/accessible': {
    live: [
      { shot: 'tutorials-beside-the-hive', title: 'lessons beside the hive', caption: 'Forty-five lessons, from creating a first tile to every window, open beside the hive itself. Each one opens the real thing and puts it away again.' },
    ],
    files: ['documentation/read-only-deployment.md', 'documentation/no-third-party-requests.md', 'documentation/mobile-one-column.md'],
  },

  // ── localized: no scene, so it speaks for itself ───────────────────────

  'presentation/localized': {
    eyebrow: 'your language',
    headline: 'The hive speaks *your* language',
    sub: 'The community translates it, and anyone can add their own.',
    plate: 'languages-heal-in',
    live: [
      { shot: 'hive-in-japanese', title: 'the hive in Japanese', caption: 'After language ja, the hive’s own reference speaks Japanese, here filtered to the words about tiles.' },
    ],
    beats: [
      { say: 'Localized means the hive speaks your language.', lit: ['localized'] },
      { say: 'Translations come from the community, and a hive fills in the words it is missing.', lit: lit('localized', 'translating') },
      { say: 'Your language is one more direction you can choose, like any other trait.', lit: lit('localized', 'locale') },
    ],
    files: ['documentation/community-translations.md', 'documentation/cell-localization.md'],
  },
}
