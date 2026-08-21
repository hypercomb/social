// diamondcoreprocessor.com/tutorial/lessons/starter.lessons.ts
//
// THE STARTER COURSE — the first flight. Moving, making, and getting home.
// This is the tour that shipped as one script; every beat is preserved
// verbatim, split into lessons that can also be run on their own
// (`/tutorial go-in`). Order is the curriculum: create, then in, then out,
// then children, then travel, then the camera, then Home.

import { tutorialLessons } from '../tutorial-lesson.js'
import { plannerCoverImage, dayCoverImage } from '../tutorial-images.js'
import { subject } from './lesson-kit.js'

const L = 'starter' as const

/** The planner is the starter course's running example — every lesson works on
 *  whatever is already on the practice page, or makes this. */
const plannerName = (stage: { t(k: string, f: string): string }): string =>
  stage.t('tutorial.name.planner', 'Weekly Planner')

tutorialLessons.register({
  id: 'create',
  level: L,
  order: 10,
  title: 'Create a tile',
  pheromones: ['tutorial', 'lesson', 'starter', 'creation'],
  teaches: ['create'],
  async run(stage) {
    await stage.flyToRect(stage.commandInput())
    const name = plannerName(stage)
    await stage.say('create', 'Create',
      'This is the command line — the fastest way to build. Type a name and press Enter, and a tile is born. I’ll make “{name}”.',
      { params: { name } })
    stage.highlight(null)

    const made = await stage.create(name, plannerCoverImage)
    await stage.flyToCell(made)
    await stage.say('your-tile', 'Your tile',
      'Meet “{name}” — a brand-new tile with a proper cover image. Anything you can name, you can make.',
      { params: { name: made } })
    stage.highlight(null)
  },
})

tutorialLessons.register({
  id: 'go-in',
  level: L,
  order: 20,
  title: 'Go inside a tile',
  pheromones: ['tutorial', 'lesson', 'starter', 'navigation'],
  async run(stage) {
    const label = await subject(stage, plannerName(stage), 1)
    await stage.flyToCell(label)
    await stage.say('go-in', 'Going in', 'To go inside a tile, just left-click it. Watch me!')

    await stage.enterCell(label)

    // point out the address bar while explaining where we landed
    const crumb = stage.breadcrumb()
    if (crumb) await stage.flyToRect(crumb)
    else { const c = stage.center(); await stage.flyTo(c.x, c.y - 50) }
    await stage.say('inside', 'Inside',
      'We’re in! Everything here lives inside “{cell}”. The address up here always shows where you are.',
      { params: { cell: label } })
    stage.highlight(null)
  },
})

tutorialLessons.register({
  id: 'go-out',
  level: L,
  order: 30,
  title: 'Come back out',
  pheromones: ['tutorial', 'lesson', 'starter', 'navigation'],
  async run(stage) {
    // Standing at the practice page's own level? Step inside something first,
    // so there is somewhere to come back OUT of.
    if (stage.depth() <= stage.practice.base.length + 1) {
      const label = await subject(stage, plannerName(stage), 1)
      await stage.enterCell(label)
    }

    const back = stage.chrome('controls.go-back')
    await stage.flyToRect(back)
    await stage.say('go-out', 'Going out',
      'Three ways back out: right-click anywhere, hold Shift and click, or press the Back button. I’ll use Back.')
    stage.highlight(null)

    if (back) await stage.ghostClick(back.left + back.width / 2, back.top + back.height / 2)
    // Back, not Shift+click. `leave()` performs its OWN ghost-click carrying a
    // "⇧ Shift" keycap, so using it here made the bee demonstrate the gesture
    // the bubble had just said it was not going to use.
    await stage.leaveTo(Math.max(0, stage.depth() - 1))

    const c = stage.center()
    await stage.flyTo(c.x - 80, c.y - 40)
    await stage.say('back', 'Back',
      'And we’re back where we started. In and out — that’s the heartbeat of Hypercomb.')
  },
})

tutorialLessons.register({
  id: 'children',
  level: L,
  order: 40,
  title: 'Give a tile children',
  pheromones: ['tutorial', 'lesson', 'starter', 'creation', 'structure'],
  async run(stage) {
    const parent = await subject(stage, plannerName(stage), 1)
    await stage.say('children', 'Children',
      'Tiles hold tiles. Let’s step inside and give it seven children — one for each day of the week.',
      { key: 'tutorial.children-intro' })

    await stage.enterCell(parent)

    const fallbacks = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
    const days = fallbacks.map((fb, i) => stage.t(`tutorial.name.day${i}`, fb))

    await stage.flyToRect(stage.commandInput())
    await stage.say('brackets', 'One line',
      'A power move: square brackets create many tiles at once. One line, seven days — watch!')
    stage.highlight(null)

    await stage.createMany(days, i => dayCoverImage(i))

    const c = stage.center()
    await stage.flyTo(c.x, c.y - 80)
    await stage.say('children', 'Children',
      'Monday through Sunday — seven child tiles, each with its own cover. Your world grows tile by tile, as deep as you like.',
      { key: 'tutorial.children-done' })
  },
})

tutorialLessons.register({
  id: 'travel',
  level: L,
  order: 50,
  title: 'Travel between tiles',
  pheromones: ['tutorial', 'lesson', 'starter', 'navigation'],
  async run(stage) {
    await stage.say('travel', 'Travel',
      'Now let’s travel between them, exactly like before: click a tile to go in, Shift+click to come back out.')

    const here = stage.labels().filter(Boolean)
    // Two stops — the first and (if the page is busy) one further along, so the
    // move reads as travel across the page rather than one tile twice.
    const stops = [here[0], here[4] ?? here[here.length - 1]].filter(Boolean)
    for (const label of stops) {
      await stage.flyToCell(label)
      stage.highlight(null)
      await stage.enterCell(label)
      await stage.leave()
    }

    const c = stage.center()
    await stage.flyTo(c.x - 60, c.y - 60)
    await stage.say('travel', 'Travel',
      'In, out, and across — you can wander anywhere. You can’t get lost: Back and Home always know the way.',
      { key: 'tutorial.travel-done' })
  },
})

tutorialLessons.register({
  id: 'zoom',
  level: L,
  order: 60,
  title: 'Zoom the honeycomb',
  pheromones: ['tutorial', 'lesson', 'starter', 'navigation'],
  async run(stage) {
    const c = stage.center()
    await stage.flyTo(c.x + 40, c.y - 60)
    await stage.say('zoom', 'Zoom',
      'Roll the mouse wheel to zoom in and out — pinch on a touch screen. A quick demo…')

    const zoom = window.ioc.get<{
      zoomByFactor?: (f: number, pivot: { x: number; y: number }, source?: 'user' | 'auto') => void
    }>('@diamondcoreprocessor.com/ZoomDrone')
    if (!zoom?.zoomByFactor) return
    const pivot = stage.center()
    // 'auto' — this is a DEMONSTRATION, not the participant zooming. Left at
    // the default it emitted `viewport:manual`, which the control bar reads as
    // "they framed this page by hand" and marks it hand-framed permanently —
    // so watching the zoom lesson quietly excluded that page from global fit.
    zoom.zoomByFactor(0.8, pivot, 'auto')
    await stage.wait(650)
    zoom.zoomByFactor(1.25, pivot, 'auto')
    await stage.wait(450)
  },
})

tutorialLessons.register({
  id: 'pan',
  level: L,
  order: 70,
  title: 'Glide across the field',
  pheromones: ['tutorial', 'lesson', 'starter', 'navigation'],
  async run(stage) {
    // Two fingers is PINCH (or the sensitivity swipe), never a pan — the
    // coordinator classifies one finger as the pan and never translates the
    // viewport for two. The `.touch` variant of this key says one finger; the
    // desktop wording used to say two and contradict it.
    await stage.say('pan', 'Pan',
      'Hold the Space bar and drag to glide across the honeycomb. On a touch screen, one finger drags.')
  },
})

tutorialLessons.register({
  id: 'home',
  level: L,
  order: 80,
  title: 'Home',
  pheromones: ['tutorial', 'lesson', 'starter', 'navigation'],
  async run(stage) {
    // The aria-label is not a stable handle for this one: it becomes
    // `controls.home.portal` ("home — {portal}") as soon as a home portal is
    // marked, so `chrome('controls.home')` silently returned null and the bee
    // was dropped at screen centre with nothing ringed. Ask for the element.
    // There is also NO home button on a phone (the bar's centre slot is the
    // camera) or when the bar is docked right — then point at the address bar,
    // which is the way back to the root on every surface.
    const home = stage.element('hc-controls-bar .rail-home') ?? stage.chrome('controls.home')
    await stage.flyToRect(home ?? stage.breadcrumb())
    await stage.say('home', 'Home',
      'And whenever you’re done exploring, the Home button brings you straight back to your front door.')
    stage.highlight(null)

    if (home) await stage.ghostClick(home.left + home.width / 2, home.top + home.height / 2)
    await stage.goHome()
  },
})
