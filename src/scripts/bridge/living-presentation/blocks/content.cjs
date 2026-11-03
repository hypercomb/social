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

module.exports = {
  'presentation/simple/primitive': {
    title: 'The primitive',
    lede: 'There is only one primitive. Everything in Hypercomb is it, used again.',
    picture: { label: 'One hexagon opening into word, signature, layer and meta', nodes: PRIMITIVE_NODES, edges: PRIMITIVE_EDGES },
    beats: [
      { say: 'This is a tile, named hypercomb. For now it is only a name.', lit: ['hypercomb'] },
      { say: 'Open it, and it shows what it is made of: four parts, and nothing else.', lit: ALL },
      { say: 'A word: its name. The same word finds the same place, anywhere.', lit: ['hypercomb', 'word', 'hypercomb-word'] },
      { say: 'A signature: the fingerprint of its bytes.', lit: ['hypercomb', 'signature', 'hypercomb-signature'] },
      { say: 'A layer: the words under it, its children.', lit: ['hypercomb', 'layer', 'hypercomb-layer'] },
      { say: 'A meta layer: what it means, said where it is needed.', lit: ['hypercomb', 'meta', 'hypercomb-meta'] },
      { say: 'A server, a domain, a page, a version: each is this same tile, with different words.', lit: ALL },
    ],
    code: [
      { path: 'hypercomb-core/src/core/life-primitive.ts', from: 'export type MetaEnvelope = {', lines: 16 },
      { path: 'hypercomb-core/src/core/canonical-layer.ts', from: 'export type CanonicalLayerContent = {', lines: 5 },
    ],
    files: ['documentation/life-primitive.md', 'hypercomb-core/src/core/life-primitive.ts'],
  },

  'presentation/simple/primitive/word': {
    title: 'Word',
    lede: 'A tile\'s name. A word is an address: the same word finds the same place, anywhere.',
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
    title: 'Signature',
    lede: 'A fingerprint of the bytes. The same bytes always have the same signature, so they are stored once.',
    picture: {
      label: 'Bytes hashed into a signature; identical bytes share one',
      nodes: [
        { id: 'bytes', label: 'bytes', sub: 'a page, a picture', kind: 'box', x: 120, y: 120, w: 170 },
        { id: 'sha', label: 'SHA-256', x: 320, y: 180 },
        { id: 'sig', label: '64 characters', sub: 'the signature', kind: 'box', x: 520, y: 180, w: 170 },
        { id: 'same', label: 'the same bytes', sub: 'from anyone', kind: 'box', x: 120, y: 260, w: 170 },
      ],
      edges: [['bytes', 'sha'], ['sha', 'sig'], ['same', 'sha']],
    },
    beats: [
      { say: 'Anything stored is bytes.', lit: ['bytes'] },
      { say: 'The bytes go through SHA-256 and come out as 64 characters: the signature.', lit: ['bytes', 'sha', 'sig', 'bytes-sha', 'sha-sig'] },
      { say: 'The same bytes, from anyone, give the same signature. So they are stored once.', lit: ['same', 'sha', 'sig', 'same-sha', 'sha-sig'] },
      { say: 'Change one letter and almost every character changes. Try it below.', lit: ['bytes', 'sig'] },
      { say: 'A reference holds the signature, never the content: small, exact, and never stale.', lit: ['sig'] },
    ],
    try: 'signature',
    code: [
      { path: 'hypercomb-core/src/core/signature.service.ts', from: '  public static async sign(bytes: ArrayBuffer)', lines: 7 },
    ],
    files: ['documentation/signature-system.md', 'documentation/signature-algebra.md', 'hypercomb-core/src/core/signature.service.ts'],
  },

  'presentation/simple/primitive/layer': {
    title: 'Layer',
    lede: 'The words under a word. Every tile can hold a layer of its own.',
    picture: {
      label: 'A layer: a name and its ordered children, kept in versions',
      nodes: [
        { id: 'name', label: 'simple', sub: 'name', x: 320, y: 80 },
        { id: 'c1', label: 'primitive', x: 170, y: 222, r: 42 },
        { id: 'c2', label: 'act', x: 320, y: 222, r: 42 },
        { id: 'c3', label: 'opening', x: 470, y: 222, r: 42 },
        { id: 'v', label: '0000 · 0001 · 0002', sub: 'versions, newest is the heart', kind: 'box', x: 320, y: 318, w: 300 },
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
    title: 'Meta',
    lede: 'What a tile means, said where it is needed, and kept in versions like everything else.',
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
}
