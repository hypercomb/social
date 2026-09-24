// molecule/vocabulary.queen.ts
//
// `/vocabulary` — SAY YOUR WORDS, AND PUBLISH THEM.
//
// The whole vocabulary stack was built, tested, and had no handle. This is the
// handle. Reading it is free and local; publishing it is an irreversible
// public act, and the two are not the same gesture.
//
// ── THE COMMAND LINE CANNOT PUBLISH ─────────────────────────────────────
//
// `execute` does exactly one thing: it emits `vocabulary:open`. There is no
// import of the publish door anywhere in this module's graph, no `confirmed`
// field on the payload, and no branch that acts. `/vocabulary publish` AIMS
// the window — it focuses the publish button — and the window then says so in
// as many words, because a participant who typed "publish" and saw a panel
// appear could otherwise reasonably believe something was published.
//
// ── NO `machine` GRAMMAR, DELIBERATELY ──────────────────────────────────
//
// `machine` absent is the safe default (`queen.base.ts`), and the window this
// opens contains the only irreversible public act in the module. A model
// speaking the communication layer must not be able to reach it, not even to
// open the door in front of it.
//
// ── NO ALIAS ────────────────────────────────────────────────────────────
//
// Aliases are the participant's to give. Nothing here declares one.

import { EffectBus, QueenBee } from '@hypercomb/core'
import { OPEN_STAMP_MS, VOCABULARY_OPEN } from './vocabulary-words.js'

/** The two verbs, in the order the window shows them. Read by `slashComplete`
 *  AND by `execute`, so autocomplete and the aim can never disagree. */
export const VOCABULARY_INTENTS: readonly string[] = Object.freeze(['publish', 'withdraw'])

/** What the window is asked to aim at. `''` is the ordinary case: open and
 *  read. Never a confirmation — this word travels no further than a focus. */
export const readIntent = (args: string): string => {
  const word = String(args ?? '').trim().toLowerCase().split(/\s+/)[0] ?? ''
  return VOCABULARY_INTENTS.includes(word) ? word : ''
}

export class VocabularyQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'vocabulary'
  override description = 'Show the words this hive declares; publish or withdraw them'
  override options = VOCABULARY_INTENTS
  override examples = [
    { input: '/vocabulary', result: 'Shows the words this hive holds — nothing leaves' },
    { input: '/vocabulary publish', result: 'Opens the same window with the publish gesture in front of you' },
  ]

  override slashComplete(args: string): readonly string[] {
    const q = String(args ?? '').trim().toLowerCase()
    return VOCABULARY_INTENTS.filter(o => !q || o.startsWith(q))
  }

  protected async execute(args: string): Promise<void> {
    EffectBus.emit(VOCABULARY_OPEN, { intent: readIntent(args), at: Date.now() })
  }
}

// THE WINDOW ARRIVES WITH THE ASK, not at boot (atomic-modules-plan.md,
// "adopt the proper load"). The surface registry takes only a tag, so the tag
// goes in at boot and the element is defined from one cached import() the
// first time `vocabulary:open` asks; the element already in the page upgrades
// in place and its own subscription replays the ask. The tag and owner are
// spelled here: importing even a const from the view would keep it static.
const SURFACE = 'hc-vocabulary'
const OWNER = '@diamondcoreprocessor.com/VocabularyView'

type OpenAsk = { intent?: string; at?: number }
let view: Promise<void> | null = null
/** The latest ask while the view loads — a burst collapses to it, as the
 *  replay does. */
let asked: OpenAsk | null = null

const defineView = (): Promise<void> => view ??= import('./vocabulary.view.js')
  .then(m => { if (!customElements.get(SURFACE)) customElements.define(SURFACE, m.VocabularyElement) })
  .catch(error => { view = null; throw error })

const openOnAsk = (ask: OpenAsk | undefined): void => {
  if (customElements.get(SURFACE) || Math.abs(Date.now() - (ask?.at ?? 0)) > OPEN_STAMP_MS) return
  asked = ask ?? null
  void defineView().then(() => {
    const last = asked
    asked = null
    // A SLOW FIRST LOAD. The upgrade replayed the ask, but the element drops
    // one older than its stamp window as a replay; this one was a hand, so it
    // is asked again, freshly stamped — still only an intent the queen offers.
    const element = document.querySelector<HTMLElement & { readonly open$?: boolean }>(SURFACE)
    if (last && !element?.open$) EffectBus.emit(VOCABULARY_OPEN, { intent: readIntent(String(last.intent ?? '')), at: Date.now() })
  }, error => {
    asked = null
    EffectBus.emit('toast:show', {
      type: 'warning',
      message: `Could not open your vocabulary: ${error instanceof Error ? error.message : String(error)}`,
    })
  })
}

// THE BEE WIRES (atomic-modules-plan.md): the view is a dependency; this bee
// adds its tag to the shell's surface registry — never a tag in either
// app.html — and defines the element when it is first asked for.
window.ioc.whenReady('@hypercomb.social/ShellSurfaceRegistry', (registry: { add(s: unknown): void }) => {
  EffectBus.on<OpenAsk>(VOCABULARY_OPEN, openOnAsk)
  try {
    registry.add({ name: SURFACE, owner: OWNER, element: SURFACE, order: 140 })
  } catch {
    // duplicate add (hot reload) — the mounted surface is already live
  }
})

const _vocabulary = new VocabularyQueenBee()
;(window as unknown as { ioc?: { register?: (k: string, v: unknown) => void } })
  .ioc?.register?.('@diamondcoreprocessor.com/VocabularyQueenBee', _vocabulary)
