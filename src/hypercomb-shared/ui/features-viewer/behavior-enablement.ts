// hypercomb-shared/ui/features-viewer/behavior-enablement.ts
//
// The WRITE side of the behavior-enablement lens (shell) — the pool's
// global lights. The READER lives essentials-side in
// `sharing/behavior-enablement.ts`; the two never import each other — they
// agree ONLY on the localStorage keys, the record shapes, and the
// `behavior:enablement-changed` event (the hidden/verified split).
//
// Model (OPT-IN — everything is off until it is lit in the pool):
//   • `hc:behavior-global-on` — THE truth once it exists: the decoration
//     kinds whose global light is ON. A kind it doesn't name is OFF — a new
//     module's behavior, a foreign decoration, anything that arrives later,
//     all dark until someone lights it in the pool. The essentials side
//     seeds this list once, on boot, from the census minus the legacy
//     off-list, so a hive that predates the opt-in model keeps exactly the
//     lights it had.
//   • `hc:behavior-global-off` — the LEGACY list, still answered while the
//     on-list hasn't been seeded, and kept written as a MIRROR afterwards
//     (kinds explicitly turned off) because the swarm's withheld wire
//     (kind 30208) needs an enumerable list to broadcast.
//   • `hc:behavior-seeded` — the cohort ledger: which groups of kinds have
//     already had their lights decided, so no seed runs twice. `'*'` means
//     the hive STARTED DARK and no cohort may ever light itself here.
//   • `hc:behavior-wake` — { "/path": [kinds] } local ON exceptions,
//     honored by the essentials READER for records that already exist. This
//     side no longer writes them: the wake writer had no UI and no callers,
//     so it was removed (2026-09-01) rather than carried as dead surface.

import { EffectBus } from '@hypercomb/core'

export const GLOBAL_ON_KEY = 'hc:behavior-global-on'
export const GLOBAL_OFF_KEY = 'hc:behavior-global-off'
/** Cohorts whose lights have been decided (essentials owns the seeding —
 *  this side only stamps `'*'` for a dark start). Agreed by key, like the
 *  rest of this lens. */
export const SEEDED_COHORTS_KEY = 'hc:behavior-seeded'
export const ENABLEMENT_CHANGED = 'behavior:enablement-changed'

// ── SUGGESTED (jwize, 2026-11-11) ────────────────────────────────────────
//
// "We can have suggested behaviors so the person who doesn't want ai doesn't
// get it." A suggested behaviour is OFF, and offered: nothing of it runs until
// the participant turns it on, and the offer is one press. It is not a third
// polarity — every reader already answers "off" for it, from the lists above.
// `hc:behavior-suggested` only says which of the dark kinds are worth
// offering, and a kind leaves it the moment the participant flips its light
// either way: a suggestion is made once.
export const SUGGESTED_KEY = 'hc:behavior-suggested'

/** What a fresh hive is offered. The AI chat is the first: a new hive opens
 *  without it. A hive that already exists is never touched — its chat stays
 *  as it was. */
export const FRESH_HIVE_SUGGESTIONS: readonly string[] = ['word:chat']

function readStringArray(key: string): string[] {
  try {
    const arr = JSON.parse(localStorage.getItem(key) ?? '[]')
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : []
  } catch { return [] }
}

/** True once the opt-in on-list has been seeded — from then on it is the
 *  single truth and the off-list is only the withheld-wire mirror. */
export function hasGlobalOnList(): boolean {
  try { return localStorage.getItem(GLOBAL_ON_KEY) != null } catch { return false }
}

/** A BRAND-NEW install starts DARK: the opt-in on-list is materialized
 *  EMPTY, so every behaviour — every view, every decoration kind the module
 *  graph brings — is globally off until the participant lights it in the
 *  Beehaviors roster. Called by the shell at the one moment it can tell a
 *  fresh hive from an existing one: cold `ensureInstall`, before any bee has
 *  registered and long before essentials' census seed (`seedGlobalOnKinds`)
 *  could light everything. Writing the list here is what makes that seed a
 *  no-op for the rest of this hive's life.
 *
 *  It also stamps the cohort ledger `'*'` — DARK START. A cohort seed
 *  (essentials' `seedCohortOn`) lights behaviour that already worked
 *  hive-wide before the roster learned to switch it, so that it doesn't
 *  read as breaking; a hive that opened with NOTHING lit has no such past,
 *  and the stamp is what stops a light appearing in it behind the
 *  participant's back — now, and for every cohort that comes later.
 *
 *  No-op once the list exists — an existing hive keeps exactly the lights it
 *  had, and re-running a cold install never darkens it. No change event: the
 *  bus has no subscribers this early, and the first read is the truth. */
export function seedDarkOnFreshInstall(): boolean {
  if (hasGlobalOnList()) return false
  try {
    localStorage.setItem(GLOBAL_ON_KEY, '[]')
    localStorage.setItem(SEEDED_COHORTS_KEY, JSON.stringify(['*']))
  } catch { return false }
  // The build's own words read lit until they are on the off-list, so a
  // suggested word is put there — off, and named as an offer.
  write(GLOBAL_OFF_KEY, [...new Set([...readGlobalOffKinds(), ...FRESH_HIVE_SUGGESTIONS])])
  write(SUGGESTED_KEY, [...FRESH_HIVE_SUGGESTIONS])
  return true
}

/** The kinds on offer: suggested, and still off. */
export function readSuggestedKinds(): string[] {
  return readStringArray(SUGGESTED_KEY).filter(kind => isKindGloballyOff(kind) || readGlobalOffKinds().includes(kind))
}

export function isKindSuggested(kind: string): boolean {
  return readSuggestedKinds().includes(String(kind ?? '').trim())
}

export function readGlobalOffKinds(): string[] {
  return readStringArray(GLOBAL_OFF_KEY)
}

export function isKindGloballyOff(kind: string): boolean {
  if (hasGlobalOnList()) return !readStringArray(GLOBAL_ON_KEY).includes(kind)
  return readGlobalOffKinds().includes(kind)
}

/** Flip one global light. Writes the on-list (the truth, once seeded) AND
 *  the off-list mirror in the same gesture, then emits the change event so
 *  every reader cache invalidates and every surface repaints at once. */
export function setKindGlobalOn(kind: string, on: boolean): void {
  const k = String(kind ?? '').trim()
  if (!k) return
  let changed = false
  if (hasGlobalOnList()) {
    const list = readStringArray(GLOBAL_ON_KEY)
    const has = list.includes(k)
    if (on && !has) { changed = true; write(GLOBAL_ON_KEY, [...list, k]) }
    else if (!on && has) { changed = true; write(GLOBAL_ON_KEY, list.filter(x => x !== k)) }
  }
  const off = readGlobalOffKinds()
  const wasOff = off.includes(k)
  if (on && wasOff) { changed = true; write(GLOBAL_OFF_KEY, off.filter(x => x !== k)) }
  else if (!on && !wasOff) { changed = true; write(GLOBAL_OFF_KEY, [...off, k]) }
  if (!changed) return
  // The participant has had their say: the suggestion is spent.
  const suggested = readStringArray(SUGGESTED_KEY)
  if (suggested.includes(k)) write(SUGGESTED_KEY, suggested.filter(x => x !== k))
  EffectBus.emit(ENABLEMENT_CHANGED, { kind: k, on })
}

function write(key: string, list: string[]): void {
  try { localStorage.setItem(key, JSON.stringify(list)) } catch { /* private-browsing */ }
}

// ── A WORD'S LIGHT, for the shell's own surfaces ─────────────────────────
//
// Every word is a behaviour with a light of its own, `word:<word>` (the
// essentials reader: commands/word-enablement.ts). The build's own words are
// lit until switched off, and a switch-off is exactly an entry on the
// off-list, which `setKindGlobalOn` above writes in the same gesture as the
// on-list. The shell's surfaces that belong to a word — the chat window, the
// rail's meeting and chat buttons, the bar's hosts and comfy launchers — are
// all the build's, so this one reading is all they need; agreed with the
// reader by key, never by import, like everything else in this lens.

export const WORD_KIND_PREFIX = 'word:'

/** True when the participant switched this word off in Beehaviors. Never on
 *  a published visitor shell, which has no roster to consult. */
export function isWordSwitchedOff(word: string): boolean {
  const w = String(word ?? '').trim().toLowerCase().replace(/^\/+/, '')
  if (!w) return false
  try { if (document.documentElement.dataset['hypercombMode'] === 'visitor') return false } catch { /* no document */ }
  return readGlobalOffKinds().includes(WORD_KIND_PREFIX + w)
}

const foldWord = (word: string): string => String(word ?? '').trim().toLowerCase().replace(/^\/+/, '')

/** True when this word is off and on offer — its door is still shown, and a
 *  press of it is the participant turning it on. */
export function isWordSuggested(word: string): boolean {
  const w = foldWord(word)
  return !!w && isWordSwitchedOff(w) && readStringArray(SUGGESTED_KEY).includes(WORD_KIND_PREFIX + w)
}

/** Take the offer: light the word. True when it was on offer. */
export function acceptSuggestedWord(word: string): boolean {
  if (!isWordSuggested(word)) return false
  setKindGlobalOn(WORD_KIND_PREFIX + foldWord(word), true)
  return true
}

/** The refusal a word's surface says when asked to open while it is off —
 *  the same keys and the same press the essentials door uses, so the two
 *  read as one voice. */
export function sayWordSwitchedOff(word: string): void {
  const w = String(word ?? '').trim().toLowerCase().replace(/^\/+/, '')
  if (!w) return
  const i18n = (globalThis as { ioc?: { get?: (key: string) => unknown } }).ioc
    ?.get?.('@hypercomb.social/I18n') as { t?: (key: string, params?: Record<string, string>) => string } | undefined
  const say = (key: string, fallback: string, params?: Record<string, string>): string => {
    const said = i18n?.t?.(key, params)
    return said && said !== key ? said : fallback
  }
  EffectBus.emit('toast:show', {
    type: 'info',
    title: '/' + w,
    message: isWordSuggested(w)
      ? say('words.suggested', `"${w}" is suggested, and off until you turn it on. Its light is in Beehaviors, under Everywhere.`, { word: w })
      : say('words.dark', `"${w}" is switched off. Its light is in Beehaviors, under Everywhere.`, { word: w }),
    actionLabel: say('words.dark.open', 'Open Beehaviors'),
    actionEffect: 'features:roster-open',
    actionPayload: { query: w },
    duration: 6000,
  })
}
