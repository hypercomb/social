// What an earlier planting of the presentation left that this one does not want
// (the tree before the 2026-11-03 audit, tree.cjs at 6a61b6128). A tile is a
// reference, so nothing is removed: plant.cjs retires these markers with
// `trait ~` (the tiles stay, one `trait` away) and these notes with `unfile`
// (named by how each starts; history keeps them, undo puts them back), so the
// layout shows only this planting's words and readers see only reader notes.
// On a hive that never had the earlier planting, each line simply finds nothing.
//
// `roots` are earlier top tiles: the root was presentation until jwize
// 2026-11-04 ("the root tile has to change to protocol instead of presentation";
// "unpublish the presentation and we use the other from now on"). plant.cjs
// retires each at `/` with `trait ~` and, for every domain it publishes to,
// withdraws it with `publish /<root> off <domain>`. Its notes below stay as
// the record of that planting; they sit under a retired root now.

module.exports = {
  "roots": [
    "presentation"
  ],
  "markers": {
    "presentation/simple": [
      "marker",
      "check",
      "lift"
    ],
    "presentation/simple/opening": [
      "cube"
    ],
    "presentation/organized": [
      "cube"
    ],
    "road": [
      "protocol"
    ]
  },
  "notes": {
    "presentation": "Welcome to Hypercomb. This is its flagship presentation.",
    "presentation/simple/primitive": "Show the one primitive: a word, its signature,",
    "presentation/simple/primitive/word": "The tile's name. A word is an address:",
    "presentation/simple/primitive/signature": "The SHA-256 of the bytes. Same bytes, same",
    "presentation/simple/primitive/layer": "The children under the word: a row of",
    "presentation/simple/primitive/meta": "What the tile means, said where it is",
    "presentation/simple/act": "Show the one act: take a word, get",
    "presentation/simple/opening": "The seven moves from one hexagon to the",
    "presentation/simple/opening/hexagon": "Move one: hypercomb alone, opening into word, signature,",
    "presentation/simple/opening/row": "Move two: the six values laid out side",
    "presentation/simple/opening/stack": "Move three: rows under rows, the plane becomes",
    "presentation/simple/opening/column": "Move four: new signatures stack above old ones;",
    "presentation/simple/opening/spread": "Move five: the same word from many hands,",
    "presentation/simple/opening/cube": "Move six: every tile a point, the points",
    "presentation/simple/opening/tesseract": "Move seven: meta and traits give every other",
    "presentation/simple/marker": "The primitive marker: a small hexagon pinned in",
    "presentation/simple/check": "The same-shape check: one control lays the primitive's",
    "presentation/simple/lift": "The transition bee: hexagons lift off the grid",
    "presentation/organized/heart": "A tile's current layer, the newest marker in",
    "presentation/organized/history": "Every version kept, one above the other; undo",
    "presentation/organized/build": "One build revision per pass: the canonical loop",
    "presentation/organized/layout": "The layout behaviour: its markers decide what shows;",
    "presentation/organized/trait": "Traits are markers: tiles not yet set, rendered",
    "presentation/organized/cube": "The grammar viewer: points, faces, slices, and every",
    "presentation/organized/cube/point": "Each point is one tile: word, version, origin.",
    "presentation/organized/cube/face": "Turning to a face flattens one direction; the",
    "presentation/organized/cube/slice": "One point chosen for each word: a working",
    "presentation/organized/organization": "Any organization of the assets: a layout of",
    "presentation/collaborative/workbench": "hypercomb.io or your own host's root: private to",
    "presentation/collaborative/domain": "A domain claimed with one sentence; one root",
    "presentation/collaborative/trial": "The trial subdomain, the isolated public debugging environment:",
    "presentation/collaborative/publishing": "Bytes first, then a pointer; nothing removed; every",
    "presentation/collaborative/participant": "Eight participants, each serving their own domain and",
    "presentation/collaborative/sharing": "Themes, styles, and code shared with no dependencies:",
    "presentation/collaborative/discovery": "Part discovery: and, or, not, across every followed",
    "presentation/collaborative/tapestry": "The cubes joined by the signatures they share,",
    "presentation/intelligent/sentence": "Natural language is the scripting language: a sentence",
    "presentation/intelligent/automaton": "The same grammar run by different automatons: same",
    "presentation/intelligent/debugging": "Debugging in sentences: module trials, changes, audit, review,",
    "presentation/intelligent/agent": "Agents speak the same sentences as people, under",
    "presentation/intelligent/merging": "Incremental update or full upgrade; where your change",
    "presentation/accessible/reader": "Anyone can open the published presentation; reading needs",
    "presentation/accessible/listening": "Written to be listened to: plain sentences, every",
    "presentation/accessible/phone": "Works at phone width: the cube and every",
    "presentation/accessible/motion": "Respects reduced motion: everything still reads with the",
    "presentation/localized/translating": "Community translations: a translator's catalog on a host,",
    "presentation/localized/locale": "Locale as one of the cube's own directions,"
  }
}
