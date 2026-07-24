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
  type DecorationRecord,
} from './decoration-manifest.js'
import { TAG_DECORATION_KIND, tagSigFor, TITLE_DECORATION_KIND } from './decoration-kind-index.js'
import { I18N_IOC_KEY, type I18nProvider } from '@hypercomb/core'

/** The locale a title is written in when the caller doesn't name one. */
const activeLocale = (): string =>
  (window.ioc?.get?.(I18N_IOC_KEY) as I18nProvider | undefined)?.locale ?? 'en'

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
  ): Promise<'set' | 'cleared' | 'noop'> {
    const target = locale ?? activeLocale()
    const next = text.trim()
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
const _decorationService = new DecorationService()
window.ioc.register('@diamondcoreprocessor.com/DecorationService', _decorationService)
