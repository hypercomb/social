// diamondcoreprocessor.com/history/history.service.spec.ts
//
// Coverage of the merkle-composing layer model:
//   - bag-per-lineage (signed by ancestry only)
//   - marker file IS the full layer JSON (no pool indirection)
//   - layerSig = sha256(marker file bytes)
//   - empty seed (00000000) auto-minted on bag's first touch
//   - merkle cascade: parent.children[i] = child's current marker sig
//
// Uses an in-memory OPFS mock so tests run in jsdom without browser.

import { describe, it, expect, beforeEach } from 'vitest'

// -------------------------------------------------
// Pure: lineage sig algorithm (mirrors history.service.ts:sign +
// show-cell.drone.ts:computeSignatureLocation, the two compute
// sites that must agree on the bag's identity)
// -------------------------------------------------

const SIG_RE = /^[a-f0-9]{64}$/
const MARKER_RE = /^\d{8}$/

const sha256Hex = async (s: string | ArrayBuffer): Promise<string> => {
  const bytes = typeof s === 'string' ? new TextEncoder().encode(s) : new Uint8Array(s)
  const hash = await crypto.subtle.digest('SHA-256', bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)
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
    const slice = this.bytes.buffer.slice(this.bytes.byteOffset, this.bytes.byteOffset + this.bytes.byteLength) as ArrayBuffer
    const blob = new Blob([slice])
    const lastModified = this.lastModified
    return Object.assign(blob, {
      lastModified,
      name: this.name,
      arrayBuffer: () => Promise.resolve(slice),
      text: () => Promise.resolve(new TextDecoder().decode(slice)),
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
// Mirrors the production logic for the merkle-composing model.
// -------------------------------------------------

type LayerContent = {
  name: string
  children: string[]
}

const emptyLayer = (name: string): LayerContent => ({ name, children: [] })

const canonicalizeLayer = (layer: LayerContent): LayerContent => ({
  name: layer.name,
  children: layer.children.slice(),
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

const fileExists = async (dir: MockDir, name: string): Promise<boolean> => {
  try { await dir.getFileHandle(name, { create: false }); return true }
  catch { return false }
}

const dirExists = async (dir: MockDir, name: string): Promise<boolean> => {
  try { await dir.getDirectoryHandle(name, { create: false }); return true }
  catch { return false }
}

const ensureSeed = async (bag: MockDir, name: string): Promise<void> => {
  if (await fileExists(bag, '00000000')) return
  const seed = canonicalizeLayer(emptyLayer(name))
  const json = JSON.stringify(seed)
  const bytes = new TextEncoder().encode(json)
  await writeBytes(bag, '00000000', bytes)
}

/**
 * Commit a layer for `lineageSig`. Marker file IS the full layer JSON
 * (no pool indirection). Returns the marker's sig (sha256 of bytes).
 */
const commitLayer = async (
  historyRoot: MockDir,
  lineageSig: string,
  layer: LayerContent,
): Promise<string> => {
  const canonical = canonicalizeLayer(layer)
  const json = JSON.stringify(canonical)
  const bytes = new TextEncoder().encode(json)
  const layerSig = await sha256Hex(json)

  const bag = await historyRoot.getDirectoryHandle(lineageSig, { create: true })
  await ensureSeed(bag, layer.name)
  const markerName = await nextMarkerName(bag)
  await writeBytes(bag, markerName, bytes)

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
        // Bare-sig content is the legacy pre-merkle marker shape
        if (SIG_RE.test(text)) { drop.push(name); continue }
        try {
          const parsed = JSON.parse(text)
          if (parsed && typeof parsed === 'object' && Array.isArray(parsed.children)) continue
        } catch { /* fall through */ }
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
      const bytes = await file.arrayBuffer()
      const layerSig = await sha256Hex(bytes)
      markers.push({ layerSig, at: file.lastModified, filename: name })
    } catch { /* skip */ }
  }
  markers.sort((a, b) => a.filename.localeCompare(b.filename))
  return markers.map((e, i) => ({ ...e, index: i }))
}

/**
 * Read a layer's content directly from its bag. Walks markers, hashes
 * each, returns the matching one's parsed JSON.
 */
const getLayerContent = async (
  historyRoot: MockDir,
  lineageSig: string,
  layerSig: string,
): Promise<LayerContent | null> => {
  if (!SIG_RE.test(layerSig)) return null
  let bag: MockDir
  try { bag = await historyRoot.getDirectoryHandle(lineageSig, { create: false }) }
  catch { return null }
  for await (const [name, h] of bag.entries()) {
    if (h.kind !== 'file') continue
    if (!MARKER_RE.test(name)) continue
    try {
      const file = await h.getFile()
      const bytes = await file.arrayBuffer()
      const sig = await sha256Hex(bytes)
      if (sig !== layerSig) continue
      const parsed = JSON.parse(new TextDecoder().decode(bytes)) as Partial<LayerContent>
      return {
        name: parsed.name ?? '',
        children: parsed.children ?? [],
      }
    } catch { /* skip unreadable */ }
  }
  return null
}

/**
 * Read the sig of the latest marker for a lineage's bag (its current
 * merkle composition). Returns the empty-seed sig if the bag has no
 * markers yet — a deterministic placeholder so children that haven't
 * been visited still have a sig.
 */
const latestMarkerSigFor = async (
  historyRoot: MockDir,
  lineageSig: string,
  name: string,
): Promise<string> => {
  let bag: MockDir | null = null
  try { bag = await historyRoot.getDirectoryHandle(lineageSig, { create: false }) }
  catch { /* no bag */ }

  if (bag) {
    let latest = ''
    for await (const [n, h] of bag.entries()) {
      if (h.kind !== 'file') continue
      if (!MARKER_RE.test(n)) continue
      if (n > latest) latest = n
    }
    if (latest) {
      try {
        const file = await (await bag.getFileHandle(latest)).getFile()
        const bytes = await file.arrayBuffer()
        return await sha256Hex(bytes)
      } catch { /* fall through */ }
    }
  }

  // Default: empty-seed sig
  const seed = canonicalizeLayer(emptyLayer(name))
  return await sha256Hex(JSON.stringify(seed))
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

  async layerContentAtCursor(historyRoot: MockDir): Promise<LayerContent | null> {
    if (this.#position === 0) {
      // Case A: pre-history empty render IF layers exist; Case B
      // (no layers at all) — caller should fall through to live disk.
      if (this.#layers.length === 0) return null
      return emptyLayer('')
    }
    const entry = this.#layers[this.#position - 1]
    return await getLayerContent(historyRoot, this.#locationSig, entry.layerSig)
  }
}

// -------------------------------------------------
// Test environment
// -------------------------------------------------

let opfsRoot: MockDir = new MockDir('/')
let historyRoot: MockDir = new MockDir('__history__')

beforeEach(() => {
  opfsRoot = new MockDir('/')
  historyRoot = new MockDir('__history__')
  opfsRoot.dirs.set('__history__', historyRoot)
})

// Helper: build a fake child sig string of a given length (pads to 64).
const fakeSig = (s: string): string => s.padEnd(64, '0').slice(0, 64)

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
})

// ===================================================
// commitLayer + listLayers + normalize
// ===================================================

describe('commitLayer / listLayers — bag-per-lineage', () => {
  it('first commit on a fresh lineage auto-mints empty seed (00000000) + the new marker (00000001)', async () => {
    const lineageSig = await signLineage(['abc'])
    const sig = await commitLayer(historyRoot, lineageSig, { name: 'abc', children: [fakeSig('m')] })

    expect(sig).toMatch(SIG_RE)
    const bag = await historyRoot.getDirectoryHandle(lineageSig)
    const names: string[] = []
    for await (const [n] of bag.entries()) names.push(n)
    expect(names.sort()).toEqual(['00000000', '00000001'])

    // Marker content IS the layer JSON
    const file = await (await bag.getFileHandle('00000001')).getFile()
    const parsed = JSON.parse(await file.text())
    expect(parsed.name).toBe('abc')
    expect(parsed.children).toEqual([fakeSig('m')])
  })

  it('list grows by one per commit (plus the empty seed)', async () => {
    const lineageSig = await signLineage(['abc'])
    expect((await listLayers(historyRoot, lineageSig)).length).toBe(0)

    await commitLayer(historyRoot, lineageSig, { name: 'abc', children: [fakeSig('s')] })
    expect((await listLayers(historyRoot, lineageSig)).length).toBe(2)   // seed + first

    await commitLayer(historyRoot, lineageSig, { name: 'abc', children: [fakeSig('s'), fakeSig('t')] })
    expect((await listLayers(historyRoot, lineageSig)).length).toBe(3)
  })

  it('two markers can carry identical content (sigs match, dedupe is observable)', async () => {
    const lineageSig = await signLineage(['abc'])
    const layer: LayerContent = { name: 'abc', children: [fakeSig('s')] }
    const sig1 = await commitLayer(historyRoot, lineageSig, layer)
    const sig2 = await commitLayer(historyRoot, lineageSig, layer) // same content

    expect(sig1).toBe(sig2)
    const entries = await listLayers(historyRoot, lineageSig)
    // seed + 2 markers = 3
    expect(entries.length).toBe(3)
    expect(entries[1].layerSig).toBe(entries[2].layerSig)
  })

  it('listLayers returns markers sorted by filename (chronological)', async () => {
    const lineageSig = await signLineage(['abc'])
    await commitLayer(historyRoot, lineageSig, { name: 'abc', children: [fakeSig('1')] })
    await commitLayer(historyRoot, lineageSig, { name: 'abc', children: [fakeSig('2')] })
    await commitLayer(historyRoot, lineageSig, { name: 'abc', children: [fakeSig('3')] })
    const entries = await listLayers(historyRoot, lineageSig)
    expect(entries.map(e => e.filename)).toEqual(['00000000', '00000001', '00000002', '00000003'])
    expect(entries.map(e => e.index)).toEqual([0, 1, 2, 3])
  })

  it('lineage isolation: commits at one lineage do not appear in another', async () => {
    const lineageA = await signLineage(['abc'])
    const lineageB = await signLineage(['def'])
    await commitLayer(historyRoot, lineageA, { name: 'abc', children: [fakeSig('x')] })
    await commitLayer(historyRoot, lineageB, { name: 'def', children: [fakeSig('y')] })
    expect((await listLayers(historyRoot, lineageA)).length).toBe(2)
    expect((await listLayers(historyRoot, lineageB)).length).toBe(2)
  })

  it('root lineage (empty segments) is a valid bag', async () => {
    const rootSig = await signLineage([])
    await commitLayer(historyRoot, rootSig, { name: '', children: [fakeSig('r')] })
    const entries = await listLayers(historyRoot, rootSig)
    expect(entries.length).toBe(2)   // seed + commit
    const content = await getLayerContent(historyRoot, rootSig, entries[entries.length - 1].layerSig)
    expect(content?.name).toBe('')
    expect(content?.children).toEqual([fakeSig('r')])
  })

  it('auto-seed: the empty-seed marker exists on first commit and is byte-stable', async () => {
    const lineageA = await signLineage(['abc'])
    const lineageB = await signLineage(['xyz'])
    await commitLayer(historyRoot, lineageA, { name: 'abc', children: [] })
    await commitLayer(historyRoot, lineageB, { name: 'xyz', children: [] })

    const bagA = await historyRoot.getDirectoryHandle(lineageA)
    const bagB = await historyRoot.getDirectoryHandle(lineageB)

    const seedABytes = await (await (await bagA.getFileHandle('00000000')).getFile()).arrayBuffer()
    const seedBBytes = await (await (await bagB.getFileHandle('00000000')).getFile()).arrayBuffer()

    // Different names → different seeds (name field is part of bytes)
    expect(await sha256Hex(seedABytes)).not.toBe(await sha256Hex(seedBBytes))

    // Same name → same seed sig
    const seedASig = await sha256Hex(seedABytes)
    const expected = await sha256Hex(JSON.stringify(canonicalizeLayer(emptyLayer('abc'))))
    expect(seedASig).toBe(expected)
  })
})

describe('normalize — drops legacy shapes, keeps merkle markers', () => {
  it('idempotent on a clean bag', async () => {
    const lineageSig = await signLineage(['abc'])
    await commitLayer(historyRoot, lineageSig, { name: 'abc', children: [fakeSig('x')] })
    const before = (await listLayers(historyRoot, lineageSig)).length
    const after = (await listLayers(historyRoot, lineageSig)).length
    expect(after).toBe(before)
  })

  it('drops sig-named files at bag root (legacy content storage)', async () => {
    const lineageSig = await signLineage(['abc'])
    const bag = await historyRoot.getDirectoryHandle(lineageSig, { create: true })
    const fakeNamedSig = await sha256Hex('something')
    await writeBytes(bag, fakeNamedSig, new TextEncoder().encode('{"children":[]}'))

    await listLayers(historyRoot, lineageSig)
    expect(await fileExists(bag, fakeNamedSig)).toBe(false)
  })

  it('drops 8-digit numeric files with bare-sig content (pre-merkle shape)', async () => {
    const lineageSig = await signLineage(['abc'])
    const bag = await historyRoot.getDirectoryHandle(lineageSig, { create: true })
    const sigOnlyMarker = await sha256Hex('legacy')
    await writeBytes(bag, '00000001', new TextEncoder().encode(sigOnlyMarker))

    await listLayers(historyRoot, lineageSig)
    expect(await fileExists(bag, '00000001')).toBe(false)
  })

  it('drops 8-digit numeric files with op-JSON content', async () => {
    const lineageSig = await signLineage(['abc'])
    const bag = await historyRoot.getDirectoryHandle(lineageSig, { create: true })
    await writeBytes(bag, '00000001', new TextEncoder().encode('{"op":"add","cell":"x"}'))

    await listLayers(historyRoot, lineageSig)
    expect(await fileExists(bag, '00000001')).toBe(false)
  })

  it('keeps canonical markers (8-digit numeric, layer-JSON-with-children content)', async () => {
    const lineageSig = await signLineage(['abc'])
    await commitLayer(historyRoot, lineageSig, { name: 'abc', children: [fakeSig('x')] })
    const before = await listLayers(historyRoot, lineageSig)
    const after = await listLayers(historyRoot, lineageSig)
    expect(after.length).toBe(before.length)
    expect(after[after.length - 1].layerSig).toBe(before[before.length - 1].layerSig)
  })
})

describe('getLayerContent — reads marker bytes from the bag', () => {
  it('returns null for non-sig input', async () => {
    const lineageSig = await signLineage(['abc'])
    expect(await getLayerContent(historyRoot, lineageSig, 'not-a-sig')).toBeNull()
    expect(await getLayerContent(historyRoot, lineageSig, '00000001')).toBeNull()
  })

  it('returns null when sig not found in bag', async () => {
    const lineageSig = await signLineage(['abc'])
    const phantomSig = await sha256Hex('nothing-written')
    expect(await getLayerContent(historyRoot, lineageSig, phantomSig)).toBeNull()
  })

  it('returns parsed full-shape layer for an existing sig', async () => {
    const lineageSig = await signLineage(['abc'])
    const sig = await commitLayer(historyRoot, lineageSig, {
      name: 'abc', children: [fakeSig('1'), fakeSig('2')],
    })
    const content = await getLayerContent(historyRoot, lineageSig, sig)
    expect(content).toEqual({
      name: 'abc', children: [fakeSig('1'), fakeSig('2')],
    })
  })

  it('content survives across listLayers calls', async () => {
    const lineageSig = await signLineage(['abc'])
    const sig = await commitLayer(historyRoot, lineageSig, { name: 'abc', children: [fakeSig('x')] })
    await listLayers(historyRoot, lineageSig)
    await listLayers(historyRoot, lineageSig)
    const content = await getLayerContent(historyRoot, lineageSig, sig)
    expect(content?.children).toEqual([fakeSig('x')])
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
    expect(await cursor.layerContentAtCursor(historyRoot)).toBeNull()
  })
})

describe('Cursor — undo/redo over a single-commit bag (= 2 markers: seed + commit)', () => {
  let lineageSig: string
  let cursor: Cursor

  beforeEach(async () => {
    lineageSig = await signLineage(['abc'])
    await commitLayer(historyRoot, lineageSig, { name: 'abc', children: [fakeSig('x')] })
    cursor = new Cursor()
    await cursor.load(historyRoot, lineageSig)
  })

  it('initial cursor is at head (position=2, total=2)', () => {
    expect(cursor.state.position).toBe(2)
    expect(cursor.state.total).toBe(2)
    expect(cursor.state.rewound).toBe(false)
  })

  it('layerContentAtCursor returns the layer at head', async () => {
    const content = await cursor.layerContentAtCursor(historyRoot)
    expect(content?.children).toEqual([fakeSig('x')])
    expect(content?.name).toBe('abc')
  })

  it('undo to position=1 lands on the empty seed', async () => {
    cursor.undo()
    expect(cursor.state.position).toBe(1)
    const content = await cursor.layerContentAtCursor(historyRoot)
    expect(content).toEqual(emptyLayer('abc'))
  })

  it('undo past the seed → position=0 (pre-history), rewound=true', () => {
    cursor.undo()
    cursor.undo()
    expect(cursor.state.position).toBe(0)
    expect(cursor.state.rewound).toBe(true)
  })

  it('redo from position 0 walks forward', () => {
    cursor.undo(); cursor.undo()
    cursor.redo()
    expect(cursor.state.position).toBe(1)
    cursor.redo()
    expect(cursor.state.position).toBe(2)
    expect(cursor.state.rewound).toBe(false)
  })

  it('extra undos at position 0 are no-ops', () => {
    cursor.undo(); cursor.undo(); cursor.undo(); cursor.undo()
    expect(cursor.state.position).toBe(0)
  })

  it('extra redos at head are no-ops', () => {
    cursor.redo()
    cursor.redo()
    expect(cursor.state.position).toBe(2)
  })
})

describe('Cursor — undo/redo over a multi-commit bag', () => {
  let lineageSig: string
  let cursor: Cursor

  beforeEach(async () => {
    lineageSig = await signLineage(['abc'])
    await commitLayer(historyRoot, lineageSig, { name: 'abc', children: [fakeSig('a')] })
    await commitLayer(historyRoot, lineageSig, { name: 'abc', children: [fakeSig('a'), fakeSig('b')] })
    await commitLayer(historyRoot, lineageSig, { name: 'abc', children: [fakeSig('a'), fakeSig('b'), fakeSig('c')] })
    cursor = new Cursor()
    await cursor.load(historyRoot, lineageSig)
  })

  it('starts at head (position=4, total=4 — seed + 3 commits)', () => {
    expect(cursor.state.position).toBe(4)
    expect(cursor.state.total).toBe(4)
  })

  it('walks backward one step per undo', () => {
    cursor.undo(); expect(cursor.state.position).toBe(3)
    cursor.undo(); expect(cursor.state.position).toBe(2)
    cursor.undo(); expect(cursor.state.position).toBe(1)
    cursor.undo(); expect(cursor.state.position).toBe(0)
  })

  it('layerContentAtCursor reflects the children set at each position', async () => {
    expect((await cursor.layerContentAtCursor(historyRoot))?.children).toEqual([fakeSig('a'), fakeSig('b'), fakeSig('c')])
    cursor.undo()
    expect((await cursor.layerContentAtCursor(historyRoot))?.children).toEqual([fakeSig('a'), fakeSig('b')])
    cursor.undo()
    expect((await cursor.layerContentAtCursor(historyRoot))?.children).toEqual([fakeSig('a')])
    cursor.undo()
    expect((await cursor.layerContentAtCursor(historyRoot))?.children).toEqual([])   // empty seed
    cursor.undo()
    expect((await cursor.layerContentAtCursor(historyRoot))).toEqual(emptyLayer(''))   // pre-history
  })

  it('round-trip undo/redo restores children set', async () => {
    const head = await cursor.layerContentAtCursor(historyRoot)
    cursor.undo(); cursor.undo(); cursor.undo(); cursor.undo()
    cursor.redo(); cursor.redo(); cursor.redo(); cursor.redo()
    expect((await cursor.layerContentAtCursor(historyRoot))?.children).toEqual(head?.children)
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
    await commitLayer(historyRoot, lineageSig, { name: 'abc', children: [fakeSig('a')] })
    const cursor = new Cursor()
    await cursor.load(historyRoot, lineageSig)
    expect(cursor.state.position).toBe(2)

    await commitLayer(historyRoot, lineageSig, { name: 'abc', children: [fakeSig('a'), fakeSig('b')] })
    await cursor.onNewLayer(historyRoot)
    expect(cursor.state.position).toBe(3)
    expect(cursor.state.total).toBe(3)
  })

  it('rewound cursor stays at its position when a new layer is committed at head', async () => {
    const lineageSig = await signLineage(['abc'])
    await commitLayer(historyRoot, lineageSig, { name: 'abc', children: [fakeSig('a')] })
    await commitLayer(historyRoot, lineageSig, { name: 'abc', children: [fakeSig('a'), fakeSig('b')] })
    const cursor = new Cursor()
    await cursor.load(historyRoot, lineageSig)
    cursor.undo()   // pos=2
    expect(cursor.state.position).toBe(2)

    await commitLayer(historyRoot, lineageSig, { name: 'abc', children: [fakeSig('a'), fakeSig('b'), fakeSig('c')] })
    await cursor.onNewLayer(historyRoot)
    // Was rewound (pos=2 < total=3), should stay at pos=2 even
    // though total grew to 4.
    expect(cursor.state.position).toBe(2)
    expect(cursor.state.total).toBe(4)
  })
})

describe('Cursor — lineage navigation', () => {
  it('cursor.load to a different lineage resets position to that lineage\'s head', async () => {
    const lineageA = await signLineage(['a'])
    const lineageB = await signLineage(['b'])
    await commitLayer(historyRoot, lineageA, { name: 'a', children: [fakeSig('x')] })
    await commitLayer(historyRoot, lineageA, { name: 'a', children: [fakeSig('x'), fakeSig('y')] })
    await commitLayer(historyRoot, lineageB, { name: 'b', children: [fakeSig('z')] })

    const cursor = new Cursor()
    await cursor.load(historyRoot, lineageA)
    expect(cursor.state.position).toBe(3)   // seed + 2 commits

    await cursor.load(historyRoot, lineageB)
    expect(cursor.state.position).toBe(2)   // seed + 1 commit
    expect(cursor.state.locationSig).toBe(lineageB)

    await cursor.load(historyRoot, lineageA)
    expect(cursor.state.position).toBe(3)
    expect(cursor.state.locationSig).toBe(lineageA)
  })

  it('navigating back to root lineage works (empty segments)', async () => {
    const rootSig = await signLineage([])
    await commitLayer(historyRoot, rootSig, { name: '', children: [fakeSig('r')] })
    const childSig = await signLineage(['child'])
    await commitLayer(historyRoot, childSig, { name: 'child', children: [fakeSig('c')] })

    const cursor = new Cursor()
    await cursor.load(historyRoot, childSig)
    expect((await cursor.layerContentAtCursor(historyRoot))?.children).toEqual([fakeSig('c')])

    await cursor.load(historyRoot, rootSig)
    expect((await cursor.layerContentAtCursor(historyRoot))?.children).toEqual([fakeSig('r')])
  })
})

// ===================================================
// Merkle invariants — cascade and root
// ===================================================

describe('Merkle invariant — current root advances per commit', () => {
  it('after each commit, the latest marker has a new sig (when content changes)', async () => {
    const lineageSig = await signLineage(['abc'])
    const sig1 = await commitLayer(historyRoot, lineageSig, { name: 'abc', children: [fakeSig('a')] })
    const sig2 = await commitLayer(historyRoot, lineageSig, { name: 'abc', children: [fakeSig('a'), fakeSig('b')] })
    const sig3 = await commitLayer(historyRoot, lineageSig, { name: 'abc', children: [fakeSig('a'), fakeSig('b'), fakeSig('c')] })

    expect(sig1).not.toBe(sig2)
    expect(sig2).not.toBe(sig3)
    expect(sig1).not.toBe(sig3)

    const entries = await listLayers(historyRoot, lineageSig)
    // seed + 3 commits = 4
    expect(entries.length).toBe(4)
    expect(entries[entries.length - 1].layerSig).toBe(sig3)
  })

  it('content-addressed: same content → same sig', async () => {
    const lineageSig = await signLineage(['abc'])
    const sig1 = await commitLayer(historyRoot, lineageSig, { name: 'abc', children: [fakeSig('a')] })
    await commitLayer(historyRoot, lineageSig, { name: 'abc', children: [fakeSig('a'), fakeSig('b')] })
    const sig3 = await commitLayer(historyRoot, lineageSig, { name: 'abc', children: [fakeSig('a')] })
    expect(sig3).toBe(sig1)
  })

  it('changing only a child sig (child mutated) changes parent layer sig', async () => {
    const lineageSig = await signLineage(['abc'])
    // Same name, different child sig ↔ parent's bytes change.
    // This is the property that drives the cascade.
    const sigA = await commitLayer(historyRoot, lineageSig, { name: 'abc', children: [fakeSig('1')] })
    const sigB = await commitLayer(historyRoot, lineageSig, { name: 'abc', children: [fakeSig('2')] })
    expect(sigA).not.toBe(sigB)
  })
})

describe('Merkle cascade — latestMarkerSigFor + parent composition', () => {
  it('latestMarkerSigFor on missing bag returns deterministic empty-seed sig', async () => {
    const lineageSig = await signLineage(['phantom'])
    const sig = await latestMarkerSigFor(historyRoot, lineageSig, 'phantom')
    const expected = await sha256Hex(JSON.stringify(canonicalizeLayer(emptyLayer('phantom'))))
    expect(sig).toBe(expected)
  })

  it('latestMarkerSigFor returns sig of LAST marker (after commits)', async () => {
    const lineageSig = await signLineage(['abc'])
    await commitLayer(historyRoot, lineageSig, { name: 'abc', children: [fakeSig('1')] })
    const sigSecond = await commitLayer(historyRoot, lineageSig, { name: 'abc', children: [fakeSig('1'), fakeSig('2')] })

    const latest = await latestMarkerSigFor(historyRoot, lineageSig, 'abc')
    expect(latest).toBe(sigSecond)
  })

  it('cascade simulation: child commit changes parent bytes when parent recomputes children', async () => {
    // Lineage: /A/B/C  (leaf)
    const leafSig = await signLineage(['A', 'B', 'C'])
    const midSig = await signLineage(['A', 'B'])
    const topSig = await signLineage(['A'])
    const rootSig = await signLineage([])

    // 1. Initial commit at leaf
    await commitLayer(historyRoot, leafSig, { name: 'C', children: [] })

    // Build mid layer with leaf's current marker sig as a child
    let leafMerkle = await latestMarkerSigFor(historyRoot, leafSig, 'C')
    const midSigBefore = await commitLayer(historyRoot, midSig, {
      name: 'B', children: [leafMerkle],
    })
    const topSigBefore = await commitLayer(historyRoot, topSig, {
      name: 'A', children: [await latestMarkerSigFor(historyRoot, midSig, 'B')],
    })
    const rootSigBefore = await commitLayer(historyRoot, rootSig, {
      name: '', children: [await latestMarkerSigFor(historyRoot, topSig, 'A')],
    })

    // 2. Leaf changes — add a child sig at /A/B/C
    await commitLayer(historyRoot, leafSig, { name: 'C', children: [fakeSig('t')] })

    // 3. Cascade up: each ancestor recomputes its children array
    leafMerkle = await latestMarkerSigFor(historyRoot, leafSig, 'C')
    const midSigAfter = await commitLayer(historyRoot, midSig, {
      name: 'B', children: [leafMerkle],
    })
    const topSigAfter = await commitLayer(historyRoot, topSig, {
      name: 'A', children: [await latestMarkerSigFor(historyRoot, midSig, 'B')],
    })
    const rootSigAfter = await commitLayer(historyRoot, rootSig, {
      name: '', children: [await latestMarkerSigFor(historyRoot, topSig, 'A')],
    })

    // Every ancestor's sig changed (cascade reached the root)
    expect(midSigAfter).not.toBe(midSigBefore)
    expect(topSigAfter).not.toBe(topSigBefore)
    expect(rootSigAfter).not.toBe(rootSigBefore)
  })

  it('siblings are isolated: a commit at /A/B/C does not change /A/B2 sig (only /A/B and up cascade)', async () => {
    const sibSig1 = await signLineage(['A', 'B', 'C'])
    const sibSig2 = await signLineage(['A', 'B2'])

    // Commit at sibling 2 first
    await commitLayer(historyRoot, sibSig2, { name: 'B2', children: [] })
    const sib2Initial = await latestMarkerSigFor(historyRoot, sibSig2, 'B2')

    // Commit at sibling 1 (under different parent path)
    await commitLayer(historyRoot, sibSig1, { name: 'C', children: [fakeSig('a')] })

    // Sibling 2 unchanged
    const sib2After = await latestMarkerSigFor(historyRoot, sibSig2, 'B2')
    expect(sib2After).toBe(sib2Initial)
  })
})

describe('Cursor — interleaved commit/undo edge cases', () => {
  it('rapid commits (no coalescing): N events → N markers (plus seed), in order', async () => {
    const lineageSig = await signLineage(['abc'])
    for (let i = 0; i < 5; i++) {
      await commitLayer(historyRoot, lineageSig, { name: 'abc', children: [fakeSig(String(i))] })
    }
    const entries = await listLayers(historyRoot, lineageSig)
    expect(entries.length).toBe(6)   // seed + 5
    expect(entries.map(e => e.filename)).toEqual([
      '00000000', '00000001', '00000002', '00000003', '00000004', '00000005',
    ])
  })

  it('cursor refresh sees new marker after commit', async () => {
    const lineageSig = await signLineage(['abc'])
    const cursor = new Cursor()
    await cursor.load(historyRoot, lineageSig)
    expect(cursor.state.total).toBe(0)

    await commitLayer(historyRoot, lineageSig, { name: 'abc', children: [fakeSig('x')] })
    await cursor.onNewLayer(historyRoot)
    expect(cursor.state.total).toBe(2)   // seed + commit
    expect(cursor.state.position).toBe(2)
    expect((await cursor.layerContentAtCursor(historyRoot))?.children).toEqual([fakeSig('x')])
  })
})

describe('Cursor — pre-history (case A) vs no-history (case B)', () => {
  it('case A: bag has markers, undone past them → render empty seed', async () => {
    const lineageSig = await signLineage(['abc'])
    await commitLayer(historyRoot, lineageSig, { name: 'abc', children: [fakeSig('x')] })
    const cursor = new Cursor()
    await cursor.load(historyRoot, lineageSig)
    cursor.undo(); cursor.undo()   // past seed
    expect(cursor.state.position).toBe(0)
    expect(cursor.state.total).toBe(2)
    const content = await cursor.layerContentAtCursor(historyRoot)
    expect(content).toEqual(emptyLayer(''))   // pre-history (case A)
  })

  it('case B: bag has no markers, position=0 → caller falls through to live disk', async () => {
    const lineageSig = await signLineage(['abc'])
    const cursor = new Cursor()
    await cursor.load(historyRoot, lineageSig)
    expect(cursor.state.position).toBe(0)
    expect(cursor.state.total).toBe(0)
    expect(await cursor.layerContentAtCursor(historyRoot)).toBeNull()
  })
})

// Sanity: dirExists/opfsRoot are used in the test setup; satisfy linter
void dirExists
void opfsRoot
