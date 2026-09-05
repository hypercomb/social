// hypercomb-shared/core/saved-locations-store.ts
//
// User-curated list of named locations. Add is explicit (no auto-history) so
// the list stays meaningful — but the mesh-modal auto-promotes the active
// location on Save so the happy path does not require an extra tap.
//
// The list is ONE DOCUMENT in the participant's `locations:saved` pool
// (participant-document.ts): synchronous to read, hydrated from disk, written
// through. The old localStorage key is read once as a fallback and never
// written again.

import { ParticipantDocument, legacyJson, type ParticipantDocumentOptions } from './participant-document'

/** LEGACY localStorage key — read at construction, never written. */
const LEGACY_KEY = 'hc:saved-locations'
/** The document pool. Colon-scoped: no tile can name it. */
export const SAVED_LOCATIONS_MEANING = 'locations:saved'

const parse = (raw: unknown): string[] | null =>
  Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string' && v.trim().length > 0) : null

export class SavedLocationsStore extends EventTarget {

  readonly #doc: ParticipantDocument<string[]>

  public get value(): ReadonlyArray<string> { return this.#doc.value }

  constructor(io: Pick<ParticipantDocumentOptions<string[]>, 'whenStore'> = {}) {
    super()
    this.#doc = new ParticipantDocument<string[]>({
      meaning: SAVED_LOCATIONS_MEANING, parse, empty: [],
      legacy: () => legacyJson(LEGACY_KEY), whenStore: io.whenStore,
    })
    this.#doc.addEventListener('change', () => this.dispatchEvent(new Event('change')))
  }

  public add = (name: string): void => {
    const clean = (name ?? '').trim()
    if (!clean) return
    if (this.#doc.value.includes(clean)) return
    this.#doc.write([...this.#doc.value, clean])
    this.dispatchEvent(new Event('change'))
  }

  public remove = (name: string): void => {
    const next = this.#doc.value.filter(v => v !== name)
    if (next.length === this.#doc.value.length) return
    this.#doc.write(next)
    this.dispatchEvent(new Event('change'))
  }
}

register('@hypercomb.social/SavedLocationsStore', new SavedLocationsStore())
