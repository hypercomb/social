// tutorial/tutorial.queen.ts

import { QueenBee, EffectBus } from '@hypercomb/core'
import { tutorialLessons, TUTORIAL_LEVELS, type TutorialLevel } from './tutorial-lesson.js'

/**
 * /tutorial — a beeing flies around the screen and shows you how the hive
 * works. The tour is a COURSE of independent lessons (see tutorial-lesson.ts);
 * the argument picks which course, or one lesson on its own.
 *
 * THE BARE WORD OPENS THE WINDOW, IT DOES NOT FLY.
 *
 * It used to launch the starter course on the spot, which made `/tutorial`
 * the one command in the hive whose plain form committed you to a five-minute
 * flight before showing you what else was on offer. Forty-five lessons across
 * four courses cannot be chosen from a command you have to already know the
 * argument of. So the bare word opens the TUTORIALS WINDOW — the roster, with
 * what each course is for and what each lesson shows you — and every argument
 * that names something still flies it directly, unchanged. `/tutorial start`
 * is the one word for "just fly the first one", for anyone who wants the old
 * behaviour back in one keystroke.
 *
 * Syntax:
 *   /tutorial                  — open the tutorials window: every course, every lesson
 *   /tutorial start            — fly the starter course straight away
 *   /tutorial beginner         — the everyday verbs
 *   /tutorial intermediate     — pheromones, filters, titles, references, filing, history
 *   /tutorial expert           — THE WINDOWS: one lesson per primary window
 *   /tutorial <lesson>         — one lesson on its own (e.g. /tutorial go-in)
 *   /tutorial list             — what is on offer, in the activity log
 *   /tutorial stop             — end a running tour
 */
export class TutorialQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'tutorial'
  override description = 'Open the tutorials window — every course and lesson, or fly one by name'
  override descriptionKey = 'slash.tutorial'
  override options = ['start', ...TUTORIAL_LEVELS, 'list', 'stop', '<lesson>']
  override examples = [
    { input: '/tutorial', result: 'Opens the tutorials window — pick a course or a single lesson' },
    { input: '/tutorial start', result: 'Skips the window and flies the starter course' },
    { input: '/tutorial intermediate', result: 'The intermediate course: marks, filters, titles, references, filing, history' },
    { input: '/tutorial go-in', result: 'Just that one lesson' },
    { input: '/tutorial list', result: 'Lists every course and its lessons in the activity log' },
    { input: '/tutorial stop', result: 'Ends the running tour' },
  ]

  override slashComplete(args: string): readonly string[] {
    const q = args.toLowerCase().trim()
    const all = ['start', ...TUTORIAL_LEVELS, 'list', 'stop', ...tutorialLessons.all().map(l => l.id)]
    return q ? all.filter(o => o.startsWith(q)) : all
  }

  protected execute(args: string): void {
    const arg = args.trim().toLowerCase()

    if (arg === 'stop') { EffectBus.emit('tutorial:stop', {}); return }
    if (arg === 'list') { this.#list(); return }

    // The bare word is the ROSTER, not a flight. `start` is the flight.
    if (!arg) { EffectBus.emit('tutorials:open', {}); return }
    if (arg === 'start') { EffectBus.emit('tutorial:start', { level: 'starter' }); return }

    if ((TUTORIAL_LEVELS as readonly string[]).includes(arg)) {
      EffectBus.emit('tutorial:start', { level: arg as TutorialLevel })
      return
    }

    const lesson = tutorialLessons.get(arg)
    if (lesson) { EffectBus.emit('tutorial:start', { lesson: lesson.id }); return }

    this.#log(`Tutorial — no course or lesson called "${arg}". Type /tutorial on its own to see them all.`)
  }

  /** One line per course, then its lessons in curriculum order. */
  #list(): void {
    for (const level of tutorialLessons.levels()) {
      const lessons = tutorialLessons.course(level)
      this.#log(`${level} — ${lessons.length} lessons: ${lessons.map(l => l.id).join(', ')}`, '🐝')
    }
  }

  #log(message: string, icon = '🐝'): void {
    EffectBus.emit('activity:log', { message, icon })
  }
}

const _tutorial = new TutorialQueenBee()
window.ioc.register('@diamondcoreprocessor.com/TutorialQueenBee', _tutorial)
