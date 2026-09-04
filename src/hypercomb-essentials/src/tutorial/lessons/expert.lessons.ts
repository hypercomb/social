// tutorial/lessons/expert.lessons.ts
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
//
// 1:1 IS A THING THAT ROTS. The roster drifted from the interface between
// 2026-08-02 and 2026-08-20 in BOTH directions, and both are failures of the
// same rule: `window-views` and `window-features` had become two lessons for
// ONE window (the Views toolwindow was retired and `/views` became a lens on
// the beehaviors panel), while the format painter, the notes reader, the
// workflow designer, the feedback window and the publish panel had shipped
// with no lesson at all. Retiring a window means retiring its lesson in the
// same pass, exactly as adding one means adding a lesson.

import { tutorialLessons, TUTORIAL_DEMO_MARK as PRACTICE_MARK } from '../tutorial-lesson.js'
import { hasBehaviour, hasWindow, showFilter, subject, subjects } from './lesson-kit.js'
import { isLocalClaudeBridgeConfigured, isParticipantAiHostConfigured } from '@hypercomb/core'

const L = 'expert' as const
const chatConfigured = (): boolean =>
  isLocalClaudeBridgeConfigured() || isParticipantAiHostConfigured()

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
  summary: 'One box, four languages: a name makes, ? filters, / runs, and name@behaviour speaks to a tile.',
  pheromones: ['tutorial', 'lesson', 'expert', 'input', 'creation', 'structure'],
  async run(stage) {
    await stage.flyToRect(stage.commandInput())
    await stage.say('cmdline', 'One box, four languages',
      'This box speaks four languages. A NAME makes a tile. A ? filters the page as you type. A / runs a behaviour. And a tile’s name with an @ SPEAKS TO that tile — “meetup@postit Doors at 7” pins a note onto the meetup tile without going there. All four complete as you type, so nothing has to be memorised.')
    stage.highlight(null)

    const root = stage.t('tutorial.name.project', 'Project')
    const items = [root, `${root}/${stage.t('tutorial.name.notes', 'Notes')}`, `${root}/${stage.t('tutorial.name.tasks', 'Tasks')}`]
    await stage.typeAndSubmit(`[${items.join(', ')}]`, true)
    await stage.waitForLabel(root)
    await stage.wait(900)

    await stage.say('cmdline-brackets', 'A shape, not a list',
      'Brackets make many tiles in ONE commit, and an item carrying a slash builds DEPTH. Three tiles, two levels, one line — and one undo takes the whole thing back.')

    // A filter line is never committed — see showFilter in the kit. Submitting
    // it fell through to create-cell and made a stray tile out of the keyword.
    await showFilter(stage, root.slice(0, 3))
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
  summary: 'The keystrokes, listed by what they DO — which is how you find one you never learned.',
  pheromones: ['tutorial', 'lesson', 'expert', 'guidance', 'input'],
  requires: () => hasWindow('hc-command-palette'),
  async run(stage) {
    const c = stage.center()
    await stage.flyTo(c.x, c.y - 100)
    await stage.say('palette-window', 'Everything the keyboard can do',
      'Every BOUND action in the hive is in one place. Open the palette, type what you MEAN, and it finds the command — no shortcut to remember, no menu to hunt through.')

    stage.invoke('ui.commandPalette')
    await stage.wait(1200)
    // The palette is built from the keymap and ONLY the keymap — it never reads
    // the slash behaviours or the view registry, so a module installing /foo
    // contributes nothing here. Slash behaviours are the command line's `/`
    // language and the /help sheet's business; this window is the keystrokes.
    await stage.say('palette-window-done', 'Search, don’t remember',
      'It is the keystrokes, listed by what they DO — which is why you can find a shortcut you have never learned. Behaviours are the other half, and they live on the command line’s / and in the /help sheet. Escape closes this one.')
    // NOT `global.escape`: the escape cascade has no palette rung — the palette
    // answers Escape only when its own input holds DOM focus, which a ghost
    // cursor never gives it. The invoke was a silent no-op that left the palette
    // up for the rest of the course, holding the InputGate and suppressing every
    // keybinding the later lessons need. This is the drone's own close channel.
    stage.emit('command-palette:close', {})
    await stage.wait(500)
  },
})

// ── 30 · the reference ─────────────────────────────────────────────────

tutorialLessons.register({
  id: 'window-help',
  level: L,
  order: 30,
  title: 'The reference and the docs reader',
  summary: 'The quick reference sheet, and /docs for the long form explaining why the hive works this way.',
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
      'This is the quick answer — Escape closes it. /docs opens the reader for the long form, the papers explaining WHY the hive works the way it does; that one closes with its own button.')
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
  summary: 'A tile’s own face: its name, cover, one link and its two colours. Only ever what is INSIDE.',
  pheromones: ['tutorial', 'lesson', 'expert', 'editing', 'appearance'],
  requires: () => hasWindow('hc-tile-editor'),
  async run(stage) {
    const label = await subject(stage, names(stage)[0], 20)

    await stage.flyToCell(label)
    // What the dialog ACTUALLY holds: the name, the cover, one link, the two
    // colours, and the answer box. Not "words" (those are notes, order 50) and
    // not "files" (those are the files window, order 60) — claiming either sent
    // the participant hunting for panes that are not in the editor.
    await stage.say('editor-window', 'Everything a tile carries',
      'The editor is where a tile’s own face lives — its name, its cover picture, one link, and the two colours it draws in. E opens it, or the pencil on the tile.')
    stage.highlight(null)

    await stage.editCell(label)
    await stage.wait(1400)
    await stage.say('editor-window-done', 'Content, not layout',
      'It also carries the answer box, for writing back to a question asked on this tile. Nothing here changes where the tile lives or what it means — that is what the other windows are for. This one is only ever about what is INSIDE.')
    stage.invoke('global.escape')
    await stage.wait(600)
  },
})

// ── 45 · the format painter ────────────────────────────────────────────
// The editor changes what is INSIDE one tile; this changes how a tile LOOKS
// and carries that look to others. It is the only copy-appearance verb in the
// hive and had no lesson at all.

tutorialLessons.register({
  id: 'window-format',
  level: L,
  order: 45,
  title: 'The format painter',
  summary: 'Read one tile’s look, tick the parts you meant, and carry it to the tiles you choose.',
  pheromones: ['tutorial', 'lesson', 'expert', 'appearance', 'editing'],
  teaches: ['format'],
  requires: () => hasBehaviour('format') && hasWindow('hc-format-painter'),
  async run(stage) {
    const three = await subjects(stage, 3, names(stage), 31)

    await stage.flyToCell(three[0])
    await stage.say('format-window', 'How a look travels',
      'The editor changes what is inside ONE tile. This changes how a tile LOOKS — and carries that look to others. Pick the tile whose appearance you want to spread, and open the painter.')
    stage.highlight(null)

    stage.select([three[0]])
    await stage.wait(300)
    await stage.typeAndSubmit('/format', false)
    await stage.wait(1600)

    await stage.say('format-window-pick', 'Choose what travels',
      'It reads that tile’s visual properties and lists them one by one — its colours, its border, its cover. You tick only the ones you meant. Copying a look is rarely copying ALL of it, so nothing is taken that you did not choose.')

    await stage.say('format-window-done', 'Apply, and nothing else moves',
      'Then pick the tiles to carry it to and press Apply. It touches appearance and nothing else: no tile moves, nothing is renamed, no meaning changes hands. Running /format again puts the painter away.')

    // The same command closes it — that is the queen's own toggle.
    await stage.typeAndSubmit('/format', false)
    stage.clearSelection()
    await stage.wait(600)
  },
})

// ── 50 · the notes window ──────────────────────────────────────────────

tutorialLessons.register({
  id: 'window-notes',
  level: L,
  order: 50,
  title: 'The writing window',
  summary: 'Two tabs over one tree — NOTES for reasoning, LISTS for order — edited in place.',
  pheromones: ['tutorial', 'lesson', 'expert', 'editing', 'meaning'],
  requires: () => hasWindow('hc-notes-strip'),
  async run(stage) {
    const label = await subject(stage, names(stage)[0], 21)

    await stage.flyToCell(label)
    await stage.say('notes-window', 'The explanation, on the thing',
      'Notes are the writing that belongs WITH a tile rather than in some other document. This window shows the ones on the tile you are looking at.')
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

    // The window has TWO tabs. Teaching only the notes half broke this course's
    // own rule that a window and all its verbs are learned as one thing.
    await stage.say('notes-window-lists', 'Notes, and lists',
      'The window carries two tabs over the same tree. NOTES is prose — the reasoning. LISTS is the other half: an always-open line where items go in one after another and stay in the order you put them. Same tile, same tree, two ways of writing on it.')

    await stage.say('notes-window-done', 'Written to be read',
      'Click a note and it opens right here, in the window’s own reading pane, where you can edit it in place — and the pane has its own face, so you can set the type you read in. Everything you write here travels with the tile: share it, adopt it, walk its history, the note comes too.')
    stage.emit('notes:panel', { visible: false })
    await stage.wait(500)
  },
})

// ── 55 · the notes reader ──────────────────────────────────────────────
// A window of its own, and a different job: the writing window is where
// you WRITE (a dense tree, edited in place); the reader is where you READ (one
// note at a time, big, with its hierarchy around it). Taught back to back.

tutorialLessons.register({
  id: 'window-reader',
  level: L,
  order: 55,
  title: 'The notes reader',
  summary: 'The reading half: one note at a time, drawn big, with its place in the outline around it.',
  pheromones: ['tutorial', 'lesson', 'expert', 'editing', 'meaning'],
  requires: () => hasWindow('hc-notes-viewer'),
  async run(stage) {
    const label = await subject(stage, names(stage)[0], 32)

    await stage.flyToCell(label)
    stage.emit('notes:panel', { visible: true })
    await stage.wait(700)
    stage.emit('note:commit', {
      cellLabel: label,
      text: stage.t('tutorial.note.reader',
        'A tile can hold a whole argument, not a caption — and an argument wants to be read at length.'),
    })
    await stage.wait(900)
    stage.highlight(null)

    // The book button on the writing window is the ONLY emitter of
    // `notes:open` — this is that button's own effect, not a private hook.
    stage.emit('notes:open', { cellLabel: label })
    await stage.wait(1600)

    await stage.say('reader-window', 'Written to be written, opened to be read',
      'The writing window is where you WRITE: a dense tree you edit in place. This is where you READ — one note at a time, drawn big, with its place in the tree around it.')

    await stage.say('reader-window-tabs', 'One tile, several documents',
      'The tabs down the side are this tile’s root notes: each one is a little document made of everything nested under it, so a tile with four roots reads as four. Previous and Next walk depth-first inside the one you are in, and wrap round at either end.')

    await stage.say('reader-window-done', 'And a mark can land on a note',
      'Click any row in the outline and the reading jumps there. One gesture lives only here: with the Pheromones palette open, drag a mark onto a row and it lands on the NOTE rather than the tile — which is how a single paragraph joins a collection.')

    stage.emit('notes:viewer-close', {})
    stage.emit('notes:panel', { visible: false })
    await stage.wait(600)
  },
})

// ── 60 · the files window ──────────────────────────────────────────────

tutorialLessons.register({
  id: 'window-files',
  level: L,
  order: 60,
  title: 'The files window',
  summary: 'Everything real your tiles carry, scoped to this tile, this page, or the whole branch.',
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
  summary: 'Every mark your hive is built from, plus the collecting walk that arms them and marks as you go.',
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
    // The PAINT BRUSH is gone (the collecting walk replaced it): armed marks no
    // longer take over the pointer, ctrl+click is the marking gesture, and a
    // mark dropped on empty canvas does nothing at all — it has to land on a
    // tile. A participant told to "paint" would click tiles and just walk in.
    await stage.say('tags-window-collect', 'Gather, then walk',
      'Gather marks in the window and they arm — then walk the hive exactly as you always do and ctrl+click each tile into the grouping. Plain clicks still go in and out; marking never takes the hive over. Done commits the whole collection in one pass, and dropping a mark straight onto a tile lands it there and then.')

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
  summary: 'The index of every aggregate — collections, websites — where a row is a doorway, never a copy.',
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
      'Drag a tile onto a row and it is ADDED — the row lends it a second doorway and leaves it exactly where it lives. Pick tiles on the canvas instead and they stage in the tray, which offers the other verb too: Move takes custody. The window is the same for every aggregate, so a new kind of index inherits all of this for free.')

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

// ── 100 · the clipboard window ─────────────────────────────────────────

tutorialLessons.register({
  id: 'window-clipboard',
  level: L,
  order: 100,
  title: 'The clipboard window',
  summary: 'Everything you have picked up, held on this machine, and a swap while the window is open.',
  pheromones: ['tutorial', 'lesson', 'expert', 'editing'],
  requires: () => hasWindow('hc-clipboard-panel'),
  async run(stage) {
    const two = await subjects(stage, 2, names(stage), 25)

    await stage.flyToCell(two[0])
    // The clipboard holds TILE entries only. Pasted images are intercepted long
    // before this and routed into the tile editor; there is no text entry type
    // at all, and never was one.
    await stage.say('clipboard-window', 'What you are carrying',
      'Copy is not a one-slot pocket here. The clipboard window shows every tile you have picked up — each one carrying its whole branch — and it stays yours, on this machine, until you place it.')
    stage.highlight(null)

    stage.select([two[0]])
    await stage.wait(300)
    stage.invoke('clipboard.copy')
    await stage.wait(700)
    stage.emit('clipboard:panel', { visible: true })
    await stage.wait(1400)

    // THE SWAP. The per-row slot field and the place (+) button this beat used
    // to describe were removed with the swap rework — a placed tile lands in the
    // next free slot like any paste, and "where" is chosen by walking there.
    await stage.say('clipboard-window-swap', 'One gesture, both directions',
      'While the window is open it is a swap. Click a tile out on the hive and it moves INTO the window; click a row and it comes back OUT, onto the page you are standing on. Ctrl+click is the walk on both sides — into a tile on the hive, into a row’s children in here.')

    await stage.say('clipboard-window-done', 'Walk there, then place',
      'A placed tile lands in the next free slot, the way any paste does — so choosing where means walking there first, which is exactly what the ctrl+click is for. It brings its whole branch with it: pictures, notes and all. Nothing here ever leaves your machine.')
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
  summary: 'The shapes tiles land in, and the target that decides where a drop comes to rest.',
  pheromones: ['tutorial', 'lesson', 'expert', 'appearance', 'structure'],
  teaches: ['sequence'],
  requires: () => hasBehaviour('sequence') && hasWindow('hc-sequence-viewer'),
  async run(stage) {
    await subjects(stage, 3, names(stage), 26)

    await stage.flyToRect(stage.commandInput())
    await stage.say('sequence-window', 'How a page fills up',
      'Tiles do not land at random — they fill the page along a SEQUENCE. This window is the set of them: a compact block, clusters of seven around a centre, and the ones you save yourself.')
    stage.highlight(null)

    await stage.typeAndSubmit('/sequence', false)
    await stage.wait(1600)
    await stage.say('sequence-window-done', 'Also where things land',
      'A sequence is also a target: it decides where a dropped file or a pasted branch comes to rest. Cycle it from the keyboard and the page rearranges under you — nothing is lost, only re-laid.')
    stage.emit('sequence:view-close', {})
    await stage.wait(600)
  },
})

// ── 115 · the workflow designer ────────────────────────────────────────
// A whole verb family (`/workflow new | run | step | stop | list`) and a
// docked window that had no lesson. Its central claim is worth teaching
// first: THE CANVAS IS THE WORKFLOW.

tutorialLessons.register({
  id: 'window-workflow',
  level: L,
  order: 115,
  title: 'The workflow designer',
  summary: 'A workflow is a tile and its steps are its children — so the page you see IS the graph.',
  pheromones: ['tutorial', 'lesson', 'expert', 'structure', 'input'],
  teaches: ['workflow'],
  requires: () => hasBehaviour('workflow') && hasWindow('hc-workflow-designer'),
  async run(stage) {
    await subjects(stage, 3, names(stage), 33)

    await stage.flyToRect(stage.commandInput())
    await stage.say('workflow-window', 'The canvas IS the workflow',
      'A workflow here is not a diagram of boxes and arrows. It is a TILE, its steps are its child tiles, and they run in the order you can already see. That is why this window draws no node graph — the page in front of you is the graph.')
    stage.highlight(null)

    await stage.typeAndSubmit('/workflow', false)
    await stage.wait(1700)

    await stage.say('workflow-window-palette', 'Everything the hive answers to',
      'The palette on the left is what a step can BE: the control kinds, and every slash behaviour your hive knows. Drag one onto the canvas and it becomes a step tile, sitting on the page like any other tile — because it is one.')

    await stage.say('workflow-window-run', 'Watch it walk',
      'The bar runs it: go, or one step at a time, with each step reporting as it lands. Stepping is the point — a workflow you can walk through is a workflow you can trust, and the steps you are watching are the tiles you already know how to read.')

    await stage.say('workflow-window-done', 'A named workflow is a skill',
      '/workflow new gives it a name, and a named workflow becomes something the hive can be ASKED for by that name — /workflow run <name>, or from anywhere the skill is offered. I am not running anything on your hive: the steps here are ours, on the practice page.')

    stage.emit('workflow:view-close', {})
    await stage.wait(700)
  },
})

// ── 120 · the history window ───────────────────────────────────────────

tutorialLessons.register({
  id: 'window-history',
  level: L,
  order: 120,
  title: 'The history window',
  summary: 'The whole road of revisions, in order, with what changed at each step and marks you can name.',
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
  summary: 'Recent moments drawn as they looked, so you pick the one you meant instead of guessing.',
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

// ── 140 · the beehaviors window ────────────────────────────────────────
//
// ONE WINDOW, ONE LESSON. There used to be two here — `window-views` and
// `window-features` — because there used to be two windows. The Views
// toolwindow was retired (`hc-views-viewer` is deleted); `/views` now only
// narrows this window's LENS, so both lessons were opening the same surface,
// closing it with the same effect, and telling the participant they were
// looking at two different things. Views are a subset of beehaviours, and the
// window says so: they are the same rows, on their own coloured ground.
//
// `window-views` is retired as a lesson id. The teaching is all here.

tutorialLessons.register({
  id: 'window-features',
  level: L,
  order: 140,
  title: 'The beehaviors window',
  summary: 'Every behaviour the hive knows, which are acting here, and where each one flows from.',
  pheromones: ['tutorial', 'lesson', 'expert', 'view', 'structure', 'appearance'],
  teaches: ['views', 'tree', 'website', 'present', 'postit', 'tutor'],
  requires: () => hasWindow('hc-features-viewer'),
  async run(stage) {
    await subjects(stage, 3, names(stage), 29)

    // The panel is LAYER-scoped and follows navigation — it is opened on where
    // you STAND, not on a tile you picked. The old `controls:action {features}`
    // route needed the selected tile to already carry a registered decoration
    // kind, so on a bare practice tile it opened nothing and the lesson talked
    // for two seconds over an unchanged screen. (The per-tile door it mirrored
    // has itself been removed.) `features:context-open` is the top-rail switch.
    stage.emit('features:context-open', {})
    await stage.wait(1600)

    const c = stage.center()
    await stage.flyTo(c.x, c.y - 100)
    await stage.say('features-window', 'What is switched on here',
      'A page is not just its tiles — behaviours are switched on for it, and more cascade down from further up. This window is the list of every behaviour the hive knows, and it says which of them are acting where you are standing, and where each one came from.')

    await stage.say('features-window-bulb', 'One row, one bulb',
      'There is one control per row and it is a light bulb. In the pool it lights the behaviour for your whole hive; on a layer it deposits the behaviour right here. An inherited row tells you where it flows from, and flips at its origin. Nothing else on the row does anything — that is the whole story.')

    // Views are behaviours; the lens is the only difference.
    await stage.typeAndSubmit('/views', false)
    await stage.wait(1500)
    await stage.say('features-window-views', 'Another way of seeing',
      'Some of those behaviours are VIEWS — ways of drawing the same tiles as something else. They are not a separate window: /views just narrows this list to them, and they wear their own colour so you can tell at a glance.')

    await stage.say('features-window-kinds', 'A tree, a site, a deck, a game',
      '/tree lays a branch out sideways, trunk on the left. /website renders it as pages. /present plays it as slides. /postit pins it up as paper — that one takes the tile’s whole presence, so no hexagon is drawn at all. /tutor turns it into study games. Same tiles every time.')

    await stage.typeAndSubmit('/tree', false)
    await stage.wait(2000)
    await stage.say('features-window-done', 'Attach, never convert',
      'Nothing changed — only how it is drawn. A view is a behaviour you ATTACH, so a branch can carry several at once and the one its row shows as the icon is the one it OPENS as. Your work is never converted into anything, and I am changing nothing: what is switched on in your hive is your call.')
    await stage.typeAndSubmit('/tree off', false)
    stage.emit('features:viewer-close', {})
    await stage.wait(700)
  },
})

// ── 160 · the assistant ────────────────────────────────────────────────

tutorialLessons.register({
  id: 'window-assistant',
  level: L,
  order: 160,
  title: 'The assistant',
  summary: 'The chat window docked beside your tiles, the context it carries, and the three structure verbs.',
  pheromones: ['tutorial', 'lesson', 'expert', 'assistant'],
  requires: () => hasWindow('hc-chat-window') && chatConfigured(),
  async run(stage) {
    await stage.flyToRect(stage.commandInput())
    await stage.say('assistant-window', 'The chat window',
      'You can ask for help from right here. A model verb — /opus, /sonnet, /haiku, /fable — or plain /ask opens the CHAT WINDOW: a conversation docked beside your tiles, so you talk ABOUT what you are looking at. Where you are standing and what you have selected is the context every question carries; the window’s footer reads it back to you.')
    stage.highlight(null)

    await stage.say('assistant-window-fullscreen', 'Or the whole screen',
      'The same window opens to the WHOLE screen, and then it grows a rail down the left: your hive as a list you can drill into, where you pick the tiles a question is about without walking there. Docked beside the hive, or full screen with the hive beside it — one window, two faces.')

    await stage.say('assistant-window-context', 'Two kinds of context',
      'Selecting tiles sends them with THIS question only. A branch dragged onto the tile as ATTACHED CONTEXT rides with EVERY question asked there — that is the paper-clip count in the chat footer, and the context window is where you manage it.')

    await stage.say('assistant-window-bees', 'Work you can watch',
      'While a question is in flight a bee flies over the tiles it is working on. Click the bee to see what was asked, where the answer will land, and add more context mid-flight.')

    // The chat window IS the durable log — that is the design, and the reply
    // is written into the thread, never as a note. Putting an answer on a tile
    // is an opt-in button per message. The old "never a chat log" line was the
    // pre-chat-window promise and is now the opposite of the truth.
    await stage.say('assistant-window-done', 'The answer stays where you asked',
      'An answer lands in the conversation and stays there — the thread is yours, and it is still here when you close the window and come back. When an answer belongs in the hive rather than the chat, each one carries a button that puts it on the tile you are standing on, as a note.')

    await stage.say('assistant-window-structure', 'Asking it to build',
      'Three verbs ask for STRUCTURE rather than an answer. /break-apart goes deeper — it mints the pieces of a tile as its children. /expand goes wider — new siblings that widen the page you are on. /organize goes shallower — it hands back a grouping PLAN, which the hive checks against the live page before it moves anything, because rewriting membership is the one move that could lose a tile.')
  },
})

// ── 165 · the context window ───────────────────────────────────────────
// The believed-missing lesson (the feature shipped without it, breaking this
// course's one-lesson-per-window rule): what ATTACHED CONTEXT is, where it is
// managed, and the promise that what is listed is what a question reads.

tutorialLessons.register({
  id: 'window-context',
  level: L,
  order: 165,
  title: 'The context window',
  summary: 'The branches attached to a tile — material every question asked there gets to read.',
  pheromones: ['tutorial', 'lesson', 'expert', 'assistant', 'structure'],
  teaches: ['context'],
  requires: () => hasBehaviour('context') && hasWindow('hc-context-window'),
  async run(stage) {
    await stage.flyToRect(stage.commandInput())
    await stage.say('context-window', 'Context that stays attached',
      'Drag a portal out of the Portals window onto a tile — an amber ring, not the teal one — and that whole branch becomes the tile’s ATTACHED CONTEXT: material every question asked there gets to read, tracking the branch as it grows. /context is the way back to what you attached.')
    stage.highlight(null)

    await stage.typeAndSubmit('/context', false)
    await stage.wait(1800)
    await stage.say('context-window-rows', 'Honest numbers',
      'One row per attached branch: how many tiles it reaches and how many signatures that resolves to, recomputed live — never a stale snapshot. When a branch is too big to walk in full, the row SAYS so instead of pretending. Click the row itself and you land on that branch; the broken-link icon at its right end takes one branch back off.')

    await stage.say('context-window-done', 'It rides with every question',
      'Everything listed here is what a configured AI request on this tile gets to draw on — in the chat window, that is the paper-clip count beside the path. Attach the branches that explain a tile once, and every future answer starts already knowing them.')
    stage.emit('context:window-close', {})
    await stage.wait(500)
  },
})

// ── 170 · the observe window ───────────────────────────────────────────

tutorialLessons.register({
  id: 'window-observe',
  level: L,
  order: 170,
  title: 'The observe window',
  summary: 'The window onto the swarm: who is here, what they share, and how taking a tile works.',
  pheromones: ['tutorial', 'lesson', 'expert', 'swarm'],
  teaches: ['observe', 'use-live-relay', 'host', 'invite'],
  requires: () => hasBehaviour('observe') && hasWindow('hc-observe-viewer'),
  async run(stage) {
    await stage.flyToRect(stage.commandInput())
    await stage.say('observe-window', 'Who else is out there',
      'Your hive is yours and private until you say otherwise. /observe is the window onto the swarm: who is here and what they have chosen to share.')
    stage.highlight(null)

    await stage.typeAndSubmit('/observe', false)
    await stage.wait(1800)

    // The way IN. A bare domain has no room, so /observe is silently empty
    // until a swarm has been joined — and joining is one command now. Narrated,
    // never fired: it goes public, which is the participant's own act.
    await stage.say('observe-window-in', 'How you get there',
      'A hive on its own is in no swarm at all, so this list starts empty. /use-live-relay is the whole way in: one command sets the relay, puts you in the shared meeting place, and goes public. I am not running it — going public is yours to decide.')

    // Taking is now the primary swarm gesture; the adopt BUTTON was retired
    // everywhere it surfaced. A lesson that only opens /observe teaches looking
    // and leaves the taking to be discovered by accident.
    await stage.say('observe-window-take', 'Taking is walking',
      'A tile someone else is sharing is drawn SHADED — that is how you know it is not yours yet. Click it and it becomes yours and you walk in, in one move. Ctrl+click, or ctrl+drag across several, takes them where they stand without going in. What you take is the tile itself; its children stay theirs until you walk in and take those too.')

    // /invite does NOT make a meeting place — it shares a way into the swarm
    // you are already in, and refuses outright without a room and a secret.
    await stage.say('observe-window-done', 'Always deliberate',
      'Watching is free and costs you nothing. Going the other way is always your own move, and I will not flip any of it for you: /host publishes the branch you are standing in and hands you a link — one act, and reversible. /invite shares a way into the meeting place you are ALREADY in, so going public comes first; without a room and a secret it refuses rather than minting a dead link.')
    await stage.typeAndSubmit('/observe', false)
    await stage.wait(700)
  },
})

// ── 175 · the publish window ───────────────────────────────────────────
// The sharing pair completed. `/host` is the GESTURE; `/publish` is the
// STATE. Strictly read-only here — course rule 2: nothing is ever published
// from a tutorial, so every row is pointed at and none is pressed.

tutorialLessons.register({
  id: 'window-publish',
  level: L,
  order: 175,
  title: 'The publish window',
  summary: 'What the world is serving right now, beside what has changed on your hive since.',
  pheromones: ['tutorial', 'lesson', 'expert', 'swarm'],
  teaches: ['publish', 'host'],
  requires: () => hasBehaviour('publish') && hasWindow('hc-publish-panel'),
  async run(stage) {
    await stage.flyToRect(stage.commandInput())
    await stage.say('publish-window', 'The gesture and the state',
      'Two verbs, deliberately not one. /host is the GESTURE — publish the branch I am standing in, hand me a link. /publish is the STATE: what the world is actually serving right now. Neither does the other’s job, which is what keeps both of them honest.')
    stage.highlight(null)

    await stage.typeAndSubmit('/publish', false)
    await stage.wait(1700)

    await stage.say('publish-window-diff', 'Live, next to here',
      'One row per branch you have published, and each row is a DIFFERENCE: what is out there, beside what has changed on your hive since. So “is the version I shared still the version I mean?” is something you can look at rather than remember.')

    await stage.say('publish-window-done', 'Every row is yours to press',
      'A row can be re-checked, re-published, copied as a link, or taken down again — nothing out there is permanent. I am pressing none of them: what your hive shows the world is only ever your own deliberate act.')

    // Toggle it away with the same verb that opened it.
    await stage.typeAndSubmit('/publish', false)
    await stage.wait(700)
  },
})
