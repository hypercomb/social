// diamondcoreprocessor.com/tutorial/tutorial-lesson.ts
//
// LESSONS — the independent pieces a guided tour is made of.
//
// The first tour was one 240-line script. Everything the hive can do cannot be
// one script: it has to be a set of small, independent lessons that any module
// can contribute, that can be run alone or as a course, and that are LINKED BY
// THE MARKS THEY CARRY rather than by their position in a function body. That
// is the same architecture the hive itself uses — one cell per part, joined by
// pheromones whose meaning matches.
//
// A lesson is therefore:
//
//   - INDEPENDENT: it declares what it needs, runs against the `TutorialStage`
//     and nothing else, and cleans up after itself. Removing one from the
//     registry removes it from the course; no other lesson notices.
//   - MARKED: `pheromones` are drawn from the DECLARED vocabulary below (never
//     minted on the fly). The lesson's tile in the hive wears exactly these
//     marks, so the tile and the code agree by construction, and a
//     course can be assembled from a mark instead of from a list in code.
//   - GROUPED BY SIGNATURE: every lesson belongs to a course, and a course's
//     identity is `groupSignature('tutorial:course:<level>')` — a first-class
//     group signature (see core/group-signature.ts). Everything a course mints
//     carries that signature, so a course adds and deletes as one unit.
//   - AVAILABLE OR NOT: `requires()` gates a lesson on the behaviour it teaches
//     actually being registered. A behaviour that is dormant, retired, or not
//     installed simply drops out of the course — never a broken step.
//
// ORDER IS THE CURRICULUM. `order` is "most obvious and simplest first": the
// courses are sorted by it, so adding a lesson is choosing where it belongs in
// the ramp, not editing a script.

import { groupSignature, GROUP_DECORATION_KIND } from '@hypercomb/core'
import type { TutorialStage } from './tutorial-stage.js'

export { GROUP_DECORATION_KIND }

/** The courses. `starter` is the first flight every participant gets; the
 *  other three are the ramp for someone who wants to keep going. */
export type TutorialLevel = 'starter' | 'beginner' | 'intermediate' | 'expert'

export const TUTORIAL_LEVELS: readonly TutorialLevel[] = Object.freeze([
  'starter', 'beginner', 'intermediate', 'expert',
])

/**
 * WHAT A COURSE IS, IN ONE LINE EACH.
 *
 * The roster used to be readable only as a list of ids in a log line, because
 * the only place it was ever shown was `/tutorial list`. A window that OFFERS
 * the courses has to say what each one is for before you pick it — so the
 * blurb is declared here, beside the level it describes, rather than written
 * into whatever surface happens to be listing them today.
 *
 * `title`/`summary` are fallbacks: `tutorial.level.<level>` and
 * `tutorial.level.<level>.about` win when the catalog carries them.
 */
export interface TutorialCourse {
  readonly level: TutorialLevel
  /** Short human name — "Starter", "The windows". */
  readonly title: string
  /** One sentence: what you can do after flying it. */
  readonly summary: string
}

export const TUTORIAL_COURSES: readonly TutorialCourse[] = Object.freeze([
  { level: 'starter', title: 'Starter',
    summary: 'Your first flight — make a tile, go in, come back out, and find your way home.' },
  { level: 'beginner', title: 'Beginner',
    summary: 'The everyday verbs: select, edit, note, copy, remove, undo, fit and arrange.' },
  { level: 'intermediate', title: 'Intermediate',
    summary: 'Meaning and time — marks, filters, titles, references, filing, and walking your history.' },
  { level: 'expert', title: 'The windows',
    summary: 'One lesson per window in the shell, each opening the real thing and putting it away again.' },
])

/** The declared blurb for a course, or an empty pair for a level some module
 *  invented. Never throws — a community course is a level like any other. */
export const courseInfo = (level: TutorialLevel): TutorialCourse =>
  TUTORIAL_COURSES.find(c => c.level === level)
    ?? { level, title: level.charAt(0).toUpperCase() + level.slice(1), summary: '' }

/**
 * The DECLARED pheromone vocabulary of the tutorial. Nothing outside
 * this list may be painted on a lesson — a new kind of lesson means adding a
 * word here deliberately, and to the vocabulary registration, in the
 * same pass.
 *
 * The topic marks deliberately REUSE the behaviour census's category keywords
 * (`view`, `structure`, `assistant`, `swarm`, `appearance`, `input`,
 * `guidance`) so a lesson and the behaviour it teaches land in the same
 * collection when the keyword is painted. Only the tutorial's own words
 * (`tutorial`, `lesson`, the level names, and the gesture/creation topics the
 * census has no word for) are new.
 */
export const TUTORIAL_PHEROMONES: readonly string[] = Object.freeze([
  // what a tile IS
  'tutorial', 'lesson', 'course',
  // which course it belongs to
  'starter', 'beginner', 'intermediate', 'expert',
  // what it teaches — census words first, then the ones the census lacks
  'view', 'structure', 'assistant', 'swarm', 'appearance', 'input', 'guidance',
  'navigation', 'creation', 'editing', 'meaning', 'history',
])

/**
 * The one mark the tutorial ever PAINTS on tiles (as opposed to the marks its
 * lesson tiles wear). Declared here for the same reason as everything above:
 * a lesson that teaches pheromones has to paint one, and it must be a word we
 * chose deliberately — not `urgent` or whatever the example says — because a
 * painted keyword joins the participant's real vocabulary. It is only ever
 * painted inside the transient practice page.
 */
export const TUTORIAL_DEMO_MARK = 'practice'

/** A course's group meaning — the preimage behind its group signature. */
export const courseMeaning = (level: TutorialLevel): string => `tutorial:course:${level}`

/** The signature that IS this course. Every tile, record, and artifact the
 *  course mints carries it, so the course adds and deletes as one unit. */
export const courseSignature = (level: TutorialLevel): Promise<string> =>
  groupSignature(courseMeaning(level))

export interface TutorialLesson {
  /** Stable id, kebab-case. Also the lesson's tile name in the hive and the
   *  argument that runs it alone (`/tutorial go-in`). */
  readonly id: string

  /** The course this lesson belongs to. */
  readonly level: TutorialLevel

  /** Position in the ramp — lowest first. "Most obvious and simplest first"
   *  is expressed here, not by the order of registration. */
  readonly order: number

  /** Marks painted on this lesson's tile. Must come from
   *  TUTORIAL_PHEROMONES — the registry rejects anything else, so a typo can
   *  never mint a keyword on the fly. */
  readonly pheromones: readonly string[]

  /** The behaviour(s) this lesson teaches, by their name in the behaviour
   *  census (`keyword`, `snapshot`, `website`…). Links the lesson's tile to the
   *  behaviour's tile in the hive; informational for the code. */
  readonly teaches?: readonly string[]

  /** Short human title fallback (i18n key `tutorial.lesson.<id>`). */
  readonly title: string

  /** ONE LINE saying what this lesson actually shows you — the sentence a
   *  window puts under the title so the roster can be READ rather than
   *  guessed at from an id. Fallback for `tutorial.lesson.<id>.about`.
   *
   *  It is declared on the lesson, not in the surface listing it, for the
   *  same reason `pheromones` is: a lesson is independent, and everything
   *  needed to offer it travels with it. */
  readonly summary?: string

  /** Whether this lesson can run right now — the behaviour it teaches is
   *  registered, the chrome it needs is mounted. Absent = always available. */
  requires?(): boolean

  /** The flight. Throws `TutorialAborted` (via `stage.say` / `stage.check`)
   *  when the participant skips; anything else it throws ends the course with
   *  a warning, never a crash. */
  run(stage: TutorialStage): Promise<void>
}

/**
 * The lesson roster. A singleton in IoC, so any module — including community
 * modules that ship their own behaviour — can add a lesson to a course without
 * this file knowing about it:
 *
 *     window.ioc.get('@diamondcoreprocessor.com/TutorialLessonRegistry')
 *       ?.register({ id: 'my-thing', level: 'expert', order: 50, … })
 */
export class TutorialLessonRegistry extends EventTarget {
  readonly #lessons = new Map<string, TutorialLesson>()

  register(lesson: TutorialLesson): void {
    if (!lesson?.id) throw new Error('[tutorial] a lesson must declare an id')
    if (!TUTORIAL_LEVELS.includes(lesson.level)) {
      throw new Error(`[tutorial] lesson "${lesson.id}" declares unknown level "${lesson.level}"`)
    }
    const stray = lesson.pheromones.filter(p => !TUTORIAL_PHEROMONES.includes(p))
    if (stray.length) {
      // Never mint a keyword on the fly — an unknown mark is a programming
      // error, not a new word. Drop the lesson rather than pollute the
      // vocabulary the collections are built from.
      console.warn(`[tutorial] lesson "${lesson.id}" declares undeclared pheromones: ${stray.join(', ')} — not registered`)
      return
    }
    const existing = this.#lessons.get(lesson.id)
    if (existing === lesson) return // idempotent (hot reload)
    if (existing) {
      console.warn(`[tutorial] duplicate lesson id "${lesson.id}" — ignoring re-registration`)
      return
    }
    this.#lessons.set(lesson.id, lesson)
    this.dispatchEvent(new CustomEvent('change'))
  }

  unregister(id: string): void {
    if (this.#lessons.delete(id)) this.dispatchEvent(new CustomEvent('change'))
  }

  get(id: string): TutorialLesson | undefined { return this.#lessons.get(id) }

  all(): TutorialLesson[] {
    return [...this.#lessons.values()].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
  }

  /** A course, in curriculum order. `available` filters out lessons whose
   *  behaviour isn't registered in this build — the ramp closes the gap
   *  instead of showing a broken step. */
  course(level: TutorialLevel, available = true): TutorialLesson[] {
    return this.all()
      .filter(l => l.level === level)
      .filter(l => !available || l.requires?.() !== false)
  }

  /** Lessons carrying a mark — the pheromone read the collections are built
   *  from. `/tutorial keyword` and the lesson tiles both go through this. */
  withPheromone(mark: string): TutorialLesson[] {
    return this.all().filter(l => l.pheromones.includes(mark))
  }

  /** Every level that has at least one available lesson. */
  levels(): TutorialLevel[] {
    return TUTORIAL_LEVELS.filter(l => this.course(l).length > 0)
  }

  /** Every course that has at least one available lesson, with its declared
   *  blurb and its lessons already resolved. The shape a window wants: one
   *  call, nothing to cross-reference, no second opinion about ordering. */
  courses(): Array<TutorialCourse & { lessons: TutorialLesson[] }> {
    return this.levels().map(level => ({ ...courseInfo(level), lessons: this.course(level) }))
  }

  /** The TOPIC marks in play — the declared vocabulary minus the words that
   *  say what a tile IS (`tutorial`, `lesson`, `course`) and minus the level
   *  names, which the course heading already carries. What is left is the
   *  axis a roster can actually be grouped or filtered by. */
  topics(): string[] {
    const structural = new Set<string>(['tutorial', 'lesson', 'course', ...TUTORIAL_LEVELS])
    const seen = new Set<string>()
    for (const lesson of this.all()) {
      for (const mark of lesson.pheromones) if (!structural.has(mark)) seen.add(mark)
    }
    return [...seen].sort()
  }

  /** The group signature of a course — see courseSignature. */
  signatureOf(level: TutorialLevel): Promise<string> { return courseSignature(level) }
}

const _registry = new TutorialLessonRegistry()
window.ioc.register('@diamondcoreprocessor.com/TutorialLessonRegistry', _registry)

/** Module-local handle — lesson files register through this, so registration
 *  never depends on IoC resolution order at module load. */
export const tutorialLessons = _registry
