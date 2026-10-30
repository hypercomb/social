// The living presentation's tile tree (documentation/living-presentation.md).
//
// The whole mesh, planted at once so agents can take tiles in parallel. The
// first layer is the six values under one tile called presentation; under each
// value sit the pieces of the presentation that show it, so every layer keeps
// one relation and every path reads aloud. Every piece stands alone, so the
// arrangement can be rebuilt later without breaking anything.
//
// `note` is the tile's task brief, filed on it when it is planted: what the
// tile must show, then the documents and code it draws on. Where a tile needs
// its meaning stated for good, that belongs in its meta layer.

const t = (name, note, children) => (children ? { name, note, children } : { name, note })

module.exports = t('presentation',
  'Welcome to Hypercomb. This is its flagship presentation. It follows its own values and grows into a grammar viewer. Read flat, the six values below are its first view. Everything here is the same thing, used again. Plan: documentation/living-presentation.md',
  [
    t('simple', 'Everything is a tile, and every tile is a word you can say. One idea, used everywhere.', [
      t('primitive', 'Show the one primitive: a word, its signature, a layer of children, and a meta layer. Opening the first hexagon reveals it. Docs: life-primitive.md, signature-system.md.', [
        t('word', 'The tile\'s name. A word is an address: sign(word). Docs: hypergraph-molecule-lineage.md, ontology-is-the-name.md.'),
        t('signature', 'The SHA-256 of the bytes. Same bytes, same signature, stored once. Docs: signature-system.md, signature-algebra.md.'),
        t('layer', 'The children under the word: a row of words under one word. Docs: concepts.md, history-sigbag-as-root.md.'),
        t('meta', 'What the tile means, said where it is needed, versioned like everything else. Docs: life-primitive.md, ontology-is-the-name.md.'),
      ]),
      t('act', 'Show the one act: take a word, get its signature, get its heart, read its children. Same for a person clicking and an agent speaking. Docs: the-algorithm-is-the-application.md, speak-dont-bridge.md.'),
      t('opening', 'The seven moves from one hexagon to the cube, each with its narration and closing sentence. Start from the opening draft kept from the session. Docs: living-presentation.md (The opening).', [
        t('hexagon', 'Move one: hypercomb alone, opening into word, signature, layer, meta. Closing: this is hypercomb, and for now it is only a name.'),
        t('row', 'Move two: the six values laid out side by side, the word direction. Closing: a layer is the words that sit under one word.'),
        t('stack', 'Move three: rows under rows, the plane becomes a stack of planes. Closing: every word can hold a layer of its own.'),
        t('column', 'Move four: new signatures stack above old ones; the top is the heart; the version caveat is said once. Closing: nothing is replaced; every change is kept.'),
        t('spread', 'Move five: the same word from many hands, worn as the origin trait; the chain of copies as an early thread. Closing: the same word can come from many hands.'),
        t('cube', 'Move six: every tile a point, the points fill a cube that was never drawn. Closing: we never drew a cube; this is the primitive, repeated.'),
        t('tesseract', 'Move seven: meta and traits give every other direction; the trait picker; a fourth trait makes a tesseract. Closing: everything here is the same thing, used again.'),
      ]),
      t('marker', 'The primitive marker: a small hexagon pinned in every scene, its four parts lit; it pulses as each direction appears and when anything is opened.'),
      t('check', 'The same-shape check: one control lays the primitive\'s outline over whatever is on screen, and it fits every time.'),
      t('lift', 'The transition bee: hexagons lift off the grid into their pages and fold back. A module like any other, guarded against recursion. Docs: three-js-migration-plan.md, embedded-sites.md.'),
    ]),
    t('organized', 'Everything has its place by its name, and every version is kept by its signature. Nothing is ever lost.', [
      t('heart', 'A tile\'s current layer, the newest marker in its history. Moving it makes the heartbeat. No new functionality. Docs: history-sigbag-as-root.md, revision-mode.md.'),
      t('history', 'Every version kept, one above the other; undo and restore move forward, never delete. Docs: universal-history-plan.md, hive-snapshots.md, revision-mode.md.'),
      t('build', 'One build revision per pass: the canonical loop seals each step. Docs: build-revisions.md, publishing-a-revision.md.'),
      t('layout', 'The layout behaviour: its markers decide what shows; a child left out is blocked, not deleted; a different layout is a new version of the layer; a child\'s layout collapses its parent\'s along that branch. Docs: layout-templates.md, template-addressing.md.'),
      t('trait', 'Traits are markers: tiles not yet set, rendered as placeholders with an extrude icon; the trait and fill words; your own layer stack; traits as tags. Docs: traits.md, tag-pools.md.'),
      t('cube', 'The grammar viewer: points, faces, slices, and every trait as a direction, up to a tesseract and beyond. Docs: superimposition.md.', [
        t('point', 'Each point is one tile: word, version, origin. Published points are the public cube; trials float outside.'),
        t('face', 'Turning to a face flattens one direction; the points slide into its groups: top, front, side.'),
        t('slice', 'One point chosen for each word: a working build, a bent surface through the cube; drag to change it.'),
      ]),
      t('organization', 'Any organization of the assets: a layout of words or a saved question over the same pieces; make many, move nothing. Docs: website-artifact-paradigm.md, known-location-pools.md.'),
    ]),
    t('collaborative', 'Share what you make from your own domain. Take what others make, whole or one piece at a time.', [
      t('workbench', 'hypercomb.io or your own host\'s root: private to your machine, able to publish once your host is registered. Docs: becoming-a-host.md, hosting-from-a-machine.md.'),
      t('domain', 'A domain claimed with one sentence; one root folder; every name is a pointer; to others the root shows the public cube. Docs: domain-claim.md, domain-folder-sharing.md, showcase.md.'),
      t('trial', 'The trial subdomain, the isolated public debugging environment: its own origin, no writes, no keys; draft, trial, reviewed, your choice; promotion is one pointer move. Docs: module-sandbox.md.'),
      t('publishing', 'Bytes first, then a pointer; nothing removed; every publisher keeps a clean path to their running code; the honest limits. Docs: read-only-deployment.md, deployment-stages.md, derivations.md.'),
      t('participant', 'Eight participants, each serving their own domain and cube; a shared package changes; the badge; take it whole or take a piece. Docs: using-a-creation.md, collections-sharing.md.'),
      t('sharing', 'Themes, styles, and code shared with no dependencies: items name words, never things; a theme is a layer of style references parts pull; parts talk by word. Docs: website-artifact-paradigm.md, background-themes.md.'),
      t('discovery', 'Part discovery: and, or, not, across every followed domain, one flat list of offers marked by domain; a question kept as a tile. Docs: pools-across-hosts.md, traits.md, signature-algebra.md.'),
      t('tapestry', 'The cubes joined by the signatures they share, from the root outward; every cube the same shape. Docs: pools-across-hosts.md, superimposition.md.'),
    ]),
    t('intelligent', 'People and AI use the same words under the same rules, and every change waits for a person to accept it.', [
      t('sentence', 'Natural language is the scripting language: a sentence is the program, its reach worked out before it runs. Docs: every-act-has-a-word.md, hive-sentence.md, hypercomb-communication-layer.md.'),
      t('automaton', 'The same grammar run by different automatons: same words, different points, different results on each domain. Docs: superimposition.md, spoken-programs.md.'),
      t('debugging', 'Debugging in sentences: module trials, changes, audit, review, assess, take, drop; the failing sentence and its slice handed over as signatures. Docs: module-sandbox.md.'),
      t('agent', 'Agents speak the same sentences as people, under the same admission; a model may put a change on a trial, never promote it. Docs: agents.md, agent-harness.md, speak-dont-bridge.md.'),
      t('merging', 'Incremental update or full upgrade; where your change meets an incoming one, the AI drafts the merge and you accept it or keep yours. Proposed. Docs: module-sandbox.md, using-a-creation.md.'),
    ]),
    t('accessible', 'Plain words, free and open source, and your work lives on your own device.', [
      t('reader', 'Anyone can open the published presentation; reading needs no account; readers load what readers need. Docs: read-only-deployment.md, no-third-party-requests.md.'),
      t('listening', 'Written to be listened to: plain sentences, every narration readable aloud. Docs: living-presentation.md.'),
      t('phone', 'Works at phone width: the cube and every scene fit one column. Docs: mobile-one-column.md.'),
      t('motion', 'Respects reduced motion: everything still reads with the animation off.'),
    ]),
    t('localized', 'The hive speaks your language: the community translates it, and anyone can add their own.', [
      t('translating', 'Community translations: a translator\'s catalog on a host, healed into hives that lack a word. Docs: community-translations.md, cell-localization.md.'),
      t('locale', 'Locale as one of the cube\'s own directions, chosen with the trait picker.'),
    ]),
  ])
