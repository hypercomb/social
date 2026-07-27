// diamondcoreprocessor.com/tutorial/lessons/expert.lessons.ts
//
// THE EXPERT COURSE — the powerful surface.
//
// Paths that build many tiles at once, naming a whole branch, seeing the same
// tiles as something else entirely (a tree, a deck, a site), the assistant, and
// the swarm.
//
// TWO RULES this course obeys strictly:
//   1. Nothing outside the practice page is touched. Behaviours that act on the
//      whole hive (snapshots, hosting) or on the network are NARRATED and
//      pointed at, never fired.
//   2. Nothing is ever published. Going public is always the participant's own
//      deliberate act — a tutorial that shares your hive to teach you sharing
//      would be the exact opposite of the lesson.

import { tutorialLessons } from '../tutorial-lesson.js'
import { hasBehaviour, subject } from './lesson-kit.js'

const L = 'expert' as const

tutorialLessons.register({
  id: 'bracket-paths',
  level: L,
  order: 10,
  title: 'Build a shape in one line',
  pheromones: ['tutorial', 'lesson', 'expert', 'creation', 'structure'],
  async run(stage) {
    await stage.flyToRect(stage.commandInput())
    await stage.say('brackets-deep', 'Paths in brackets',
      'Brackets make many tiles at once — and an item with a slash builds DEPTH. One line can lay out a whole shape.')
    stage.highlight(null)

    const root = stage.t('tutorial.name.project', 'Project')
    const items = [root, `${root}/${stage.t('tutorial.name.notes', 'Notes')}`, `${root}/${stage.t('tutorial.name.tasks', 'Tasks')}`]
    await stage.typeAndSubmit(`[${items.join(', ')}]`, true)
    await stage.waitForLabel(root)
    await stage.wait(900)

    await stage.say('brackets-done', 'A shape, not a list',
      'One commit, three tiles, two levels deep. Everything you can draw as a path, you can type as a line.')
  },
})

tutorialLessons.register({
  id: 'hive',
  level: L,
  order: 20,
  title: 'Name a branch',
  pheromones: ['tutorial', 'lesson', 'expert', 'structure'],
  teaches: ['hive'],
  requires: () => hasBehaviour('hive'),
  async run(stage) {
    const handle = stage.t('tutorial.name.handle', 'practice-hive')
    await stage.flyToRect(stage.commandInput())
    await stage.say('hive', 'Hives',
      'Any branch can be NAMED — a complete, named piece of your world. Once it has a name, commands can take it by that name instead of a path.')
    stage.highlight(null)

    await stage.typeAndSubmit(`/hive ${handle}`, true)
    await stage.wait(1000)
    await stage.say('hive-done', 'Named',
      'That is a handle onto this whole branch — share it, open a view on it, root a tree at it. I’ll let it go again, since our page is about to disappear.')
    // Leave no handle pointing at a page we are about to delete.
    await stage.typeAndSubmit(`/hive ${handle} clear`, false)
    await stage.wait(600)
  },
})

tutorialLessons.register({
  id: 'tree',
  level: L,
  order: 30,
  title: 'See a branch as a tree',
  pheromones: ['tutorial', 'lesson', 'expert', 'view'],
  teaches: ['tree'],
  requires: () => hasBehaviour('tree'),
  async run(stage) {
    await subject(stage, stage.t('tutorial.name.project', 'Project'), 11)
    await stage.flyToRect(stage.commandInput())
    await stage.say('tree', 'The tree view',
      'The same tiles, drawn sideways: trunk on the left, one column per ring. It is the fastest way to take in the shape of a branch.')
    stage.highlight(null)

    await stage.typeAndSubmit('/tree', false)
    await stage.wait(2000)
    await stage.say('tree-done', 'Same tiles, other eyes',
      'Nothing changed — only how it is drawn. That is what a VIEW is here: another way of seeing, never another copy of the data.')
    await stage.typeAndSubmit('/tree off', false)
    await stage.wait(800)
  },
})

tutorialLessons.register({
  id: 'views',
  level: L,
  order: 40,
  title: 'Views on your tiles',
  pheromones: ['tutorial', 'lesson', 'expert', 'view'],
  teaches: ['website', 'present', 'tutor'],
  async run(stage) {
    const c = stage.center()
    await stage.flyTo(c.x, c.y - 90)
    await stage.say('views', 'More ways of seeing',
      'A branch can also render as a website, play as slides, or become study games — /website, /present, /tutor. The tiles stay the tiles; the view is a behaviour you attach.')
    await stage.say('views-done', 'Attach, don’t convert',
      'Attaching a view never rewrites your work, so you can carry several at once and switch between them from the command line.')
  },
})

tutorialLessons.register({
  id: 'assistant',
  level: L,
  order: 50,
  title: 'The assistant and its bees',
  pheromones: ['tutorial', 'lesson', 'expert', 'assistant'],
  async run(stage) {
    await stage.flyToRect(stage.commandInput())
    await stage.say('assistant', 'Asking',
      'You can ask for help from right here — /ask for a quick answer, /opus or /sonnet to send tiles as context. Answers land as notes on the tiles they are about.')
    stage.highlight(null)
    await stage.say('assistant-bees', 'Work you can watch',
      'While a question is in flight a bee flies over the tiles it is working on. Click the bee to see what was asked, where the answer will land, and add more context mid-flight.')
  },
})

tutorialLessons.register({
  id: 'share',
  level: L,
  order: 60,
  title: 'Sharing with the swarm',
  pheromones: ['tutorial', 'lesson', 'expert', 'swarm'],
  async run(stage) {
    const c = stage.center()
    await stage.flyTo(c.x, c.y - 90)
    await stage.say('share', 'The swarm',
      'Your hive is yours and private until you say otherwise. Going public shows the tiles you chose to peers; /host publishes a branch; /invite makes a meeting place.')
    await stage.say('share-done', 'Always deliberate',
      'I will not flip any of that for you — sharing is never automatic here. When you are ready, it is one deliberate move, and it is reversible.')
  },
})
