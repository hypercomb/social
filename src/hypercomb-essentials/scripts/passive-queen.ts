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
// Deliberately strict and read from the source; a queen that fails it loads
// exactly as before.

/** Module-level acts that change the hive by loading. */
const SIDE_EFFECT = /whenReady\(|\bonEffect\(|EffectBus\.on\(|addEventListener\(|registerTranslations\(|customElements\.define\(|registry\.register\(|\.register\(\{/

/** A literal-key IoC registration: `register('@domain.com/Name', …)`. */
const LITERAL_REGISTER = /register\(\s*['"](@[^'"]+)['"]/g

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
  if (!/\.queen\.ts$/.test(file)) return { passive: false, why: 'not a queen module' }
  const keys = [...source.matchAll(LITERAL_REGISTER)].map(match => match[1]!)
  if (keys.length !== 1) return { passive: false, why: `registers ${keys.length} literal keys` }
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
