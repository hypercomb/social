// commands/decoration.service.ts
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
  type DecorationRecord,
} from './decoration-manifest.js'
import {
  TAG_DECORATION_KIND, tagSigFor, TITLE_DECORATION_KIND, titleForSegments, activeTitleLocale,
} from './decoration-kind-index.js'
import { canonicalizeLineageSegment } from '../history/lineage-key.js'

/** The locale a title is written in when the caller doesn't name one. */
const activeLocale = activeTitleLocale

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

  /** How a cell READS right now, synchronously: its title for this locale
   *  (default: the active locale) from the index, otherwise its own name. This
   *  is the string a list row or heading should draw — the name is the
   *  ADDRESS, so a list that draws it alone never shows a rename. '' title
   *  here can also mean "the index has not walked this cell yet"; the caller
   *  then shows the address, which is honest. */
  readingAt(segments: readonly string[], locale?: string): string {
    return titleForSegments(segments, locale ?? activeLocale()) || (segments[segments.length - 1] ?? '')
  }

  /** How a sibling READS right now: its title for this locale if it has one,
   *  otherwise its own name. This is the string the participant actually sees,
   *  which is what a duplicate check has to compare against.
   *
   *  Index first — a title the index holds is answered without touching OPFS.
   *  Only a sibling the index shows no title for falls back to reading its
   *  slot, because an empty answer can also mean the index has not walked it. */
  async #readingOf(segments: readonly string[], locale: string): Promise<string> {
    const indexed = titleForSegments(segments, locale)
    if (indexed) return indexed
    return (await this.titleOf(segments, locale)) || (segments[segments.length - 1] ?? '')
  }

  /** The reading AND the address of a sibling that already looks like `text`, or null.
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
  ): Promise<{ reading: string; address: string } | null> {
    const target = locale ?? activeLocale()
    const wanted = text.trim().toLowerCase()
    if (!wanted) return null                       // clearing can never duplicate
    const parent = segments.slice(0, -1)
    // Every sibling is read at once: a cold scan of a large page was a
    // sequential OPFS read per sibling, which left the heading looking
    // committed for seconds while nothing had been written.
    const names = await this.#siblingNames(segments)
    const readings = await Promise.all(names.map(name => this.#readingOf([...parent, name], target)))
    const at = readings.findIndex(reading => reading.trim().toLowerCase() === wanted)
    return at < 0 ? null : { reading: readings[at], address: names[at] }
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
    const layers = await Promise.all(children.map(sig => history.getLayerBySig(String(sig ?? ''))))
    const names: string[] = []
    for (const child of layers) {
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
    // Newest record first — the index keeps the LAST title record it sees, so
    // the heading and the hive must read the same one when a slot ever holds
    // more than one.
    for (const entry of [...records].reverse()) {
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
  setTitle(
    segments: readonly string[],
    text: string,
    locale?: string,
  ): Promise<'set' | 'cleared' | 'noop' | 'duplicate'> {
    // One title write at a time per PAGE. Two overlapping writes on a tile each
    // read the old record and each appended a new one, leaving two records —
    // the heading then read the first and the hive the last. Serialising per
    // parent also closes the sibling race: two tiles titled at once to the same
    // words would each pass the duplicate check before either had written.
    const lane = segments.slice(0, -1).join('/')
    const run = (this.#titleLanes.get(lane) ?? Promise.resolve())
      .catch(() => undefined)
      .then(() => this.#setTitleNow(segments, text, locale))
    const tail = run.catch(() => undefined)
    this.#titleLanes.set(lane, tail)
    void tail.then(() => { if (this.#titleLanes.get(lane) === tail) this.#titleLanes.delete(lane) })
    return run
  }

  /** The tail of the title write in flight for each page, by parent path. */
  #titleLanes = new Map<string, Promise<unknown>>()

  async #setTitleNow(
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
