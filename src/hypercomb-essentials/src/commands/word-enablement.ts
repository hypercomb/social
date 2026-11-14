// commands/word-enablement.ts
//
// EVERY WORD IS A BEHAVIOUR (jwize, 2026-11-08: "everything in hypercomb must
// be a behavior"). The word↔roster contract, in one file, on the pattern the
// games set (games/game-enablement.ts).
//
// The Beehaviors roster used to ask one question — what can a tile carry? —
// and a word marks no tile, so 161 words had no switch at all. `mail` could
// not be turned off. A word's roster identity is minted here instead, from
// the one thing every word already is: `word:<word>`. Like a game's kind, it
// is never written onto a tile and never read off one. It exists to be
// switched, and the switch is the whole of it — which is why words appear
// under Everywhere only: Here answers "what does this layer carry", and a
// word is never an answer to that.
//
// The census is not a list either. It IS the slash drone's providers — every
// queen it auto-wraps, every hand-written provider, every queen still asleep
// — so a community module's word takes its row with no edit anywhere.
//
// ── What off means ──────────────────────────────────────────────────────
//
//   • typed       — the door refuses (`SlashBehaviourDrone.execute`) and SAYS
//                   SO, with the way to its light. A typed word is a gesture,
//                   and swallowing one reads as a broken word (the games'
//                   lesson, in their own contract).
//   • listed      — it presents as hidden, so the palette, the autocomplete
//                   and the reading of prose all leave it out, from one seam.
//   • its desk    — a desk belongs to the word that opens it. An open desk
//                   closes the moment its light goes out (`closeWhenDark`),
//                   and refuses every other door while it is out.
//
// ── Which words arrive lit (jwize, 2026-11-08) ──────────────────────────
//
// A fresh install starts dark: nothing is lit until the participant lights
// it. Applied to words, a new hive would have no language at all. So the
// build's own words read the opposite way round: LIT until switched off.
// The off-list (`hc:behavior-global-off`) already records every explicit
// switch-off — the shell's writer keeps it in the same gesture as the
// on-list — so a shipped word is dark exactly when it is on that list, and a
// word the next build adds simply works. A word from anyone else's module
// reads the way every foreign kind does: dark until lit. A community word
// that already worked on a hive before this switch existed is lit once, as
// the `words` cohort (`seedCohortOn`), and never on a hive that started dark.
//
// A word whose game has a row is not a word row of its own: `/solomon` IS
// the game, its queen already refuses when the game is out, and two switches
// for one thing is the contradiction the one-switch rule forbids.

import { get, EffectBus, I18N_IOC_KEY, type I18nProvider } from '@hypercomb/core'
import {
  ENABLEMENT_CHANGED, isKindGloballyOff, isKindSuggested, isPublishedVisitorShell, readGlobalOffKinds,
} from '../sharing/behavior-enablement.js'
import { gameCensus } from '../games/game-enablement.js'

/** A word's kind is the word under this prefix — two segments, like a game's,
 *  because a word belongs to no tile and to no render pipeline. */
export const WORD_KIND_PREFIX = 'word:'

/** The cohort community words that already worked are lit under, once. */
export const WORD_COHORT = 'words'

/** THE BUILD'S OWN NAMESPACES — the ones essentials signs its bees with, and
 *  the shell's own (a word the shell registers, like `header`). A word whose
 *  queen declares one of these is shipped: lit until switched off. A
 *  hand-written provider and a queen still asleep carry no namespace, and
 *  both come from the build (the drone's own providers, the install package's
 *  walk), so no namespace reads as shipped too. */
export const SHIPPED_NAMESPACES: ReadonlySet<string> = new Set(['diamondcoreprocessor.com', 'revolucionstyle.com', 'hypercomb.social'])

/** THE WORDS THAT CANNOT GO DARK — without them there is no way back. The
 *  roster's own word and the binding word, `help`, `create`, and undo and
 *  redo (a switch-off is undone by a press, but a word typed by mistake is
 *  undone by these). Held here, beside the switch, and nowhere else: a word
 *  that could declare itself unswitchable could escape the switch. */
export const ALWAYS_LIT_WORDS: ReadonlySet<string> = new Set([
  'beehaviors', 'behavior', 'help', 'create', 'undo', 'redo',
])

/** THE WAY BACK, AS CODE (documentation/beehaviors-and-packages.md). The hosts
 *  desk refuses to switch off whole a package whose bees answer one of these
 *  words: with its code gone, nothing is left to turn it back on. The words
 *  that cannot go dark, and `hosts`, the desk's own word — that one may go
 *  dark (its light comes back from Beehaviors), but its code must stay. */
export const PACKAGE_WAY_BACK_WORDS: ReadonlySet<string> = new Set([...ALWAYS_LIT_WORDS, 'hosts'])

const fold = (word: unknown): string => String(word ?? '').trim().toLowerCase().replace(/^\/+/, '')

/** `mail` → `word:mail`. Empty in, empty out. */
export function wordKind(word: string): string {
  const w = fold(word)
  return w ? WORD_KIND_PREFIX + w : ''
}

/** `word:mail` → `mail`; '' for any other kind. */
export function wordOfKind(kind: string): string {
  const k = String(kind ?? '')
  return k.startsWith(WORD_KIND_PREFIX) ? k.slice(WORD_KIND_PREFIX.length) : ''
}

/** True for a namespace the build ships — and for no namespace at all. */
export function isShippedNamespace(namespace?: string): boolean {
  const ns = String(namespace ?? '').trim().toLowerCase()
  return !ns || SHIPPED_NAMESPACES.has(ns)
}

export function isAlwaysLit(word: string): boolean {
  return ALWAYS_LIT_WORDS.has(fold(word))
}

/** The games' ids — each game's word is its row, never a word row. */
export function gameWords(): ReadonlySet<string> {
  return new Set(gameCensus().map(game => fold(game.id)).filter(Boolean))
}

/** THE dormancy answer for a word. Global only: a word has no location, so
 *  none of the per-tile sources (wake, withheld, binding) can reach it.
 *
 *  On a published visitor shell there is no roster to consult — the shell
 *  is a cold install every visit — so no word is dark there. */
export function isWordDark(word: string, namespace?: string): boolean {
  const w = fold(word)
  if (!w || ALWAYS_LIT_WORDS.has(w)) return false
  if (isPublishedVisitorShell()) return false
  const kind = WORD_KIND_PREFIX + w
  return isShippedNamespace(namespace) ? readGlobalOffKinds().has(kind) : isKindGloballyOff(kind)
}

const say = (key: string, fallback: string, params?: Record<string, string>): string => {
  const i18n = get(I18N_IOC_KEY) as I18nProvider | undefined
  const said = i18n?.t?.(key, params)
  return said && said !== key ? said : fallback
}

/** THE REFUSAL, said once per gesture: the word, that it is off, and the way
 *  to its light — a press that opens Beehaviors on Everywhere, already
 *  searching for this word. */
export function sayWordDark(word: string): void {
  const w = fold(word)
  if (!w) return
  EffectBus.emit('toast:show', {
    type: 'info',
    title: '/' + w,
    message: isKindSuggested(WORD_KIND_PREFIX + w)
      ? say('words.suggested', `"${w}" is suggested, and off until you turn it on. Its light is in Beehaviors, under Everywhere.`, { word: w })
      : say('words.dark', `"${w}" is switched off. Its light is in Beehaviors, under Everywhere.`, { word: w }),
    actionLabel: say('words.dark.open', 'Open Beehaviors'),
    actionEffect: 'features:roster-open',
    actionPayload: { query: w },
    duration: 6000,
  })
}

/** A desk's half of the contract: run `close` the moment `word` goes dark.
 *  Only on the change — the bus replays its last value on subscribe, and a
 *  desk that is not open has nothing to close. Returns the unsubscribe. */
export function closeWhenDark(word: string, close: () => void, namespace?: string): () => void {
  let dark = isWordDark(word, namespace)
  return EffectBus.on(ENABLEMENT_CHANGED, () => {
    const now = isWordDark(word, namespace)
    if (now && !dark) close()
    dark = now
  })
}

/** A desk's other door: refuse to open while its word is dark, and say so.
 *  True when it refused. */
export function refuseWhileDark(word: string, namespace?: string): boolean {
  if (!isWordDark(word, namespace)) return false
  sayWordDark(word)
  return true
}
