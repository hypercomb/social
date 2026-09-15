// assistant/llm-context.measure.spec.ts
//
// THE NUMBERS. Three realistic fixtures, each compared two ways:
//
//   RAW    — what a model must pull today: one `/read` node result (content
//            = the tile's raw slot sig arrays) PLUS one `read <sig>` result
//            per resource it references (properties, each top-level note),
//            each wrapped the way `formatHypercombObservationReceipt`
//            (hypercomb-shared/ui/chat-window/hypercomb-observation.ts)
//            wraps a node result: `{ grammar, root, name, sig, children,
//            content, truncated }`. That shape is REPRODUCED here as plain
//            data — this package must never import hypercomb-shared
//            (CLAUDE.md's dependency direction: modules never import
//            shared) — not simulated by re-implementing hive-tree-reader.ts
//            (READ ONLY per the brief; not touched, not duplicated).
//   PROJECTED — the SAME tile, one `/read`, `projection` in place of
//            `content` — using the REAL `projectLayer` from llm-context.ts,
//            so the number is the actual derivation's output, never a
//            hand-typed stand-in.
//
// Token estimate: `Math.ceil(chars / 3)` — the same ratio
// commands/translation.service.ts already uses. No tokenizer dependency.
//
// "rounds": one hive request/response is one round. Every round beyond the
// first RESENDS THE WHOLE TRANSCRIPT AS INPUT TOKENS (documentation/
// anatomy-context-need.md §0, §7) — the raw column's `reads` is therefore
// not just "more bytes once," it is more bytes on every following turn too.

import { describe, expect, it } from 'vitest'
import { projectLayer } from './llm-context.js'

const sig = (n: number): string => n.toString(16).padStart(64, '0')
const tokensOf = (chars: number): number => Math.ceil(chars / 3)
const encode = (value: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(value))

type Child = { readonly name: string; readonly sig: string }

/** Reproduces `formatHypercombObservationReceipt`'s node-result shape
 *  exactly (field names and order) — see the header. */
const nodeReceipt = (
  grammar: string, root: string, name: string, layerSig: string,
  children: readonly Child[], content: Record<string, unknown>,
): string => JSON.stringify({ grammar, root, name, sig: layerSig, children, content, truncated: false })

const projectedReceipt = (
  grammar: string, root: string, name: string, layerSig: string,
  children: readonly Child[], projection: string,
): string => JSON.stringify({ grammar, root, name, sig: layerSig, children, projection, truncated: false })

type Row = { readonly reads: number; readonly chars: number; readonly tokens: number; readonly rounds: number }

const rowFor = (receipts: readonly string[]): Row => {
  const chars = receipts.reduce((sum, r) => sum + r.length, 0)
  return { reads: receipts.length, chars, tokens: tokensOf(chars), rounds: receipts.length }
}

const printTable = (title: string, raw: Row, projected: Row): void => {
  console.log(`\n${title}`)
  console.log('  kind        reads   chars   ~tokens  rounds')
  console.log(`  raw         ${String(raw.reads).padStart(5)}   ${String(raw.chars).padStart(5)}   ${String(raw.tokens).padStart(6)}   ${String(raw.rounds).padStart(5)}`)
  console.log(`  projected   ${String(projected.reads).padStart(5)}   ${String(projected.chars).padStart(5)}   ${String(projected.tokens).padStart(6)}   ${String(projected.rounds).padStart(5)}`)
  console.log('  every round beyond the first resends the whole transcript as input tokens.')
}

// ── Fixture 1: properties + 5 notes (two with a sub-note) + 2 decorations ──

describe('Fixture 1 — properties bag + 5 notes (2 with sub-notes) + 2 decorations', () => {
  it('the single projected /read costs fewer chars and far fewer rounds than the raw walk', async () => {
    const TILE = sig(101)
    const PROPS = sig(102)
    const NOTES = [sig(103), sig(104), sig(105), sig(106), sig(107)]
    const SUB_A = sig(108)
    const SUB_B = sig(109)
    const DECOR = [sig(110), sig(111)]
    const CHILDREN: Child[] = [
      { name: 'Cohibas', sig: sig(112) },
      { name: 'Padrons', sig: sig(113) },
      { name: 'Montecristos', sig: sig(114) },
    ]

    const propsBag = {
      index: 7, imageSig: sig(199), link: 'https://cigars.example/humidor',
      tags: ['favorite', 'travel'], hideText: true, substrate: true,
    }
    const noteBodies: Record<string, { note: string; children: string[] }> = {
      [NOTES[0]]: { note: 'Rotate the Cohibas to the back of the tray', children: [] },
      [NOTES[1]]: { note: 'Check the hygrometer weekly', children: [SUB_A] },
      [NOTES[2]]: { note: 'Reorder cedar spills before the trip', children: [] },
      [NOTES[3]]: { note: 'Ask about the Padron allocation', children: [SUB_B] },
      [NOTES[4]]: { note: 'Photograph new arrivals for the log', children: [] },
      [SUB_A]: { note: 'Replace the battery if it reads below 60%', children: [] },
      [SUB_B]: { note: 'Call before Friday — allocation closes', children: [] },
    }

    const layer = {
      name: 'Travel Humidor',
      properties: [PROPS],
      notes: NOTES,
      decorations: DECOR,
      children: CHILDREN.map(c => c.sig),
    }
    const resourceBytes = new Map<string, Uint8Array>()
    resourceBytes.set(PROPS, encode(propsBag))
    for (const [k, v] of Object.entries(noteBodies)) resourceBytes.set(k, encode(v))
    const readResource = async (s: string): Promise<Uint8Array | null> => resourceBytes.get(s) ?? null

    const GRAMMAR = '/read /humidor/travel'
    const raw = [
      nodeReceipt(GRAMMAR, '/humidor/travel', 'Travel Humidor', TILE, CHILDREN,
        { properties: [PROPS], notes: NOTES, decorations: DECOR }),
      nodeReceipt(`read ${PROPS}`, PROPS, PROPS.slice(0, 8), PROPS, [], propsBag),
      ...NOTES.map(n => {
        const body = noteBodies[n]
        const children = body.children.map(c => ({ name: '', sig: c }))
        return nodeReceipt(`read ${n}`, n, n.slice(0, 8), n, children, { note: body.note })
      }),
    ]

    const projection = await projectLayer(layer, readResource)
    expect(projection).not.toBeNull()
    const projected = [projectedReceipt(GRAMMAR, '/humidor/travel', 'Travel Humidor', TILE, CHILDREN, projection!)]

    const rawRow = rowFor(raw)
    const projectedRow = rowFor(projected)
    printTable('Fixture 1 — properties + 5 notes (2 with sub-notes) + 2 decorations', rawRow, projectedRow)

    expect(rawRow.reads).toBe(7) // 1 initial + properties + 5 notes
    expect(projectedRow.reads).toBe(1)
    expect(projectedRow.chars).toBeLessThan(rawRow.chars)
    expect(projectedRow.tokens).toBeLessThan(rawRow.tokens)
  })
})

// ── Fixture 2: a bare tile — name only ─────────────────────────────────────

describe('Fixture 2 — a bare tile (name only)', () => {
  it('costs the projected /read almost nothing extra over the raw one — no worse by more than a handful of chars', async () => {
    const TILE = sig(201)
    const layer = { name: 'Empty Shelf' }
    const readResource = async (): Promise<Uint8Array | null> => null

    const GRAMMAR = '/read /shelf/empty'
    const raw = [nodeReceipt(GRAMMAR, '/shelf/empty', 'Empty Shelf', TILE, [], {})]

    const projection = await projectLayer(layer, readResource)
    expect(projection).toBe('Empty Shelf')
    const projected = [projectedReceipt(GRAMMAR, '/shelf/empty', 'Empty Shelf', TILE, [], projection!)]

    const rawRow = rowFor(raw)
    const projectedRow = rowFor(projected)
    printTable('Fixture 2 — a bare tile (name only)', rawRow, projectedRow)

    expect(rawRow.reads).toBe(1)
    expect(projectedRow.reads).toBe(1)
    // Same round count either way (nothing to fetch); the projected form
    // trades an empty `content:{}` for `projection:"Empty Shelf"` — a
    // handful of characters, never a regression worth avoiding the cache for.
    expect(Math.abs(projectedRow.chars - rawRow.chars)).toBeLessThanOrEqual(40)
  })
})

// ── Fixture 3: a note-heavy tile, just under the cap ───────────────────────

describe('Fixture 3 — a note-heavy tile, just under the projection cap', () => {
  it('still costs one round instead of eleven, and fewer chars than the raw walk', async () => {
    const { MAX_PROJECTION_CHARS } = await import('./llm-context.js')
    const TILE = sig(301)
    const NOTE_COUNT = 10
    const NOTES = Array.from({ length: NOTE_COUNT }, (_, i) => sig(310 + i))
    const CHILDREN: Child[] = [{ name: 'Older logs', sig: sig(399) }]

    // A per-note budget computed FROM the real cap, so this fixture tracks
    // the derivation's own constant rather than a number that could drift
    // out of "just under" if the cap ever changes.
    const overhead = 200 // name line + 'notes:' header + two-space indents
    const perNote = Math.floor((MAX_PROJECTION_CHARS - overhead) / NOTE_COUNT)
    const noteBodies: Record<string, { note: string; children: string[] }> = {}
    for (let i = 0; i < NOTE_COUNT; i++) {
      const text = `Tasting note ${i + 1}: ${'aroma cedar leather cocoa spice '.repeat(30)}`.slice(0, perNote)
      noteBodies[NOTES[i]] = { note: text, children: [] }
    }

    const layer = { name: 'Cellar Journal', notes: NOTES, children: CHILDREN.map(c => c.sig) }
    const resourceBytes = new Map<string, Uint8Array>()
    for (const [k, v] of Object.entries(noteBodies)) resourceBytes.set(k, encode(v))
    const readResource = async (s: string): Promise<Uint8Array | null> => resourceBytes.get(s) ?? null

    const projection = await projectLayer(layer, readResource)
    expect(projection).not.toBeNull()
    expect(projection!.length).toBeLessThan(MAX_PROJECTION_CHARS)
    expect(projection!.length).toBeGreaterThan(MAX_PROJECTION_CHARS * 0.6) // genuinely note-HEAVY, not token

    const GRAMMAR = '/read /cellar/journal'
    const raw = [
      nodeReceipt(GRAMMAR, '/cellar/journal', 'Cellar Journal', TILE, CHILDREN, { notes: NOTES }),
      ...NOTES.map(n => nodeReceipt(`read ${n}`, n, n.slice(0, 8), n, [], { note: noteBodies[n].note })),
    ]
    const projected = [projectedReceipt(GRAMMAR, '/cellar/journal', 'Cellar Journal', TILE, CHILDREN, projection!)]

    const rawRow = rowFor(raw)
    const projectedRow = rowFor(projected)
    printTable('Fixture 3 — a note-heavy tile, just under the projection cap', rawRow, projectedRow)

    expect(rawRow.reads).toBe(NOTE_COUNT + 1)
    expect(projectedRow.reads).toBe(1)
    expect(projectedRow.chars).toBeLessThan(rawRow.chars)
    expect(projectedRow.tokens).toBeLessThan(rawRow.tokens)
  })
})
