// diamondcoreprocessor.com/commands/decoration.service.ts
//
// IoC facade over the decoration primitive (`decoration-manifest.ts`).
//
// `hypercomb-shared` command behaviours (tag-assign, the command-line tag
// extractor) must be able to write decorations, but shared can't import
// essentials at compile time. They resolve this service at runtime via IoC —
// the same pattern tag-assign already uses to reach HistoryService / Store /
// LayerCommitter. Keeping the decoration write/remove logic behind ONE facade
// means the `refs` closure (collectSigsDeep) and the tag-record shape live in
// a single place, not duplicated per caller.
//
// Tag convenience: a tag is a decoration of kind `tag` with payload `{ name }`
// and `appliesTo: []`. The empty appliesTo makes identical tag names produce
// ONE content-addressed resource shared across every cell (signature-doctrine
// dedup). Colour/accent live in TagRegistry keyed by name — never in the
// record — so the record stays pure and dedupable.

import {
  writeDecoration,
  removeDecoration,
  listDecorations,
  registerDecorationsSlot,
  type DecorationRecord,
} from './decoration-manifest.js'
import { TAG_DECORATION_KIND, tagSigFor, TITLE_DECORATION_KIND, titleForSegments } from './decoration-kind-index.js'
import { canonicalizeLineageSegment } from '../history/lineage-key.js'
import { I18N_IOC_KEY, type I18nProvider } from '@hypercomb/core'

/** The locale a title is written in when the caller doesn't name one. */
const activeLocale = (): string =>
  (window.ioc?.get?.(I18N_IOC_KEY) as I18nProvider | undefined)?.locale ?? 'en'

/** Just enough of HistoryService to enumerate a cell's siblings. */
type HistoryLike = {
  sign(lineage: { explorerSegments?: () => readonly string[] }): Promise<string>
  currentLayerAt(sig: string): Promise<Record<string, unknown> | null>
  getLayerBySig(sig: string): Promise<Record<string, unknown> | null>
}

export class DecorationService {

  /** Write a decoration JSON as a content-addressed resource (a sig file
   *  at the flat OPFS root; legacy `__resources__/` is a read-fallback) and
   *  append its sig to the cell's `decorations` slot. Returns the sig. */
  write<TPayload>(opts: {
    kind: string
    appliesTo: readonly string[]
    payload: TPayload
    segments: readonly string[]
    mark?: 'persistent'
  }): Promise<string> {
    return writeDecoration(opts)
  }

  /** Splice a decoration sig from a cell's `decorations` slot. The
   *  content-addressed resource is left intact (it may be shared). */
  remove(opts: { sig: string; segments: readonly string[] }): void {
    removeDecoration(opts)
  }

  /** Read + filter the decorations on a cell by kind. */
  list<TPayload>(opts: {
    kind: string
    segments: readonly string[]
  }): Promise<Array<{ sig: string; record: DecorationRecord<TPayload> }>> {
    return listDecorations<TPayload>(opts)
  }

  /** This cell's title rendered AS A PATH SEGMENT, for the breadcrumb: the
   *  same canonicalization a lineage key uses, so every run of non-letter,
   *  non-number folds to ONE hyphen and edge hyphens are trimmed
   *  ("Hard Bop, Revisited!" → "Hard-Bop-Revisited"). A crumb is a path, so it
   *  should read like one even when the words behind it are prose.
   *
   *  Synchronous and index-backed — a computed calls this per segment per
   *  render. '' when the cell has no title for the locale, or when the index
   *  has not walked it, and the caller falls back to the raw name. */
  titleSlugAt(segments: readonly string[], locale?: string): string {
    const title = titleForSegments(segments, locale ?? activeLocale())
    return title ? canonicalizeLineageSegment(title) : ''
  }

  /** How a sibling READS right now: its title for this locale if it has one,
   *  otherwise its own name. This is the string the participant actually sees,
   *  which is what a duplicate check has to compare against. */
  async #readingOf(segments: readonly string[], locale: string): Promise<string> {
    return (await this.titleOf(segments, locale)) || (segments[segments.length - 1] ?? '')
  }

  /** The reading of a sibling that already looks like `text`, or null.
   *
   *  Titles cannot COLLIDE the way names can — the address is untouched and
   *  `appliesTo: []` means two cells with the same title even share one record.
   *  This guard is about legibility, not integrity: two tiles side by side
   *  showing the same words are indistinguishable to the person reading them.
   *
   *  Compared case-insensitively and trimmed, against each sibling's READING
   *  (title-or-name), so titling one tile "Jazz" is refused both when a sibling
   *  is already titled "jazz" and when a sibling is simply NAMED "jazz". Only
   *  the active locale matters — it is the only one on screen. */
  async duplicateTitle(
    segments: readonly string[],
    text: string,
    locale?: string,
  ): Promise<string | null> {
    const target = locale ?? activeLocale()
    const wanted = text.trim().toLowerCase()
    if (!wanted) return null                       // clearing can never duplicate
    const parent = segments.slice(0, -1)
    for (const name of await this.#siblingNames(segments)) {
      const reading = await this.#readingOf([...parent, name], target)
      if (reading.trim().toLowerCase() === wanted) return reading
    }
    return null
  }

  /** Names of the cells alongside `segments`, self excluded. Read from the
   *  parent's `children` sigs, so it reflects committed truth rather than
   *  whatever the render happens to be showing. */
  async #siblingNames(segments: readonly string[]): Promise<string[]> {
    const history = window.ioc?.get?.('@diamondcoreprocessor.com/HistoryService') as HistoryLike | undefined
    if (!history?.sign || !history.currentLayerAt || !history.getLayerBySig) return []
    const self = segments[segments.length - 1] ?? ''
    const parent = segments.slice(0, -1)
    const parentSig = await history.sign({ explorerSegments: () => parent })
    const layer = await history.currentLayerAt(parentSig)
    const children = Array.isArray(layer?.['children']) ? (layer['children'] as unknown[]) : []
    const names: string[] = []
    for (const sig of children) {
      const child = await history.getLayerBySig(String(sig ?? ''))
      const name = typeof child?.['name'] === 'string' ? (child['name'] as string) : ''
      if (name && name !== self) names.push(name)
    }
    return names
  }

  /** This cell's title for `locale` (default: the active locale), or '' when it
   *  carries none — the caller then shows the raw name. */
  async titleOf(segments: readonly string[], locale?: string): Promise<string> {
    const target = locale ?? activeLocale()
    const records = await listDecorations<{ text?: Record<string, string> }>({
      kind: TITLE_DECORATION_KIND,
      segments,
    })
    for (const entry of records) {
      const byLocale = entry.record.payload?.text
      const value = byLocale && typeof byLocale === 'object' ? byLocale[target] : undefined
      if (typeof value === 'string' && value.trim()) return value.trim()
    }
    return ''
  }

  /** Set this cell's title FOR ONE LOCALE (empty `text` clears that locale).
   *
   *  The tile's NAME is untouched — it is the address, and moving it would
   *  strand the lineage bag and everything keyed by the path. This writes an
   *  interpretation of that address in one language.
   *
   *  Merges with the locales already present, so retitling in English never
   *  drops the Japanese reading; the record disappears once no locale is left.
   *  Replace, not append: a cell carries at most ONE title record. The old
   *  records are content-addressed and may be shared with identically-titled
   *  cells elsewhere, so they stay in the resource store.
   *
   *  Both `/title` and the tile editor funnel through here — the editor lives
   *  in shared and reaches it via IoC, never by import. */
  async setTitle(
    segments: readonly string[],
    text: string,
    locale?: string,
  ): Promise<'set' | 'cleared' | 'noop' | 'duplicate'> {
    const target = locale ?? activeLocale()
    const next = text.trim()

    // Guard here, in the funnel, rather than in each caller — a duplicate must
    // be refused whether it arrives from `/title` or the editor heading.
    if (next && await this.duplicateTitle(segments, next, target)) return 'duplicate'

    const existing = await listDecorations<{ text?: Record<string, string> }>({
      kind: TITLE_DECORATION_KIND,
      segments,
    })

    const merged: Record<string, string> = {}
    for (const entry of existing) {
      const byLocale = entry.record.payload?.text
      if (byLocale && typeof byLocale === 'object') {
        for (const [loc, value] of Object.entries(byLocale)) {
          if (typeof value === 'string' && value.trim()) merged[loc] = value.trim()
        }
      }
    }

    const had = merged[target] ?? ''
    if (had === next) return 'noop'          // nothing changed — no commit, no repaint
    if (next) merged[target] = next
    else delete merged[target]

    for (const entry of existing) removeDecoration({ sig: entry.sig, segments })

    if (Object.keys(merged).length === 0) return 'cleared'

    // appliesTo:[] so identically-titled cells dedup to ONE record — the
    // location comes from the slot the sig lands in, not from the record.
    await writeDecoration({
      kind: TITLE_DECORATION_KIND,
      appliesTo: [],
      payload: { text: merged },
      segments,
    })
    return next ? 'set' : 'cleared'
  }

  /** Apply a tag to the cell at `segments`. Idempotent: same name → same
   *  record sig → append-or-noop on the slot. */
  addTag(segments: readonly string[], name: string): Promise<string> {
    return writeDecoration({
      kind: TAG_DECORATION_KIND,
      appliesTo: [],
      payload: { name },
      segments,
    })
  }

  /** Remove a tag from the cell at `segments` by name. Resolves the slot sig
   *  from the in-memory index first; falls back to reading the slot when the
   *  index is cold (e.g. first action after a fresh load). No-op if absent. */
  async removeTag(segments: readonly string[], name: string): Promise<void> {
    const label = segments[segments.length - 1]
    // Resolve by PATH, not by name: the index keys cells by location, and this
    // call can arrive for a cell that isn't the one on screen (the pheromone
    // card carries its own segments). A name-only lookup would answer with a
    // same-named cell elsewhere and splice the tag off the wrong tile.
    let sig = label ? tagSigFor(label, name, segments) : undefined
    if (!sig) {
      const records = await listDecorations<{ name?: string }>({
        kind: TAG_DECORATION_KIND,
        segments,
      })
      sig = records.find(r => r.record.payload?.name === name)?.sig
    }
    if (sig) removeDecoration({ sig, segments })
  }
}

// ── registration ────────────────────────────────────────
//
// The `decorations` SLOT is registered from here, not only from
// decoration-manifest.ts: this module is in the side-effects barrel and that
// one is not, so its own module-scope call was never reached. Without the
// slot, LayerCommitter has no `decorations:changed` subscription and every
// decoration write in the app silently vanishes. See the long note in
// decoration-manifest.ts. Idempotent.
registerDecorationsSlot()

const _decorationService = new DecorationService()
window.ioc.register('@diamondcoreprocessor.com/DecorationService', _decorationService)
