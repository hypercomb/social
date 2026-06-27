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
import { TAG_DECORATION_KIND, tagSigFor } from './decoration-kind-index.js'

export class DecorationService {

  /** Write a decoration JSON to `__resources__` and append its sig to the
   *  cell's `decorations` slot. Returns the decoration sig. */
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
    let sig = label ? tagSigFor(label, name) : undefined
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
