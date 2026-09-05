// presentation/tiles/hide.queen.ts
//
// `/hide` — take a tile out of view without taking it out of existence.
//
// HIDE FIRST, DELETE SECOND is standing doctrine here: the gentle verb is the
// one that should be easy to reach, and the destructive one should cost a
// confirmation. The overlay has honoured that for a long time — hide is an
// icon on the tile — but the icon was the ONLY door. There was no word, so the
// gentler half of the pair was missing from the grammar while `/remove`, the
// harsher half, was in it. A speaker who wanted the safe option had to ask for
// the dangerous one.
//
// Hiding is a lens, not a commit: it writes the hidden list this browser keeps
// and repaints. Nothing leaves the layer — no tile leaves a parent's children,
// no bytes move — which is why it is the right first reach for a model, and why
// the worst case is a view you can restore with the same word.
//
// CORRECTION (2026-09-04). This header used to add "nothing is published, and
// no peer sees a change". THAT IS FALSE, and it was the premise the machine
// `reach` was chosen on. `#hideOrBlock` hands the hidden list to
// `SwarmDrone.publishHide` (tile-actions.drone.ts), which emits a SIGNED MESH
// EVENT under the participant's own pubkey (swarm.drone.ts, SWARM_HIDE_KIND) so
// peers filter the same tile at render time. Hiding is local in what it changes
// and NOT local in how far it travels — which is precisely the pair the machine
// block now declares: `reach: 'editing'`, `scope: 'network'`.
//
// Syntax:
//   /hide <tile>                 — hide one tile
//   /hide [<tile>, <tile>]       — hide several
//   /hide ~<tile>                — show it again
//   /hide ~[<tile>, <tile>]      — show several again
//
// The `~` prefix is the language's existing un-do-this mark (`/keyword ~urgent`
// drops a tag), so unhiding needed no second word.

import { QueenBee, EffectBus } from '@hypercomb/core'

const get = <T,>(key: string): T | undefined => (window as { ioc?: { get?: (k: string) => T } }).ioc?.get?.(key)

/** `[a, b, c]` or a single bare name — the same list shape `/remove` reads. */
const parseTargets = (raw: string): string[] => {
  const trimmed = raw.trim()
  const bracket = trimmed.match(/^\[(.*)\]$/s)
  const body = bracket ? bracket[1] : trimmed
  return body.split(bracket ? ',' : '\n')
    .map(part => part.trim())
    .filter(Boolean)
}

type Reading =
  | { readonly show: boolean; readonly targets: readonly string[] }
  | { readonly refuse: string }

/** ONE reading for both callers. The participant's parser and the machine's
 *  admission gate must never disagree about what a line means. */
const read = (args: string): Reading => {
  const raw = args.trim()
  if (!raw) return { refuse: '/hide needs a tile name' }
  const show = raw.startsWith('~')
  const targets = parseTargets(show ? raw.slice(1) : raw)
  if (!targets.length) return { refuse: '/hide needs at least one tile name' }
  if (targets.some(name => name.includes('/'))) {
    return { refuse: '/hide names tiles on this page; it does not reach through /' }
  }
  return { show, targets }
}

export class HideQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'hide'
  override description = 'Take tiles out of view here, keeping everything they hold'
  override descriptionKey = 'slash.hide'
  override options = ['<tile>', '[<tile>, <tile>, ...]', '~<tile>']
  override examples = [
    { input: '/hide drafts', result: 'The tile "drafts" stops drawing on this page' },
    { input: '/hide ~drafts', result: 'It draws again' },
  ]

  /** Offered to machines BEFORE `/remove` is reached for: it is reversible by
   *  the same word, local to this browser, and commits nothing. */
  override machine = {
    forms: '<tile> | [<tile>, <tile>, ...] | ~<tile>',
    example: '/hide drafts',
    // EDITING, NOT DESTRUCTIVE — deliberately, and the scope carries the rest.
    // The rubric's destructive line names hiding ("Moves, hides, or takes
    // something away"), but it was written when hiding was believed local. What
    // /hide actually does to the hive is set a visibility flag: no tile leaves
    // a parent's children, no bytes move, and the same word reverses it. Label
    // it destructive and an "additive + editing" grant blocks the GENTLE verb
    // while leaving nothing safer than /remove — inverting HIDE FIRST, DELETE
    // SECOND at exactly the surface where a model chooses.
    //
    // The concerning half is not magnitude, it is travel: this publishes a
    // signed mesh event under the participant's pubkey (tile-actions.drone.ts
    // -> swarm.publishHide). `scope: 'network'` is what a grant should gate on,
    // and it is why this file's header — "nothing is published, and no peer
    // sees a change" — is wrong and has been corrected below.
    reach: 'editing' as const,
    scope: 'network' as const,
    refuse: (args: string): string | undefined => {
      const reading = read(args)
      return 'refuse' in reading ? reading.refuse : undefined
    },
  }

  /** Tiles on this page, so the line completes what is actually here. */
  override slashComplete(args: string): readonly string[] {
    const raw = args.trim()
    const show = raw.startsWith('~')
    const query = (show ? raw.slice(1) : raw).toLowerCase()
    const names = this.#pageTiles()
    const matched = query ? names.filter(name => name.toLowerCase().startsWith(query)) : names
    return show ? matched.map(name => `~${name}`) : matched
  }

  protected async execute(args: string): Promise<void> {
    const reading = read(args)
    if ('refuse' in reading) { this.#log(`Hide — ${reading.refuse}`); return }

    // The tile-actions bee owns the hidden list and the repaint. Speaking to
    // it by its action name is the same door the icon uses, so there is one
    // implementation of hiding and this queen is only a way to say it.
    // EACH TILE IS ACKNOWLEDGED, and the count reports what was CLAIMED rather
    // than what was asked. An emit nobody handles looks exactly like one that
    // worked, so this used to log "3 tiles out of view" whether the tile-actions
    // bee was listening or not. `#hideOrBlock` is synchronous today, so these
    // settle at once; the acknowledgement is what makes an unhandled emit
    // visible, and what keeps this honest if hides move into a pool and the
    // write becomes asynchronous.
    const claimedLabels: string[] = []
    for (const label of reading.targets) {
      let accepted = false
      let finish!: (error?: unknown) => void
      const done = new Promise<void>((resolve, reject) => {
        let settled = false
        finish = error => {
          if (settled) return
          settled = true
          error === undefined ? resolve() : reject(error)
        }
      })
      EffectBus.emitTransient('tile:action', {
        action: reading.show ? 'unhide' : 'hide',
        label, q: 0, r: 0, index: 0,
        accept: () => { accepted = true },
        complete: finish,
      })
      if (!accepted) continue
      try { await done; claimedLabels.push(label) }
      catch (error) { console.warn('[hide] tile action failed:', label, error) }
    }

    if (claimedLabels.length === 0) {
      this.#log('Hide — nothing was hidden; the tile surface is not listening')
      return
    }
    // Name the tile that actually landed, not the first one asked for.
    const noun = claimedLabels.length === 1
      ? `"${claimedLabels[0]}"`
      : `${claimedLabels.length} tiles`
    this.#log(reading.show ? `Hide — ${noun} drawing again` : `Hide — ${noun} out of view here`)
  }

  #pageTiles(): readonly string[] {
    const cells = get<{ suggestions(): string[] }>('@hypercomb.social/CellSuggestionProvider')
    return cells?.suggestions?.() ?? []
  }

  #log(message: string): void {
    EffectBus.emit('activity:log', { message, icon: '◌' })
  }
}

const _hide = new HideQueenBee()
window.ioc.register('@diamondcoreprocessor.com/HideQueenBee', _hide)
