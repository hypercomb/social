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
  // Imported by another module, she loads with it whatever the word says.
  const base = (file.split(/[\\/]/).pop() ?? '').replace(/\.ts$/, '')
  const imported = new RegExp(`from\\s+['"][^'"]*/${base.replace(/\./g, '\\.')}(?:\\.js)?['"]`)
  for (const [path, text] of others) {
    if (path === file) continue
    if (text.includes(key)) return { passive: false, why: `key named by ${path}` }
    // A namespace barrel's `export *` of a bee is dropped when the barrel is
    // built (it re-exports atoms only), so it never loads her.
    const barrel = /(^|\/)index\.ts$/.test(path)
    if (!barrel && imported.test(text)) return { passive: false, why: `imported by ${path}` }
  }
  return { passive: true, key }
}
