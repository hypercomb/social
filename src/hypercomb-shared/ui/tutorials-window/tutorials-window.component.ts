// hypercomb-shared/ui/tutorials-window/tutorials-window.component.ts
//
// THE TUTORIALS WINDOW — the roster of guided tours, as a tool window.
//
// It replaces a fixed-position flyout that hung off the rail's bee on
// Ctrl+click (`.tour-menu` in controls-bar). That menu was the only surface
// that had ever listed the courses, and it could not carry the roster: it
// showed an id and a count, nothing about what a lesson was FOR, and the
// first click anywhere dismissed it — so choosing between forty-five lessons
// meant opening it, reading four words, and opening it again.
//
// It is a TOOL WINDOW now, which is a claim with content: it docks in the
// lane, it resizes and content-shrinks, it takes the common header band, it
// joins the group / text-size / reading-face settings through the shared
// gear, it parks and unparks with the rest, and Escape unwinds it one level
// at a time through the cascade rather than through a listener of its own.
// Everything in this file beyond the roster itself comes from `hcDockedPanel`.
//
// WHERE THE CONTENT COMES FROM: the tutorial's own `TutorialLessonRegistry`,
// over IoC. Shell UI must never import essentials, and the roster is exactly
// the sort of thing that must not be re-declared here — a build without the
// tutorial module has no window, and a community module that registers its
// own lesson appears in it for free. `courses()` hands back the levels that
// have available lessons, each with its declared blurb, already ordered.
//
// WHAT THE WINDOW ADDS THAT THE REGISTRY CANNOT: progress. Which lessons you
// have flown is a participant preference, not content — the same call the
// help launcher's reached-tier makes — so it lives in localStorage and never
// in a layer. The drone announces `tutorial:flown` for every lesson that ran
// to the end (a lesson that threw is deliberately not ticked), and
// `tutorial:flying` for what is in the air, which is what makes the Stop
// button and the Continue button possible at all.

import { Component, computed, signal, type OnDestroy } from '@angular/core'
import { EffectBus } from '@hypercomb/core'
import { TranslatePipe } from '../../core/i18n.pipe'
import { registerShellSurface } from '../../core/shell-surface-registry'
import { DockInsetDirective } from '../dock-inset/dock-inset.directive'
import { HcDockedPanelDirective } from '../docked-panel/hc-docked-panel.directive'
import { accordion } from '../accordion'
import { signalSession } from '../window-session'

/** Structural mirrors of the essentials shapes — shared cannot import them. */
type LessonLike = {
  id: string
  level: string
  order: number
  title: string
  summary?: string
  pheromones?: readonly string[]
  teaches?: readonly string[]
}
type CourseLike = { level: string; title: string; summary: string; lessons: LessonLike[] }
type RegistryLike = EventTarget & {
  courses?(): CourseLike[]
  levels?(): string[]
  course?(level: string): LessonLike[]
}

/** A lesson as the window draws it: resolved text, its place in the course,
 *  and whether it has been flown. */
export type LessonRow = {
  id: string
  level: string
  /** 1-based position in its course — the curriculum number, not the `order`
   *  field, which is a sparse sort key nobody should be shown. */
  number: number
  title: string
  summary: string
  /** The marks worth showing: the declared vocabulary minus the words that say
   *  what a tile IS and minus the level, which the course heading carries. */
  topics: readonly string[]
  flown: boolean
}

export type CourseRow = {
  level: string
  title: string
  summary: string
  /** 1-based place in the ramp. Fixed: it is where this course sits in the
   *  curriculum, so a search must never renumber it. */
  step: number
  lessons: LessonRow[]
  /** Lessons matching the current search. A course with none is dropped. */
  matches: LessonRow[]
  flownCount: number
  total: number
  /** 0-1, for the hexagon's fill and the progress bar. */
  progress: number
}

/** Marks that say what a tile IS rather than what a lesson is ABOUT. Mirrors
 *  the structural half of TUTORIAL_PHEROMONES; the level names go with them
 *  because the course heading already says which course this is. */
const STRUCTURAL_MARKS = new Set(['tutorial', 'lesson', 'course', 'starter', 'beginner', 'intermediate', 'expert'])

const REGISTRY_KEY = '@diamondcoreprocessor.com/TutorialLessonRegistry'
const FLOWN_KEY = 'hc:tutorial:flown'

type Ioc = {
  get<T>(key: string): T | undefined
  whenReady?(key: string, cb: (value: unknown) => void): void
}
const ioc = (): Ioc | undefined => (globalThis as { ioc?: Ioc }).ioc

/** `t()` without the pipe, for values computed in the class. The service
 *  answers a MISSING key with the key itself, which is a leak rather than a
 *  translation — so a declared fallback wins over an unresolved key. */
const t = (key: string, fallback: string): string => {
  const i18n = ioc()?.get<{ t?(k: string): string }>('@hypercomb.social/I18n')
  const value = i18n?.t?.(key)
  return value && value !== key ? value : fallback
}

/** The catalog keys a lesson and a course answer to. Declared once so the
 *  spelling cannot drift between the roster and whatever else resolves them. */
const LESSON_KEY = (id: string): string => 'tutorial.lesson.' + id
const LESSON_ABOUT_KEY = (id: string): string => 'tutorial.lesson.' + id + '.about'
const LEVEL_KEY = (level: string): string => 'tutorial.level.' + level
const LEVEL_ABOUT_KEY = (level: string): string => 'tutorial.level.' + level + '.about'

const readFlown = (): Set<string> => {
  try {
    const raw = localStorage.getItem(FLOWN_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return new Set(Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [])
  } catch { return new Set() }
}
const writeFlown = (ids: ReadonlySet<string>): void => {
  try { localStorage.setItem(FLOWN_KEY, JSON.stringify([...ids])) } catch { /* private mode */ }
}

@Component({
  selector: 'hc-tutorials-window',
  standalone: true,
  imports: [TranslatePipe, DockInsetDirective, HcDockedPanelDirective],
  templateUrl: './tutorials-window.component.html',
  styleUrls: ['./tutorials-window.component.scss'],
})
export class TutorialsWindowComponent implements OnDestroy {
  readonly visible = signal(false)
  readonly query = signal('')
  readonly flown = signal<ReadonlySet<string>>(readFlown())
  /** Which course is showing its lessons — ONE at a time (accordion.ts). Two
   *  open at once pushed the courses below off the bottom of a 380px panel,
   *  so the list you opened in order to browse became the thing you could not
   *  browse. */
  readonly sections = accordion()
  /** What the bee is flying right now, from `tutorial:flying`. */
  readonly flying = signal<{ level?: string; lesson?: string } | null>(null)
  /** THE CARTRIDGE you set into the top: the lesson you picked. Cleared once
   *  it has been flown, so the slot falls back to the next unflown one rather
   *  than sitting on something you have finished. */
  readonly picked = signal<string | null>(null)
  /** Bumped to re-read the registry, which is an EventTarget, not a signal. */
  readonly revision = signal(0)

  readonly session = signalSession(
    this.visible,
    open => { EffectBus.emit('tutorials:state', { open }) },
    {
      // One level per press, innermost first: a search narrows the roster and
      // an open course narrows it again, so backing out of either is a step
      // back that must not also cost you the window.
      dismiss: () => {
        if (this.query()) { this.query.set(''); return true }
        return this.sections.dismiss()
      },
      close: () => this.close(),
    },
  )

  readonly #cleanups: Array<() => void> = []

  constructor() {
    this.#cleanups.push(EffectBus.on('tutorials:open', () => this.open()))
    this.#cleanups.push(EffectBus.on('tutorials:close', () => this.close()))
    this.#cleanups.push(EffectBus.on('tutorials:toggle', () => { if (this.visible()) this.close(); else this.open() }))

    this.#cleanups.push(EffectBus.on<{ running?: boolean; level?: string; lesson?: string }>(
      'tutorial:flying',
      payload => this.flying.set(payload?.running ? { level: payload.level, lesson: payload.lesson } : null),
    ))
    this.#cleanups.push(EffectBus.on<{ lesson?: string }>('tutorial:flown', payload => {
      const id = payload?.lesson
      if (!id) return
      // A finished lesson is no longer what you are on, so the slot hands
      // itself back to Continue rather than sitting on something done.
      if (this.picked() === id) this.picked.set(null)
      if (this.flown().has(id)) return
      const next = new Set(this.flown())
      next.add(id)
      writeFlown(next)
      this.flown.set(next)
    }))

    // The roster can arrive after this component does (the web shell loads the
    // tutorial module at runtime), and can change while the window is open
    // when a community module registers a lesson of its own.
    const registry = ioc()?.get<RegistryLike>(REGISTRY_KEY)
    if (registry) this.#watch(registry)
    else ioc()?.whenReady?.(REGISTRY_KEY, value => this.#watch(value as RegistryLike))

    // A locale switch changes every title and blurb in the list.
    this.#cleanups.push(EffectBus.on('locale:changed', () => this.revision.update(n => n + 1)))
  }

  ngOnDestroy(): void { for (const cleanup of this.#cleanups) cleanup() }

  #watch(registry: RegistryLike): void {
    const bump = (): void => { this.revision.update(n => n + 1) }
    registry.addEventListener('change', bump)
    this.#cleanups.push(() => registry.removeEventListener('change', bump))
    bump()
  }

  // -- the roster ------------------------------------------------------

  /** THE ROSTER -- everything, unfiltered. Reads the registry at call time, so
   *  a lesson registered after boot is simply there.
   *
   *  It is kept separate from what the list SHOWS because a search must not
   *  move the facts: the totals, the progress bar, a course's step in the ramp
   *  and the Continue button all describe the WHOLE roster. Computing them off
   *  the filtered set made "0/44 - Create a tile" become "0/28 - Select tiles"
   *  the moment you typed a word, which is a window changing its own subject
   *  under you. */
  readonly roster = computed<CourseRow[]>(() => {
    this.revision()
    const registry = ioc()?.get<RegistryLike>(REGISTRY_KEY)
    if (!registry) return []

    // `courses()` is the one call that answers everything. A registry from
    // before it existed still answers the two calls it is built from -- the
    // window is not the place to demand a matching build.
    const raw: CourseLike[] = registry.courses?.()
      ?? (registry.levels?.() ?? []).map(level => ({
        level, title: level, summary: '', lessons: registry.course?.(level) ?? [],
      }))

    const flown = this.flown()

    return raw.map<CourseRow>((course, step) => {
      const lessons: LessonRow[] = course.lessons.map((lesson, index) => ({
        id: lesson.id,
        level: course.level,
        number: index + 1,
        title: t(LESSON_KEY(lesson.id), lesson.title || lesson.id),
        summary: t(LESSON_ABOUT_KEY(lesson.id), lesson.summary ?? ''),
        topics: (lesson.pheromones ?? []).filter(mark => !STRUCTURAL_MARKS.has(mark)),
        flown: flown.has(lesson.id),
      }))
      const flownCount = lessons.filter(lesson => lesson.flown).length
      return {
        level: course.level,
        title: t(LEVEL_KEY(course.level), course.title || course.level),
        summary: t(LEVEL_ABOUT_KEY(course.level), course.summary || ''),
        step: step + 1,
        lessons,
        matches: lessons,
        flownCount,
        total: lessons.length,
        progress: lessons.length ? flownCount / lessons.length : 0,
      }
    })
  })

  /** WHAT THE LIST SHOWS -- the roster narrowed by the search, MINUS whatever
   *  is loaded in the cartridge.
   *
   *  A lesson named at the top and again three rows down is the same lesson
   *  twice, and the top one is not a summary of the list — it IS one of its
   *  items, lifted out. So it leaves the list while it is up there, and drops
   *  back in when something else takes its place. (While searching the
   *  cartridge stands down entirely, so nothing is subtracted and the results
   *  are complete.)
   *
   *  A course with no matching lesson drops out; the rows that remain keep
   *  their own numbers, because a lesson's number is its place in the
   *  curriculum, never its position in a filtered list. */
  readonly courses = computed<CourseRow[]>(() => {
    const needle = this.query().trim().toLowerCase()
    const lifted = needle ? null : this.cartridge()?.id ?? null
    return this.roster()
      .map(course => ({
        ...course,
        matches: course.lessons.filter(lesson =>
          lesson.id !== lifted && (!needle || this.#matches(lesson, course.title, needle))),
      }))
      .filter(course => course.matches.length > 0 || !needle)
  })

  #matches(lesson: LessonRow, courseTitle: string, needle: string): boolean {
    return [lesson.id, lesson.title, lesson.summary, lesson.topics.join(' '), courseTitle]
      .join(' ').toLowerCase().includes(needle)
  }

  readonly totalLessons = computed(() => this.roster().reduce((n, course) => n + course.total, 0))
  readonly totalFlown = computed(() => this.roster().reduce((n, course) => n + course.flownCount, 0))
  readonly searching = computed(() => this.query().trim().length > 0)
  readonly matchCount = computed(() => this.courses().reduce((n, course) => n + course.matches.length, 0))

  /** The next lesson you have not flown, in curriculum order across the whole
   *  roster. The window's ONE primary action: a list this long needs a door
   *  that does not make you choose first. */
  readonly next = computed<LessonRow | null>(() => {
    for (const course of this.roster()) {
      for (const lesson of course.lessons) if (!lesson.flown) return lesson
    }
    return null
  })

  /** WHAT IS LOADED IN THE TOP SLOT, in priority order:
   *
   *    the lesson in the air  — while a tour runs, the slot IS that tour, and
   *                             it is where the Stop lives
   *    the one you picked     — clicking a row lifts it up here
   *    the next unflown       — the standing offer, when you have picked
   *                             nothing and nothing is flying
   *
   *  One slot, one lesson. It used to be two surfaces (a flying banner and a
   *  Continue card) that named the same lesson while the list named it a
   *  third time. */
  readonly cartridge = computed<LessonRow | null>(() =>
    this.flyingRow()
      ?? (this.picked() ? this.#find(this.picked() as string) : null)
      ?? this.next())

  #find(id: string): LessonRow | null {
    for (const course of this.roster()) {
      const hit = course.lessons.find(lesson => lesson.id === id)
      if (hit) return hit
    }
    return null
  }

  /** The lesson in the air, resolved for the slot. */
  readonly flyingRow = computed<LessonRow | null>(() => {
    const id = this.flying()?.lesson
    if (!id) return null
    for (const course of this.roster()) {
      const hit = course.lessons.find(lesson => lesson.id === id)
      if (hit) return hit
    }
    return null
  })
  readonly flyingCourse = computed<CourseRow | null>(() => {
    const level = this.flying()?.level
    return level ? this.roster().find(course => course.level === level) ?? null : null
  })

  /** THE ACTIVE COURSE — the one the cartridge's lesson belongs to.
   *
   *  "Create a tile" and "Starter" are the same subject at that moment: the
   *  slot at the top already says which course you are in, so the course's own
   *  header repeating its blurb underneath is the same sentence twice. An
   *  active course draws as ONE shaded line — still there, still openable,
   *  just no longer introducing itself. */
  readonly activeLevel = computed<string | null>(() => this.cartridge()?.level ?? null)

  /** A search opens every course it matched — a hit hidden inside a collapsed
   *  section is a search that did not answer. It overrides the accordion
   *  rather than writing to it, so clearing the search puts back whichever
   *  section you had open before you typed. */
  isExpanded(level: string): boolean {
    return this.searching() || this.sections.isOpen(level)
  }

  /** Percent, for the inline fill styles. */
  percent(fraction: number): number { return Math.round(fraction * 100) }

  // -- verbs -----------------------------------------------------------

  open(): void {
    if (!this.visible()) {
      this.revision.update(n => n + 1)
      // EVERY SECTION CLOSED. It used to pre-open whichever course you were
      // partway through, which is the shell choosing for you: you arrive
      // already inside one of four courses, with the other three pushed down
      // by its eight rows. All four headers fit on the screen at once, and
      // where you are is already said — by the Continue row at the top and by
      // each course's own pill.
      this.sections.closeAll()
      this.picked.set(null)
    }
    this.visible.set(true)
    EffectBus.emit('tutorials:state', { open: true })
  }

  close(): void {
    this.visible.set(false)
    this.query.set('')
    EffectBus.emit('tutorials:state', { open: false })
  }

  toggleCourse(level: string): void {
    // While searching every match is forced open, so a header press has
    // nothing to say — it would write a state you cannot see the effect of.
    if (this.searching()) return
    this.sections.toggle(level)
  }

  /** Fly a whole course. Same effect `/tutorial <level>` raises, so the window
   *  and the command are one path. */
  flyCourse(level: string, event?: Event): void {
    event?.stopPropagation()
    EffectBus.emit('tutorial:start', { level })
  }

  /** Fly ONE lesson, and load it into the top slot on the way — the row you
   *  pressed is the lesson you are on, so it belongs up there and not in the
   *  list twice. A lesson makes whatever it needs on the practice page, so
   *  starting it alone is a first-class way in, not a shortcut. */
  flyLesson(id: string): void {
    this.picked.set(id)
    EffectBus.emit('tutorial:start', { lesson: id })
  }

  stop(): void { EffectBus.emit('tutorial:stop', {}) }

  search(value: string): void { this.query.set(value) }

  /** Search for a topic by clicking its chip — the marks ARE the second axis
   *  through the roster, so they have to be usable as one. */
  pickTopic(topic: string, event?: Event): void {
    event?.stopPropagation()
    this.query.set(this.query().trim().toLowerCase() === topic ? '' : topic)
  }

  /** Forget what has been flown. Progress is a participant preference; there
   *  has to be a way to put it back. */
  resetProgress(): void {
    writeFlown(new Set())
    this.flown.set(new Set())
  }
}

registerShellSurface({
  name: 'hc-tutorials-window',
  owner: '@hypercomb.shared/TutorialsWindowComponent',
  component: TutorialsWindowComponent,
  order: 155,
})
