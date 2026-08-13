// diamondcoreprocessor.com/tutorial/lessons/expert.lessons.ts
//
// THE EXPERT COURSE — THE WINDOWS.
//
// The advanced course used to be six lessons on "some powerful stuff". It is
// now the roster it should always have been: ONE LESSON PER PRIMARY WINDOW,
// each one carrying every behaviour that belongs to that window.
//
// Why per window: the interface IS the curriculum. A participant who knows the
// verbs (starter → beginner → intermediate) does not next need a grab-bag of
// clever tricks — they need to know what every surface in front of them is for.
// A window is also exactly the right unit: it owns its behaviours, it opens and
// closes, it can be missing from a build, and it can be taught in ninety
// seconds. Adding a window to the shell means adding a lesson here, in the same
// pass — the roster and the interface stay 1:1 by construction.
//
// Each lesson therefore:
//   - opens its window through the REAL path (the slash behaviour, the binding,
//     or the effect the button raises) — never a private hook,
//   - names the behaviours that live in it, so the window and its verbs are
//     learned as one thing,
//   - CLOSES it again before it hands the stage back.
//
// TWO RULES this course still obeys strictly:
//   1. Nothing outside the practice page is touched. Behaviours that act on the
//      whole hive (snapshots, hosting) or on the network are NARRATED and
//      pointed at, never fired.
//   2. Nothing is ever published. Going public is always the participant's own
//      deliberate act — a tutorial that shares your hive to teach you sharing
//      would be the exact opposite of the lesson.

import { tutorialLessons, TUTORIAL_DEMO_MARK as PRACTICE_MARK } from '../tutorial-lesson.js'
import { hasBehaviour, hasWindow, subject, subjects } from './lesson-kit.js'

const L = 'expert' as const

/** Practice names, so every lesson stands alone with something to point at. */
const names = (stage: { t(k: string, f: string): string }): string[] => [
  stage.t('tutorial.name.note0', 'Ideas'),
  stage.t('tutorial.name.note1', 'Reading'),
  stage.t('tutorial.name.note2', 'Errands'),
]

// ── 10 · the command line ──────────────────────────────────────────────
// The window everything else is reachable from. Creation, depth, filtering
// and every slash behaviour ride this one box.

tutorialLessons.register({
  id: 'window-command-line',
  level: L,
  order: 10,
  title: 'The command line',
  pheromones: ['tutorial', 'lesson', 'expert', 'input', 'creation', 'structure'],
  async run(stage) {
    await stage.flyToRect(stage.commandInput())
    await stage.say('cmdline', 'One box, three languages',
      'This box speaks three languages. A NAME makes a tile. A ? filters the page as you type. A / runs a behaviour — and it completes as you go, so nothing has to be memorised.')
    stage.highlight(null)

    const root = stage.t('tutorial.name.project', 'Project')
    const items = [root, `${root}/${stage.t('tutorial.name.notes', 'Notes')}`, `${root}/${stage.t('tutorial.name.tasks', 'Tasks')}`]
    await stage.typeAndSubmit(`[${items.join(', ')}]`, true)
    await stage.waitForLabel(root)
    await stage.wait(900)

    await stage.say('cmdline-brackets', 'A shape, not a list',
      'Brackets make many tiles in ONE commit, and an item carrying a slash builds DEPTH. Three tiles, two levels, one line — and one undo takes the whole thing back.')

    await stage.typeAndSubmit(`>?${root.slice(0, 3)}`, true)
    await stage.wait(1200)
    await stage.say('cmdline-filter', 'Narrowing, not changing',
      'A filter is a lens — it never moves anything. /clear puts the page back.')
    await stage.typeAndSubmit('/clear', false)
    await stage.wait(700)
  },
})

// ── 20 · the command palette ───────────────────────────────────────────

tutorialLessons.register({
  id: 'window-palette',
  level: L,
  order: 20,
  title: 'The command palette',
  pheromones: ['tutorial', 'lesson', 'expert', 'guidance', 'input'],
  requires: () => hasWindow('hc-command-palette'),
  async run(stage) {
    const c = stage.center()
    await stage.flyTo(c.x, c.y - 100)
    await stage.say('palette-window', 'Everything, in one list',
      'Every action in the hive is in one place. Open the palette, type what you MEAN, and it finds the command — no shortcut to remember, no menu to hunt through.')

    stage.invoke('ui.commandPalette')
    await stage.wait(1200)
    await stage.say('palette-window-done', 'Search, don’t remember',
      'Commands, views, behaviours — all of it, searchable. Behaviours a module installs appear here the moment it loads. Escape closes it.')
    stage.invoke('global.escape')
    await stage.wait(500)
  },
})

// ── 30 · the reference ─────────────────────────────────────────────────

tutorialLessons.register({
  id: 'window-help',
  level: L,
  order: 30,
  title: 'The reference and the docs reader',
  pheromones: ['tutorial', 'lesson', 'expert', 'guidance'],
  teaches: ['help', 'docs'],
  requires: () => hasBehaviour('help'),
  async run(stage) {
    await stage.flyToRect(stage.commandInput())
    await stage.say('help-window', 'The reference',
      '/help opens the whole surface as a reference — every slash behaviour, every command-line operation, every keystroke, searchable.')
    stage.highlight(null)

    await stage.typeAndSubmit('/help', false)
    await stage.wait(1600)
    await stage.say('help-window-done', 'And the long form',
      'This is the quick answer. /docs opens the reader for the long form — the papers explaining WHY the hive works the way it does. Escape closes either.')
    stage.invoke('global.escape')
    await stage.wait(600)
  },
})

// ── 40 · the tile editor ───────────────────────────────────────────────

tutorialLessons.register({
  id: 'window-editor',
  level: L,
  order: 40,
  title: 'The tile editor',
  pheromones: ['tutorial', 'lesson', 'expert', 'editing', 'appearance'],
  requires: () => hasWindow('hc-tile-editor'),
  async run(stage) {
    const label = await subject(stage, names(stage)[0], 20)

    await stage.flyToCell(label)
    await stage.say('editor-window', 'Everything a tile carries',
      'The editor is where a tile’s own contents live — its words, its cover picture, its links and its files. E opens it, or the pencil on the tile.')
    stage.highlight(null)

    await stage.editCell(label)
    await stage.wait(1400)
    await stage.say('editor-window-done', 'Content, not layout',
      'Nothing here changes where the tile lives or what it means — that is what the other windows are for. This one is only ever about what is INSIDE.')
    stage.invoke('global.escape')
    await stage.wait(600)
  },
})

// ── 50 · the notes window ──────────────────────────────────────────────

tutorialLessons.register({
  id: 'window-notes',
  level: L,
  order: 50,
  title: 'The notes window',
  pheromones: ['tutorial', 'lesson', 'expert', 'editing', 'meaning'],
  requires: () => hasWindow('hc-notes-strip'),
  async run(stage) {
    const label = await subject(stage, names(stage)[0], 21)

    await stage.flyToCell(label)
    await stage.say('notes-window', 'The explanation, on the thing',
      'Notes are the writing that belongs WITH a tile rather than in some other document. The strip shows the ones on the tile you are looking at.')
    stage.highlight(null)

    stage.emit('notes:panel', { visible: true })
    await stage.wait(700)
    stage.emit('note:commit', {
      cellLabel: label,
      text: stage.t('tutorial.note.window', 'Notes nest, take marks, and reorder — the reasoning lives beside the thing it is about.'),
    })
    await stage.wait(1200)

    await stage.say('notes-window-nesting', 'Notes have shape too',
      'A note can nest under another, carry a mark, and be dragged into order — so a tile can hold a whole line of reasoning, not just a caption.')

    await stage.say('notes-window-done', 'Reading at length',
      'Click a note and it opens in the reading window as a tab, so you can hold several tiles’ notes side by side. Everything you write here travels with the tile — share it, adopt it, walk its history, the note comes too.')
    stage.emit('notes:panel', { visible: false })
    await stage.wait(500)
  },
})

// ── 60 · the files window ──────────────────────────────────────────────

tutorialLessons.register({
  id: 'window-files',
  level: L,
  order: 60,
  title: 'The files window',
  pheromones: ['tutorial', 'lesson', 'expert', 'editing', 'structure'],
  teaches: ['files'],
  requires: () => hasBehaviour('files') && hasWindow('hc-files-viewer'),
  async run(stage) {
    await subject(stage, names(stage)[0], 22)

    await stage.flyToRect(stage.commandInput())
    await stage.say('files-window', 'The documents underneath',
      'Tiles can carry real files — pictures, documents, anything you drop on them. /files opens the window that lists them.')
    stage.highlight(null)

    await stage.typeAndSubmit('/files', false)
    await stage.wait(1600)
    await stage.say('files-window-done', 'Reach as far as you like',
      'It can list just this tile, this page, or the whole branch below you — so “what have I actually got in here?” is one question, not an expedition. Our practice page is nearly empty; on a real branch this fills up fast.')
    stage.emit('files:viewer-close', {})
    await stage.wait(600)
  },
})

// ── 70 · the tags window ───────────────────────────────────────────────

tutorialLessons.register({
  id: 'window-tags',
  level: L,
  order: 70,
  title: 'The tags window',
  pheromones: ['tutorial', 'lesson', 'expert', 'meaning'],
  teaches: ['tags', 'keyword'],
  requires: () => hasBehaviour('tags') && hasWindow('hc-tags-viewer'),
  async run(stage) {
    const two = await subjects(stage, 2, names(stage), 23)

    await stage.flyToRect(stage.commandInput())
    await stage.say('tags-window', 'Your whole vocabulary',
      'Pheromones are the marks that gather tiles. This window is every mark you have ever used, in one place — the vocabulary your hive is actually built from.')
    stage.highlight(null)

    await stage.typeAndSubmit('/tags', false)
    await stage.wait(1600)

    stage.select(two)
    await stage.wait(400)
    await stage.say('tags-window-paint', 'Arm, then paint',
      'Pick marks in the window and they arm; then paint them onto tiles — one commit, however many tiles. Drag a mark onto the canvas and it becomes a tile of its own: a collection of everything wearing it.')

    await stage.typeAndSubmit(`/keyword ${PRACTICE_MARK}`, true)
    await stage.wait(1200)
    await stage.say('tags-window-done', 'A bouquet',
      'Marks that belong together make a BOUQUET — a named handful you can arm at once. Nothing here moves a tile; a mark is meaning, never a location.')

    stage.clearSelection()
    stage.emit('tags:view-close', {})
    await stage.wait(600)
  },
})

// ── 80 · the collections index ─────────────────────────────────────────

tutorialLessons.register({
  id: 'window-collections',
  level: L,
  order: 80,
  title: 'The collections index',
  pheromones: ['tutorial', 'lesson', 'expert', 'meaning', 'structure', 'navigation'],
  teaches: ['collections', 'hive', 'requires'],
  requires: () => hasBehaviour('collections') && hasWindow('hc-aggregate-index'),
  async run(stage) {
    await stage.flyToRect(stage.commandInput())
    await stage.say('collections-window', 'The index of everything gathered',
      'A collection is a set of tiles held together by meaning rather than by place. This window is the index of all of them — and of your websites, and of anything else that registers as an aggregate.')
    stage.highlight(null)

    await stage.typeAndSubmit('/collections', false)
    await stage.wait(1600)
    await stage.say('collections-window-drag', 'Drag to make meaning',
      'Dragging a tile in here files it into a collection. Add lends it a second doorway and leaves it where it lives; Move takes custody. The window is the same for every aggregate, so a new kind of index inherits all of this for free.')

    // ── SAME NAME = SAME TILE ──────────────────────────────────────────
    // One name names one tile. That is the convention the whole sharing
    // model rests on — folders are SHARED and filtered, never copied — so
    // the field's + must be taught as a LINKER first and a maker second.
    await stage.say('collections-window-link', 'Typing a name links before it makes',
      'The field on top is also the maker. Type a name and press + — and if a tile already answers to that name, anywhere and at any depth, the new row simply binds to THAT tile: same folder, same children, one more doorway. Only a name nothing answers to makes a new, empty collection.')

    await stage.say('collections-window-doorways', 'One folder, many doorways',
      'A row is a doorway, never a copy — the same folder can appear wherever it is useful, and adding through any doorway lands in the one real folder. A doorway can even DEMAND pheromones: /requires people = family makes a door that shows only the family subset, and stepping back outside returns your own lens untouched. The filter lives on the doorway; the folder stays whole.')

    await stage.say('collections-window-done', 'And naming a branch',
      'A branch can also be NAMED with /hive, and then taken by that name instead of a path — a handle onto a whole complete piece of your world, which commands, views and shares can all point at.')
    stage.emit('aggregate:view-close', {})
    await stage.wait(600)
  },
})

// ── 90 · the filters window ────────────────────────────────────────────

tutorialLessons.register({
  id: 'window-filters',
  level: L,
  order: 90,
  title: 'The filters window',
  pheromones: ['tutorial', 'lesson', 'expert', 'meaning', 'view'],
  requires: () => hasWindow('hc-filter-configurations'),
  async run(stage) {
    await subjects(stage, 2, names(stage), 24)

    await stage.flyToRect(stage.commandInput())
    await stage.say('filters-window', 'Filters you keep',
      'Typing ? filters once. This window is where a filter becomes something you KEEP — named, saved, and reopened whenever you want that view of your hive back.')
    stage.highlight(null)

    await stage.typeAndSubmit(`>?${PRACTICE_MARK}`, true)
    await stage.wait(1600)
    await stage.say('filters-window-done', 'A lens, still',
      'Saved or not, a filter never changes a single tile — it decides what you are looking at. /clear puts everything back, and the saved one is still there for next time.')
    await stage.typeAndSubmit('/clear', false)
    await stage.wait(700)
  },
})

// ── 100 · the clipboard window ─────────────────────────────────────────

tutorialLessons.register({
  id: 'window-clipboard',
  level: L,
  order: 100,
  title: 'The clipboard window',
  pheromones: ['tutorial', 'lesson', 'expert', 'editing'],
  requires: () => hasWindow('hc-clipboard-panel'),
  async run(stage) {
    const two = await subjects(stage, 2, names(stage), 25)

    await stage.flyToCell(two[0])
    await stage.say('clipboard-window', 'What you are carrying',
      'Copy is not a one-slot pocket here. The clipboard window shows everything you have picked up — tiles, branches, pictures, text — and it stays yours, on this machine, until you place it.')
    stage.highlight(null)

    stage.select([two[0]])
    await stage.wait(300)
    stage.invoke('clipboard.copy')
    await stage.wait(700)
    stage.emit('clipboard:panel', { visible: true })
    await stage.wait(1400)

    await stage.say('clipboard-window-done', 'Place, don’t just paste',
      'Each entry can be placed where you choose rather than dumped where you stand, and a copied tile brings its whole branch — pictures, notes and all. Nothing here ever leaves your machine.')
    stage.emit('clipboard:panel', { visible: false })
    stage.clearSelection()
    await stage.wait(500)
  },
})

// ── 110 · the arrangements window ──────────────────────────────────────

tutorialLessons.register({
  id: 'window-sequence',
  level: L,
  order: 110,
  title: 'The arrangements window',
  pheromones: ['tutorial', 'lesson', 'expert', 'appearance', 'structure'],
  teaches: ['sequence'],
  requires: () => hasBehaviour('sequence') && hasWindow('hc-sequence-viewer'),
  async run(stage) {
    await subjects(stage, 3, names(stage), 26)

    await stage.flyToRect(stage.commandInput())
    await stage.say('sequence-window', 'How a page fills up',
      'Tiles do not land at random — they fill the page along a SEQUENCE. This window is the set of them: rings, rows, spirals, and the ones you save yourself.')
    stage.highlight(null)

    await stage.typeAndSubmit('/sequence', false)
    await stage.wait(1600)
    await stage.say('sequence-window-done', 'Also where things land',
      'A sequence is also a target: it decides where a dropped file or a pasted branch comes to rest. Cycle it from the keyboard and the page rearranges under you — nothing is lost, only re-laid.')
    stage.emit('sequence:view-close', {})
    await stage.wait(600)
  },
})

// ── 120 · the history window ───────────────────────────────────────────

tutorialLessons.register({
  id: 'window-history',
  level: L,
  order: 120,
  title: 'The history window',
  pheromones: ['tutorial', 'lesson', 'expert', 'history'],
  teaches: ['history', 'revise'],
  requires: () => hasBehaviour('history') && hasWindow('hc-history-viewer'),
  async run(stage) {
    await subject(stage, names(stage)[0], 27)

    await stage.flyToRect(stage.commandInput())
    await stage.say('history-window', 'Every change you have made',
      'Undo is only the doorway. Every change is a REVISION that stays — this window is the whole road, in order, with what changed at each step.')
    stage.highlight(null)

    await stage.typeAndSubmit('/history', false)
    await stage.wait(1700)
    await stage.say('history-window-marks', 'Mark the ones that matter',
      'Give a revision a mark and it becomes a place you can find again — “before the rearrange”, “the version I sent”. History never branches here: taking something back writes a new step that undoes it, so the road is always one road.')

    await stage.say('history-window-done', 'Travel, then come back',
      '/revise puts the clock on the page so you can walk backwards and watch it change. Nothing is overwritten by looking — new work is always a new revision.')
    await stage.typeAndSubmit('/history', false)
    await stage.wait(700)
  },
})

// ── 130 · the rewind window ────────────────────────────────────────────

tutorialLessons.register({
  id: 'window-rewind',
  level: L,
  order: 130,
  title: 'The rewind window',
  pheromones: ['tutorial', 'lesson', 'expert', 'history', 'view'],
  teaches: ['rewind'],
  requires: () => hasBehaviour('rewind') && hasWindow('hc-rewind-window'),
  async run(stage) {
    await subjects(stage, 2, names(stage), 28)

    await stage.flyToRect(stage.commandInput())
    await stage.say('rewind-window', 'Undo, but you can see it',
      'The problem with undo is that you have to guess how far back to go. /rewind shows you: each recent moment drawn as it looked, so you PICK the one you meant.')
    stage.highlight(null)

    await stage.typeAndSubmit('/rewind', false)
    await stage.wait(1800)
    await stage.say('rewind-window-done', 'Choosing, not counting',
      'Land on one and the page returns to it — and because that return is itself a revision, changing your mind again is just another step forward. Nothing here is ever destroyed.')
    stage.emit('rewind:close', {})
    await stage.wait(600)
  },
})

// ── 140 · the views window ─────────────────────────────────────────────

tutorialLessons.register({
  id: 'window-views',
  level: L,
  order: 140,
  title: 'The views window',
  pheromones: ['tutorial', 'lesson', 'expert', 'view', 'appearance'],
  teaches: ['views', 'tree', 'website', 'present', 'tutor'],
  requires: () => hasBehaviour('views') && hasWindow('hc-views-viewer'),
  async run(stage) {
    await subjects(stage, 3, names(stage), 29)

    await stage.flyToRect(stage.commandInput())
    await stage.say('views-window', 'Another way of seeing',
      'The same tiles can be drawn as something else entirely. This window is the library of those ways — attach one, preview it, take it off again.')
    stage.highlight(null)

    await stage.typeAndSubmit('/views', false)
    await stage.wait(1700)
    await stage.say('views-window-kinds', 'A tree, a site, a deck, a game',
      '/tree lays a branch out sideways, trunk on the left. /website renders it as pages. /present plays it as slides. /tutor turns it into study games. Same tiles every time.')

    await stage.typeAndSubmit('/tree', false)
    await stage.wait(2000)
    await stage.say('views-window-done', 'Attach, never convert',
      'Nothing changed — only how it is drawn. A view is a behaviour you ATTACH, so a branch can carry several at once and you switch between them. Your work is never converted into anything.')
    await stage.typeAndSubmit('/tree off', false)
    stage.emit('views:close', {})
    await stage.wait(700)
  },
})

// ── 150 · the features window ──────────────────────────────────────────

tutorialLessons.register({
  id: 'window-features',
  level: L,
  order: 150,
  title: 'The features window',
  pheromones: ['tutorial', 'lesson', 'expert', 'structure', 'appearance'],
  requires: () => hasWindow('hc-features-viewer'),
  async run(stage) {
    const label = await subject(stage, names(stage)[0], 30)

    await stage.flyToCell(label)
    await stage.say('features-window', 'What is switched on here',
      'A tile is not just its contents — behaviours are attached to it, and more cascade down from its ancestors. This window says exactly what is acting on the tile you picked, and where each one came from.')
    stage.highlight(null)

    stage.select([label])
    await stage.wait(300)
    stage.emit('controls:action', { action: 'features' })
    await stage.wait(1600)

    await stage.say('features-window-done', 'Turn things on and off',
      'You can enable one here, take one off, or fetch a behaviour you do not have yet — and see whether it is a direct mark on this tile or something inherited from further up. I am changing nothing: what is on your hive is your call.')
    stage.emit('features:viewer-close', {})
    stage.clearSelection()
    await stage.wait(600)
  },
})

// ── 160 · the assistant ────────────────────────────────────────────────

tutorialLessons.register({
  id: 'window-assistant',
  level: L,
  order: 160,
  title: 'The assistant',
  pheromones: ['tutorial', 'lesson', 'expert', 'assistant'],
  async run(stage) {
    await stage.flyToRect(stage.commandInput())
    await stage.say('assistant-window', 'Asking, with the tiles attached',
      'You can ask for help from right here. /opus, /sonnet or /haiku open the ask screen: type the question, then tap tiles to send as context. No tiles tapped means the page you are on.')
    stage.highlight(null)

    await stage.say('assistant-window-bees', 'Work you can watch',
      'While a question is in flight a bee flies over the tiles it is working on. Click the bee to see what was asked, where the answer will land, and add more context mid-flight.')

    await stage.say('assistant-window-done', 'Answers land as notes',
      'Answers come back as NOTES on the tiles they are about — never a chat log you have to keep somewhere else. /atomize asks it to break a tile into its pieces; /organize asks it to insert a level into a crowded page. Both hand back a plan the hive checks before it moves anything.')
  },
})

// ── 170 · the observe window ───────────────────────────────────────────

tutorialLessons.register({
  id: 'window-observe',
  level: L,
  order: 170,
  title: 'The observe window',
  pheromones: ['tutorial', 'lesson', 'expert', 'swarm'],
  teaches: ['observe'],
  requires: () => hasBehaviour('observe') && hasWindow('hc-observe-viewer'),
  async run(stage) {
    await stage.flyToRect(stage.commandInput())
    await stage.say('observe-window', 'Who else is out there',
      'Your hive is yours and private until you say otherwise. /observe is the window onto the swarm: who is here and what they have chosen to share.')
    stage.highlight(null)

    await stage.typeAndSubmit('/observe', false)
    await stage.wait(1800)
    await stage.say('observe-window-done', 'Always deliberate',
      'Watching is free and costs you nothing. Going the other way — /host to publish a branch, /invite to make a meeting place — is always your own move, and I will not flip any of it for you. When you are ready it is one deliberate act, and it is reversible.')
    await stage.typeAndSubmit('/observe', false)
    await stage.wait(700)
  },
})
