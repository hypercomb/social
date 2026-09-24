// molecule/vocabulary-find.queen.ts
//
// `/find-word <word>` — hash a word, ask the hosts, and show the FOUR
// outcomes without merging any two of them.
//
// ── `slashComplete` RETURNS NOTHING, AND THAT IS THE POINT ───────────────
//
// `dottedToSpaced` in the slash drone rewrites `a.b` into `a b` whenever every
// dotted segment is a word the completer offers. A find behaviour that
// completed this hive's own vocabulary is EXACTLY the case where a typed
// `cigar.maduro` would be silently turned into two words and the wrong
// question asked. So the argument position offers nothing and `options` is
// empty. The affordance is not lost: the window carries an input with a
// datalist of the local spellings, which is a local read and cannot rewrite
// anything.
//
// ── NO `machine` GRAMMAR ────────────────────────────────────────────────
//
// The address is a hash of a word the caller chose, and probing hosts with it
// tells them what was asked. A read that leaves the device is still a
// disclosure, so a model may not choose the word.

import { EffectBus, QueenBee } from '@hypercomb/core'
import { OPEN_STAMP_MS, VOCABULARY_FIND } from './vocabulary-words.js'

export class VocabularyFindQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'find-word'
  override description = 'Ask the hosts which of them declare a word — present, absent, or unknown'
  override examples = [
    { input: '/find-word cigar', result: 'Asks every publisher you follow, and says which could not answer' },
    { input: '/find-word', result: 'Opens the lookup with nothing asked yet' },
  ]

  /** Free text. Offering the hive's own words here would let a legitimate
   *  dotted argument be rewritten into two. */
  override slashComplete(_args: string): readonly string[] {
    return []
  }

  protected async execute(args: string): Promise<void> {
    EffectBus.emit(VOCABULARY_FIND, { word: String(args ?? '').trim(), at: Date.now() })
  }
}

// THE WINDOW ARRIVES WITH THE ASK, not at boot (atomic-modules-plan.md,
// "adopt the proper load"). The surface registry takes only a tag, so the tag
// goes in at boot and the element is defined from one cached import() the
// first time `vocabulary:find` asks; the element already in the page upgrades
// in place and its own subscription replays the ask. The tag and owner are
// spelled here: importing even a const from the view would keep it static.
const SURFACE = 'hc-vocabulary-find'
const OWNER = '@diamondcoreprocessor.com/VocabularyFindView'

type FindAsk = { word?: string; at?: number }
let view: Promise<void> | null = null
/** The latest ask while the view loads — a burst collapses to it, as the
 *  replay does. */
let asked: FindAsk | null = null

const defineView = (): Promise<void> => view ??= import('./vocabulary-find.view.js')
  .then(m => { if (!customElements.get(SURFACE)) customElements.define(SURFACE, m.VocabularyFindElement) })
  .catch(error => { view = null; throw error })

const openOnAsk = (ask: FindAsk | undefined): void => {
  if (customElements.get(SURFACE) || Math.abs(Date.now() - (ask?.at ?? 0)) > OPEN_STAMP_MS) return
  asked = ask ?? null
  void defineView().then(() => {
    const last = asked
    asked = null
    // A SLOW FIRST LOAD. The upgrade replayed the ask, but the element drops
    // one older than its stamp window as a replay; this one was a hand, so it
    // is asked again, freshly stamped.
    const element = document.querySelector<HTMLElement & { readonly open$?: boolean }>(SURFACE)
    if (last && !element?.open$) EffectBus.emit(VOCABULARY_FIND, { word: String(last.word ?? ''), at: Date.now() })
  }, error => {
    asked = null
    EffectBus.emit('toast:show', {
      type: 'warning',
      message: `Could not open Find a word: ${error instanceof Error ? error.message : String(error)}`,
    })
  })
}

// THE BEE WIRES (atomic-modules-plan.md): the view is a dependency; this bee
// adds its tag to the shell's surface registry — never a tag in either
// app.html — and defines the element when it is first asked for.
window.ioc.whenReady('@hypercomb.social/ShellSurfaceRegistry', (registry: { add(s: unknown): void }) => {
  EffectBus.on<FindAsk>(VOCABULARY_FIND, openOnAsk)
  try {
    registry.add({ name: SURFACE, owner: OWNER, element: SURFACE, order: 141 })
  } catch {
    // duplicate add (hot reload) — the mounted surface is already live
  }
})

const _findWord = new VocabularyFindQueenBee()
;(window as unknown as { ioc?: { register?: (k: string, v: unknown) => void } })
  .ioc?.register?.('@diamondcoreprocessor.com/VocabularyFindQueenBee', _findWord)
