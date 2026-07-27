// diamondcoreprocessor.com/tutorial/lessons/beginner.lessons.ts
//
// THE BEGINNER COURSE — the everyday verbs, once you can move and make.
// Select, edit, note, copy, paste, remove, undo, fit, arrange. Every one runs
// through the participant's own binding (`keymap:invoke`), so what the bee
// demonstrates is exactly what the keystroke does.
//
// Ordered most obvious and simplest first: you must be able to SELECT before
// copy or remove mean anything, so selection leads.

import { tutorialLessons } from '../tutorial-lesson.js'
import { cover, subject, subjects } from './lesson-kit.js'

const L = 'beginner' as const

/** Practice names, localized with plain fallbacks. */
const names = (stage: { t(k: string, f: string): string }): string[] => [
  stage.t('tutorial.name.note0', 'Ideas'),
  stage.t('tutorial.name.note1', 'Reading'),
  stage.t('tutorial.name.note2', 'Errands'),
]

tutorialLessons.register({
  id: 'select',
  level: L,
  order: 10,
  title: 'Select tiles',
  pheromones: ['tutorial', 'lesson', 'beginner', 'editing'],
  async run(stage) {
    const three = await subjects(stage, 3, names(stage), 2)

    await stage.flyToCell(three[0])
    await stage.say('select', 'Selecting',
      'A plain click goes INSIDE a tile. To pick tiles without leaving, hold Ctrl and click — that selects. Ctrl+drag paints a whole run of them.')
    stage.highlight(null)

    // The same service the pointer path drives — a scripted select and a real
    // Ctrl+click end in exactly the same place.
    for (const label of three.slice(0, 2)) {
      const point = stage.point(label)
      if (point) await stage.ghostClick(point.x, point.y, { hold: 240 })
      stage.select([label])
      await stage.wait(220)
    }

    await stage.say('selected', 'Selected',
      'Two tiles picked. Selection is what every command acts on — copy, cut, remove, keywords. Ctrl+click a selected tile again to drop it.')

    stage.clearSelection()
    await stage.wait(200)
  },
})

tutorialLessons.register({
  id: 'edit',
  level: L,
  order: 20,
  title: 'Edit a tile',
  pheromones: ['tutorial', 'lesson', 'beginner', 'editing'],
  async run(stage) {
    const label = await subject(stage, names(stage)[0], 3)
    await stage.flyToCell(label)
    await stage.say('edit', 'Editing',
      'Hover a tile and press E — or click its pencil — to open the editor. Words, pictures, links: the tile’s contents live there.')
    stage.highlight(null)

    await stage.editCell(label)
    await stage.wait(900)
    await stage.say('editor', 'The editor',
      'Type to write, drop a picture in, and Escape closes it again. Nothing is lost — every change becomes one revision you can walk back.')

    stage.invoke('global.escape')
    await stage.wait(400)
  },
})

tutorialLessons.register({
  id: 'note',
  level: L,
  order: 30,
  title: 'Leave a note',
  pheromones: ['tutorial', 'lesson', 'beginner', 'editing', 'meaning'],
  async run(stage) {
    const label = await subject(stage, names(stage)[0], 4)
    await stage.flyToCell(label)
    await stage.say('note', 'Notes',
      'Every tile can carry notes — the explanation that belongs WITH the thing, not in some other document. Let me leave one.')
    stage.highlight(null)

    stage.emit('notes:panel', { visible: true })
    await stage.wait(700)
    stage.emit('note:commit', {
      cellLabel: label,
      text: stage.t('tutorial.note.sample', 'A note lives on the tile — anyone who visits reads it here.'),
    })
    await stage.wait(800)

    await stage.say('note-done', 'Noted',
      'That note now travels with the tile: share it, adopt it, walk its history — the note comes too.')
    stage.emit('notes:panel', { visible: false })
    await stage.wait(300)
  },
})

tutorialLessons.register({
  id: 'copy-paste',
  level: L,
  order: 40,
  title: 'Copy and paste',
  pheromones: ['tutorial', 'lesson', 'beginner', 'editing'],
  async run(stage) {
    const two = await subjects(stage, 2, names(stage), 5)
    const source = two[0]
    const into = two[1]

    await stage.flyToCell(source)
    stage.select([source])
    await stage.say('copy', 'Copy',
      'Pick a tile and press Ctrl+C. The copy carries everything — its pictures, its notes, its whole branch.')
    stage.highlight(null)
    stage.invoke('clipboard.copy')
    await stage.wait(500)

    await stage.enterCell(into)
    await stage.say('paste', 'Paste',
      'Now Ctrl+V drops it wherever you are standing. Watch — inside “{cell}”.',
      { params: { cell: into } })
    stage.invoke('clipboard.paste')
    await stage.wait(1200)

    await stage.say('paste-done', 'Pasted',
      'Same tile, second home. Cut (Ctrl+X) does the same but takes it with you instead of leaving the original.')
    stage.clearSelection()
    await stage.leave()
  },
})

tutorialLessons.register({
  id: 'remove',
  level: L,
  order: 50,
  title: 'Remove a tile',
  pheromones: ['tutorial', 'lesson', 'beginner', 'editing'],
  async run(stage) {
    const spare = await stage.create(stage.t('tutorial.name.spare', 'Spare'), cover(6))
    await stage.flyToCell(spare)
    stage.select([spare])
    await stage.say('remove', 'Removing',
      'Select a tile and press Delete. If it has anything nested inside, you get asked first — a branch never leaves quietly.')
    stage.highlight(null)

    stage.invoke('selection.remove')
    await stage.waitForCells(labels => !labels.includes(spare), 6000)
    await stage.wait(400)

    await stage.say('remove-done', 'Gone',
      'Gone from the page — but not from history. Nothing you do here is unrecoverable; the next lesson brings it straight back.')
  },
})

tutorialLessons.register({
  id: 'undo-redo',
  level: L,
  order: 60,
  title: 'Undo and redo',
  pheromones: ['tutorial', 'lesson', 'beginner', 'history'],
  async run(stage) {
    // Stand alone: make something and remove it, so there is a change to undo.
    const doomed = await stage.create(stage.t('tutorial.name.spare', 'Spare'), cover(6))
    stage.select([doomed])
    stage.invoke('selection.remove')
    await stage.waitForCells(labels => !labels.includes(doomed), 6000)
    stage.clearSelection()

    const c = stage.center()
    await stage.flyTo(c.x, c.y - 70)
    await stage.say('undo', 'Undo',
      'Ctrl+Z walks the page back one change. Every single thing you do is one revision — so undo always knows exactly what to take back.')

    stage.invoke('history.undo')
    await stage.waitForCells(labels => labels.includes(doomed), 6000)
    await stage.wait(500)

    await stage.say('redo', 'Redo',
      'Back it comes. Ctrl+Shift+Z steps forward again — you can walk your work in both directions.')
    stage.invoke('history.redo')
    await stage.wait(900)
    // Leave the page as we found it.
    stage.invoke('history.undo')
    await stage.wait(700)
  },
})

tutorialLessons.register({
  id: 'fit',
  level: L,
  order: 70,
  title: 'Fit and centre',
  pheromones: ['tutorial', 'lesson', 'beginner', 'navigation'],
  async run(stage) {
    const c = stage.center()
    await stage.flyTo(c.x + 30, c.y - 80)
    await stage.say('fit', 'Fit',
      'Wandered off? Fit brings the whole page back into view in one move — the button in the bar, or its key.')
    stage.invoke('navigation.fitToScreen')
    await stage.wait(900)
    await stage.say('fit-done', 'Framed',
      'Everything back on screen. Between Fit, Back and Home you can always get your bearings.')
  },
})

tutorialLessons.register({
  id: 'arrange',
  level: L,
  order: 80,
  title: 'Arrange the page',
  pheromones: ['tutorial', 'lesson', 'beginner', 'appearance', 'structure'],
  async run(stage) {
    await subjects(stage, 3, names(stage), 7)
    const c = stage.center()
    await stage.flyTo(c.x, c.y - 90)
    await stage.say('arrange', 'Arranging',
      'Tiles fill the page in a sequence — a spiral, a line, a ring. Cycle the sequence and the page rearranges itself.')
    stage.invoke('sequence.cycle')
    await stage.wait(1100)
    stage.invoke('sequence.cycle')
    await stage.wait(1100)
    await stage.say('arrange-done', 'Arranged',
      'Same tiles, different shape. You can also drag a tile where you want it — the arrangement is yours, and it is remembered.')
  },
})
