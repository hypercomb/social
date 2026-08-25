// diamondcoreprocessor.com/commands/forget.queen.ts
//
// `/forget` — see, and drop, what the line has learned about how you talk.
//
// Spoken habits are built from execution alone (spoken-habits.ts), so nothing
// gets in that the participant did not deliberately run. That is what makes
// them safe to have; this is what makes them THEIRS. An adaptive list you
// cannot inspect or empty is not adapting to you, it is accumulating on you.
//
//   forget                — LISTS every lead-in currently held
//   forget <lead-in>      — drops just that one way of starting
//   forget all            — drops the lot, phrasings and use weights alike
//
// The bare word LISTS rather than wipes, and that asymmetry is the safety.
// The obvious alternative was to ship this `slashHidden` like the remove
// family, so prose could never reach it — but hidden behaviours are cut from
// `match()`, which is what feeds argument completion, and that would have cost
// the lead-in listing: the only window onto what has actually been learned.
// Making the destructive reading the one that needs a second word buys the
// same protection and keeps the window. "forget the milk" drops phrasings
// beginning "the milk", which is to say nothing at all; only `forget all`
// empties anything you did not name.
//
// Consequence worth knowing: `all` is reserved. A lead-in you actually spoke
// as "all" can only be dropped by emptying everything.

import { QueenBee, EffectBus } from '@hypercomb/core'

const get = <T,>(key: string): T | undefined => (window as { ioc?: { get?: (k: string) => T } }).ioc?.get?.(key)

type HabitsShape = {
  forget(leadIn?: string): number
  leadIns(): readonly string[]
}

export class ForgetQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'forget'
  override description = 'Show or drop the phrasings the command line learned from you'
  override descriptionKey = 'slash.forget'
  override options = ['', '<lead-in>', 'all']
  override examples = [
    { input: '/forget', result: 'Lists every lead-in the line has learned' },
    { input: '/forget open', result: 'Drops the phrasings that begin with "open"' },
    { input: '/forget all', result: 'Drops every learned phrasing and use weight' },
  ]

  /** The lead-ins actually held, best first — plus `all`. Typing `forget ` is
   *  how a participant SEES what the line has learned about them. */
  override slashComplete(args: string): readonly string[] {
    const held = get<HabitsShape>('@diamondcoreprocessor.com/SpokenHabits')?.leadIns() ?? []
    const options = [...held, 'all']
    const q = args.trim().toLowerCase()
    return q ? options.filter(l => l.startsWith(q)) : options
  }

  protected async execute(args: string): Promise<void> {
    const habits = get<HabitsShape>('@diamondcoreprocessor.com/SpokenHabits')
    if (!habits) { this.#log('Forget — the line is not learning anything right now'); return }

    const leadIn = args.trim()

    // Bare word: show, never destroy.
    if (!leadIn) {
      const held = habits.leadIns()
      this.#log(held.length
        ? `Forget — learned so far: ${held.join(', ')}. Say "forget <lead-in>", or "forget all".`
        : 'Forget — nothing has been learned yet; run a behaviour with your own words first')
      return
    }

    if (leadIn.toLowerCase() === 'all') {
      const dropped = habits.forget()
      this.#log(dropped
        ? `Forget — dropped every learned phrasing (${dropped})`
        : 'Forget — nothing had been learned')
      return
    }

    const dropped = habits.forget(leadIn)
    this.#log(dropped
      ? `Forget — dropped ${dropped} phrasing${dropped === 1 ? '' : 's'} starting "${leadIn}"`
      : `Forget — nothing was learned starting "${leadIn}"`)
  }

  #log(message: string): void {
    EffectBus.emit('activity:log', { message, icon: '⌫' })
  }
}

const _forget = new ForgetQueenBee()
window.ioc.register('@diamondcoreprocessor.com/ForgetQueenBee', _forget)
