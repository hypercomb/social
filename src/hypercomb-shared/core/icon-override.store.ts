// hypercomb-shared/core/icon-override.store.ts
//
// IconOverrideStore — participant-local, per-element icon overrides for the
// universal icon protocol. Any icon site resolves `glyph(id, default)`; if the
// participant has reskinned that element (via the icon-hive picker in edit
// mode), the override wins. This is UI chrome — never hive content or
// history; it does not sync across the swarm.
//
// The overrides are ONE DOCUMENT (element id → glyph) in the participant's
// `icons:overrides` pool (participant-document.ts): synchronous to read,
// hydrated from disk, written through. The old localStorage key is read once
// as a fallback and never written again; when the disk answers with a
// different record, every element whose glyph moved re-resolves.
//
// Element ids are namespaced by surface so they never collide:
//   control:pin · view:website · group:websites · overlay:edit
//
// Registered in IoC at `@hypercomb.social/IconOverrides`. Emits `change`
// ({ id, glyph|null }) so every surface re-resolves live.

// THE CONTAINER THIS MODULE REGISTERS INTO, named so it loads first wherever
// a bundler puts this file. A lazy entry that also reaches this module hoists
// it into a shared chunk that evaluates before the shell's main — where
// ioc.web used to be imported for it — and the bare `register` global did
// not exist yet: the whole graph threw and the shell came up blank.
import './ioc.web'
import { EffectBus } from '@hypercomb/core'
import { ParticipantDocument, legacyJson, type ParticipantDocumentOptions } from './participant-document'

/** LEGACY localStorage key — read at construction, never written. */
const LEGACY_KEY = 'hc:icon-overrides'
/** The document pool. Colon-scoped: no tile can name it. */
export const ICON_OVERRIDES_MEANING = 'icons:overrides'

type Overrides = Record<string, string>

const parse = (raw: unknown): Overrides | null => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const out: Overrides = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (k && typeof v === 'string' && v) out[k] = v
  }
  return out
}

export class IconOverrideStore extends EventTarget {
  #map: Map<string, string>
  readonly #doc: ParticipantDocument<Overrides>

  constructor(io: Pick<ParticipantDocumentOptions<Overrides>, 'whenStore'> = {}) {
    super()
    this.#doc = new ParticipantDocument<Overrides>({
      meaning: ICON_OVERRIDES_MEANING, parse, empty: {},
      legacy: () => legacyJson(LEGACY_KEY), whenStore: io.whenStore,
    })
    this.#map = new Map(Object.entries(this.#doc.value))
    // The record arrived from disk: every element whose glyph differs from
    // what was painted re-resolves. Ids that agree stay quiet.
    this.#doc.addEventListener('change', () => {
      const prev = this.#map
      const next = new Map(Object.entries(this.#doc.value))
      this.#map = next
      for (const id of new Set([...prev.keys(), ...next.keys()])) {
        const glyph = next.get(id) ?? null
        if (glyph !== (prev.get(id) ?? null)) this.#notify(id, glyph)
      }
    })
  }

  /** Resolve the glyph for an element id, falling back to the author default. */
  glyph(id: string, defaultGlyph: string): string {
    return this.#map.get(id) ?? defaultGlyph
  }

  /** Has the participant set an override for this element? */
  has(id: string): boolean { return this.#map.has(id) }

  /** Reskin an element. Persists + notifies. */
  set(id: string, glyph: string): void {
    const g = String(glyph ?? '').trim()
    if (!g || !id) return
    if (this.#map.get(id) === g) return
    this.#map.set(id, g)
    this.#persist()
    this.#notify(id, g)
  }

  /** Drop an override, reverting to the author default. */
  clear(id: string): void {
    if (!this.#map.delete(id)) return
    this.#persist()
    this.#notify(id, null)
  }

  /** Notify both the DOM (EventTarget, for Angular) and EffectBus (for Pixi /
   *  essentials drones that cannot subscribe to this EventTarget). */
  #notify(id: string, glyph: string | null): void {
    this.dispatchEvent(new CustomEvent('change', { detail: { id, glyph } }))
    EffectBus.emit('icon:override-changed', { id, glyph })
  }

  #persist(): void {
    this.#doc.write(Object.fromEntries(this.#map))
  }
}

export const iconOverrides = new IconOverrideStore()
register('@hypercomb.social/IconOverrides', iconOverrides)
