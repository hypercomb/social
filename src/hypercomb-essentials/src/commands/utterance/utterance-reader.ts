// utterance-reader.ts — the WIRED reader: the pure reading dressed by the hive.
//
// Imports the pure core (utterance-reading.ts — spec-covered, dependency
// free) and adds the live registries: the SlashBehaviourDrone census as the
// lexicon, and each action colored by its behaviour tile's category keyword
// through TagRegistry. Registered in IoC for the shell.

import { tagsForLabel } from '../decoration-kind-index.js'
import { readUtterance, type UtteranceReading } from './utterance-reading.js'

export type { UtteranceAction, UtteranceLexiconEntry, UtteranceReading, UtteranceSpan } from './utterance-reading.js'

// ── the wired reader ──────────────────────────────────────────────────────

interface SlashBehaviourDroneLike {
  /** Primary behaviours only — aliases preserved on each entry's `aliases`
   *  field, descriptions localized. NOT all(): that census alias-EXPANDS
   *  (one entry per alias, each still carrying the full aliases array), so
   *  reading it would claim every word once per alias and misname the
   *  claimants of an ambiguity. */
  entries?(): readonly { name: string; description?: string; aliases?: readonly string[]; hidden?: boolean }[]
}
interface TagRegistryLike { color?(name: string): string | undefined }

export class UtteranceReader {
  /** Read an utterance against the LIVE behaviour census, and dress each
   *  action in its behaviour's own color: the category keyword painted on
   *  its behaviour tile (behaviors/<category>/<name>), through TagRegistry.
   *  Beehaviors have color — the reading wears it. */
  read(text: string, resolutions?: ReadonlyMap<number, string>): UtteranceReading | null {
    const drone = window.ioc?.get?.('@diamondcoreprocessor.com/SlashBehaviourDrone') as SlashBehaviourDroneLike | undefined
    const entries = drone?.entries?.()
    if (!entries?.length) return null
    const reading = readUtterance(text, entries, resolutions)
    for (const span of reading.spans) {
      if (span.role !== 'action' && span.role !== 'ambiguity') continue
      const color = this.#colorFor(span.command ?? span.candidates?.[0]?.name)
      if (color) span.color = color
    }
    return reading
  }

  #colorFor(command: string | undefined): string | undefined {
    if (!command) return undefined
    const tags = tagsForLabel(command)
    const category = tags.find(t => t !== 'behavior')
    if (!category) return undefined
    const registry = window.ioc?.get?.('@hypercomb.social/TagRegistry') as TagRegistryLike | undefined
    return registry?.color?.(category) || undefined
  }
}

window.ioc?.register?.('@diamondcoreprocessor.com/UtteranceReader', new UtteranceReader())
