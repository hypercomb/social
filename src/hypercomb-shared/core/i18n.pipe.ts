// hypercomb-shared/core/i18n.pipe.ts
//
// Angular pipe for template localization.
// Usage:  {{ 'key' | t }}   or   {{ 'key' | t: { count: 5 } }}
//
// WHY THIS PIPE IS STILL `pure: false`, AND WHY THAT NO LONGER COSTS A LOOKUP.
//
// A pure pipe is memoized by Angular on its INPUTS alone: `ɵɵpipeBind1` →
// `pureFunction1Internal` → `bindingUpdated(lView, index, 'key')`, and when
// the key is the same literal it was last time the stored string is returned
// without calling `transform` at all (@angular/core 21, _debug_node-chunk:
// pureFunction1Internal / isPure). A signal read inside `transform` cannot
// change that — the view is marked for refresh when the signal moves, but the
// memoized binding never re-runs — so a pure `t` would freeze every
// `{{ 'key' | t }}` at the first word it resolved and `/language ja` would
// flip nothing. The pipe must stay impure to be asked again.
//
// What it does instead is make being asked nearly free. Each pipe instance
// (one per binding) remembers the inputs it last answered for and the
// CATALOG VERSION it answered under (LocalizationService.version, read
// through the shell's one `catalogVersion()` signal). A pass that changed no
// word is one signal read and three identity compares per binding, not a
// container lookup, an IoC lookup and a catalog resolve. When the locale flips
// or a catalog lands the version moves, every binding resolves once, and —
// because the version is a signal the view read — only views that show words
// are refreshed, with no `markForCheck` anywhere. The version moves in the
// microtask AFTER the write (fromRuntime's deferral), so nothing flips inside
// the pass that registered it and NG0100 stays quiet on boot.
//
// Under OnPush the view is only executed when something it reads changed; an
// impure pipe in such a view runs only then. That — not `pure: true` — is how
// the shell stops re-translating itself on every change-detection pass.

import { Pipe, type PipeTransform } from '@angular/core'
import type { I18nProvider } from '@hypercomb/core'
import { catalogVersion } from './i18n.signal'
import { consoleIsQuiet } from './quiet-console'

/** How often the pipe was asked, and how often it had to resolve a word.
 *  Specs read it to prove a pass costs no lookups; a verbose console
 *  (`hc:verbose=1`) can read it as `window.hcTranslateStats()`. */
export const translateStats = { transforms: 0, lookups: 0 }

if (!consoleIsQuiet && typeof window !== 'undefined') {
  (window as Window & { hcTranslateStats?: () => { transforms: number; lookups: number } })
    .hcTranslateStats = () => ({ ...translateStats })
}

@Pipe({ name: 't', standalone: true, pure: false })
export class TranslatePipe implements PipeTransform {
  #key: string | undefined
  #params: Record<string, string | number> | undefined
  #namespace: string | undefined
  #version = -1
  #value = ''

  transform(key: string, params?: Record<string, string | number>, namespace?: string): string {
    translateStats.transforms++
    const version = catalogVersion()
    if (
      version === this.#version && key === this.#key
      && params === this.#params && namespace === this.#namespace
    ) return this.#value
    translateStats.lookups++
    const i18n = get('@hypercomb.social/I18n') as I18nProvider | undefined
    this.#value = i18n?.t(key, params, namespace) ?? key
    this.#key = key
    this.#params = params
    this.#namespace = namespace
    this.#version = version
    return this.#value
  }
}
