// diamondcoreprocessor.com/history/delta-reducer.ts
//
// Fold a chain of DeltaRecords into a hydrated in-memory state. The
// identity element is empty — no cells, no hidden, nothing. Each
// record applies mechanically based on its op key. The output is
// what the renderer / anything else would consume in place of the
// legacy full-snapshot LayerContent.
//
// This is pure: same record list → same state, every time. No side
// effects, no I/O. Callers do I/O (resolving sigs) and pass the
// resolved records in.
//
// Ops currently handled (cell lifecycle only — Phase 2 scope):
//   `{name}`          bare → cells.add(name)
//   `{name, remove}`  remove → cells.delete(name), hidden.delete(name)
//   `{name, hide}`    hide → hidden.add(name)
//   `{name, show}`    unhide → hidden.delete(name)
//
// Richer ops (content, tags, layout, reorder) come in Phase 2b when
// their resource-sig wiring lands; this reducer already allocates a
// slot for them so extension is additive.
//
// Edge cases:
//   - An empty record list → identity state (empty sets). This is
//     the "synthetic seed" behaviour: rendering at cursor 0 or
//     before any real entry produces an empty grid.
//   - An `unknown op` is silently ignored. Forward-compat: older
//     code reducing newer records doesn't crash, it just skips.
//   - `remove` on a name not currently in cells is a no-op, not an
//     error. The record log is the truth; the reducer is
//     defensively idempotent.

import type { DeltaRecord } from './delta-record.js'

export interface HydratedState {
  readonly cells: ReadonlySet<string>
  readonly hidden: ReadonlySet<string>
}

/**
 * Fold an ordered list of records into a HydratedState. Order
 * matters — earlier records apply first. The caller decides slice
 * (full history vs. up-to-cursor-position).
 */
export function reduce(records: readonly (DeltaRecord | null)[]): HydratedState {
  const cells = new Set<string>()
  const hidden = new Set<string>()
  for (const record of records) {
    if (!record) continue
    const opKeys = Object.keys(record).filter(k => k !== 'name')
    if (opKeys.length === 0) {
      // Bare creation — `{name: "foo"}` alone means "foo exists".
      cells.add(record.name)
      continue
    }
    for (const op of opKeys) {
      switch (op) {
        case 'remove':
          cells.delete(record.name)
          hidden.delete(record.name)
          break
        case 'hide':
          hidden.add(record.name)
          break
        case 'show':
          hidden.delete(record.name)
          break
        // Unknown ops: ignored. Phase 2b extends this switch for
        // content / tags / layout / reorder once their record shapes
        // land.
      }
    }
  }
  return { cells, hidden }
}
