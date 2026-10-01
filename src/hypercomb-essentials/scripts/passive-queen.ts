// hypercomb-essentials/scripts/passive-queen.ts
//
// MAY THIS QUEEN SLEEP? (jwize 2026-09-25: "why are all libraries and
// dependencies used even if we don't need them — this has to stop".)
//
// A queen answers one word. If loading her does nothing BUT make her ready to
// answer it, she need not load until the word is used: the build writes her
// word and description into the layer docs, the command line and its
// completions read them from there, and the runtime wakes her by the word
// (script-preloader.ts `wakeWord`). A queen that does anything else when her
// module runs — registers a view, listens to a stream, hooks the DOM,
// registers translations or a second service — changes the hive just by
// loading, so she stays awake. So does one whose key another file names:
// something may ask IoC for her synchronously, and a sleeper would answer
// nothing.
//
// AND SO DOES A QUEEN A MACHINE MAY SAY (jwize's drive session, 2026-09-30).
// A `machine` block is the hive teaching a model one of its verbs — the
// forms, how far it reaches, and a `refuse` function that is code. All of
// that lives in her module and nowhere else, so asleep she was missing from
// the model's vocabulary entirely: on a deployed hive the chat's AI answered
// that it could not create a tile, because create, title, hide and file were
// asleep. Loading her changes what the hive teaches, which is changing the
// hive, so she stays awake.
//
// Deliberately strict and read from the source; a queen that fails it loads
// exactly as before.

/** Does this queen offer herself to a machine? A false yes only keeps a
 *  queen awake, which is the safe direction. */
export const declaresMachine = (source: string): boolean =>
  /^[ \t]*(?:(?:public|override|readonly)\s+)*machine\s*(?::[^=\n]+)?=/m.test(source)

/** Module-level acts that change the hive by loading. */
const SIDE_EFFECT = /whenReady\(|\bonEffect\(|EffectBus\.on\(|addEventListener\(|registerTranslations\(|customElements\.define\(|registry\.register\(|\.register\(\{/

/** A literal-key IoC registration: `register('@domain.com/Name', …)`. */
const LITERAL_REGISTER = /register\(\s*['"](@[^'"]+)['"]/g

/** An IoC registration by a NAMED key: `register(SOME_SERVICE_KEY, …)`. Always
 *  a second service — her own key is a literal — and invisible to the literal
 *  count, which is how the reference word slept with the create path's landing
 *  service inside her. */
const NAMED_REGISTER = /\bregister\(\s*[A-Za-z_$]/

export type PassiveVerdict = { passive: true; key: string } | { passive: false; why: string }

/** Named by key, or imported, by any module other than a namespace barrel
 *  (a barrel's `export *` of a bee is dropped when it is built). */
const reachedFromElsewhere = (file: string, keys: readonly string[], others: ReadonlyMap<string, string>): string | null => {
  const base = (file.split(/[\\/]/).pop() ?? '').replace(/\.ts$/, '')
  const imported = new RegExp(`from\\s+['"][^'"]*/${base.replace(/\./g, '\\.')}(?:\\.js)?['"]`)
  for (const [path, text] of others) {
    if (path === file) continue
    for (const key of keys) if (text.includes(key)) return `key named by ${path}`
    if (!/(^|\/)index\.ts$/.test(path) && imported.test(text)) return `imported by ${path}`
  }
  return null
}

export type EffectSleepVerdict = { sleeps: true; wakesOn: string[] } | { sleeps: false; why: string }

/** Every effect subscription in a source: literal names, and whether any
 *  subscription names its effect some other way (a constant, an expression). */
const subscriptionsOf = (source: string): { literal: string[]; opaque: boolean } => {
  const literal = [...source.matchAll(/(?:onEffect|EffectBus\.on|EffectBus\.once)(?:<[^>]*>)?\(\s*(['"`])([^'"`]+)\1/g)].map(match => match[2]!)
  const all = [...source.matchAll(/(?:onEffect|EffectBus\.on|EffectBus\.once)(?:<[^>]*>)?\(\s*([^\s,)]+)/g)].length
  return { literal, opaque: all > literal.length }
}

/**
 * MAY THIS BEE SLEEP UNTIL AN EFFECT? A bee that DECLARES the effects that
 * wake it (`readonly wakesOn = ['expand:layer', …]`) claims it does nothing
 * until one arrives; it stays unloaded until one is emitted, and the bus
 * replays that emission to it when it wakes. The build holds the claim to
 * what it can see: every subscription the bee makes is declared, none is
 * sent without replay (emitTransient), it listens to no DOM, and nothing
 * else names its key or imports it.
 */
export const effectSleeper = (
  file: string,
  source: string,
  others: ReadonlyMap<string, string>,
): EffectSleepVerdict => {
  const declared = /readonly\s+wakesOn\s*(?::[^=]+)?=\s*\[([^\]]*)\]/.exec(source)
  if (!declared) return { sleeps: false, why: 'declares no wakesOn' }
  const wakesOn = [...declared[1]!.matchAll(/['"]([^'"]+)['"]/g)].map(match => match[1]!)
  if (!wakesOn.length) return { sleeps: false, why: 'wakes on nothing' }
  const subscriptions = subscriptionsOf(source)
  if (subscriptions.opaque) return { sleeps: false, why: 'subscribes to an effect it does not name' }
  const undeclared = subscriptions.literal.filter(effect => !wakesOn.includes(effect))
  if (undeclared.length) return { sleeps: false, why: `subscribes to undeclared ${undeclared[0]}` }
  if (/addEventListener\(/.test(source)) return { sleeps: false, why: 'listens to the DOM' }
  for (const [path, text] of others) {
    for (const effect of wakesOn) {
      if (new RegExp(`emitTransient(?:<[^>]*>)?\\(\\s*['"]${effect.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]`).test(text)) {
        return { sleeps: false, why: `${effect} is sent without replay by ${path}` }
      }
    }
  }
  const keys = [...source.matchAll(LITERAL_REGISTER)].map(match => match[1]!)
  const reached = reachedFromElsewhere(file, keys, others)
  if (reached) return { sleeps: false, why: reached }
  return { sleeps: true, wakesOn }
}

export type ViewSleepVerdict = { sleeps: true; renders: string[] } | { sleeps: false; why: string }

/**
 * MAY THIS VIEW SLEEP? A bee that DECLARES the views it renders
 * (`readonly renders = ['slides', …]`) claims it acts nowhere else, so it may
 * stay unloaded until the view mode enters one of them or `view:open-for-tile`
 * names one. The declaration is the author's reviewed claim; the build only
 * adds that nothing else may reach for it by key or import.
 */
export const viewSleeper = (
  file: string,
  source: string,
  others: ReadonlyMap<string, string>,
): ViewSleepVerdict => {
  const declared = /readonly\s+renders\s*(?::[^=]+)?=\s*\[([^\]]*)\]/.exec(source)
  if (!declared) return { sleeps: false, why: 'declares no renders' }
  const renders = [...declared[1]!.matchAll(/['"]([^'"]+)['"]/g)].map(match => match[1]!)
  if (!renders.length) return { sleeps: false, why: 'renders nothing' }
  const keys = [...source.matchAll(LITERAL_REGISTER)].map(match => match[1]!)
  const reached = reachedFromElsewhere(file, keys, others)
  if (reached) return { sleeps: false, why: reached }
  return { sleeps: true, renders }
}

export const passiveQueen = (
  file: string,
  source: string,
  /** Every other source file of the package, by path. */
  others: ReadonlyMap<string, string>,
): PassiveVerdict => {
  // A queen is what DECLARES the one word it answers — never what its file is
  // called. A module that also pulses does work every cycle, so it stays awake.
  if (!/readonly\s+command\s*=\s*['"][^'"]+['"]/.test(source)) return { passive: false, why: 'declares no word' }
  if (/^\s*(?:(?:public|protected|override|async)\s+)*(?:heartbeat|sense)\s*\(/m.test(source)) return { passive: false, why: 'pulses' }
  if (declaresMachine(source)) return { passive: false, why: 'offers herself to a machine' }
  // `rawArgs` is the same kind of thing: the command line must know it BEFORE
  // it reads the line (no tag extraction, no dot walk, no splitting), and a
  // stand-in built from her word and description cannot say it for her.
  if (/^[ \t]*(?:(?:public|override|readonly)\s+)*rawArgs\s*(?::\s*boolean\s*)?=\s*true\b/m.test(source)) return { passive: false, why: 'takes her arguments verbatim' }
  const keys = [...source.matchAll(LITERAL_REGISTER)].map(match => match[1]!)
  if (keys.length !== 1) return { passive: false, why: `registers ${keys.length} literal keys` }
  if (NAMED_REGISTER.test(source)) return { passive: false, why: 'registers a service by a named key' }
  const side = SIDE_EFFECT.exec(source)
  if (side) return { passive: false, why: `acts on load (${side[0]})` }
  if (/listens\s*=\s*\[\s*['"]/.test(source)) return { passive: false, why: 'listens to effects' }
  const key = keys[0]!
  // Named or imported by another module, she loads with it whatever the word
  // says.
  const reached = reachedFromElsewhere(file, [key], others)
  if (reached) return { passive: false, why: reached }
  return { passive: true, key }
}
