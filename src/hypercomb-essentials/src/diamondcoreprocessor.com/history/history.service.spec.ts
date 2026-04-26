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
  children?: string[]
}

const emptyLayer = (name: string): LayerContent => ({ name })

const canonicalizeLayer = (layer: LayerContent): LayerContent => {
  if (!layer.children || layer.children.length === 0) return { name: layer.name }
  return { name: layer.name, children: layer.children.slice() }
}

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
          // Canonical: must have non-empty name. children is optional
          // (seed shape `{name}` is valid).
          if (parsed && typeof parsed === 'object' && typeof parsed.name === 'string' && parsed.name.length > 0) continue
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
      if (!parsed.name) continue
      const out: LayerContent = { name: parsed.name }
      if (Array.isArray(parsed.children) && parsed.children.length > 0) out.children = parsed.children
      return out
    } catch { /* skip unreadable */ }
  }
  return null
}

/**
 * Return the sig of the lineage's CURRENT layer (last marker in bag).
 * Materializes the bag + seed if missing — every sig this returns
 * MUST point to real on-disk bytes. That's the invariant: a sig
 * landing in a parent's children array is always resolvable later
 * via the preloader cache or a bag scan.
 */
const latestMarkerSigFor = async (
  historyRoot: MockDir,
  lineageSig: string,
  name: string,
): Promise<string> => {
  // Materialize bag + seed if missing
  const bag = await historyRoot.getDirectoryHandle(lineageSig, { create: true })
  await ensureSeed(bag, name)
  // Find latest marker (00000000 at minimum)
  let latest = '00000000'
  for await (const [n, h] of bag.entries()) {
    if (h.kind !== 'file') continue
    if (!MARKER_RE.test(n)) continue
    if (n > latest) latest = n
  }
  const file = await (await bag.getFileHandle(latest)).getFile()
  const bytes = await file.arrayBuffer()
  return await sha256Hex(bytes)
}

/**
 * Preloader: walk every bag, find the marker whose bytes hash to the
 * given sig, return its parsed content. Mirrors production's
 * HistoryService.getLayerBySig (cold-miss path; the cache is implicit
 * since all sigs we mint also write bytes to disk).
 */
const getLayerBySig = async (
  historyRoot: MockDir,
  layerSig: string,
): Promise<LayerContent | null> => {
  if (!SIG_RE.test(layerSig)) return null
  for await (const [, dirHandle] of historyRoot.entries()) {
    if (dirHandle.kind !== 'directory') continue
    const bag = dirHandle as MockDir
    for await (const [name, fileHandle] of bag.entries()) {
      if (fileHandle.kind !== 'file') continue
      if (!MARKER_RE.test(name)) continue
      const file = await (fileHandle as MockFile).getFile()
      const bytes = await file.arrayBuffer()
      const sig = await sha256Hex(bytes)
      if (sig !== layerSig) continue
      try {
        const parsed = JSON.parse(new TextDecoder().decode(bytes)) as Partial<LayerContent>
        if (!parsed.name) return null
        const out: LayerContent = { name: parsed.name }
        if (Array.isArray(parsed.children) && parsed.children.length > 0) out.children = parsed.children
        return out
      } catch { return null }
    }
  }
  return null
}

/**
 * Mechanical resolver mirroring show-cell.drone.ts:resolveChildNames.
 * Iterates parent's child sigs, looks each up via the preloader, collects names.
 */
const resolveChildNames = async (
  historyRoot: MockDir,
  content: LayerContent | null,
): Promise<Set<string>> => {
  const out = new Set<string>()
  if (!content?.children?.length) return out
  for (const childSig of content.children) {
    const child = await getLayerBySig(historyRoot, childSig)
    if (child?.name) out.add(child.name)
  }
  return out
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

  it('root lineage (empty segments) is a valid bag, name = "/" (ROOT_NAME)', async () => {
    const rootSig = await signLineage([])
    await commitLayer(historyRoot, rootSig, { name: '/', children: [fakeSig('r')] })
    const entries = await listLayers(historyRoot, rootSig)
    expect(entries.length).toBe(2)   // seed + commit
    const content = await getLayerContent(historyRoot, rootSig, entries[entries.length - 1].layerSig)
    expect(content?.name).toBe('/')
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
    expect((await cursor.layerContentAtCursor(historyRoot))?.children).toBeUndefined()   // empty seed (no children field)
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
    await commitLayer(historyRoot, rootSig, { name: '/', children: [fakeSig('r')] })
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

// ===================================================
// Full cascade: leaf → root, every ancestor commits a new marker
// ===================================================
//
// These tests model the user's directive:
//   "remember the ancestor cascade"
//   "the parent tiles should never be affected, only pointing to
//    the new sig changing from the old. all the way to the root"
//
// We simulate the commit pipeline (LayerCommitter.#commit's loop)
// using the spec's commitLayer + latestMarkerSigFor helpers.

const cascade = async (
  historyRoot: MockDir,
  segments: string[],
  childNamesByDepth: Record<number, string[]>,
): Promise<{ depth: number; sig: string }[]> => {
  const out: { depth: number; sig: string }[] = []
  for (let depth = segments.length; depth >= 0; depth--) {
    const sub = segments.slice(0, depth)
    const ancestorName = depth === 0 ? '/' : sub[sub.length - 1]
    const ancestorLocSig = await signLineage(sub)
    const childNames = childNamesByDepth[depth] ?? []
    const children: string[] = []
    for (const cn of childNames) {
      const childLocSig = await signLineage([...sub, cn])
      const childSig = await latestMarkerSigFor(historyRoot, childLocSig, cn)
      children.push(childSig)
    }
    const layer: LayerContent = childNames.length === 0
      ? { name: ancestorName }
      : { name: ancestorName, children }
    const sig = await commitLayer(historyRoot, ancestorLocSig, layer)
    out.push({ depth, sig })
  }
  return out
}

describe('Cascade — every ancestor commits when a leaf changes', () => {
  it('cell:added at /A/B/C produces a new marker at /A/B/C, /A/B, /A, and /', async () => {
    const segments = ['A', 'B', 'C']

    // Initial cascade with leaf having no children.
    await cascade(historyRoot, segments, { 3: [], 2: ['C'], 1: ['B'], 0: ['A'] })

    const before = await Promise.all([
      listLayers(historyRoot, await signLineage([])),
      listLayers(historyRoot, await signLineage(['A'])),
      listLayers(historyRoot, await signLineage(['A', 'B'])),
      listLayers(historyRoot, await signLineage(['A', 'B', 'C'])),
    ])
    // each bag = seed + first commit
    expect(before.map(b => b.length)).toEqual([2, 2, 2, 2])

    // Leaf adds a child "D"
    await cascade(historyRoot, segments, { 3: ['D'], 2: ['C'], 1: ['B'], 0: ['A'] })

    const after = await Promise.all([
      listLayers(historyRoot, await signLineage([])),
      listLayers(historyRoot, await signLineage(['A'])),
      listLayers(historyRoot, await signLineage(['A', 'B'])),
      listLayers(historyRoot, await signLineage(['A', 'B', 'C'])),
    ])
    // every bag picked up exactly one more marker
    expect(after.map(b => b.length)).toEqual([3, 3, 3, 3])
  })

  it('parent name stays the same; only the merkle entry for the changed child swaps', async () => {
    const segments = ['A']

    // Two children at /A: B and C, both with their own bags.
    await cascade(historyRoot, ['A', 'B'], { 2: [], 1: ['B', 'C'], 0: ['A'] })
    await cascade(historyRoot, ['A', 'C'], { 2: [], 1: ['B', 'C'], 0: ['A'] })

    // Snapshot /A's layer
    const aSig = await signLineage(['A'])
    const aBefore = await listLayers(historyRoot, aSig)
    const aBeforeContent = await getLayerContent(historyRoot, aSig, aBefore[aBefore.length - 1].layerSig)
    expect(aBeforeContent?.name).toBe('A')
    expect(aBeforeContent?.children?.length).toBe(2)
    const [bSigBefore, cSigBefore] = aBeforeContent!.children!

    // B mutates: cascade through /A, /
    await cascade(historyRoot, ['A', 'B'], { 2: ['x'], 1: ['B', 'C'], 0: ['A'] })

    const aAfter = await listLayers(historyRoot, aSig)
    const aAfterContent = await getLayerContent(historyRoot, aSig, aAfter[aAfter.length - 1].layerSig)
    expect(aAfterContent?.name).toBe('A')   // name unchanged
    expect(aAfterContent?.children?.length).toBe(2)   // child count unchanged
    const [bSigAfter, cSigAfter] = aAfterContent!.children!
    expect(bSigAfter).not.toBe(bSigBefore)   // B's merkle changed
    expect(cSigAfter).toBe(cSigBefore)       // C's merkle stable
  })

  it('cascade reaches the root: root marker count grows for every commit', async () => {
    const rootSig = await signLineage([])

    // 3 cascades, each at a different depth. All should mint a root marker.
    await cascade(historyRoot, [], { 0: [] })                       // root only
    await cascade(historyRoot, ['A'], { 1: [], 0: ['A'] })           // /A + root
    await cascade(historyRoot, ['A', 'B'], { 2: [], 1: ['B'], 0: ['A'] })  // /A/B + /A + root

    const rootEntries = await listLayers(historyRoot, rootSig)
    // seed + 3 cascades = 4 markers
    expect(rootEntries.length).toBe(4)
  })
})

// ===================================================
// Step-back render: parent's past `children` sigs resolve to
// on-disk child names by enumerating parent dir + matching against
// each child's bag markers. (Mirrors the renderer's resolveChildNames
// helper in show-cell.drone.ts so the bug "step back shows live disk
// state" can't regress.)
// ===================================================

const resolveChildNamesFromBag = async (
  historyRoot: MockDir,
  parentSegments: string[],
  parentChildSigsWanted: string[],
  onDiskChildNames: string[],
): Promise<Set<string>> => {
  const wanted = new Set(parentChildSigsWanted)
  const out = new Set<string>()
  for (const name of onDiskChildNames) {
    const childLocSig = await signLineage([...parentSegments, name])
    // Fast path: latest marker sig (or seed sig for bagless child).
    const currentSig = await latestMarkerSigFor(historyRoot, childLocSig, name)
    if (wanted.has(currentSig)) { out.add(name); continue }
    // Slow path: walk all markers (covers historical sigs).
    const markers = await listLayers(historyRoot, childLocSig)
    for (const m of markers) {
      if (wanted.has(m.layerSig)) { out.add(name); break }
    }
  }
  return out
}

describe('resolveChildNames — past sigs map back to current on-disk names', () => {
  it('all past children still on disk → all resolve', async () => {
    // Parent /A with children B, C. Both have bags with at least one marker.
    await cascade(historyRoot, ['A', 'B'], { 2: [], 1: ['B', 'C'], 0: ['A'] })
    await cascade(historyRoot, ['A', 'C'], { 2: [], 1: ['B', 'C'], 0: ['A'] })

    // Get /A's current children sigs
    const aContent = await getLayerContent(
      historyRoot,
      await signLineage(['A']),
      (await listLayers(historyRoot, await signLineage(['A']))).slice(-1)[0].layerSig,
    )
    const wanted = aContent?.children ?? []

    const names = await resolveChildNamesFromBag(historyRoot, ['A'], wanted, ['B', 'C'])
    expect([...names].sort()).toEqual(['B', 'C'])
  })

  it('past layer had 1 child; current disk has 2 — only the past one resolves', async () => {
    // Initial: /A has child B
    await cascade(historyRoot, ['A', 'B'], { 2: [], 1: ['B'], 0: ['A'] })
    const aSig = await signLineage(['A'])
    const aPastEntries = await listLayers(historyRoot, aSig)
    const aPastContent = await getLayerContent(historyRoot, aSig, aPastEntries.slice(-1)[0].layerSig)
    const pastChildSigs = aPastContent?.children ?? []
    expect(pastChildSigs.length).toBe(1)

    // Now C is added: /A has B + C
    await cascade(historyRoot, ['A', 'C'], { 2: [], 1: ['B', 'C'], 0: ['A'] })

    // Resolve PAST children sigs against CURRENT disk listing [B, C]
    const names = await resolveChildNamesFromBag(historyRoot, ['A'], pastChildSigs, ['B', 'C'])
    expect([...names]).toEqual(['B'])   // past state had only B; user steps back, sees B only
  })

  it('past children = empty (seed) → resolves to no names; renderer clears union', async () => {
    // Parent /A starts as seed (no children)
    await cascade(historyRoot, ['A'], { 1: [], 0: ['A'] })
    const aSig = await signLineage(['A'])
    const seedEntries = await listLayers(historyRoot, aSig)
    const seedContent = await getLayerContent(historyRoot, aSig, seedEntries[0].layerSig)
    expect(seedContent?.children).toBeUndefined()

    // Later A gains a child B
    await cascade(historyRoot, ['A', 'B'], { 2: [], 1: ['B'], 0: ['A'] })

    // Step back to seed: resolve `undefined` children against disk → empty
    const names = await resolveChildNamesFromBag(historyRoot, ['A'], seedContent?.children ?? [], ['B'])
    expect(names.size).toBe(0)
  })

  it("user's scenario: 1 tile already there, add hello → step back to 1-child layer", async () => {
    // Initial state: root has child "original" with its own bag + first commit.
    await cascade(historyRoot, ['original'], { 1: [], 0: ['original'] })
    // Snapshot root's first commit
    const rootSig = await signLineage([])
    const stepOneEntries = await listLayers(historyRoot, rootSig)
    expect(stepOneEntries.length).toBe(2)   // seed + 1 commit
    const stepOneContent = await getLayerContent(historyRoot, rootSig, stepOneEntries[1].layerSig)
    const stepOneChildren = stepOneContent?.children ?? []
    expect(stepOneChildren.length).toBe(1)

    // User adds "hello" at root: root cascade picks it up + builds children
    // = [original_sig, hello_seed_sig]. hello has NO bag yet.
    await cascade(historyRoot, [], { 0: ['original', 'hello'] })

    const stepTwoEntries = await listLayers(historyRoot, rootSig)
    expect(stepTwoEntries.length).toBe(3)   // seed + 2 commits
    const stepTwoContent = await getLayerContent(historyRoot, rootSig, stepTwoEntries[2].layerSig)
    expect(stepTwoContent?.children?.length).toBe(2)   // 2 sigs ✓ (matches user's observation)

    // Render at HEAD (step 2): on-disk = [original, hello].
    // - 'original' has a bag → currentSig matches step 2's children.
    // - 'hello' has NO bag → currentSig = deterministic empty-seed
    //   sig for "hello", which is EXACTLY what parent's cascade
    //   stored in children (latestMarkerSigFor returns the same
    //   value during commit AND during render). Match!
    // Result: allowed = {original, hello} → renderer keeps both →
    // user sees 2 tiles ✓
    const allowedAtHead = await resolveChildNamesFromBag(historyRoot, [], stepTwoContent?.children ?? [], ['original', 'hello'])
    expect([...allowedAtHead].sort()).toEqual(['hello', 'original'])

    // Render at STEP 1 (after undo): step 1's children = [original_sig_old].
    // - 'original' has a bag with markers including the old sig → allowed.
    // - 'hello' has no bag → its seed sig is NOT in step 1's children
    //   (step 1 was committed before hello existed) → not allowed.
    // Result: allowed = {original} → user sees 1 tile ✓
    const allowedAtStepOne = await resolveChildNamesFromBag(historyRoot, [], stepOneChildren, ['original', 'hello'])
    expect([...allowedAtStepOne]).toEqual(['original'])
  })

  it('past child is no longer on disk → cannot resolve (known limitation)', async () => {
    // /A had child B
    await cascade(historyRoot, ['A', 'B'], { 2: [], 1: ['B'], 0: ['A'] })
    const aSig = await signLineage(['A'])
    const pastContent = await getLayerContent(historyRoot, aSig, (await listLayers(historyRoot, aSig)).slice(-1)[0].layerSig)
    const pastChildSigs = pastContent?.children ?? []

    // B is removed from disk (simulate: only Y on disk now)
    const names = await resolveChildNamesFromBag(historyRoot, ['A'], pastChildSigs, ['Y'])
    expect(names.size).toBe(0)
    // Renderer falls back to live disk in this case — Y is shown,
    // not B. Documented limitation; needs a sig→name index for full
    // historical fidelity.
  })
})

// ===================================================
// END-TO-END SCENARIOS — preloader + cascade + resolve
// ===================================================
//
// "this is the whole point of the exercise" — every sig that lands
// in a parent's children array must resolve via getLayerBySig.
// The renderer uses the resolved name; sigs are content-addressed
// so there's no possibility of getting out of sync.

describe('end-to-end: sig→content lookup is mechanical', () => {
  it('every child sig in a parent layer resolves via getLayerBySig', async () => {
    // Add 3 tiles at root: a, b, c. Cascade once, captures all 3 child sigs.
    await cascade(historyRoot, [], { 0: ['a', 'b', 'c'] })
    const rootSig = await signLineage([])
    const rootEntries = await listLayers(historyRoot, rootSig)
    const rootContent = await getLayerContent(historyRoot, rootSig, rootEntries.slice(-1)[0].layerSig)
    expect(rootContent?.children?.length).toBe(3)

    // Every sig must resolve via the preloader to a layer with the right name.
    const names = await resolveChildNames(historyRoot, rootContent)
    expect([...names].sort()).toEqual(['a', 'b', 'c'])
  })

  it("scenario A: 'add hello → step back to 1-tile' shows just the original tile", async () => {
    // Initial: just `original` exists. Cascade captures 1 child.
    await cascade(historyRoot, [], { 0: ['original'] })
    const rootSig = await signLineage([])
    const stepOne = await listLayers(historyRoot, rootSig)
    const stepOneContent = await getLayerContent(historyRoot, rootSig, stepOne.slice(-1)[0].layerSig)
    expect(stepOneContent?.children?.length).toBe(1)

    // User adds `hello`. Cascade re-fires with both children.
    await cascade(historyRoot, [], { 0: ['original', 'hello'] })
    const stepTwo = await listLayers(historyRoot, rootSig)
    const stepTwoContent = await getLayerContent(historyRoot, rootSig, stepTwo.slice(-1)[0].layerSig)
    expect(stepTwoContent?.children?.length).toBe(2)

    // Render at HEAD (step 2): should resolve to {original, hello}.
    const allowedAtHead = await resolveChildNames(historyRoot, stepTwoContent)
    expect([...allowedAtHead].sort()).toEqual(['hello', 'original'])

    // Render at STEP 1 (one undo): should resolve to {original} only.
    const allowedAtStepOne = await resolveChildNames(historyRoot, stepOneContent)
    expect([...allowedAtStepOne]).toEqual(['original'])
  })

  it("scenario B: stepping back to seed renders empty (no children = render nothing)", async () => {
    await cascade(historyRoot, [], { 0: ['x', 'y', 'z'] })
    const rootSig = await signLineage([])
    const entries = await listLayers(historyRoot, rootSig)

    // Seed (00000000) has no children.
    const seedContent = await getLayerContent(historyRoot, rootSig, entries[0].layerSig)
    expect(seedContent?.children).toBeUndefined()
    const allowed = await resolveChildNames(historyRoot, seedContent)
    expect(allowed.size).toBe(0)
  })

  it('scenario C: multi-level abc/123 — each level resolves independently', async () => {
    // Type abc/123 from root: cascade fires for both /abc (gains '123') and / (gains 'abc').
    await cascade(historyRoot, ['abc'], { 1: ['123'], 0: ['abc'] })

    // Root layer should resolve children to ['abc'].
    const rootSig = await signLineage([])
    const rootContent = await getLayerContent(historyRoot, rootSig, (await listLayers(historyRoot, rootSig)).slice(-1)[0].layerSig)
    const rootNames = await resolveChildNames(historyRoot, rootContent)
    expect([...rootNames]).toEqual(['abc'])

    // /abc layer should resolve to ['123'].
    const abcSig = await signLineage(['abc'])
    const abcContent = await getLayerContent(historyRoot, abcSig, (await listLayers(historyRoot, abcSig)).slice(-1)[0].layerSig)
    const abcNames = await resolveChildNames(historyRoot, abcContent)
    expect([...abcNames]).toEqual(['123'])
  })

  it('scenario D: sig invariant — parent stores child sig that resolves to child layer with that exact sig', async () => {
    await cascade(historyRoot, [], { 0: ['alpha', 'beta'] })
    const rootSig = await signLineage([])
    const rootContent = await getLayerContent(historyRoot, rootSig, (await listLayers(historyRoot, rootSig)).slice(-1)[0].layerSig)
    expect(rootContent?.children?.length).toBe(2)

    // Each stored sig MUST be the actual hash of the child's bytes
    // (no ghost sigs — the preloader can find every one).
    for (const childSig of rootContent?.children ?? []) {
      const childLayer = await getLayerBySig(historyRoot, childSig)
      expect(childLayer).not.toBeNull()
      // Round-trip: re-canonicalize child layer + sha256 → same sig.
      const canonical = canonicalizeLayer(childLayer!)
      const reSig = await sha256Hex(JSON.stringify(canonical))
      expect(reSig).toBe(childSig)
    }
  })

  it('scenario E: cascade preserves cells stable, only changed-child sig swaps', async () => {
    // /A with children B, C. Both have own bags.
    await cascade(historyRoot, ['A', 'B'], { 2: [], 1: ['B', 'C'], 0: ['A'] })
    await cascade(historyRoot, ['A', 'C'], { 2: [], 1: ['B', 'C'], 0: ['A'] })
    const aSig = await signLineage(['A'])
    const aBefore = await getLayerContent(historyRoot, aSig, (await listLayers(historyRoot, aSig)).slice(-1)[0].layerSig)
    const aBeforeChildren = aBefore?.children ?? []
    expect(aBeforeChildren.length).toBe(2)
    const aBeforeNames = await resolveChildNames(historyRoot, aBefore)
    expect([...aBeforeNames].sort()).toEqual(['B', 'C'])

    // B mutates: cascade updates B + /A + root
    await cascade(historyRoot, ['A', 'B'], { 2: ['x'], 1: ['B', 'C'], 0: ['A'] })
    const aAfter = await getLayerContent(historyRoot, aSig, (await listLayers(historyRoot, aSig)).slice(-1)[0].layerSig)
    const aAfterChildren = aAfter?.children ?? []

    // Same length, same names, but ONE sig differs (B's).
    expect(aAfterChildren.length).toBe(2)
    const aAfterNames = await resolveChildNames(historyRoot, aAfter)
    expect([...aAfterNames].sort()).toEqual(['B', 'C'])

    let differingCount = 0
    for (let i = 0; i < aBeforeChildren.length; i++) {
      if (aBeforeChildren[i] !== aAfterChildren[i]) differingCount++
    }
    expect(differingCount).toBe(1)   // exactly one merkle entry changed
  })

  it('scenario F: cold preloader — getLayerBySig walks bags when cache empty', async () => {
    // Build a tree, then ask for a child sig directly (no parent context).
    await cascade(historyRoot, [], { 0: ['gamma', 'delta'] })
    const rootSig = await signLineage([])
    const rootContent = await getLayerContent(historyRoot, rootSig, (await listLayers(historyRoot, rootSig)).slice(-1)[0].layerSig)
    const childSigs = rootContent?.children ?? []
    expect(childSigs.length).toBe(2)

    // Each child sig resolves through the preloader (cold-walks bags).
    for (const sig of childSigs) {
      const found = await getLayerBySig(historyRoot, sig)
      expect(found).not.toBeNull()
      expect(['gamma', 'delta']).toContain(found!.name)
    }

    // Garbage sig: returns null.
    const garbage = await sha256Hex('not-a-real-layer')
    expect(await getLayerBySig(historyRoot, garbage)).toBeNull()
  })
})

// ===================================================
// LAYER↔TILES INVARIANT — for every layer we open, the tiles we
// resolve from its children sigs must match the layer's claim
// ===================================================
//
// "literally do a test that when you open a layer read the contents
//  and get the tiles to compare — needs to match the layer every time"
//
// For every commit on every lineage, this test:
//   1. Opens the layer by its sig (preloader)
//   2. Reads its children sigs from the parsed JSON
//   3. Resolves each child sig → child layer → name (preloader)
//   4. Asserts the resolved name set has the same size as children.length
//   5. Asserts every child sig in children is fetchable
//   6. Asserts the layer JSON's children array byte-equals what we
//      computed (sig invariant: bytes ↔ sig)

const verifyLayerInvariant = async (
  historyRoot: MockDir,
  lineageSig: string,
): Promise<{ markersChecked: number; childrenChecked: number }> => {
  let markersChecked = 0
  let childrenChecked = 0

  const entries = await listLayers(historyRoot, lineageSig)
  for (const entry of entries) {
    // 1. Open the layer by sig
    const layer = await getLayerBySig(historyRoot, entry.layerSig)
    expect(layer, `layer ${entry.layerSig.slice(0, 10)} must resolve via preloader`).not.toBeNull()
    expect(layer!.name, 'layer must have non-empty name').toBeTruthy()
    markersChecked++

    // 2. Read children sigs
    const childSigs = layer!.children ?? []
    if (childSigs.length === 0) continue

    // 3+4. Resolve each child sig → child layer → name. Set size must == childSigs.length.
    const resolvedNames: string[] = []
    for (const childSig of childSigs) {
      const child = await getLayerBySig(historyRoot, childSig)
      expect(child, `child sig ${childSig.slice(0, 10)} must resolve via preloader`).not.toBeNull()
      expect(child!.name, 'child layer must have a name').toBeTruthy()
      resolvedNames.push(child!.name)
      childrenChecked++
    }
    // The preloader must give back EXACTLY one resolution per stored
    // child sig. No drops, no collisions.
    expect(resolvedNames.length).toBe(childSigs.length)

    // 5. Round-trip sig invariant: re-canonicalize the layer + sha256 → same sig.
    const canonical = canonicalizeLayer(layer!)
    const reSig = await sha256Hex(JSON.stringify(canonical))
    expect(reSig, `re-hashing layer JSON must reproduce its sig`).toBe(entry.layerSig)
  }
  return { markersChecked, childrenChecked }
}

describe('layer ↔ tiles invariant: every layer\'s children resolve to real tiles', () => {
  it('1 tile, 1 commit', async () => {
    await cascade(historyRoot, [], { 0: ['only'] })
    const result = await verifyLayerInvariant(historyRoot, await signLineage([]))
    expect(result.markersChecked).toBeGreaterThan(0)
  })

  it('add hello: every step\'s children resolve to current names', async () => {
    await cascade(historyRoot, [], { 0: ['original'] })
    await cascade(historyRoot, [], { 0: ['original', 'hello'] })
    const result = await verifyLayerInvariant(historyRoot, await signLineage([]))
    // seed (no children) + commit1 (1 child) + commit2 (2 children) = 3 markers, 3 child resolutions
    expect(result.markersChecked).toBe(3)
    expect(result.childrenChecked).toBe(3)
  })

  it('multi-level abc/123: invariant holds at root and at /abc', async () => {
    await cascade(historyRoot, ['abc'], { 1: ['123'], 0: ['abc'] })
    const rootResult = await verifyLayerInvariant(historyRoot, await signLineage([]))
    const abcResult = await verifyLayerInvariant(historyRoot, await signLineage(['abc']))
    expect(rootResult.markersChecked).toBeGreaterThan(0)
    expect(abcResult.markersChecked).toBeGreaterThan(0)
  })

  it('cascade with children mutating: every historical state still resolves', async () => {
    // Build a tree, mutate a child several times, verify EVERY step
    // still resolves correctly via the preloader.
    await cascade(historyRoot, ['A', 'B'], { 2: [], 1: ['B', 'C'], 0: ['A'] })
    await cascade(historyRoot, ['A', 'C'], { 2: [], 1: ['B', 'C'], 0: ['A'] })
    await cascade(historyRoot, ['A', 'B'], { 2: ['x'], 1: ['B', 'C'], 0: ['A'] })
    await cascade(historyRoot, ['A', 'B'], { 2: ['x', 'y'], 1: ['B', 'C'], 0: ['A'] })

    // Walk every bag, every marker, verify the invariant.
    const bags = [
      await signLineage([]),
      await signLineage(['A']),
      await signLineage(['A', 'B']),
      await signLineage(['A', 'C']),
    ]
    for (const bag of bags) {
      const result = await verifyLayerInvariant(historyRoot, bag)
      expect(result.markersChecked).toBeGreaterThan(0)
    }
  })

  it('STRICT: parent\'s children sigs are byte-exact hashes of child layer JSON', async () => {
    // The strongest content-addressed claim: the parent's stored
    // child sig MUST equal sha256(canonicalize(child).JSON.stringify).
    // Anything else is a broken sig.
    await cascade(historyRoot, [], { 0: ['x', 'y', 'z'] })
    const rootSig = await signLineage([])
    const rootContent = await getLayerContent(historyRoot, rootSig, (await listLayers(historyRoot, rootSig)).slice(-1)[0].layerSig)

    for (const childSig of rootContent?.children ?? []) {
      const child = await getLayerBySig(historyRoot, childSig)
      expect(child, `child sig ${childSig.slice(0, 10)} must resolve`).not.toBeNull()

      // sha256 of the canonical child JSON must equal the parent's stored sig.
      const recomputed = await sha256Hex(JSON.stringify(canonicalizeLayer(child!)))
      expect(recomputed, `child sig ${childSig.slice(0, 10)} ≠ sha256(child JSON)`).toBe(childSig)
    }
  })

  it('STALE SIG: parent stored a sig whose bytes were never written → preloader returns null → 0 tiles', async () => {
    // Simulate the user's pre-fix data: a parent layer whose children
    // array contains a sig that has no backing bytes anywhere on disk
    // (this is what happened when latestMarkerSigFor returned a
    // deterministic seed sig WITHOUT writing the seed bytes).
    const rootSig = await signLineage([])
    const ghostSig = await sha256Hex('{"name":"phantom","cells":[],"hidden":[]}')   // legacy schema, never written
    const root = await historyRoot.getDirectoryHandle(rootSig, { create: true })
    await ensureSeed(root, '/')
    const layerJson = JSON.stringify({ name: '/', children: [ghostSig] })
    await writeBytes(root, '00000001', new TextEncoder().encode(layerJson))

    // Open the layer: it parses fine.
    const entries = await listLayers(historyRoot, rootSig)
    const headContent = await getLayerContent(historyRoot, rootSig, entries.slice(-1)[0].layerSig)
    expect(headContent?.children).toEqual([ghostSig])

    // But the ghost sig has no bytes anywhere. Preloader returns null.
    expect(await getLayerBySig(historyRoot, ghostSig)).toBeNull()

    // resolveChildNames returns 0 — exactly what the user observed
    // ("click #1 → nothing" with the old data).
    const names = await resolveChildNames(historyRoot, headContent)
    expect(names.size).toBe(0)
    // FIX: the user must /compact to rebuild children sigs against
    // freshly-materialized child bags (latestMarkerSigFor now writes
    // real bytes). After /compact, the sig→content invariant holds.
  })

  it('AFTER /compact: stale sigs are replaced with materialized ones, all resolve', async () => {
    // Start with a stale layer like above
    const rootSig = await signLineage([])
    const ghostSig = await sha256Hex('{"name":"phantom-x","cells":[]}')
    const root = await historyRoot.getDirectoryHandle(rootSig, { create: true })
    await ensureSeed(root, '/')
    await writeBytes(root, '00000001', new TextEncoder().encode(JSON.stringify({ name: '/', children: [ghostSig] })))

    // /compact wipe-and-rebuild: drop all markers, re-cascade with
    // CURRENT on-disk children. Since the spec mock doesn't model
    // hypercomb.io tile dirs, we just simulate the rebuild step:
    // remove everything, cascade fresh.
    for await (const [name] of root.entries()) {
      try { await root.removeEntry(name) } catch { /* */ }
    }
    await cascade(historyRoot, [], { 0: ['real-tile'] })

    // Now every sig in the rebuilt root layer must resolve.
    const result = await verifyLayerInvariant(historyRoot, rootSig)
    expect(result.markersChecked).toBeGreaterThan(0)
    expect(result.childrenChecked).toBeGreaterThan(0)
  })

  it('NEVER load by name or disk: getLayerBySig is the ONLY resolution path', async () => {
    // Build a parent with a child, then DELETE the child's on-disk
    // bag. The preloader's cold-walk should still find the child
    // layer (it's the markers in OPFS, not the dir tree on hypercomb.io).
    // Actually the bag IS in OPFS, so this test is structural — it
    // proves the resolver doesn't depend on the explorer dir tree
    // (no parentDir, no parentSegments, no name list).
    await cascade(historyRoot, [], { 0: ['solo'] })
    const rootSig = await signLineage([])
    const rootContent = await getLayerContent(historyRoot, rootSig, (await listLayers(historyRoot, rootSig)).slice(-1)[0].layerSig)
    const childSig = rootContent?.children?.[0]
    expect(childSig).toBeTruthy()

    // The resolver takes ONLY a sig. Nothing else.
    const child = await getLayerBySig(historyRoot, childSig!)
    expect(child?.name).toBe('solo')
  })
})

// Sanity: dirExists/opfsRoot are used in the test setup; satisfy linter
void dirExists
void opfsRoot
