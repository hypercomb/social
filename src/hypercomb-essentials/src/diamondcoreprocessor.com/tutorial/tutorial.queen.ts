// diamondcoreprocessor.com/tutorial/tutorial.queen.ts

import { QueenBee, EffectBus } from '@hypercomb/core'
import { tutorialLessons, TUTORIAL_LEVELS, type TutorialLevel } from './tutorial-lesson.js'

/**
 * /tutorial — a beeing flies around the screen and shows you how the hive
 * works. The tour is a COURSE of independent lessons (see tutorial-lesson.ts);
 * the argument picks which course, or one lesson on its own.
 *
 * Syntax:
 *   /tutorial                  — the starter course: move, make, get home
 *   /tutorial beginner         — the everyday verbs
 *   /tutorial intermediate     — pheromones, titles, references, history
 *   /tutorial expert           — paths, hives, views, the assistant, the swarm
 *   /tutorial <lesson>         — one lesson on its own (e.g. /tutorial go-in)
 *   /tutorial list             — what is on offer
 *   /tutorial stop             — end a running tour
 *   /tour                      — alias
 */
export class TutorialQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'tutorial'
  override readonly aliases = ['tour']
  override description = 'Guided tour — a beeing shows you how it works, at four levels'
  override descriptionKey = 'slash.tutorial'
  override options = [...TUTORIAL_LEVELS, 'list', 'stop', '<lesson>']
  override examples = [
    { input: '/tutorial', result: 'A beeing flies in and walks you through the basics' },
    { input: '/tutorial intermediate', result: 'The intermediate course: marks, titles, references, history' },
    { input: '/tutorial go-in', result: 'Just that one lesson' },
    { input: '/tutorial list', result: 'Lists every course and its lessons' },
    { input: '/tutorial stop', result: 'Ends the running tour' },
  ]

  override slashComplete(args: string): readonly string[] {
    const q = args.toLowerCase().trim()
    const all = [...TUTORIAL_LEVELS, 'list', 'stop', ...tutorialLessons.all().map(l => l.id)]
    return q ? all.filter(o => o.startsWith(q)) : all
  }

  protected execute(args: string): void {
    const arg = args.trim().toLowerCase()

    if (arg === 'stop') { EffectBus.emit('tutorial:stop', {}); return }
    if (arg === 'list') { this.#list(); return }

    if (!arg) { EffectBus.emit('tutorial:start', { level: 'starter' }); return }

    if ((TUTORIAL_LEVELS as readonly string[]).includes(arg)) {
      EffectBus.emit('tutorial:start', { level: arg as TutorialLevel })
      return
    }

    const lesson = tutorialLessons.get(arg)
    if (lesson) { EffectBus.emit('tutorial:start', { lesson: lesson.id }); return }

    this.#log(`Tutorial — no course or lesson called "${arg}". Try /tutorial list.`)
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
