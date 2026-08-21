// diamondcoreprocessor.com/tutorial/lessons/intermediate.lessons.ts
//
// THE INTERMEDIATE COURSE — giving the hive meaning.
//
// Beginner teaches the verbs that change tiles; this course teaches the ones
// that change what tiles MEAN: pheromones and the collections they build,
// titles, references, the palette, and history as a place you can travel.
//
// Every lesson gates on the behaviour it teaches actually being registered
// (`requires`), so a build without a behaviour simply has one lesson fewer.

import { tutorialLessons, TUTORIAL_DEMO_MARK as PRACTICE_MARK } from '../tutorial-lesson.js'
import { hasBehaviour, showFilter, subject, subjects } from './lesson-kit.js'

const L = 'intermediate' as const

const names = (stage: { t(k: string, f: string): string }): string[] => [
  stage.t('tutorial.name.note0', 'Ideas'),
  stage.t('tutorial.name.note1', 'Reading'),
  stage.t('tutorial.name.note2', 'Errands'),
]

tutorialLessons.register({
  id: 'keyword',
  level: L,
  order: 10,
  title: 'Paint a pheromone',
  pheromones: ['tutorial', 'lesson', 'intermediate', 'meaning'],
  teaches: ['keyword'],
  requires: () => hasBehaviour('keyword'),
  async run(stage) {
    const two = await subjects(stage, 2, names(stage), 8)

    await stage.flyToCell(two[0])
    await stage.say('keyword', 'Pheromones',
      'Tiles carry MARKS — pheromones. A mark says what a tile is, and anything wearing the same mark belongs together, wherever it lives.')
    stage.highlight(null)

    stage.select(two)
    await stage.wait(300)
    await stage.flyToRect(stage.commandInput())
    await stage.typeAndSubmit(`/keyword ${PRACTICE_MARK}`, true)
    await stage.wait(1000)
    stage.highlight(null)

    await stage.say('keyword-done', 'Marked',
      'Both tiles now wear “{mark}”. Paint the same mark anywhere in your hive and those tiles join the same collection — no folder, no moving anything.',
      { params: { mark: PRACTICE_MARK } })
    stage.clearSelection()
  },
})

tutorialLessons.register({
  id: 'filter',
  level: L,
  order: 20,
  title: 'Find by mark',
  pheromones: ['tutorial', 'lesson', 'intermediate', 'meaning'],
  async run(stage) {
    await subjects(stage, 2, names(stage), 8)

    await stage.flyToRect(stage.commandInput())
    await stage.say('filter', 'Filtering',
      'Type >? in the command line and the page filters as you type — by name, by mark, live. It never moves anything; it just narrows what you see.')
    stage.highlight(null)

    // A filter line is never SUBMITTED — see showFilter. Submitting it used to
    // create a stray tile named "practice" instead of narrowing anything.
    await showFilter(stage, PRACTICE_MARK)
    await stage.wait(1400)

    await stage.say('filter-done', 'Narrowed',
      'Only what matches is left standing. /clear puts everything back — the filter is a lens, never a change.')
    await stage.typeAndSubmit('/clear', false)
    await stage.wait(800)
  },
})

tutorialLessons.register({
  id: 'title',
  level: L,
  order: 30,
  title: 'Rename without moving',
  pheromones: ['tutorial', 'lesson', 'intermediate', 'structure'],
  teaches: ['title'],
  requires: () => hasBehaviour('title'),
  async run(stage) {
    const label = await subject(stage, names(stage)[0], 9)
    await stage.flyToCell(label)
    await stage.say('title', 'Titles',
      'A tile’s NAME is its address — everything points at it. So renaming does not move it: /title gives it new words to draw under, and every link stays good.')
    stage.highlight(null)

    const pretty = stage.t('tutorial.name.title-demo', 'Bright Ideas')
    await stage.flyToRect(stage.commandInput())
    await stage.typeAndSubmit(`/title ${label} = ${pretty}`, true)
    await stage.wait(1200)
    stage.highlight(null)

    await stage.say('title-done', 'Retitled',
      'It reads as “{title}” now, and it is still exactly where it was. /title {cell} = clears it again.',
      { params: { title: pretty, cell: label } })
  },
})

tutorialLessons.register({
  id: 'reference',
  level: L,
  order: 40,
  title: 'Point at another place',
  pheromones: ['tutorial', 'lesson', 'intermediate', 'structure'],
  teaches: ['reference'],
  requires: () => hasBehaviour('reference'),
  async run(stage) {
    const target = await subject(stage, names(stage)[0], 10)
    await stage.flyToRect(stage.commandInput())
    await stage.say('reference', 'References',
      'One thing often belongs in several places. A reference tile is a live pointer: click it and you land on the real thing, which stays where it lives.')
    stage.highlight(null)

    // `/reference <path>` names the new tile after the target's LAST SEGMENT
    // and refuses when that name already lives here — which, for a sibling on
    // this very page, is always. So name the doorway explicitly, and give the
    // FULL path: the target is resolved from the hive root, not from where we
    // are standing, so a bare sibling name pointed outside the practice page.
    const doorway = stage.t('tutorial.name.doorway', 'Doorway')
    const path = [...stage.practice.base, stage.practice.name, target].join('/')
    const before = stage.labels().length
    await stage.typeAndSubmit(`/reference ${doorway} = ${path}`, true)
    // Assert it landed, so a future refusal fails loudly instead of leaving the
    // next bubble narrating over a page where nothing happened.
    await stage.waitForCells(labels => labels.length > before, 6000)
    await stage.wait(600)

    await stage.say('reference-done', 'Pointed',
      'That new tile is a doorway, not a copy. Change the original and the doorway shows the change — one truth, many ways in.')
  },
})

tutorialLessons.register({
  id: 'into',
  level: L,
  order: 45,
  title: 'File a tile away',
  pheromones: ['tutorial', 'lesson', 'intermediate', 'structure'],
  teaches: ['into'],
  requires: () => hasBehaviour('into'),
  async run(stage) {
    // Three tiles: two to file, one to file them INTO. Everything happens inside
    // the practice page — the Organizer half of this lesson is narrated, because
    // a real collection is a root of its own and that is outside our sandbox.
    const three = await subjects(stage, 3, names(stage), 11)
    const box = three[2]

    await stage.flyToCell(box)
    await stage.say('into', 'Filing things away',
      'A reference lends a tile a second doorway and leaves it where it is. Filing is the other act: the tile MOVES. It goes inside another tile and stops being on this page at all.')
    stage.highlight(null)

    stage.select([three[0], three[1]])
    await stage.wait(300)
    await stage.flyToRect(stage.commandInput())
    await stage.typeAndSubmit(`/into ${box}`, true)
    await stage.wait(1400)
    stage.highlight(null)

    await stage.enterCell(box)
    await stage.wait(600)
    await stage.say('into-done', 'Moved in',
      'There they are, living in “{cell}”. The page you took them from does not hold them any more — that is what makes this tidying rather than tagging. Undo puts them straight back; nothing was deleted.',
      { params: { cell: box } })
    await stage.leave()
    await stage.wait(500)

    // The same act at hive scale. Shown, not performed: pressing Move needs a
    // real collection to land in, and making one would reach outside the
    // practice page.
    // The button's aria-label is `collections-landing.title` ("Portals"). It
    // was `pools.title` until the Organizer → Places → Portals renames, after
    // which `chrome('pools.title')` matched nothing and this whole beat — the
    // hive-scale half of the lesson — was silently skipped.
    const pools = stage.chrome('collections-landing.title')
    if (pools) {
      await stage.flyToRect(pools)
      await stage.ghostClick(pools.left + pools.width / 2, pools.top + pools.height / 2)
      await stage.wait(900)
      await stage.say('into-organizer', 'Anywhere in the hive',
        'Portals do this across your whole hive. Walk into a collection, pick tiles wherever they are, and it offers both verbs: Add leaves them where they live, Move brings them in. Holding Ctrl while you drag one tile onto another is the same act again, on one page.')
      await stage.ghostClick(pools.left + pools.width / 2, pools.top + pools.height / 2)
      await stage.wait(400)
      stage.highlight(null)
    }
  },
})

tutorialLessons.register({
  id: 'palette',
  level: L,
  order: 50,
  title: 'The command palette',
  pheromones: ['tutorial', 'lesson', 'intermediate', 'guidance'],
  async run(stage) {
    const c = stage.center()
    await stage.flyTo(c.x, c.y - 100)
    await stage.say('palette', 'The palette',
      'Every action you could reach for a key to do is in one list. Open the palette, start typing what you want, and it finds it — you never have to remember a shortcut.')

    stage.invoke('ui.commandPalette')
    await stage.wait(1100)
    // The palette is built from BOUND actions — the keymap, nothing else. It
    // reads neither the slash behaviours nor the views, so "commands, views,
    // behaviours" was a promise it does not keep. And /help opens the reference
    // SHEET (three searchable lists), not tiles.
    await stage.say('palette-done', 'Search, don’t remember',
      'Everything the keyboard can do, searchable by what it MEANS rather than by its keystroke. Escape closes it. /help opens the other half — the reference sheet, with every slash behaviour and every shortcut in one searchable list.')
    // The escape cascade has no palette rung: the palette only answers Escape
    // when its own input holds DOM focus, which a ghost cursor never gives it.
    // `global.escape` was therefore a silent no-op that left the palette up —
    // holding the InputGate and its keybinding suppression — for the rest of
    // the course. `command-palette:close` is the drone's own close channel.
    stage.emit('command-palette:close', {})
    await stage.wait(400)
  },
})

tutorialLessons.register({
  id: 'history',
  level: L,
  order: 60,
  title: 'Walk your history',
  pheromones: ['tutorial', 'lesson', 'intermediate', 'history'],
  teaches: ['history'],
  requires: () => hasBehaviour('history'),
  async run(stage) {
    await stage.flyToRect(stage.commandInput())
    await stage.say('history', 'History',
      'Undo is only the doorway. Every change you have ever made is a revision you can travel to — the history panel is the road.')
    stage.highlight(null)

    await stage.typeAndSubmit('/history', false)
    await stage.wait(1500)
    await stage.say('history-done', 'The whole road',
      'Slide back through the revisions and the page shows you how it looked. Nothing is overwritten here — new work is always a new revision.')
    await stage.typeAndSubmit('/history', false)
    await stage.wait(700)
  },
})

tutorialLessons.register({
  id: 'snapshot',
  level: L,
  order: 70,
  title: 'Checkpoints you can name',
  pheromones: ['tutorial', 'lesson', 'intermediate', 'history'],
  teaches: ['snapshot', 'restore'],
  requires: () => hasBehaviour('snapshot'),
  async run(stage) {
    // NARRATED, not performed: /snapshot and /restore act on the WHOLE hive,
    // not the practice page. A tutorial never changes anything outside its own
    // sandbox — the participant runs these when they mean them.
    await stage.flyToRect(stage.commandInput())
    await stage.say('snapshot', 'Snapshots',
      '/snapshot freezes your WHOLE hive under a name — before a big rearrange, say. /restore <name> makes that moment the live hive again.')
    stage.highlight(null)
    await stage.say('snapshot-done', 'Safe to experiment',
      'I am not running those now — they reach past our practice page, and that is yours to decide. Try them when you have something worth keeping.')
  },
})

