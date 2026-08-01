// hypercomb-shared/core/packed-store-engine.ts
//
// THE PACKED STORE — every small record of a hive in ONE file.
//
// This is the web port of `hypercomb-client/crates/store/` (redb). The native
// client proved the hive's slowness was never rendering: it was one-file-per-
// record storage — thousands of OPFS open/close broker hops and per-file AV
// scans. Measured: 11ms cold-open native vs 13.6s flat scan over 603 bags /
// 8,006 markers. The bytes are trivial; the *file operations* are not.
//
// The entire navigable structure of a hive is a few megabytes, so it is simply
// resident: ONE sequential read at open builds the whole index. Head lookup is
// then a map max — the packed analogue of redb's "markers keyed
// `bag ++ big-endian index`, so the maximum key IS the head". There is nothing
// left to cache, which is why the localStorage head index in HistoryService is
// DELETED in packed mode rather than kept (see `crates/store/src/lib.rs`,
// "do not port the head index" — this is the inverse).
//
// ## The split (mirrors `BLOB_THRESHOLD` native)
//
// | Content                                        | Storage                |
// |------------------------------------------------|------------------------|
// | markers, layers, pool members, small resources | this one packed file   |
// | blobs >= 64KiB (images)                        | loose sig-named files  |
//
// Loose blobs live as `<real OPFS root>/<sig>` — exactly where the flat
// layout already put them, so large content NEVER migrates. The packed file
// itself lives inside the `sign('store:packed')` pool directory (a
// colon-carrying meaning: collision-proof by the lineage-key rule, and a
// signed address rather than a banned typed folder).
//
// ## File format
//
// An append-only log. Compact, torn-write-safe, rebuilt into memory at open:
//
//   MAGIC "HCPACK01" (8 bytes)
//   record*:
//     u32 LE bodyLen                  (kind + keyLen field + key + value)
//     body:
//       u8  kind                      (put/tombstone x content/marker/pool)
//       u16 LE keyLen
//       key bytes                     (content: 32 sig bytes;
//                                      marker: 32 bag + 4 BE index;
//                                      pool:   32 pool + utf8 member name)
//     u32 LE crc32(body)
//
// A record whose length field, bounds, or CRC does not check out marks the
// torn tail of an interrupted write: everything before it is intact (appends
// never rewrite), the scan stops there, and the next append truncates the
// torn bytes. Tombstones exist because markers and pool members are REAL
// deletes (they are not layers and not in the history graph), while content
// is removed only by explicit sweep from the garbage collector.
//
// ## Internal representation is not the protocol
//
// `documentation/protocol/conformance.md` §7 defines a portable interchange
// form, not an on-disk mandate. This file stores however it likes; the worker
// serves the interchange shape (flat sig files, sigbags, pools) live through
// the `native-filesystem.ts` facade, and export/restore round-trips it.
//
// The engine is PURE: it computes nothing async, owns no OPFS handle and no
// crypto — signatures come from the caller. `SyncFile` is the seam that makes
// it testable in vitest and bindable to an OPFS `SyncAccessHandle` in the
// worker, which is the only place the sync API exists.

/** The synchronous byte-file the engine runs over. In the worker this wraps
 *  an OPFS `FileSystemSyncAccessHandle`; in tests, a growable buffer. */
export interface SyncFile {
  getSize(): number
  /** Read `length` bytes at `offset` into a fresh array (may be short at EOF). */
  read(offset: number, length: number): Uint8Array
  write(offset: number, bytes: Uint8Array): void
  truncate(size: number): void
  flush(): void
}

/** Content at or above this size goes to a loose sig-named file rather than
 *  the packed log. Mirrors `hypercomb_store::BLOB_THRESHOLD`. */
export const BLOB_THRESHOLD = 64 * 1024

export const PACK_MAGIC = new TextEncoder().encode('HCPACK01')

/** The pool of meaning whose directory physically houses the packed file.
 *  Colon-carrying by the collision rule: a lineage key can never produce a
 *  colon, so this address collides with no tile's bag. */
export const PACKED_STORE_MEANING = 'store:packed'

/** The packed log's filename inside the sign('store:packed') pool dir. */
export const PACK_FILENAME = 'hive.pack'

const enum Kind {
  Content = 1,
  Marker = 2,
  Pool = 3,
  TombMarker = 18,
  TombPool = 19,
  /** Only the garbage collector sweeps content — see `removeContent`. */
  TombContent = 17,
}

/** 8-digit marker filename — the interchange spelling of a marker index. */
export const markerFilename = (index: number): string => String(index).padStart(8, '0')

/** Strict interchange rule: an 8-digit name is a marker, anything else is a
 *  pool member. NEVER classify directories — a bare-word pool and a
 *  same-named tile's bag are ONE address. */
export const markerIndexOf = (name: string): number | null =>
  /^\d{8}$/.test(name) ? Number(name) : null

const SIG_HEX = /^[0-9a-f]{64}$/i

export const isSigName = (name: string): boolean => SIG_HEX.test(name)

export const hexToBytes = (hex: string): Uint8Array => {
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return out
}

/** byte -> two hex chars. Open converts a 32-byte key per record across
 *  thousands of records, so the table is not premature: it is most of the
 *  cold-open cost. */
const HEX_BYTE = Array.from({ length: 256 }, (_, b) => b.toString(16).padStart(2, '0'))

export const bytesToHex = (bytes: Uint8Array): string => {
  let out = ''
  for (let i = 0; i < bytes.length; i++) out += HEX_BYTE[bytes[i]]
  return out
}

// CRC-32 (IEEE), table-driven. Guards every record body so a torn append is
// detected at open rather than parsed as garbage.
const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

export const crc32 = (bytes: Uint8Array): number => {
  let crc = 0xffffffff
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

interface ValueRef {
  /** Absolute file offset of the VALUE bytes within the record. */
  offset: number
  length: number
}

/** One raw listing entry, matching the facade's `RawEntry`. */
export interface PackedEntry {
  name: string
  directory: boolean
}

export interface PackedStats {
  contentRecords: number
  bags: number
  markers: number
  pools: number
  poolMembers: number
  fileSize: number
  /** Bytes belonging to superseded or tombstoned records — reclaimable by
   *  compaction. */
  garbageBytes: number
}

/**
 * The resident index plus the append tail. One instance per packed file,
 * owned by exactly one worker — OPFS enforces the exclusivity by refusing a
 * second `SyncAccessHandle`.
 */
export class PackedStoreEngine {
  /** content sig hex -> value location */
  readonly #content = new Map<string, ValueRef>()
  /** bag sig hex -> (index -> value location). */
  readonly #markers = new Map<string, Map<number, ValueRef>>()
  /** pool sig hex -> (member name -> value location) */
  readonly #pools = new Map<string, Map<string, ValueRef>>()

  #end = 0
  #garbageBytes = 0

  private constructor(private readonly file: SyncFile) {}

  /**
   * Open a packed file: ONE sequential read, parse every record into the
   * resident index. This is the whole cold boot — the 13.6s flat scan
   * becomes this method.
   */
  static open(file: SyncFile): PackedStoreEngine {
    const engine = new PackedStoreEngine(file)
    const size = file.getSize()

    if (size < PACK_MAGIC.length) {
      // Fresh (or hopelessly short) file: stamp the magic and start empty.
      file.truncate(0)
      file.write(0, PACK_MAGIC)
      file.flush()
      engine.#end = PACK_MAGIC.length
      return engine
    }

    const bytes = file.read(0, size)
    for (let i = 0; i < PACK_MAGIC.length; i++) {
      if (bytes[i] !== PACK_MAGIC[i]) {
        throw new Error('[packed-store] not a hive.pack file — refusing to touch it')
      }
    }

    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    let at = PACK_MAGIC.length
    while (at + 4 <= size) {
      const bodyLen = view.getUint32(at, true)
      const bodyAt = at + 4
      const crcAt = bodyAt + bodyLen
      // Bounds or CRC failure = the torn tail of an interrupted append.
      // Everything before `at` is intact; stop here and let the next append
      // truncate the torn bytes.
      if (bodyLen < 3 || crcAt + 4 > size) break
      const body = bytes.subarray(bodyAt, crcAt)
      if (view.getUint32(crcAt, true) !== crc32(body)) break

      const kind = body[0]
      const keyLen = body[1] | (body[2] << 8)
      if (3 + keyLen > bodyLen) break
      const key = body.subarray(3, 3 + keyLen)
      const value: ValueRef = { offset: bodyAt + 3 + keyLen, length: bodyLen - 3 - keyLen }
      engine.#apply(kind, key, value)
      at = crcAt + 4
    }
    engine.#end = at
    return engine
  }

  /** Route one parsed (or freshly appended) record into the index. */
  #apply(kind: number, key: Uint8Array, value: ValueRef): void {
    switch (kind) {
      case Kind.Content: {
        const sig = bytesToHex(key)
        const prior = this.#content.get(sig)
        if (prior) this.#garbageBytes += prior.length
        this.#content.set(sig, value)
        break
      }
      case Kind.TombContent: {
        const sig = bytesToHex(key)
        const prior = this.#content.get(sig)
        if (prior) this.#garbageBytes += prior.length
        this.#content.delete(sig)
        break
      }
      case Kind.Marker: {
        const bag = bytesToHex(key.subarray(0, 32))
        const index =
          (key[32] << 24) | (key[33] << 16) | (key[34] << 8) | key[35]
        let map = this.#markers.get(bag)
        if (!map) this.#markers.set(bag, (map = new Map()))
        const prior = map.get(index >>> 0)
        if (prior) this.#garbageBytes += prior.length
        map.set(index >>> 0, value)
        break
      }
      case Kind.TombMarker: {
        const bag = bytesToHex(key.subarray(0, 32))
        const index =
          ((key[32] << 24) | (key[33] << 16) | (key[34] << 8) | key[35]) >>> 0
        const map = this.#markers.get(bag)
        const prior = map?.get(index)
        if (prior) this.#garbageBytes += prior.length
        map?.delete(index)
        if (map && map.size === 0) this.#markers.delete(bag)
        break
      }
      case Kind.Pool: {
        const pool = bytesToHex(key.subarray(0, 32))
        const name = new TextDecoder().decode(key.subarray(32))
        let map = this.#pools.get(pool)
        if (!map) this.#pools.set(pool, (map = new Map()))
        const prior = map.get(name)
        if (prior) this.#garbageBytes += prior.length
        map.set(name, value)
        break
      }
      case Kind.TombPool: {
        const pool = bytesToHex(key.subarray(0, 32))
        const name = new TextDecoder().decode(key.subarray(32))
        const map = this.#pools.get(pool)
        const prior = map?.get(name)
        if (prior) this.#garbageBytes += prior.length
        map?.delete(name)
        if (map && map.size === 0) this.#pools.delete(pool)
        break
      }
      default:
        // Unknown kinds are skipped, not fatal: a newer writer may add kinds
        // an older reader can safely ignore (the CRC already proved the
        // record intact).
        break
    }
  }

  /** Append one record and index it. */
  #append(kind: Kind, key: Uint8Array, value: Uint8Array): void {
    const bodyLen = 3 + key.length + value.length
    const record = new Uint8Array(4 + bodyLen + 4)
    const view = new DataView(record.buffer)
    view.setUint32(0, bodyLen, true)
    record[4] = kind
    record[5] = key.length & 0xff
    record[6] = (key.length >> 8) & 0xff
    record.set(key, 7)
    record.set(value, 7 + key.length)
    const body = record.subarray(4, 4 + bodyLen)
    view.setUint32(4 + bodyLen, crc32(body), true)

    // If a previous session tore its tail, the parse stopped at #end —
    // truncate the torn bytes exactly once, then append.
    if (this.file.getSize() > this.#end) this.file.truncate(this.#end)
    this.file.write(this.#end, record)
    this.file.flush()

    const valueAt = this.#end + 4 + 3 + key.length
    this.#end += record.length
    this.#apply(kind, key, { offset: valueAt, length: value.length })
  }

  #read(ref: ValueRef): Uint8Array {
    return this.file.read(ref.offset, ref.length)
  }

  #markerKey(bagHex: string, index: number): Uint8Array {
    const key = new Uint8Array(36)
    key.set(hexToBytes(bagHex), 0)
    key[32] = (index >>> 24) & 0xff
    key[33] = (index >>> 16) & 0xff
    key[34] = (index >>> 8) & 0xff
    key[35] = index & 0xff
    return key
  }

  #poolKey(poolHex: string, name: string): Uint8Array {
    const nameBytes = new TextEncoder().encode(name)
    const key = new Uint8Array(32 + nameBytes.length)
    key.set(hexToBytes(poolHex), 0)
    key.set(nameBytes, 32)
    return key
  }

  // -------------------------------------------------------------------
  // content
  // -------------------------------------------------------------------

  /** Store content under its signature. Idempotent by construction: if the
   *  sig is present the bytes are by definition identical. The CALLER signs —
   *  the engine trusts the sig it is handed, and the worker verifies before
   *  calling. */
  putContent(sigHex: string, bytes: Uint8Array): void {
    if (this.#content.has(sigHex)) return
    this.#append(Kind.Content, hexToBytes(sigHex), bytes)
  }

  getContent(sigHex: string): Uint8Array | null {
    const ref = this.#content.get(sigHex)
    return ref ? this.#read(ref) : null
  }

  hasContent(sigHex: string): boolean {
    return this.#content.has(sigHex)
  }

  /** Permanently drop content. ONLY the garbage collector may call this —
   *  removing a tile appends a new layer and deletes nothing. */
  sweepContent(sigHex: string): boolean {
    if (!this.#content.has(sigHex)) return false
    this.#append(Kind.TombContent, hexToBytes(sigHex), new Uint8Array())
    return true
  }

  contentSigs(): string[] {
    return [...this.#content.keys()]
  }

  // -------------------------------------------------------------------
  // markers
  // -------------------------------------------------------------------

  /** The head of a bag — its maximum marker index — without enumeration.
   *  The packed analogue of redb's reverse range scan. */
  head(bagHex: string): { index: number; bytes: Uint8Array } | null {
    const map = this.#markers.get(bagHex)
    if (!map || map.size === 0) return null
    let max = -1
    for (const index of map.keys()) if (index > max) max = index
    return { index: max, bytes: this.#read(map.get(max)!) }
  }

  /** Write a marker at a specific index (restore semantics: preserve, never
   *  renumber). Refuses to overwrite an occupied index. */
  putMarkerAt(bagHex: string, index: number, bytes: Uint8Array): boolean {
    if (this.#markers.get(bagHex)?.has(index)) return false
    this.#append(Kind.Marker, this.#markerKey(bagHex, index), bytes)
    return true
  }

  /** Write a marker at an index, OVERWRITING an occupant — the facade path,
   *  where the caller chose the filename (opportunistic shape migration
   *  rewrites a marker in place). Identical bytes are a no-op. */
  setMarker(bagHex: string, index: number, bytes: Uint8Array): void {
    const existing = this.#markers.get(bagHex)?.get(index)
    if (existing && existing.length === bytes.length) {
      const prior = this.#read(existing)
      let same = true
      for (let i = 0; i < bytes.length; i++) if (prior[i] !== bytes[i]) { same = false; break }
      if (same) return
    }
    this.#append(Kind.Marker, this.#markerKey(bagHex, index), bytes)
  }

  getMarker(bagHex: string, index: number): Uint8Array | null {
    const ref = this.#markers.get(bagHex)?.get(index)
    return ref ? this.#read(ref) : null
  }

  /** A REAL delete — history compaction genuinely removes revisions. */
  removeMarker(bagHex: string, index: number): boolean {
    if (!this.#markers.get(bagHex)?.has(index)) return false
    this.#append(Kind.TombMarker, this.#markerKey(bagHex, index), new Uint8Array())
    return true
  }

  /** Every marker index in a bag, ascending. */
  markerIndices(bagHex: string): number[] {
    const map = this.#markers.get(bagHex)
    return map ? [...map.keys()].sort((a, b) => a - b) : []
  }

  bags(): string[] {
    return [...this.#markers.keys()]
  }

  // -------------------------------------------------------------------
  // pools
  // -------------------------------------------------------------------

  putPool(poolHex: string, name: string, bytes: Uint8Array): void {
    // A member already present with identical bytes is a no-op — keeps
    // "did this change anything?" a truthful answer and the log lean.
    const existing = this.#pools.get(poolHex)?.get(name)
    if (existing && existing.length === bytes.length) {
      const prior = this.#read(existing)
      let same = true
      for (let i = 0; i < bytes.length; i++) if (prior[i] !== bytes[i]) { same = false; break }
      if (same) return
    }
    this.#append(Kind.Pool, this.#poolKey(poolHex, name), bytes)
  }

  getPool(poolHex: string, name: string): Uint8Array | null {
    const ref = this.#pools.get(poolHex)?.get(name)
    return ref ? this.#read(ref) : null
  }

  /** A REAL delete — pool members are not layers and not in the history
   *  graph. */
  removePool(poolHex: string, name: string): boolean {
    if (!this.#pools.get(poolHex)?.has(name)) return false
    this.#append(Kind.TombPool, this.#poolKey(poolHex, name), new Uint8Array())
    return true
  }

  poolMembers(poolHex: string): string[] {
    const map = this.#pools.get(poolHex)
    return map ? [...map.keys()] : []
  }

  pools(): string[] {
    return [...this.#pools.keys()]
  }

  // -------------------------------------------------------------------
  // listings — the interchange shape, served live
  // -------------------------------------------------------------------

  /** Everything inside a sig-named directory: markers AND pool members
   *  together, since a colliding address is a bag and a pool at once. */
  dirEntries(sigHex: string): PackedEntry[] {
    const out: PackedEntry[] = []
    for (const index of this.markerIndices(sigHex)) {
      out.push({ name: markerFilename(index), directory: false })
    }
    for (const name of this.poolMembers(sigHex)) {
      out.push({ name, directory: false })
    }
    return out
  }

  /** The virtual root: content sigs as files, bag/pool addresses as
   *  directories (de-duplicated — a colliding address is ONE directory). */
  rootEntries(): PackedEntry[] {
    const out: PackedEntry[] = []
    for (const sig of this.#content.keys()) out.push({ name: sig, directory: false })
    const dirs = new Set<string>([...this.#markers.keys(), ...this.#pools.keys()])
    for (const name of dirs) out.push({ name, directory: true })
    return out
  }

  stats(): PackedStats {
    let members = 0
    for (const map of this.#pools.values()) members += map.size
    let markers = 0
    for (const map of this.#markers.values()) markers += map.size
    return {
      contentRecords: this.#content.size,
      bags: this.#markers.size,
      markers,
      pools: this.#pools.size,
      poolMembers: members,
      fileSize: this.#end,
      garbageBytes: this.#garbageBytes,
    }
  }

  /**
   * Write every LIVE record into a fresh file, dropping superseded values and
   * tombstoned entries. The caller owns the swap (move new over old) — the
   * engine only produces a complete, valid image. Returns the new engine over
   * `target`.
   */
  compactInto(target: SyncFile): PackedStoreEngine {
    target.truncate(0)
    target.write(0, PACK_MAGIC)
    target.flush()
    const fresh = new PackedStoreEngine(target)
    fresh.#end = PACK_MAGIC.length
    for (const [sig, ref] of this.#content) {
      fresh.#append(Kind.Content, hexToBytes(sig), this.#read(ref))
    }
    for (const [bag, map] of this.#markers) {
      for (const index of [...map.keys()].sort((a, b) => a - b)) {
        fresh.#append(Kind.Marker, fresh.#markerKey(bag, index), this.#read(map.get(index)!))
      }
    }
    for (const [pool, map] of this.#pools) {
      for (const [name, ref] of map) {
        fresh.#append(Kind.Pool, fresh.#poolKey(pool, name), this.#read(ref))
      }
    }
    return fresh
  }
}

/** A growable in-memory SyncFile — the vitest stand-in for a SyncAccessHandle. */
export class MemorySyncFile implements SyncFile {
  #bytes = new Uint8Array(0)

  getSize(): number {
    return this.#bytes.length
  }

  read(offset: number, length: number): Uint8Array {
    return this.#bytes.slice(offset, offset + length)
  }

  write(offset: number, bytes: Uint8Array): void {
    if (offset + bytes.length > this.#bytes.length) {
      const grown = new Uint8Array(offset + bytes.length)
      grown.set(this.#bytes)
      this.#bytes = grown
    }
    this.#bytes.set(bytes, offset)
  }

  truncate(size: number): void {
    if (size < this.#bytes.length) this.#bytes = this.#bytes.slice(0, size)
    else if (size > this.#bytes.length) {
      const grown = new Uint8Array(size)
      grown.set(this.#bytes)
      this.#bytes = grown
    }
  }

  flush(): void {}

  /** Test hook: corrupt the tail to simulate a torn append. */
  chopTail(bytes: number): void {
    this.truncate(Math.max(0, this.#bytes.length - bytes))
  }
}
