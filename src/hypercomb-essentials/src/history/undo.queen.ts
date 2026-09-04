// history/undo.queen.ts
//
// `/undo` and `/redo` — the two verbs everyone already knew Hypercomb had, and
// the two it could not be ASKED to do.
//
// Stepping the history cursor has been reachable since the beginning: a
// keystroke, a button in the controls bar, a glyph on the phone deck. What it
// never had was a WORD. That is not a cosmetic gap. The communication layer is
// the grammar — a participant speaking a sentence, a model with no bridge and
// no pointer — and a capability with no word in the grammar does not exist to
// anyone who can only speak. "Undo that" was, until this file, unsayable.
//
// So the verb joins the census like any other, and the pointer paths keep
// working unchanged: both call the same `HistoryCursorService`, which is where
// undo actually lives. This queen adds a door, not a mechanism.
//
// Syntax:
//   /undo        — step back one user action
//   /undo 3      — step back three
//   /redo        — step forward one
//   /redo 3      — step forward three
//
// Nothing is destroyed by either: the cursor walks a list of layer entries and
// every marker stays where it was ([[sigbag-root-model]]). Undo is the one
// wholly reversible verb in the language, which is why both directions are
// offered to a machine while `/remove` is offered with a confirmation.

import { QueenBee, EffectBus } from '@hypercomb/core'

const get = <T,>(key: string): T | undefined => (window as { ioc?: { get?: (k: string) => T } }).ioc?.get?.(key)

type CursorShape = {
  undo(): void | Promise<void>
  redo(): void | Promise<void>
  readonly state?: { readonly position: number }
}

const MAX_STEPS = 50

/** A step count, or a refusal reason. The two readers — the participant's
 *  parser and the machine's admission gate — must agree exactly, so both ask
 *  this one function. */
const readSteps = (args: string): { steps: number } | { refuse: string } => {
  const raw = args.trim()
  if (!raw) return { steps: 1 }
  if (!/^\d+$/.test(raw)) return { refuse: 'a step count must be a whole number' }
  const steps = Number(raw)
  if (steps < 1) return { refuse: 'a step count must be at least 1' }
  if (steps > MAX_STEPS) return { refuse: `at most ${MAX_STEPS} steps at a time` }
  return { steps }
}

const refuseSteps = (args: string): string | undefined => {
  const read = readSteps(args)
  return 'refuse' in read ? read.refuse : undefined
}

abstract class CursorStepQueen extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'

  /** Which way this queen walks the cursor. */
  protected abstract step(cursor: CursorShape): void | Promise<void>

  protected async execute(args: string): Promise<void> {
    const read = readSteps(args)
    if ('refuse' in read) { this.#log(`${this.command} — ${read.refuse}`); return }

    const cursor = get<CursorShape>('@diamondcoreprocessor.com/HistoryCursorService')
    if (!cursor) { this.#log(`${this.command} — history is not ready yet`); return }

    // One press = one user action, so N words = N presses — but a press is
    // separated from the next IN TIME, and this loop is not. Each walk reads
    // the cursor's position before its first await, so firing N synchronously
    // made all N compute the same target and `seek` swallow every one but the
    // first: `/undo 3` stepped back exactly ONCE and said it stepped three.
    // The cursor now serializes its own walks; this awaits them.
    //
    // AND IT REPORTS WHAT MOVED, NOT WHAT WAS ASKED. Running out of history is
    // the ordinary case for a machine that guessed a number, and a receipt
    // that claims three when the floor was one step away is the same lie in a
    // smaller size. When the position stops changing there is nothing left to
    // step, so the walk stops with it.
    let stepped = 0
    for (let i = 0; i < read.steps; i++) {
      const before = cursor.state?.position
      await this.step(cursor)
      if (before !== undefined && cursor.state?.position === before) break
      stepped++
    }

    this.#log(
      stepped === 0 ? `${this.command} — nothing left to step`
      : stepped === 1 ? `${this.command} — stepped one action`
      : `${this.command} — stepped ${stepped} actions`)
  }

  #log(message: string): void {
    EffectBus.emit('activity:log', { message, icon: '↺' })
  }
}

export class UndoQueenBee extends CursorStepQueen {
  readonly command = 'undo'
  override description = 'Step back through what you did'
  override descriptionKey = 'slash.undo'
  override options = ['', '<steps>']
  override examples = [
    { input: '/undo', result: 'Steps back one action' },
    { input: '/undo 3', result: 'Steps back three actions' },
  ]
  override machine = {
    forms: '| <steps>',
    example: '/undo',
    bare: true,
    reach: 'editing' as const,
    scope: 'hive' as const,
    refuse: refuseSteps,
  }

  protected step(cursor: CursorShape): void | Promise<void> { return cursor.undo() }
}

export class RedoQueenBee extends CursorStepQueen {
  readonly command = 'redo'
  override description = 'Step forward again through what you undid'
  override descriptionKey = 'slash.redo'
  override options = ['', '<steps>']
  override examples = [
    { input: '/redo', result: 'Steps forward one action' },
    { input: '/redo 3', result: 'Steps forward three actions' },
  ]
  override machine = {
    forms: '| <steps>',
    example: '/redo',
    bare: true,
    reach: 'editing' as const,
    scope: 'hive' as const,
    refuse: refuseSteps,
  }

  protected step(cursor: CursorShape): void | Promise<void> { return cursor.redo() }
}

const _undo = new UndoQueenBee()
window.ioc.register('@diamondcoreprocessor.com/UndoQueenBee', _undo)

const _redo = new RedoQueenBee()
window.ioc.register('@diamondcoreprocessor.com/RedoQueenBee', _redo)
