// The living presentation's tile tree (documentation/living-presentation.md).
//
// The whole mesh, planted at once so agents can take tiles in parallel. The
// first layer is the six values under one tile called protocol (jwize
// 2026-11-04: "the root tile has to change to protocol instead of presentation");
// under each value sit the ideas that show it, so every layer keeps ONE relation
// and every path reads aloud ("the protocol is simple; simple is shown by the primitive;
// the primitive is made of a word, ..."). Every piece stands alone, so the
// arrangement can be rebuilt later without breaking anything.
//
// TWO TREES, because they are two relations (audit, jwize 2026-11-03: "fix all
// three and replant"):
//   protocol     — what the reader is shown: the protocol, its values and the
//                  ideas under them. This is what gets published. (The earlier
//                  root, presentation, is retired and withdrawn: retired.cjs.)
//   presenter    — what shows it: the marker, the same-shape check, the lift,
//                  and the cube viewer. The presentation's own machinery, each
//                  piece a tile like everything else, kept out of the values
//                  so "simple has a marker" is never a path.
// Every name is one molecule hive-wide (doctrine N1), so no word is used twice:
// the opening's sixth move is `fill` ("the points fill a cube"), and `cube` is
// the viewer alone.
//
// `note` is what a READER sees on the tile once it is published: one plain
// sentence or two, nothing unbuilt shown as built. `brief` is the builder's
// task (what the tile must show, and the documents it draws on); it stays here
// in the repo and is never planted, so the published presentation carries no
// work notes. Where a tile needs its meaning stated for good, that belongs in
// its meta layer.
//
// Order is the order of the words: the trait markers' order IS the layout
// (living-presentation.md, "the order of markers is the layout"), so the seven
// opening moves are listed first to last.

const t = (name, note, brief, children) => {
  const tile = { name, note, brief }
  if (children) tile.children = children
  return tile
}

const protocol = t('protocol',
  'Hypercomb is an open protocol for people: one shared way of naming, keeping and passing on what we make. Everything here is one idea, used again: a tile. Start with any of the six values below, and step in to go deeper.',
  'The root: tour scene 2, An open protocol. It follows its own values and grows into a grammar viewer. Read flat, the six values are its first view. Plan: documentation/living-presentation.md',
  [
    t('simple', 'Everything is a tile, and every tile is a word you can say. One idea, used everywhere.', 'Value. Relation of its children: shown by.', [
      t('primitive', 'There is only one primitive: a word, its signature, a layer of children under it, and a meta layer that says what it means.',
        'Show the one primitive. Opening the first hexagon reveals it. Docs: life-primitive.md, signature-system.md.', [
        t('word', 'A tile\'s name. A word is an address: the same word finds the same place, anywhere.', 'Docs: hypergraph-molecule-lineage.md, ontology-is-the-name.md.'),
        t('signature', 'A fingerprint of the bytes. The same bytes always have the same signature, so they are stored once.', 'Docs: signature-system.md, signature-algebra.md.'),
        t('layer', 'The words under a word. Every tile can hold a layer of its own.', 'Docs: concepts.md, history-sigbag-as-root.md.'),
        t('meta', 'What a tile means, said where it is needed, and kept in versions like everything else.', 'Docs: life-primitive.md, ontology-is-the-name.md.'),
      ]),
      t('act', 'There is only one act: take a word, find its current layer, and read its children. A person clicking and an agent speaking do the same thing.',
        'Show the one act on every plane. Docs: the-algorithm-is-the-application.md, speak-dont-bridge.md.'),
      t('proof', 'Anyone can work out a signature again from the bytes, so nothing here has to be taken on trust. A list of what a host holds is not proof, and a cache can always be thrown away and rebuilt.',
        'No tour scene: its own plate and beats (blocks/plates/simple-proof.cjs). Axioms M1, M2, M3, P6, D1 to D3. Recomputing is the proof; a listing never is; a pool holds membership, never truth; membership is backed only as a worn mark or a signed enumeration, and not every pool has that form yet (the research\'s rung 4); a federated pool converges only under union; a cache is derived, wipe-safe and never load-bearing. Docs: mathematically-backed-truth-research.md, known-location-pools.md, optimize-phase.md.'),
      t('opening', 'Seven moves, from one hexagon to a cube that was never drawn.',
        'Each move with its narration and closing sentence; start from the opening draft kept from the session. Docs: living-presentation.md (The opening).', [
        t('hexagon', 'One hexagon, named hypercomb. For now it is only a name.', 'Move one: hypercomb alone, opening into word, signature, layer, meta.'),
        t('row', 'A layer is the words that sit under one word.', 'Move two: the six values side by side, the word direction.'),
        t('stack', 'Every word can hold a layer of its own.', 'Move three: rows under rows; the plane becomes a stack of planes.'),
        t('column', 'Nothing is replaced. Every change is kept, and the newest is the heart.', 'Move four: new signatures stack above old ones; the version caveat is said once.'),
        t('spread', 'The same word can come from many hands.', 'Move five: the same word worn as the origin trait; the chain of copies as an early thread.'),
        t('fill', 'Every tile is a point, and the points fill a cube. We never drew the cube; it is the primitive, repeated.', 'Move six: the cube appears from the points alone.'),
        t('tesseract', 'Meaning and traits add more directions. Everything here is the same thing, used again.', 'Move seven: meta and traits give every other direction; the trait picker; a fourth trait makes a tesseract.'),
      ]),
    ]),
    t('organized', 'Everything has its place by its name, and every version is kept by its signature. Nothing is ever lost.', 'Value. Relation of its children: shown by.', [
      t('heart', 'A tile\'s current layer: the newest of its versions. Every change moves the heart forward.', 'No new functionality. Docs: history-sigbag-as-root.md, revision-mode.md.'),
      t('history', 'Every version is kept, one above the other. Undo and restore move forward; nothing is deleted.', 'Docs: universal-history-plan.md, hive-snapshots.md, revision-mode.md.'),
      t('build', 'A piece of work is sealed as one build, with a name you can return to.', 'One build revision per pass: the canonical loop. Docs: build-revisions.md, publishing-a-revision.md.'),
      t('layout', 'A layout decides what shows. A child left out is hidden, never deleted.', 'Its markers decide what shows; a different layout is a new version of the layer; a child\'s layout collapses its parent\'s along that branch. Docs: layout-templates.md, template-addressing.md.'),
      t('trait', 'A trait is a place a tile leaves open, waiting for whatever fills it.', 'Traits are markers rendered as placeholders with an extrude icon; the trait and fill words; your own layer stack; traits as tags. Docs: traits.md, tag-pools.md.'),
      t('organization', 'The same pieces can be organized in many ways at once, and none of them moves anything.', 'A layout of words or a saved question over the same pieces. Docs: website-artifact-paradigm.md, known-location-pools.md.'),
      t('hiding', 'Hide first, delete second. A hidden thing is still there and comes back with one press; deleting is a separate, later act, and it only makes this hive forget.',
        'No tour scene: its own plate and beats (blocks/plates/organized-hiding.cjs). Axioms H4, B3. A list offers only hide; the delete area; delete refused unless hidden and deletable; delete is a local forget; in force today on a host\'s build ledger and a branch\'s published versions; user data is never wiped. Docs: hide-first-delete-second.md.'),
      t('shelf', 'A tile is placed, never copied or cut: it is stored once and can show in many places. The shelf holds the tiles you are carrying, and recents shows every tile a hive ever made.',
        'No tour scene: its own plate and beats (blocks/plates/organized-shelf.cjs). Axioms A7, A9, H7. Placing adds an incidence; no cut, copy or paste words; the shelf takes a reference and only the drop writes (appearance, or custody with Shift); recents is the census, once per atom, hidden shaded and never absent. Landed: the shelf, its handle, recents. Not built: the trait-group pick at the drop. Docs: recents-and-the-quick-tray.md.'),
    ]),
    t('collaborative', 'Share what you make from your own domain. Take what others make, whole or one piece at a time.', 'Value. Relation of its children: shown by.', [
      t('workbench', 'Your workbench is your own hive, private to your machine until you publish.', 'hypercomb.io or your own host\'s root. Docs: becoming-a-host.md, hosting-from-a-machine.md.'),
      t('domain', 'A domain is claimed with one sentence. Everything on it is a name pointing at your work.', 'One root folder; every name is a pointer; to others the root shows the public cube. Docs: domain-claim.md, domain-folder-sharing.md, showcase.md.'),
      t('trial', 'A trial address lets you try a change in public, on its own, before anyone depends on it.', 'Its own origin, no writes, no keys; draft, trial, reviewed; promotion is one pointer move. Docs: module-sandbox.md.'),
      t('publishing', 'Publishing puts the bytes up first and then moves a pointer. Nothing is removed, so older versions keep working.', 'Every publisher keeps a clean path to their running code; the honest limits. Docs: read-only-deployment.md, deployment-stages.md, derivations.md.'),
      t('participant', 'Each participant serves their own domain. You can take a whole creation or just one piece of it.', 'Eight participants, a shared package changes, the badge. Docs: using-a-creation.md, collections-sharing.md.'),
      t('sharing', 'Themes, styles and code are shared without dependencies: parts name words, never each other.', 'A theme is a layer of style references parts pull; parts talk by word. Docs: website-artifact-paradigm.md, background-themes.md.'),
      t('discovery', 'Find parts across every domain you follow, by their word. Combining words with and, or and not is planned.', 'One flat list of offers marked by domain; a question kept as a tile. Docs: pools-across-hosts.md, traits.md, signature-algebra.md.'),
      t('hosting', 'A host keeps pools of meaning: a word at the same address on every host, so what answers it can be found even when its maker is offline. Without one, you see only who is online with you.', 'What a host adds over the swarm alone: pools of meaning answered at one derived address on every host; the floor, operator-declared and index-driven listings; pictures for a name through hosts next. Docs: pools-across-hosts.md (What a host adds), becoming-a-host.md.'),
      t('gate', 'Three separate gates stand between someone else\'s work and your hive: whom you take from, what you keep, and what may run. The first two are built, and the gate on what may run is partly built.',
        'No tour scene: its own plate and beats (blocks/plates/collaborative-gate.cjs). Axioms T5, T2, T3. Selection, intake and activation, never conflated; holding bytes implies neither publishing nor running. Selection built; intake built and inert until an interest is set (intake-filter.md); activation authority built (install-by-replication.md), with the open paths and the unbuilt rules workflow listed in code-admission.md, so the third gate is said as partly built. Docs: intake-filter.md, install-by-replication.md, code-admission.md.'),
      t('tapestry','Where two hives hold the same piece, they are joined. Together they form one larger picture.', 'The cubes joined by the signatures they share, from the root outward. Docs: pools-across-hosts.md, superimposition.md.'),
    ]),
    t('intelligent', 'People and AI use the same words under the same rules, and every change waits for a person to accept it.', 'Value. Relation of its children: shown by.', [
      t('sentence', 'A sentence is the program. Plain language runs, and you can see what it will touch before it does.', 'Its reach worked out before it runs. Docs: every-act-has-a-word.md, hive-sentence.md, hypercomb-communication-layer.md.'),
      t('automaton', 'The same words can run on different domains and give different results.', 'Same grammar, different automatons, different points. Docs: superimposition.md, spoken-programs.md.'),
      t('debugging', 'Problems are found and fixed in sentences too, one tried change at a time.', 'Module trials, changes, audit, review, assess, take, drop; the failing sentence and its slice as signatures. Docs: module-sandbox.md.'),
      t('agent', 'An agent speaks the same sentences as a person, and a person decides what runs.', 'Same admission; a model may put a change on a trial, never promote it. Docs: agents.md, agent-harness.md, speak-dont-bridge.md.'),
      t('interest', 'A pheromone is a signed signal that someone, a person or an agent, found a piece of content worth attention. Your interests are private, and only a match brings something forward for you.',
        'No tour scene: its own plate and beats (blocks/plates/intelligent-interest.cjs). Axioms R1, R2, R3. A signed interest signal on a signature, by a person or an agent; never a label (the name\'s job); interests private, a match surfaces, no match is no signal. Built: signing, verifying, minting and local reading of deposits, and the interest word; inert until an interest is named. Not built, said as planned: a deposit travelling with its content across a hive boundary. Docs: pheromones.md, intake-filter.md.'),
      t('merging', 'Planned: when your change meets someone else\'s, the AI drafts the merge, and you choose.', 'Proposed, not built. Incremental update or full upgrade. Docs: module-sandbox.md, using-a-creation.md.'),
    ]),
    t('accessible', 'Plain words, free and open source, and your work lives on your own device.', 'Value. Relation of its children: shown by.', [
      t('reader', 'Anyone can read a published presentation. Reading needs no account.', 'Readers load what readers need. Docs: read-only-deployment.md, no-third-party-requests.md.'),
      t('listening', 'Every part is written to be listened to, in plain sentences.', 'Every narration readable aloud. Docs: living-presentation.md.'),
      t('phone', 'It works on a phone, one column at a time.', 'The cube and every scene fit one column. Docs: mobile-one-column.md.'),
      t('motion', 'With reduced motion on, everything still reads without the animation.', 'Respect prefers-reduced-motion everywhere.'),
    ]),
    t('localized', 'The hive speaks your language: the community translates it, and anyone can add their own.', 'Value. Relation of its children: shown by.', [
      t('translating', 'Translations come from the community, and a hive fills in the words it is missing.', 'A translator\'s catalog on a host, healed into hives that lack a word. Docs: community-translations.md, cell-localization.md.'),
      t('locale', 'Your language is one more direction you can choose.', 'Locale as one of the cube\'s own directions, chosen with the trait picker.'),
    ]),
  ])

const presenter = t('presenter',
  'What shows the presentation: the marker, the same-shape check, the lift, and the cube viewer. Each is a tile like everything else.',
  'The presentation\'s own machinery, kept out of the values (one relation per layer). Relation of its children: made of.',
  [
    t('marker', 'A small hexagon pinned in every scene, showing the four parts of the primitive. It pulses whenever something opens.', 'The primitive marker: its four parts lit; it pulses as each direction appears. Docs: living-presentation.md (The primitive marker).'),
    t('check', 'One control lays the primitive\'s outline over whatever is on screen, and it fits every time.', 'The same-shape check. Docs: living-presentation.md (the same-shape check).'),
    t('lift', 'Hexagons lift off the grid into their pages, and fold back again.', 'The transition bee, a module like any other, guarded against recursion. Docs: three-js-migration-plan.md, embedded-sites.md.'),
    t('cube', 'The grammar viewer: every tile is a point, and every trait is a direction.', 'Points, faces, slices, up to a tesseract and beyond. Docs: superimposition.md.', [
      t('point', 'Each point is one tile: its word, its version, and where it came from.', 'Published points are the public cube; trials float outside.'),
      t('face', 'Turn to a face, and one direction flattens into groups.', 'Top, front, side: the points slide into the face\'s groups.'),
      t('slice', 'Choose one point for each word, and you have a working build.', 'A bent surface through the cube; drag to change it.'),
    ]),
  ])

// The road: the tour's opening question and its close, one scene per tile
// (jwize 2026-11-03: "the entire hierarchy will have one scene per tile").
// Kept out of the values so /protocol's layer stays the six values (one
// relation per layer). Relation of its children: the way ahead.
const road = t('road',
  'Where Hypercomb leads: what it is for, what people make with it, and how to begin.',
  'The tour\'s scene 1 and scenes 20 to 25 (blocks/tour.cjs), one per tile, in the tour\'s order. Scene 2, the protocol, is the root.',
  [
    t('question', 'It starts with a question: who decides where your work lives, and who it reaches? Here, it lives with you, and your community connects directly to the ones it cares about most.', 'Tour scene 1, A new way to bee: the question the protocol answers.'),
    t('creations', 'What people make with it today: cards, websites and games, the language, communities.', 'Tour scene 20, Shown by its creations.'),
    t('market', 'An open exchange of ideas: publish for free from your own domain, and find by word across the hosts you follow. Sealing a page for the people you choose is built and not yet run on a live host, and nothing here moves money.',
      'No tour scene: its own plate and beats (blocks/plates/road-market.cjs). Free is built; finding by word, none ranked; sealing built (the `private` word, private.queen.ts), not yet run on a live host; payment outside the hive, no platform cut. Docs: presentation-blueprint.md (The marketplace of ideas), sealed-audiences.md, pools-across-hosts.md, bee-story/the-economy.md.'),
    t('coming', 'In progress: the next things being built.', 'Tour scene 21, What comes next. Everything here is planned or in progress, and says so.'),
    t('vision', 'Further out: where the protocol is headed.', 'Tour scene 22, The vision. Planned.'),
    t('computer', 'The horizon: the hive as a computer.', 'Tour scene 23, The hive is a computer. Planned.', [
      t('machine', 'There is no shared machine. A program runs where it is used, in your own browser, and the only thing everyone agrees on is the hash of the bytes.',
        'No tour scene: its own plate and beats (blocks/plates/road-computer-machine.cjs). The comparison with a blockchain, said exactly, and the honest limit said once: no global ledger. Docs: presentation-blueprint.md (Why this does not pay the shared-machine price), signature-system.md, hosting-from-a-machine.md, collapsed-compute.md.'),
      t('system', 'The hive in the words of an operating system: files, folders, programs, a command line, installing, updates and a network. Each one points at something real.',
        'No tour scene: its own plate and beats (blocks/plates/road-computer-system.cjs). The map from familiar words to the hive; the rules screen is planned. Docs: presentation-blueprint.md (The shared system, in the words people already know), code-admission.md, install-by-replication.md, every-act-has-a-word.md.'),
    ]),
    t('gathering', 'A place to get involved, whenever you like: join a meeting, or become a host. Nothing here is asked of you.',
      'No tour scene: its own beats and the hub picture (blocks/content.cjs). The open door (presentation-blueprint.md, Calls to action): never a prompt, nothing pops up. Relation of its children: the ways in.', [
      t('meeting', 'Type meeting to start one, or to join the one already going. You join with your voice only, and the people in it follow whoever leads around the hive.',
        'No tour scene: its own plate and beats (blocks/plates/road-gathering-meeting.cjs). The swarm\'s, never a tile\'s; voice only, camera off until turned on; the starter leads; directions, never code; each person allows or disallows the room\'s words; the invite link. Docs: meeting-lobby.md.'),
      t('host', 'A host lets other people reach your work when you are not online with them. The desktop app can serve your hive from your own computer; the rest of the path is planned.',
        'No tour scene: its own plate and beats (blocks/plates/road-gathering-host.cjs). Built in the desktop app: try it now, use my domain, check it, the native ask, take it offline. The four-step path in the hosts window is design, said as planned. Docs: becoming-a-host.md, hosting-from-a-machine.md.'),
    ]),
    t('yours','The invitation: the hive is yours.', 'Tour scene 24, The hive is yours.'),
    t('first-day', 'Your first day: type help, and everything you can do is laid out for you.', 'Tour scene 25, How to bee.'),
  ])

// PROMOTED, AND WAITING (jwize 2026-11-05: "the language needs to be for
// absolute beginners but hit the crux of it for the technical people so lets
// do our best to select on the most important pieces we can put the others
// aside in waiting in a list as unpromoted"). The tree above is every piece;
// these routes are set aside. They are not planted, not paged and not
// published, and a hive that already holds them sees them retired with
// `trait ~` (plant.cjs), so each stays one `trait` away. Their notes and briefs
// stay above, ready, and a route promotes again by leaving this list.
const WAITING = [
  'protocol/simple/opening',
  'protocol/simple/primitive/layer',
  'protocol/organized/heart', 'protocol/organized/build', 'protocol/organized/layout',
  'protocol/organized/trait',
  'protocol/collaborative/trial',
  'protocol/collaborative/tapestry',
  'protocol/intelligent/automaton', 'protocol/intelligent/debugging', 'protocol/intelligent/merging',
  'protocol/accessible/reader', 'protocol/accessible/listening', 'protocol/accessible/phone', 'protocol/accessible/motion',
  'protocol/localized/translating', 'protocol/localized/locale',
  'road/coming', 'road/vision',
]
const waiting = new Set(WAITING)

/** The tree without what waits: the same tiles, every waiting route and all
 *  beneath it left out. */
const promoted = (node, at = []) => {
  const route = [...at, node.name]
  if (!node.children) return node
  const kept = node.children.filter(c => !waiting.has([...route, c.name].join('/')))
  return { ...node, children: kept.map(c => promoted(c, route)) }
}

const all = { protocol, road, presenter }
const shown = { protocol: promoted(protocol), road: promoted(road), presenter }
for (const route of WAITING) {
  const [top, ...rest] = route.split('/')
  let node = all[top]
  for (const name of rest) node = (node?.children || []).find(c => c.name === name)
  if (!node) throw new Error(`tree.cjs: waiting route ${route} names no tile`)
}

module.exports = shown.protocol
module.exports.protocol = shown.protocol
module.exports.presenter = presenter
module.exports.road = shown.road
module.exports.roots = [shown.protocol, shown.road, presenter]
// every piece, promoted or waiting, and the waiting routes themselves
module.exports.all = [protocol, road, presenter]
module.exports.waiting = WAITING
module.exports.isWaiting = (route) => {
  const parts = String(route).split('/')
  return parts.some((_, i) => waiting.has(parts.slice(0, i + 1).join('/')))
}
