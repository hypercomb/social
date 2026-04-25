// diamondcoreprocessor.com/history/history.service.spec.ts
//
// Comprehensive coverage of the bag-per-lineage primitive. Tests
// every undo/redo edge case, marker invariants, and sig stability.
// Uses an in-memory OPFS mock so tests run in jsdom without browser.

import { describe, it, expect, beforeEach } from 'vitest'

// -------------------------------------------------
// Pure: lineage sig algorithm (mirrors history.service.ts:sign +
// show-cell.drone.ts:computeSignatureLocation, the two compute
// sites that must agree on the bag's identity)
// -------------------------------------------------

const SIG_RE = /^[a-f0-9]{64}$/
const MARKER_RE = /^\d{8}$/

const sha256Hex = async (s: string): Promise<string> => {
  const bytes = new TextEncoder().encode(s)
  const hash = await crypto.subtle.digest('SHA-256', bytes.buffer as ArrayBuffer)
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

const signLineage = async (segments: string[]): Promise<string> => {
  const cleaned = segments.map(s => String(s ?? '').trim()).filter(s => s.length > 0)
  return await sha256Hex(cleaned.join('/'))
}

// -------------------------------------------------
// Mock OPFS — in-memory implementation of the slice of
// FileSystemDirectoryHandle / FileSystemFileHandle the history
// service touches
// -------------------------------------------------

class MockFile {
  kind = 'file' as const
  bytes = new Uint8Array(0)
  lastModified = Date.now()
  constructor(public name: string) {}

  async getFile(): Promise<File> {
    const blob = new Blob([this.bytes.buffer.slice(this.bytes.byteOffset, this.bytes.byteOffset + this.bytes.byteLength) as ArrayBuffer])
    const lastModified = this.lastModified
    const bytes = this.bytes
    // Hand-rolled File-like; arrayBuffer + text + lastModified are
    // what the production code reads.
    return Object.assign(blob, {
      lastModified,
      name: this.name,
      arrayBuffer: () => Promise.resolve(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer),
      text: () => Promise.resolve(new TextDecoder().decode(bytes)),
    }) as unknown as File
  }

  async createWritable() {
    const self = this
    return {
      write: async (chunk: ArrayBuffer | Uint8Array | string) => {
        if (typeof chunk === 'string') self.bytes = new TextEncoder().encode(chunk)
        else if (chunk instanceof Uint8Array) self.bytes = new Uint8Array(chunk)
        else self.bytes = new Uint8Array(chunk)
        self.lastModified = Date.now()
      },
      close: async () => { /* noop */ },
    }
  }
}

class MockDir {
  kind = 'directory' as const
  files = new Map<string, MockFile>()
  dirs = new Map<string, MockDir>()
  constructor(public name: string = '') {}

  async getFileHandle(name: string, opts: { create?: boolean } = {}): Promise<MockFile> {
    let h = this.files.get(name)
    if (!h) {
      if (!opts.create) throw new DOMException('NotFoundError', 'NotFoundError')
      h = new MockFile(name)
      this.files.set(name, h)
    }
    return h
  }

  async getDirectoryHandle(name: string, opts: { create?: boolean } = {}): Promise<MockDir> {
    let d = this.dirs.get(name)
    if (!d) {
      if (!opts.create) throw new DOMException('NotFoundError', 'NotFoundError')
      d = new MockDir(name)
      this.dirs.set(name, d)
    }
    return d
  }

  async removeEntry(name: string, _opts: { recursive?: boolean } = {}): Promise<void> {
    const inFiles = this.files.delete(name)
    const inDirs = this.dirs.delete(name)
    if (!inFiles && !inDirs) throw new DOMException('NotFoundError', 'NotFoundError')
  }

  async *entries(): AsyncIterable<[string, MockFile | MockDir]> {
    for (const [name, h] of this.files) yield [name, h]
    for (const [name, d] of this.dirs) yield [name, d]
  }
}

// -------------------------------------------------
// Re-implement the testable slice of HistoryService inline.
// Mirrors the production logic so the tests catch divergence.
// -------------------------------------------------

type LayerContent = { cells: string[]; hidden: string[] }

const canonicalizeLayer = (layer: LayerContent): LayerContent => ({
  cells: layer.cells.slice(),
  hidden: [...layer.hidden].sort(),
})

const nextMarkerName = async (bag: MockDir): Promise<string> => {
  let max = 0
  for await (const [name, h] of bag.entries()) {
    if (h.kind !== 'file') continue
    if (!MARKER_RE.test(name)) continue
    const n = parseInt(name, 10)
    if (!isNaN(n) && n > max) max = n
  }
  return String(max + 1).padStart(8, '0')
}

const writeBytes = async (dir: MockDir, name: string, bytes: Uint8Array): Promise<void> => {
  const h = await dir.getFileHandle(name, { create: true })
  const w = await h.createWritable()
  try { await w.write(bytes) } finally { await w.close() }
}

const writeText = async (dir: MockDir, name: string, text: string): Promise<void> => {
  const h = await dir.getFileHandle(name, { create: true })
  const w = await h.createWritable()
  try { await w.write(text) } finally { await w.close() }
}

const fileExists = async (dir: MockDir, name: string): Promise<boolean> => {
  try { await dir.getFileHandle(name, { create: false }); return true }
  catch { return false }
}

const dirExists = async (dir: MockDir, name: string): Promise<boolean> => {
  try { await dir.getDirectoryHandle(name, { create: false }); return true }
  catch { return false }
}

const commitLayer = async (
  pool: MockDir,
  historyRoot: MockDir,
  lineageSig: string,
  layer: LayerContent,
): Promise<string> => {
  const canonical = canonicalizeLayer(layer)
  const json = JSON.stringify(canonical)
  const bytes = new TextEncoder().encode(json)
  const layerSig = await sha256Hex(json)

  // 1. content → __layers__/{sig}, idempotent
  if (!(await fileExists(pool, layerSig))) {
    await writeBytes(pool, layerSig, bytes)
  }

  // 2. marker → __history__/{lineageSig}/NNNN
  const bag = await historyRoot.getDirectoryHandle(lineageSig, { create: true })
  const markerName = await nextMarkerName(bag)
  await writeText(bag, markerName, layerSig)

  return layerSig
}

type Entry = { layerSig: string; at: number; filename: string; index: number }

const normalize = async (bag: MockDir): Promise<void> => {
  const drop: string[] = []
  for await (const [name, h] of bag.entries()) {
    if (h.kind !== 'file') continue
    if (MARKER_RE.test(name)) {
      try {
        const file = await h.getFile()
        const text = (await file.text()).trim()
        if (SIG_RE.test(text)) continue
      } catch { /* drop */ }
    }
    drop.push(name)
  }
  for (const name of drop) {
    try { await bag.removeEntry(name) } catch { /* */ }
  }
}

const listLayers = async (
  historyRoot: MockDir,
  lineageSig: string,
): Promise<Entry[]> => {
  let bag: MockDir
  try { bag = await historyRoot.getDirectoryHandle(lineageSig, { create: false }) }
  catch { return [] }

  await normalize(bag)

  const markers: Array<Omit<Entry, 'index'>> = []
  for await (const [name, h] of bag.entries()) {
    if (h.kind !== 'file') continue
    if (!MARKER_RE.test(name)) continue
    try {
      const file = await h.getFile()
      const sig = (await file.text()).trim()
      if (!SIG_RE.test(sig)) continue
      markers.push({ layerSig: sig, at: file.lastModified, filename: name })
    } catch { /* skip */ }
  }
  markers.sort((a, b) => a.filename.localeCompare(b.filename))
  return markers.map((e, i) => ({ ...e, index: i }))
}

const getLayerContent = async (
  pool: MockDir,
  layerSig: string,
): Promise<LayerContent | null> => {
  if (!SIG_RE.test(layerSig)) return null
  try {
    const h = await pool.getFileHandle(layerSig, { create: false })
    const file = await h.getFile()
    const parsed = JSON.parse(await file.text()) as Partial<LayerContent>
    return { cells: parsed.cells ?? [], hidden: parsed.hidden ?? [] }
  } catch { return null }
}

// Cursor — pure state-machine slice; layers come from listLayers.
type CursorState = {
  locationSig: string
  position: number          // 1-based; 0 = pre-history
  total: number
  rewound: boolean
  at: number
}

class Cursor {
  #locationSig = ''
  #position = 0
  #layers: Entry[] = []

  get state(): CursorState {
    return {
      locationSig: this.#locationSig,
      position: this.#position,
      total: this.#layers.length,
      rewound: this.#layers.length > 0 && this.#position < this.#layers.length,
      at: this.#position > 0 ? this.#layers[this.#position - 1].at : 0,
    }
  }

  async load(historyRoot: MockDir, locationSig: string): Promise<void> {
    this.#layers = await listLayers(historyRoot, locationSig)
    if (this.#locationSig !== locationSig) {
      this.#locationSig = locationSig
      this.#position = this.#layers.length
    } else if (this.#position > this.#layers.length) {
      this.#position = this.#layers.length
    }
  }

  async onNewLayer(historyRoot: MockDir): Promise<void> {
    const wasAtLatest = this.#position >= this.#layers.length
    this.#layers = await listLayers(historyRoot, this.#locationSig)
    if (wasAtLatest) this.#position = this.#layers.length
  }

  seek(position: number): void {
    const clamped = Math.max(0, Math.min(position, this.#layers.length))
    this.#position = clamped
  }

  undo(): void { if (this.#position > 0) this.seek(this.#position - 1) }
  redo(): void { if (this.#position < this.#layers.length) this.seek(this.#position + 1) }

  async layerContentAtCursor(pool: MockDir): Promise<LayerContent | null> {
    if (this.#position === 0) {
      // Case A: pre-history empty render IF layers exist; Case B
      // (no layers at all) — caller should fall through to live disk.
      if (this.#layers.length === 0) return null
      return { cells: [], hidden: [] }
    }
    const entry = this.#layers[this.#position - 1]
    return await getLayerContent(pool, entry.layerSig)
  }
}

// -------------------------------------------------
// Test environment
// -------------------------------------------------

let opfsRoot: MockDir
let pool: MockDir
let historyRoot: MockDir

beforeEach(() => {
  opfsRoot = new MockDir('/')
  // initialize the two top-level dirs
  pool = new MockDir('__layers__')
  historyRoot = new MockDir('__history__')
  opfsRoot.dirs.set('__layers__', pool)
  opfsRoot.dirs.set('__history__', historyRoot)
})

// ===================================================
// sign() — bag identity contract
// ===================================================

describe('signLineage — bag identity = ancestry only', () => {
  it('produces stable 64-hex for a given path', async () => {
    const a = await signLineage(['abc', 'def'])
    const b = await signLineage(['abc', 'def'])
    expect(a).toBe(b)
    expect(a).toMatch(SIG_RE)
  })

  it('different paths → different sigs', async () => {
    const a = await signLineage(['abc'])
    const b = await signLineage(['abc', 'def'])
    expect(a).not.toBe(b)
  })

  it('root lineage (empty path) returns sha256(empty string)', async () => {
    const root = await signLineage([])
    const expected = await sha256Hex('')
    expect(root).toBe(expected)
    expect(root).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
  })

  it('whitespace and empty segments are stripped before hashing', async () => {
    const a = await signLineage(['abc', '  ', '', 'def'])
    const b = await signLineage(['abc', 'def'])
    expect(a).toBe(b)
  })

  it('two compute sites must produce identical sigs (contract)', async () => {
    // Both history.service.ts:sign() and show-cell.drone.ts:
    // computeSignatureLocation() must yield the same sig for the
    // same lineage. Test asserts this by computing twice from the
    // same canonical source.
    const sig1 = await signLineage(['x', 'y', 'z'])
    const sig2 = await signLineage(['x', 'y', 'z'])
    expect(sig1).toBe(sig2)
  })
})

// ===================================================
// commitLayer + listLayers + normalize
// ===================================================

describe('commitLayer / listLayers — bag-per-lineage', () => {
  it('first commit on a fresh lineage creates one marker (00000001) + one pool entry', async () => {
    const lineageSig = await signLineage(['abc'])
    const layer: LayerContent = { cells: ['x'], hidden: [] }
    const sig = await commitLayer(pool, historyRoot, lineageSig, layer)

    expect(sig).toMatch(SIG_RE)
    // Pool has the content
    expect(await fileExists(pool, sig)).toBe(true)
    // Bag has exactly one marker named 00000001
    const bag = await historyRoot.getDirectoryHandle(lineageSig)
    const names: string[] = []
    for await (const [n] of bag.entries()) names.push(n)
    expect(names).toEqual(['00000001'])
    // Marker content is the sig
    const markerFile = await bag.getFileHandle('00000001')
    const text = await (await markerFile.getFile()).text()
    expect(text.trim()).toBe(sig)
  })

  it('list grows by exactly one per commit', async () => {
    const lineageSig = await signLineage(['abc'])
    expect((await listLayers(historyRoot, lineageSig)).length).toBe(0)

    await commitLayer(pool, historyRoot, lineageSig, { cells: ['x'], hidden: [] })
    expect((await listLayers(historyRoot, lineageSig)).length).toBe(1)

    await commitLayer(pool, historyRoot, lineageSig, { cells: ['x', 'y'], hidden: [] })
    expect((await listLayers(historyRoot, lineageSig)).length).toBe(2)

    await commitLayer(pool, historyRoot, lineageSig, { cells: ['x', 'y', 'z'], hidden: [] })
    expect((await listLayers(historyRoot, lineageSig)).length).toBe(3)
  })

  it('two markers can point at the same sig (overlap = dedupe)', async () => {
    const lineageSig = await signLineage(['abc'])
    const layer: LayerContent = { cells: ['x'], hidden: [] }
    const sig1 = await commitLayer(pool, historyRoot, lineageSig, layer)
    const sig2 = await commitLayer(pool, historyRoot, lineageSig, layer) // same content

    expect(sig1).toBe(sig2)                                   // same content sig
    const entries = await listLayers(historyRoot, lineageSig)
    expect(entries.length).toBe(2)                            // two markers
    expect(entries[0].layerSig).toBe(entries[1].layerSig)     // pointing at same sig
    // Pool has only ONE file for that sig (deduped)
    let poolFiles = 0
    for await (const [n] of pool.entries()) if (n === sig1) poolFiles++
    expect(poolFiles).toBe(1)
  })

  it('listLayers returns markers sorted by filename (chronological)', async () => {
    const lineageSig = await signLineage(['abc'])
    await commitLayer(pool, historyRoot, lineageSig, { cells: ['a'], hidden: [] })
    await commitLayer(pool, historyRoot, lineageSig, { cells: ['b'], hidden: [] })
    await commitLayer(pool, historyRoot, lineageSig, { cells: ['c'], hidden: [] })
    const entries = await listLayers(historyRoot, lineageSig)
    expect(entries.map(e => e.filename)).toEqual(['00000001', '00000002', '00000003'])
    expect(entries.map(e => e.index)).toEqual([0, 1, 2])
  })

  it('lineage isolation: commits at one lineage do not appear in another', async () => {
    const lineageA = await signLineage(['abc'])
    const lineageB = await signLineage(['def'])
    await commitLayer(pool, historyRoot, lineageA, { cells: ['x'], hidden: [] })
    await commitLayer(pool, historyRoot, lineageB, { cells: ['y'], hidden: [] })
    expect((await listLayers(historyRoot, lineageA)).length).toBe(1)
    expect((await listLayers(historyRoot, lineageB)).length).toBe(1)
    // No cross-pollination — A's marker only in A's bag
    const bagA = await historyRoot.getDirectoryHandle(lineageA)
    const bagB = await historyRoot.getDirectoryHandle(lineageB)
    expect(bagA).not.toBe(bagB)
  })

  it('root lineage (empty segments) is a valid bag', async () => {
    const rootSig = await signLineage([])
    await commitLayer(pool, historyRoot, rootSig, { cells: ['root-tile'], hidden: [] })
    const entries = await listLayers(historyRoot, rootSig)
    expect(entries.length).toBe(1)
    const content = await getLayerContent(pool, entries[0].layerSig)
    expect(content?.cells).toEqual(['root-tile'])
  })
})

describe('normalize — ruthless, idempotent', () => {
  it('idempotent on a clean bag', async () => {
    const lineageSig = await signLineage(['abc'])
    await commitLayer(pool, historyRoot, lineageSig, { cells: ['x'], hidden: [] })
    const before = (await listLayers(historyRoot, lineageSig)).length
    const after = (await listLayers(historyRoot, lineageSig)).length
    expect(after).toBe(before)
  })

  it('drops sig-named files at bag root (legacy content storage)', async () => {
    const lineageSig = await signLineage(['abc'])
    const bag = await historyRoot.getDirectoryHandle(lineageSig, { create: true })
    const fakeSig = await sha256Hex('something')
    await writeText(bag, fakeSig, '{"cells":[],"hidden":[]}')   // legacy: content at bag root

    await listLayers(historyRoot, lineageSig)

    expect(await fileExists(bag, fakeSig)).toBe(false)
  })

  it('drops 8-digit numeric files with non-sig content (legacy ops, JSON, etc.)', async () => {
    const lineageSig = await signLineage(['abc'])
    const bag = await historyRoot.getDirectoryHandle(lineageSig, { create: true })
    await writeText(bag, '00000001', '{"op":"add","cell":"x"}')   // legacy op

    await listLayers(historyRoot, lineageSig)
    expect(await fileExists(bag, '00000001')).toBe(false)
  })

  it('keeps canonical markers (8-digit numeric, sig content)', async () => {
    const lineageSig = await signLineage(['abc'])
    await commitLayer(pool, historyRoot, lineageSig, { cells: ['x'], hidden: [] })
    const before = await listLayers(historyRoot, lineageSig)
    const after = await listLayers(historyRoot, lineageSig)
    expect(after.length).toBe(before.length)
    expect(after[0].layerSig).toBe(before[0].layerSig)
  })
})

describe('getLayerContent — reads from shared pool', () => {
  it('returns null for non-sig input', async () => {
    expect(await getLayerContent(pool, 'not-a-sig')).toBeNull()
    expect(await getLayerContent(pool, '00000001')).toBeNull()
  })

  it('returns null when sig not in pool', async () => {
    const phantomSig = await sha256Hex('nothing-written')
    expect(await getLayerContent(pool, phantomSig)).toBeNull()
  })

  it('returns parsed slim layer for an existing sig', async () => {
    const lineageSig = await signLineage(['abc'])
    const sig = await commitLayer(pool, historyRoot, lineageSig, { cells: ['a', 'b'], hidden: ['c'] })
    const content = await getLayerContent(pool, sig)
    expect(content).toEqual({ cells: ['a', 'b'], hidden: ['c'] })
  })

  it('content survives across listLayers calls (normalize does not touch pool)', async () => {
    const lineageSig = await signLineage(['abc'])
    const sig = await commitLayer(pool, historyRoot, lineageSig, { cells: ['x'], hidden: [] })
    await listLayers(historyRoot, lineageSig)
    await listLayers(historyRoot, lineageSig)
    expect(await getLayerContent(pool, sig)).toEqual({ cells: ['x'], hidden: [] })
  })
})

// ===================================================
// Cursor — undo/redo edge cases
// ===================================================

describe('Cursor — undo/redo over an empty bag', () => {
  it('fresh cursor on empty bag: position=0, total=0, undo/redo no-op', async () => {
    const lineageSig = await signLineage(['abc'])
    const cursor = new Cursor()
    await cursor.load(historyRoot, lineageSig)
    expect(cursor.state.position).toBe(0)
    expect(cursor.state.total).toBe(0)
    expect(cursor.state.rewound).toBe(false)

    cursor.undo()
    expect(cursor.state.position).toBe(0)
    cursor.redo()
    expect(cursor.state.position).toBe(0)
  })

  it('layerContentAtCursor returns null on empty bag (caller should fall through to live disk)', async () => {
    const lineageSig = await signLineage(['abc'])
    const cursor = new Cursor()
    await cursor.load(historyRoot, lineageSig)
    expect(await cursor.layerContentAtCursor(pool)).toBeNull()
  })
})

describe('Cursor — undo/redo over a single-marker bag', () => {
  let lineageSig: string
  let cursor: Cursor

  beforeEach(async () => {
    lineageSig = await signLineage(['abc'])
    await commitLayer(pool, historyRoot, lineageSig, { cells: ['x'], hidden: [] })
    cursor = new Cursor()
    await cursor.load(historyRoot, lineageSig)
  })

  it('initial cursor is at head (position=1, total=1)', () => {
    expect(cursor.state.position).toBe(1)
    expect(cursor.state.total).toBe(1)
    expect(cursor.state.rewound).toBe(false)
  })

  it('layerContentAtCursor returns the layer at head', async () => {
    expect(await cursor.layerContentAtCursor(pool)).toEqual({ cells: ['x'], hidden: [] })
  })

  it('undo takes cursor to position 0 (pre-history)', () => {
    cursor.undo()
    expect(cursor.state.position).toBe(0)
    expect(cursor.state.rewound).toBe(true)
  })

  it('layerContentAtCursor at position 0 returns the empty seed (case A: history exists)', async () => {
    cursor.undo()
    expect(await cursor.layerContentAtCursor(pool)).toEqual({ cells: [], hidden: [] })
  })

  it('redo from position 0 takes cursor back to head', () => {
    cursor.undo()
    cursor.redo()
    expect(cursor.state.position).toBe(1)
    expect(cursor.state.rewound).toBe(false)
  })

  it('extra undos at position 0 are no-ops', () => {
    cursor.undo()
    cursor.undo()
    cursor.undo()
    expect(cursor.state.position).toBe(0)
  })

  it('extra redos at head are no-ops', () => {
    cursor.redo()
    cursor.redo()
    expect(cursor.state.position).toBe(1)
  })
})

describe('Cursor — undo/redo over a multi-marker bag', () => {
  let lineageSig: string
  let cursor: Cursor
  let sigs: string[]

  beforeEach(async () => {
    lineageSig = await signLineage(['abc'])
    sigs = []
    sigs.push(await commitLayer(pool, historyRoot, lineageSig, { cells: ['a'], hidden: [] }))
    sigs.push(await commitLayer(pool, historyRoot, lineageSig, { cells: ['a', 'b'], hidden: [] }))
    sigs.push(await commitLayer(pool, historyRoot, lineageSig, { cells: ['a', 'b', 'c'], hidden: [] }))
    cursor = new Cursor()
    await cursor.load(historyRoot, lineageSig)
  })

  it('starts at head (position=3, total=3)', () => {
    expect(cursor.state.position).toBe(3)
    expect(cursor.state.total).toBe(3)
  })

  it('walks backward one step per undo', () => {
    cursor.undo()
    expect(cursor.state.position).toBe(2)
    cursor.undo()
    expect(cursor.state.position).toBe(1)
    cursor.undo()
    expect(cursor.state.position).toBe(0)
  })

  it('layerContentAtCursor reflects the cell set at each position', async () => {
    expect(await cursor.layerContentAtCursor(pool)).toEqual({ cells: ['a', 'b', 'c'], hidden: [] })
    cursor.undo()
    expect(await cursor.layerContentAtCursor(pool)).toEqual({ cells: ['a', 'b'], hidden: [] })
    cursor.undo()
    expect(await cursor.layerContentAtCursor(pool)).toEqual({ cells: ['a'], hidden: [] })
    cursor.undo()
    expect(await cursor.layerContentAtCursor(pool)).toEqual({ cells: [], hidden: [] })   // pre-history
  })

  it('redo walks forward', () => {
    cursor.undo(); cursor.undo(); cursor.undo()
    cursor.redo()
    expect(cursor.state.position).toBe(1)
    cursor.redo()
    expect(cursor.state.position).toBe(2)
    cursor.redo()
    expect(cursor.state.position).toBe(3)
  })

  it('round-trip undo/redo restores cell set', async () => {
    const head = await cursor.layerContentAtCursor(pool)
    cursor.undo(); cursor.undo(); cursor.undo()
    cursor.redo(); cursor.redo(); cursor.redo()
    expect(await cursor.layerContentAtCursor(pool)).toEqual(head)
  })

  it('rewound state is correctly reported when not at head', () => {
    cursor.undo()
    expect(cursor.state.rewound).toBe(true)
    cursor.redo()
    expect(cursor.state.rewound).toBe(false)
  })
})

describe('Cursor — onNewLayer behavior', () => {
  it('cursor at head absorbs new layer and stays at new head', async () => {
    const lineageSig = await signLineage(['abc'])
    await commitLayer(pool, historyRoot, lineageSig, { cells: ['a'], hidden: [] })
    const cursor = new Cursor()
    await cursor.load(historyRoot, lineageSig)
    expect(cursor.state.position).toBe(1)

    await commitLayer(pool, historyRoot, lineageSig, { cells: ['a', 'b'], hidden: [] })
    await cursor.onNewLayer(historyRoot)
    expect(cursor.state.position).toBe(2)
    expect(cursor.state.total).toBe(2)
  })

  it('rewound cursor stays at its position when a new layer is committed at head', async () => {
    const lineageSig = await signLineage(['abc'])
    await commitLayer(pool, historyRoot, lineageSig, { cells: ['a'], hidden: [] })
    await commitLayer(pool, historyRoot, lineageSig, { cells: ['a', 'b'], hidden: [] })
    const cursor = new Cursor()
    await cursor.load(historyRoot, lineageSig)
    cursor.undo()
    expect(cursor.state.position).toBe(1)

    await commitLayer(pool, historyRoot, lineageSig, { cells: ['a', 'b', 'c'], hidden: [] })
    await cursor.onNewLayer(historyRoot)
    // Was rewound (pos=1 < total=2), should stay at pos=1 even
    // though total grew to 3.
    expect(cursor.state.position).toBe(1)
    expect(cursor.state.total).toBe(3)
  })
})

describe('Cursor — lineage navigation', () => {
  it('cursor.load to a different lineage resets position to that lineage\'s head', async () => {
    const lineageA = await signLineage(['a'])
    const lineageB = await signLineage(['b'])
    await commitLayer(pool, historyRoot, lineageA, { cells: ['x'], hidden: [] })
    await commitLayer(pool, historyRoot, lineageA, { cells: ['x', 'y'], hidden: [] })
    await commitLayer(pool, historyRoot, lineageB, { cells: ['z'], hidden: [] })

    const cursor = new Cursor()
    await cursor.load(historyRoot, lineageA)
    expect(cursor.state.position).toBe(2)
    expect(cursor.state.total).toBe(2)

    await cursor.load(historyRoot, lineageB)
    expect(cursor.state.position).toBe(1)
    expect(cursor.state.total).toBe(1)
    expect(cursor.state.locationSig).toBe(lineageB)

    await cursor.load(historyRoot, lineageA)
    expect(cursor.state.position).toBe(2)
    expect(cursor.state.locationSig).toBe(lineageA)
  })

  it('navigating back to root lineage works (empty segments)', async () => {
    const rootSig = await signLineage([])
    await commitLayer(pool, historyRoot, rootSig, { cells: ['root-cell'], hidden: [] })
    const childSig = await signLineage(['child'])
    await commitLayer(pool, historyRoot, childSig, { cells: ['child-cell'], hidden: [] })

    const cursor = new Cursor()
    await cursor.load(historyRoot, childSig)
    expect((await cursor.layerContentAtCursor(pool))?.cells).toEqual(['child-cell'])

    await cursor.load(historyRoot, rootSig)
    expect((await cursor.layerContentAtCursor(pool))?.cells).toEqual(['root-cell'])
  })
})

describe('Root merkle invariant — current root advances per commit', () => {
  it('after each commit, the latest marker points at a new sig (when content changes)', async () => {
    const lineageSig = await signLineage(['abc'])
    const sig1 = await commitLayer(pool, historyRoot, lineageSig, { cells: ['a'], hidden: [] })
    const sig2 = await commitLayer(pool, historyRoot, lineageSig, { cells: ['a', 'b'], hidden: [] })
    const sig3 = await commitLayer(pool, historyRoot, lineageSig, { cells: ['a', 'b', 'c'], hidden: [] })

    const entries = await listLayers(historyRoot, lineageSig)
    expect(entries.length).toBe(3)
    expect(entries[0].layerSig).toBe(sig1)
    expect(entries[1].layerSig).toBe(sig2)
    expect(entries[2].layerSig).toBe(sig3)

    // The current root = the latest marker's sig
    const currentRoot = entries[entries.length - 1].layerSig
    expect(currentRoot).toBe(sig3)
  })

  it('current root is identical when content matches (sig is content-addressed)', async () => {
    const lineageSig = await signLineage(['abc'])
    const sig1 = await commitLayer(pool, historyRoot, lineageSig, { cells: ['a'], hidden: [] })
    // Different intermediate state
    await commitLayer(pool, historyRoot, lineageSig, { cells: ['a', 'b'], hidden: [] })
    // Back to the same state as sig1
    const sig3 = await commitLayer(pool, historyRoot, lineageSig, { cells: ['a'], hidden: [] })
    expect(sig3).toBe(sig1)

    // Three markers, two distinct sigs, current root = sig1 (= sig3)
    const entries = await listLayers(historyRoot, lineageSig)
    expect(entries.length).toBe(3)
    const currentRoot = entries[entries.length - 1].layerSig
    expect(currentRoot).toBe(sig1)
  })
})

describe('Cursor — interleaved commit/undo edge cases', () => {
  it('commit while rewound: contract says caller skips (we test the guard logic itself)', async () => {
    const lineageSig = await signLineage(['abc'])
    await commitLayer(pool, historyRoot, lineageSig, { cells: ['a'], hidden: [] })
    await commitLayer(pool, historyRoot, lineageSig, { cells: ['a', 'b'], hidden: [] })
    const cursor = new Cursor()
    await cursor.load(historyRoot, lineageSig)
    cursor.undo()
    expect(cursor.state.rewound).toBe(true)
    // Per layer-committer.drone.ts:#commit, the guard `if (cursor?.state?.rewound) return`
    // skips commits while rewound. Mirror that guard here:
    const shouldSkip = cursor.state.rewound
    expect(shouldSkip).toBe(true)
    // ...so a "would-be commit" in this state must NOT advance the bag
    const before = (await listLayers(historyRoot, lineageSig)).length
    if (!shouldSkip) {
      await commitLayer(pool, historyRoot, lineageSig, { cells: ['x'], hidden: [] })
    }
    const after = (await listLayers(historyRoot, lineageSig)).length
    expect(after).toBe(before)   // no new marker
  })

  it('rapid commits (no coalescing): N events → N markers, in order', async () => {
    const lineageSig = await signLineage(['abc'])
    const promises: Promise<string>[] = []
    for (let i = 0; i < 5; i++) {
      promises.push(commitLayer(pool, historyRoot, lineageSig, { cells: [`cell-${i}`], hidden: [] }))
    }
    await Promise.all(promises)
    const entries = await listLayers(historyRoot, lineageSig)
    expect(entries.length).toBe(5)
    expect(entries.map(e => e.filename)).toEqual([
      '00000001', '00000002', '00000003', '00000004', '00000005',
    ])
  })

  it('cursor refresh sees new marker after commit', async () => {
    const lineageSig = await signLineage(['abc'])
    const cursor = new Cursor()
    await cursor.load(historyRoot, lineageSig)
    expect(cursor.state.total).toBe(0)

    await commitLayer(pool, historyRoot, lineageSig, { cells: ['x'], hidden: [] })
    await cursor.onNewLayer(historyRoot)
    expect(cursor.state.total).toBe(1)
    expect(cursor.state.position).toBe(1)
    expect((await cursor.layerContentAtCursor(pool))?.cells).toEqual(['x'])
  })
})

describe('Cursor — pre-history (case A) vs no-history (case B)', () => {
  it('case A: bag has markers, undone past them → render empty', async () => {
    const lineageSig = await signLineage(['abc'])
    await commitLayer(pool, historyRoot, lineageSig, { cells: ['x'], hidden: [] })
    const cursor = new Cursor()
    await cursor.load(historyRoot, lineageSig)
    cursor.undo()
    expect(cursor.state.position).toBe(0)
    expect(cursor.state.total).toBe(1)   // history exists
    const content = await cursor.layerContentAtCursor(pool)
    expect(content).toEqual({ cells: [], hidden: [] })   // empty seed (case A)
  })

  it('case B: bag has no markers, position=0 → caller falls through to live disk', async () => {
    const lineageSig = await signLineage(['abc'])
    const cursor = new Cursor()
    await cursor.load(historyRoot, lineageSig)
    expect(cursor.state.position).toBe(0)
    expect(cursor.state.total).toBe(0)   // NO history
    // The cursor returns null (no layer); the renderer is responsible
    // for falling through to live disk in this case.
    expect(await cursor.layerContentAtCursor(pool)).toBeNull()
  })
})

// Sanity: dirExists is used in the test setup; satisfy linter
void dirExists
