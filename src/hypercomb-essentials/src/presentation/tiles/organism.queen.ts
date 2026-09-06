// presentation/tiles/organism.queen.ts
//
// `/organism` — look at this page by how densely populated its tiles are.
//
// EVERY ACT HAS A WORD. The organism is a projection a participant enters and
// leaves, so it needs one, and the word carries the whole grammar of the view:
//
//   /organism            — the densest tile at the centre, the rest crowding
//                          around it and thinning outward
//   /organism texture    — each kind as its own blob, kinds ordered by weight
//   /organism <tag>      — the organism with that kind lifted to the top layer
//   /organism off        — give the map back
//
// It commits nothing, publishes nothing and leaves no mark: entering re-reads
// the grid, leaving restores it. The machine axes have no "reading" reach —
// the mildest is `editing` — so that is what it declares, held to
// `scope: 'local'`, which is the axis that actually bounds it: the change
// never leaves this browser. The worst case of a model getting this wrong is
// a view the same word undoes.

import { QueenBee, EffectBus } from '@hypercomb/core'
import {
  ORGANISM_SET,
  ORGANISM_CHANGED,
  type OrganismChangedPayload,
  type OrganismSetPayload,
} from './organism.drone.js'

type Reading =
  | { readonly mode: 'off' }
  | { readonly mode: 'organism'; readonly promote: string | null }
  | { readonly mode: 'texture' }

/** ONE reading for both callers — the participant's line and the machine's
 *  admission gate must never disagree about what it means. */
const read = (args: string): Reading => {
  const raw = args.trim().toLowerCase()
  if (!raw) return { mode: 'organism', promote: null }
  if (raw === 'off' || raw === '~') return { mode: 'off' }
  if (raw === 'texture') return { mode: 'texture' }
  // Anything else names the kind to bring to the top.
  return { mode: 'organism', promote: args.trim() }
}

export class OrganismQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'organism'
  override description = 'See this page by density — the thickest tile at the centre, the rest crowding around it'
  override descriptionKey = 'slash.organism'
  override options = ['', 'texture', '<tag>', 'off']
  override examples = [
    { input: '/organism', result: 'The most densely populated tile takes the centre; the rest thin outward' },
    { input: '/organism texture', result: 'Each kind becomes its own blob, the heaviest kind at the centre' },
    { input: '/organism notes', result: 'The organism, with tiles tagged "notes" met first' },
    { input: '/organism off', result: 'The map comes back exactly as it was' },
  ]

  /** The gentlest reach the axes offer, and the narrowest scope. The
   *  projection changes the slot grid and nothing else: no layer is minted,
   *  no index rewritten, no mesh event sent, and the same word restores the
   *  map. `scope: 'local'` is the load-bearing half — nothing leaves this
   *  browser, which is what a grant should be gating on here. */
  override machine = {
    forms: '(nothing) | texture | <tag> | off',
    example: '/organism',
    reach: 'editing' as const,
    scope: 'local' as const,
  }

  /** Complete on the kinds actually present, plus the two shapes. */
  override slashComplete(args: string): readonly string[] {
    const query = args.trim().toLowerCase()
    const words = ['texture', 'off', ...this.#pageTags()]
    return query ? words.filter(w => w.toLowerCase().startsWith(query)) : words
  }

  protected async execute(args: string): Promise<void> {
    const reading = read(args)
    const settled = this.#nextAnswer()

    EffectBus.emit<OrganismSetPayload>(ORGANISM_SET, reading.mode === 'organism'
      ? { mode: 'organism', ...(reading.promote ? { promote: reading.promote } : {}) }
      : { mode: reading.mode })

    const answer = await settled
    this.#log(this.#say(reading, answer))
  }

  /** The drone answers on ORGANISM_CHANGED. Waiting for it means the word
   *  reports what LANDED — a refusal, or the ontology that actually ranked —
   *  rather than what was asked for.
   *
   *  `EffectBus.on` REPLAYS the last value synchronously to a new subscriber,
   *  which for a sticky answer effect means the PREVIOUS run's answer would
   *  resolve this promise before the drone has done anything. The replay
   *  arrives inside the `on()` call, so ignoring anything delivered while
   *  `subscribing` is set skips exactly the stale one and nothing else. */
  #nextAnswer(): Promise<OrganismChangedPayload | null> {
    return new Promise(resolve => {
      let done = false
      let subscribing = true
      const timer = setTimeout(() => { if (!done) { done = true; off(); resolve(null) } }, 4000)
      const off = EffectBus.on<OrganismChangedPayload>(ORGANISM_CHANGED, payload => {
        if (done || subscribing) return
        done = true
        clearTimeout(timer)
        off()
        resolve(payload)
      })
      subscribing = false
    })
  }

  #say(reading: Reading, answer: OrganismChangedPayload | null): string {
    if (reading.mode === 'off') return 'Organism — the map is back'
    if (!answer) return 'Organism — the tile surface did not answer'
    if (answer.refused) return `Organism — ${answer.refused}`
    if (answer.placed === 0) return 'Organism — nothing here has a density to rank'

    const by = answer.ontology === 'holders'
      ? 'participants holding each tile'
      : 'what each tile contains'
    const shape = reading.mode === 'texture'
      ? `${answer.placed} tiles gathered into kinds`
      : `${answer.placed} tiles crowding the thickest one`
    if (reading.mode === 'organism' && reading.promote && answer.promoted === 0) {
      return `Organism — ${shape}, ranked by ${by}; nothing here is tagged "${reading.promote}", so nothing was lifted`
    }
    const lifted = reading.mode === 'organism' && reading.promote
      ? `, ${answer.promoted} tagged "${reading.promote}" first`
      : ''
    return `Organism — ${shape}${lifted}, ranked by ${by}`
  }

  /** Tags on this page, so the line completes what is actually here. The bus
   *  has no reader, but a subscribe REPLAYS the last value synchronously —
   *  so subscribing and immediately unsubscribing is the read. */
  #pageTags(): string[] {
    let tags: { name: string }[] = []
    const off = EffectBus.on<{ tags?: { name: string }[] }>('render:tags', payload => {
      tags = payload?.tags ?? []
    })
    off()
    return tags.map(t => t.name)
  }

  #log(message: string): void {
    EffectBus.emit('activity:log', { message, icon: '◌' })
  }
}

const organismWord = new OrganismQueenBee()
;(window as unknown as { ioc?: { register?: (k: string, v: unknown) => void } }).ioc?.register?.(
  '@diamondcoreprocessor.com/OrganismQueenBee', organismWord,
)
