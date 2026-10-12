// show-cell.meeting-scale.spec.ts — a page of a thousand peer tiles, and the
// participant's own new tile on its way to the room (SCALE-1, the speed half).
//
// With the label atlas fixed (show-cell.label-view.spec.ts), an own create at
// 987 peer tiles still took 0.87-1.57 s from Enter to the wire (target 0.5 s).
// Profiled, two per-pass costs that grow with the page were ahead of it:
//
//  1. The decoration index walked every label of every pass, and a peer's
//     cell — which has no layer here — was forgotten and walked again each
//     time: ~1,000 absent-layer reads per pass. show-cell now names those
//     cells (`peerOnlyLabels`) and the index skips them
//     (decoration-kind-index.peer-only.spec.ts).
//  2. The pinned layout seated its pile of slotless tiles in one sweep, so one
//     displaced tile pushed every later tile out of its remembered seat and
//     each paid a whole-grid score — ~0.5 s per pass whenever a peer's page
//     grew. The pile is now seated by unindexed-seating.ts
//     (unindexed-seating.spec.ts), remembered seats first.
//
// Source-shape ratchets, like the label-view spec: ShowCellDrone cannot be
// stood up in a unit test (Pixi renderer, IoC, OPFS). The latency is proven by
// the lane's speed drill (987 peer tiles) — see the lane report.

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const SRC = readFileSync(join(__dirname, 'show-cell.drone.ts'), 'utf8')

const stripComments = (src: string): string =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1')

const memberBody = (marker: string): string => {
  const lines = SRC.split('\n')
  const start = lines.findIndex(l => l.includes(marker))
  expect(start, `member not found: ${marker}`).toBeGreaterThan(-1)
  let open = start
  while (open < lines.length && !lines[open].trimEnd().endsWith('{')) open++
  expect(open, `member body never opens: ${marker}`).toBeLessThan(lines.length)
  const out: string[] = []
  for (let i = open + 1; i < lines.length; i++) {
    if (/^ {2}\S/.test(lines[i])) break
    out.push(lines[i])
  }
  return stripComments(out.join('\n'))
}

describe('show-cell at meeting scale (SCALE-1)', () => {
  it('render:cell-count names the cells that are a peer\'s alone', () => {
    const from = SRC.indexOf('#buildCellCountPayload(cells: readonly Cell[]): {')
    const to = SRC.indexOf('#readLayoutMode(_locationKey')
    expect(from).toBeGreaterThan(-1)
    expect(to).toBeGreaterThan(from)
    const body = stripComments(SRC.slice(from, to))
    // A spotlit stack variant is YOUR tile showing their version: it has a
    // layer here, so only the rest of the external cells are peer-only.
    expect(body).toMatch(/peerOnlyLabels: cells\s*\.filter\(c => c\.external && !this\.#stackVariantLabels\.has\(c\.label\)\)\s*\.map\(c => c\.label\)/)
  })

  it('the pinned layout seats its slotless pile remembered-seats-first', () => {
    const body = memberBody('async #orderByIndexPinned(dir: FileSystemDirectoryHandle, names: string[]')
    expect(body).toMatch(/const placedUnindexed = seatUnindexed\(sparse, unindexed, maxSlot, this\.#sessionSlotByLabel,\s*navPass \? lowestFree : \(s\) => this\.#bestFreeSlotByScore\(s, maxSlot\)\)/)
    // The old sweep scored inside its own loop over the pile.
    expect(body).not.toMatch(/for \(const name of unindexed\)/)
    expect(stripComments(SRC)).toMatch(/import \{ seatUnindexed \} from '\.\/unindexed-seating\.js'/)
  })
})
