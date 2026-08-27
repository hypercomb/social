// hypercomb-shared/core/native-filesystem.ts
//
// A FileSystemDirectoryHandle implementation backed by the native store.
//
// LIVES IN `shared`, NOT IN THE CLIENT. This is shell-level plumbing — the same
// category as bootstrapping and file installation — and `Store` imports it
// directly. Putting it in `hypercomb-client` would make `shared` depend on a
// shell, inverting the dependency direction.
//
// It is inert in a browser: `nativeAvailable()` is false, `nativeRoot()`
// returns null, and `Store` keeps using OPFS with nothing changed.
//
// WHY THIS EXISTS
//
// 44 files in the shell reach past `Store`'s methods and use the File System
// API directly against `hypercombRoot` / `opfsRoot`. A drop-in native `Store`
// therefore cannot work — the callers do not go through it.
//
// Rather than refactor 44 files (weeks, and it touches drones), this implements
// the ~10 File System API methods they actually use, backed by IPC. Every one
// of those files then runs unmodified.
//
// THE VIRTUAL LAYOUT IS THE INTERCHANGE FORM
//
// This is not an arbitrary mapping. What the shim exposes is exactly the
// portable interchange form (`documentation/protocol/conformance.md` §7) —
// the same shape `export`/`restore` already produce, served live instead of
// batched:
//
//   <root>/<sig>            content bytes (a FILE)
//   <root>/<lineageSig>/    a bag — 8-digit marker files
//   <root>/<sign(meaning)>/ a pool — arbitrarily-named member files
//
// A sig-named directory may be a bag, a pool, or BOTH — for a bare-word
// meaning the two addresses are byte-identical. The shim never tries to
// classify the directory. It classifies each ENTRY: an 8-digit name is a
// marker, anything else is a pool member. That is the same rule `restore` uses,
// and it is why a colliding address works correctly without ever guessing.
//
// DELETION
//
// `removeEntry` on content is a NO-OP, and that is the model rather than a
// limitation. Every layer is atomic and complete: removing a tile appends a new
// layer with one less child, and the old layer remains history, still pointed
// at by its own marker. Content is reclaimed only by collection, and only when
// no committed layer ever referenced it.
//
// `removeEntry` on a marker or a pool member IS a real delete — those are not
// layers and not in the history graph.
//
// WHAT IS DELIBERATELY NOT IMPLEMENTED
//
// `createSyncAccessHandle` (worker-only sync access) has no call sites in the
// shell and no sane IPC analogue. It throws rather than silently misbehaving.

import { poolMeanings } from '@hypercomb/core'

type Invoke = (
  command: string,
  payload?: unknown,
  options?: { headers?: Record<string, string> },
) => Promise<unknown>

interface RawEntry {
  name: string
  directory: boolean
}

const SIG = /^[0-9a-f]{64}$/i
const MARKER = /^\d{8}$/

/** The drain-era spelling of a pool: a meaning fenced in double underscores.
 *  Matched as a SHAPE, never as a list of folder names — the fence is stripped
 *  and the registry decides what the meaning is, so this file names no typed
 *  folder and needs no edit when a pool is minted or a drain completes. */
const FENCED = /^__([a-z][a-z0-9_-]*)__$/

/** The bridge to the native host. Injected so this file stays testable and
 *  carries no Tauri import — the shell must not depend on the desktop runtime
 *  to compile. */
export interface NativeBridge {
  invoke: Invoke
}

/** Is the native host present? False in a browser, where the shell keeps using
 *  OPFS unchanged. */
export const nativeAvailable = (): boolean =>
  typeof (globalThis as any).__TAURI__?.core?.invoke === 'function'

// ---------------------------------------------------------------------------
// TRANSPORT DISCIPLINE
//
// WebView2's IPC dies under a burst, and a dead call is NEVER reported.
//
// Measured on a real hive (renderer.log, two restarts in three): moments after
// the first tile paints, the image reads go out — `content_get_raw` per visible
// tile, unbounded, tens of them, hundreds of KB each — and the channel
// collapses:
//
//   IPC custom protocol failed, Tauri will now use the postMessage interface
//   instead TypeError: Failed to fetch          at r.read → r.getFile
//   [TAURI] Couldn't find callback id 1758429260
//
// The second line is the damage. A lost callback id is a promise that never
// settles, so every tile waiting on one of those reads stays picture-less for
// the WHOLE session — and `putPoolDoc` dies in the same burst, so the optimized
// rendition is never minted and the next restart repeats it. "Empty pictures
// on every restart" is exactly this.
//
// Two rules, both cheap:
//
//   1. BOUND THE BURST. At most `IN_FLIGHT_MAX` raw calls at once; the rest
//      queue. The channel survives what it can actually carry, and total
//      throughput is unchanged — the reads were serialized by the host anyway.
//   2. NEVER WAIT FOREVER. A call that has not settled inside `TIMEOUT_MS` is
//      treated as lost: retried if the command is safe to repeat, rejected
//      otherwise. A rejection surfaces as a missing picture that the next
//      render retries; a hang is permanent.
//
// Content reads prefer the `hive://` scheme (see `nativeContentUrl`) and never
// reach this path at all — this is the floor under everything else.
// ---------------------------------------------------------------------------

const IN_FLIGHT_MAX = 6
const TIMEOUT_MS = 15_000
const RETRIES = 2

/** Commands that may be repeated after a lost call.
 *
 *  Reads are trivially safe. The writes here are safe because every one of them
 *  is addressed BY VALUE — content by its own signature, a marker at an
 *  explicit index, a pool member under a caller-chosen key — so repeating one
 *  writes the same bytes to the same address. An APPEND is not in this set and
 *  never may be: repeating it would mint a second marker. */
const REPEATABLE = new Set([
  'content_get_raw', 'content_get', 'content_has',
  'dir_get_raw', 'raw_dir_get', 'raw_dir_entries', 'raw_root_entries',
  'pool_get', 'pool_list',
  'content_put_raw', 'content_put', 'dir_put_raw', 'pool_put',
])

let inFlight = 0
const queued: Array<() => void> = []

const acquire = (): Promise<void> => {
  if (inFlight < IN_FLIGHT_MAX) {
    inFlight++
    return Promise.resolve()
  }
  return new Promise<void>(resume => queued.push(() => { inFlight++; resume() }))
}

const release = (): void => {
  inFlight--
  queued.shift()?.()
}

/** A call that never settles, made visible. Distinct so callers can tell a lost
 *  transport from a store that answered "no". */
const lostCall = (command: string): Error =>
  Object.assign(
    new Error(`[hypercomb] native call '${command}' did not answer in ${TIMEOUT_MS}ms`),
    { kind: 'Timeout' },
  )

const withTimeout = async (command: string, call: Promise<unknown>): Promise<unknown> => {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      call,
      new Promise((_, reject) => { timer = setTimeout(() => reject(lostCall(command)), TIMEOUT_MS) }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

/** Wrap the host's `invoke` in the two rules above. */
const disciplined = (invoke: Invoke): Invoke => async (command, payload, options) => {
  const attempts = REPEATABLE.has(command) ? RETRIES + 1 : 1
  for (let attempt = 1; ; attempt++) {
    await acquire()
    try {
      return await withTimeout(command, invoke(command, payload, options))
    } catch (error) {
      // Only a LOST call is retried. A store that answered — NotFound, a bad
      // signature, a refusal — answered, and repeating it would just ask again.
      if ((error as { kind?: string })?.kind !== 'Timeout' || attempt >= attempts) throw error
      console.warn(`[hypercomb] native call '${command}' lost — retry ${attempt}/${attempts - 1}`)
    } finally {
      release()
    }
  }
}

/** The ambient bridge, when running inside the native window. */
export const ambientBridge = (): NativeBridge | null =>
  nativeAvailable() ? { invoke: disciplined((globalThis as any).__TAURI__.core.invoke) } : null

// ---------------------------------------------------------------------------
// files
// ---------------------------------------------------------------------------

class NativeWritable {
  #chunks: Uint8Array[] = []

  constructor(private readonly commit: (bytes: Uint8Array) => Promise<void>) {}

  async write(data: unknown): Promise<void> {
    // Mirrors the real FileSystemWritableFileStream, which accepts a blob, a
    // buffer source, a string, or a {type:'write'} command record.
    //
    // ORDER MATTERS. A Blob also has a `.type` property (its MIME), so a
    // naive `'type' in data` check swallows every Blob as a malformed
    // command record and silently writes ZERO bytes — which then fails the
    // shim's content-address check on close. Byte-shaped inputs are
    // recognized first; only plain command records reach the record branch.
    if (
      data instanceof Uint8Array ||
      data instanceof ArrayBuffer ||
      ArrayBuffer.isView(data) ||
      typeof data === 'string' ||
      (typeof Blob !== 'undefined' && data instanceof Blob)
    ) {
      this.#chunks.push(await toBytes(data))
      return
    }
    if (data && typeof data === 'object' && 'type' in (data as any)) {
      const record = data as { type: string; data?: unknown }
      if (record.type !== 'write') return
      return this.write(record.data)
    }
    this.#chunks.push(await toBytes(data))
  }

  async truncate(): Promise<void> {
    this.#chunks = []
  }

  async close(): Promise<void> {
    const total = this.#chunks.reduce((n, c) => n + c.byteLength, 0)
    const joined = new Uint8Array(total)
    let at = 0
    for (const chunk of this.#chunks) {
      joined.set(chunk, at)
      at += chunk.byteLength
    }
    await this.commit(joined)
  }

  async abort(): Promise<void> {
    this.#chunks = []
  }
}

const toBytes = async (data: unknown): Promise<Uint8Array> => {
  if (data instanceof Uint8Array) return data
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  }
  if (typeof Blob !== 'undefined' && data instanceof Blob) {
    return new Uint8Array(await data.arrayBuffer())
  }
  if (typeof data === 'string') return new TextEncoder().encode(data)
  if (data == null) return new Uint8Array()
  return new TextEncoder().encode(String(data))
}

class NativeFileHandle {
  readonly kind = 'file' as const

  constructor(
    readonly name: string,
    private readonly read: () => Promise<Uint8Array | null>,
    private readonly commit: (bytes: Uint8Array) => Promise<void>,
  ) {}

  async getFile(): Promise<File> {
    const bytes = (await this.read()) ?? new Uint8Array()
    // A File, not a Blob — callers read `.name`, `.lastModified` and `.size`.
    // lastModified is 0: content is immutable and addressed by signature, so
    // there is no modification time to report and inventing one would be a lie
    // that some cache could come to depend on.
    return new File([bytes as BlobPart], this.name, { lastModified: 0 })
  }

  async createWritable(): Promise<NativeWritable> {
    return new NativeWritable(this.commit)
  }

  async isSameEntry(other: unknown): Promise<boolean> {
    return other instanceof NativeFileHandle && other.name === this.name
  }
}

// ---------------------------------------------------------------------------
// directories
// ---------------------------------------------------------------------------

/**
 * A sig-named directory: a bag, a pool, or both.
 *
 * POOLS NEST ONE LEVEL. `Store.putPoolDoc` writes document pools as
 * `<pool>/<sign(subKey)>/<sig>` — a sub-bucket directory inside the pool. So
 * the layout is up to three levels, not two.
 *
 * A sub-bucket is represented as a **prefixed member key** (`<subSig>/<name>`),
 * which needs no change to the store: pool keys are arbitrary strings. This
 * class carries that prefix, so the same implementation serves both the pool
 * itself and any sub-bucket inside it.
 *
 * Listing collapses correctly: a member whose key contains the prefix and no
 * further `/` is a FILE; a deeper key contributes its next segment once, as a
 * DIRECTORY. That distinction is load-bearing — `putPoolDoc` prunes prior
 * members with a `kind === 'file'` guard specifically so it cannot delete a
 * sub-bucket, and sub-bucket names are 64-hex too.
 */
class NativeSigDirectory {
  readonly kind = 'directory' as const

  constructor(
    readonly name: string,
    private readonly bridge: NativeBridge,
    /** Sub-bucket path within the pool, `''` at the pool itself. */
    private readonly prefix: string = '',
  ) {}

  /** The stored member key for a name in this directory. */
  #key(name: string): string {
    return this.prefix + name
  }

  async getFileHandle(name: string, options?: { create?: boolean }): Promise<NativeFileHandle> {
    if (options?.create) return this.#fileHandle(name)
    // Prove existence by READING, never by listing.
    //
    // A pool of meaning holds one member per layer — thousands on a real hive
    // — and `#entries()` is a full O(n) listing that ALSO re-enumerates the
    // undrained flat directory inside the worker. Paying that on every lookup
    // is what made each children-manifest read hang for tens of seconds, so
    // the renderer resolved no children and the hive painted EMPTY while every
    // individual layer read stayed instant. `dir_get_raw` settles existence in
    // one round trip and hands back the very bytes the caller is about to ask
    // for; the listing cost now scales with nothing.
    let bytes: Uint8Array
    try {
      const buf = await this.bridge.invoke('dir_get_raw', { sig: this.name, name: this.#key(name) })
      bytes = new Uint8Array(buf as ArrayBuffer)
    } catch (error) {
      if ((error as { kind?: string })?.kind === 'NotFound') {
        throw notFound(name, `dir ${this.name.slice(0, 12)}…/${this.prefix}`)
      }
      throw error
    }
    return this.#fileHandle(name, bytes)
  }

  /**
   * A file handle WITHOUT the existence listing.
   *
   * `getFileHandle` re-lists the directory to answer "is it there?", which is
   * right for a blind caller but catastrophic per ITEM of an iteration: a bag
   * of n markers cost n+1 `raw_dir_entries` round trips, and every one of them
   * re-enumerates the undrained flat directory inside the worker. On a real
   * hive (a 251-marker root bag) that turned one listing into minutes of RPCs,
   * so the root head never resolved and the hive rendered EMPTY — while small
   * synthetic bags stayed fast enough to look healthy. An entry we are handing
   * out mid-iteration was just listed; it exists by construction.
   */
  #fileHandle(name: string, prefetched?: Uint8Array): NativeFileHandle {
    const key = this.#key(name)
    // Bytes the existence check already paid for. Served ONCE — a handle kept
    // across a write must still read through to the store afterwards.
    let pending = prefetched
    return new NativeFileHandle(
      name,
      async () => {
        if (pending) {
          const bytes = pending
          pending = undefined
          return bytes
        }
        try {
          const buf = await this.bridge.invoke('dir_get_raw', { sig: this.name, name: key })
          return new Uint8Array(buf as ArrayBuffer)
        } catch (error) {
          if ((error as any)?.kind === 'NotFound') return null
          throw error
        }
      },
      async bytes => {
        await this.bridge.invoke('dir_put_raw', bytes, {
          headers: { 'x-hc-sig': this.name, 'x-hc-name': encodeURIComponent(key) },
        })
      },
    )
  }

  /** A sub-bucket. Always available with `create`, and reported absent without
   *  it unless a member already lives under that prefix — matching OPFS. */
  async getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<NativeSigDirectory> {
    if (!options?.create) {
      const entries = await this.#entries()
      if (!entries.some(e => e.name === name && e.directory)) {
        throw notFound(name, `sub-bucket of ${this.name.slice(0, 12)}…`)
      }
    }
    return new NativeSigDirectory(this.name, this.bridge, `${this.#key(name)}/`)
  }

  async removeEntry(name: string, options?: { recursive?: boolean }): Promise<void> {
    // Markers and pool members are real deletes — neither is a layer.
    await this.bridge.invoke('raw_dir_remove', { sig: this.name, name: this.#key(name) })
    if (options?.recursive) {
      // Drop everything beneath a sub-bucket too.
      const under = `${this.#key(name)}/`
      for (const entry of await this.#rawEntries()) {
        if (entry.name.startsWith(under)) {
          await this.bridge.invoke('raw_dir_remove', { sig: this.name, name: entry.name })
        }
      }
    }
  }

  async isSameEntry(other: unknown): Promise<boolean> {
    return (
      other instanceof NativeSigDirectory &&
      other.name === this.name &&
      other.prefix === this.prefix
    )
  }

  async #rawEntries(): Promise<RawEntry[]> {
    return (await this.bridge.invoke('raw_dir_entries', { sig: this.name })) as RawEntry[]
  }

  /** Entries at THIS level: direct members as files, deeper members collapsed
   *  into their sub-bucket directory, listed once. */
  async #entries(): Promise<RawEntry[]> {
    const out: RawEntry[] = []
    const seen = new Set<string>()
    for (const entry of await this.#rawEntries()) {
      if (!entry.name.startsWith(this.prefix)) continue
      const rest = entry.name.slice(this.prefix.length)
      if (!rest) continue
      const slash = rest.indexOf('/')
      if (slash === -1) {
        out.push({ name: rest, directory: false })
      } else {
        const bucket = rest.slice(0, slash)
        if (!seen.has(bucket)) {
          seen.add(bucket)
          out.push({ name: bucket, directory: true })
        }
      }
    }
    return out
  }

  async *keys(): AsyncGenerator<string> {
    for (const entry of await this.#entries()) yield entry.name
  }

  /** Yields sub-buckets as DIRECTORIES. `putPoolDoc` prunes stale members with
   *  a `kind === 'file'` guard, and sub-bucket names are 64-hex too — so
   *  reporting one as a file would let that prune delete a whole sub-bucket. */
  async *values(): AsyncGenerator<NativeFileHandle | NativeSigDirectory> {
    for (const entry of await this.#entries()) yield await this.#handleFor(entry)
  }

  async #handleFor(entry: RawEntry): Promise<NativeFileHandle | NativeSigDirectory> {
    return entry.directory
      ? new NativeSigDirectory(this.name, this.bridge, `${this.#key(entry.name)}/`)
      : this.#fileHandle(entry.name)
  }

  async *entries(): AsyncGenerator<[string, NativeFileHandle | NativeSigDirectory]> {
    for (const entry of await this.#entries()) {
      yield [entry.name, await this.#handleFor(entry)]
    }
  }

  [Symbol.asyncIterator]() {
    return this.entries()
  }
}

// ---------------------------------------------------------------------------
// CONTENT OVER `hive://`, NOT OVER IPC
//
// Content bytes are the heaviest thing the shell reads and the only thing it
// reads in bursts — one per visible tile the moment a view settles. IPC is the
// wrong pipe for them: every byte is marshalled through the one channel whose
// collapse costs a picture (see TRANSPORT DISCIPLINE above).
//
// The host registers a `hive` URI scheme serving `<sig>` straight from the
// store, so a content read is an ordinary fetch: WebView2's own transport,
// streamed, off the IPC channel entirely, and cacheable — the response carries
// `immutable`, which is simply TRUE of content addressed by its own hash.
//
// Tauri spells a custom scheme differently per platform (`http://hive.localhost`
// on Windows and Android, `hive://localhost` elsewhere), so both are tried once
// and the winner is remembered. If neither answers — an older host without the
// scheme — `viaScheme` reports absence and the caller falls back to IPC. The
// shim stays correct on any host it is dropped into.
// ---------------------------------------------------------------------------

const SCHEME_SHAPES = ['http://hive.localhost', 'hive://localhost'] as const

/** The shape known to work here: undefined until proven, null once ruled out. */
let schemeBase: string | null | undefined

const viaScheme = async (sig: string): Promise<Uint8Array | null | 'unavailable'> => {
  // Only the native host serves it. In a browser — including the packed store,
  // which shares this reader — `hive.localhost` is a real network name and must
  // never be dialled.
  if (schemeBase === null || !nativeAvailable() || typeof fetch !== 'function') return 'unavailable'
  const shapes = schemeBase ? [schemeBase] : SCHEME_SHAPES
  for (const base of shapes) {
    try {
      const response = await fetch(`${base}/${sig}`)
      // Said once, and worth saying: which pipe content is travelling on is the
      // difference between a picture that arrives and a picture that hangs.
      if (schemeBase !== base) console.log(`[store] content served over ${base} — off the IPC channel`)
      schemeBase = base
      if (response.status === 404) return null
      if (!response.ok) return 'unavailable'
      const bytes = new Uint8Array(await response.arrayBuffer())
      return bytes
    } catch {
      // This shape is not served here. Try the next; if none answer, the host
      // has no scheme and IPC carries content as it always did.
    }
  }
  if (!schemeBase) {
    schemeBase = null
    console.warn('[store] no hive:// scheme on this host — content falls back to IPC')
  }
  return 'unavailable'
}

/** The hive root. */
export class NativeRootDirectory {
  readonly kind = 'directory' as const
  readonly name = ''

  constructor(private readonly bridge: NativeBridge) {}

  async getFileHandle(name: string, options?: { create?: boolean }): Promise<NativeFileHandle> {
    if (!SIG.test(name)) {
      // The root holds content addressed by signature and nothing else. A
      // non-signature name here is a caller bug (or legacy code reaching for a
      // typed folder), and failing loudly beats inventing a file.
      throw notFound(name)
    }
    // PROVE EXISTENCE BY READING, NOT BY ASKING.
    //
    // This used to answer "does it exist?" with its own `content_has` IPC
    // call before the bytes were fetched over `hive://` — one extra IPC
    // round trip per handle, fired once per visible tile the instant a view
    // settles. That is the exact burst the transport discipline above exists
    // to keep OFF the IPC channel: when it collapses, the in-flight callbacks
    // are dropped and those promises NEVER settle, so the tile never mounts
    // and its slot stays empty while its siblings render around the hole.
    // Moving the bytes to the scheme while leaving the existence probe on IPC
    // fixed the payload and kept the burst.
    //
    // The scheme already answers the question: 404 IS absence. So read once,
    // and hand the bytes we just proved exist straight to the handle — the
    // same "one round trip, no separate existence call" shape the packed
    // store's facade was fixed into for this identical failure. Content is
    // immutable, so a served answer can be reused for the handle's lifetime.
    let served: Uint8Array | null | 'unavailable' = 'unavailable'
    if (!options?.create) {
      served = await viaScheme(name)
      if (served === null) throw notFound(name, 'root content')
      if (served === 'unavailable') {
        // No scheme on this host (an older client) — fall back to the IPC
        // probe rather than inventing a file. One call, only off the fast path.
        const present = await this.bridge.invoke('content_has', { sig: name })
        if (!present) throw notFound(name, 'root content')
      }
    }
    return new NativeFileHandle(
      name,
      async () => {
        if (served !== 'unavailable') return served
        const fetched = await viaScheme(name)
        if (fetched !== 'unavailable') return fetched
        try {
          const buf = await this.bridge.invoke('content_get_raw', { sig: name })
          return new Uint8Array(buf as ArrayBuffer)
        } catch (error) {
          if ((error as any)?.kind === 'NotFound') return null
          throw error
        }
      },
      async bytes => {
        // Content is addressed by its own hash, so the name is not a choice —
        // it is determined by the bytes. If a caller writes different bytes
        // under a signature name, the store places them at their TRUE
        // signature and the requested name simply does not gain that content.
        // Silently honouring the wrong name would corrupt content addressing.
        const actual = await this.bridge.invoke('content_put_raw', bytes)
        if (actual !== name) {
          throw new Error(
            `[hypercomb] refusing to write content under ${name.slice(0, 16)}… — ` +
            `its bytes sign as ${String(actual).slice(0, 16)}…`,
          )
        }
      },
    )
  }

  async getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<NativeSigDirectory> {
    if (!SIG.test(name)) {
      // Legacy typed folders (`__hive__`, `__layers__`, …) land here. They do
      // not exist natively and never will — reporting absence is exactly what
      // the drain code expects, and it makes every legacy path a no-op.
      throw notFound(name)
    }
    // A sig-named directory always "exists": a bag with no markers and a pool
    // with no members are indistinguishable from an empty one, and both are
    // valid. `create` is therefore irrelevant.
    void options
    return new NativeSigDirectory(name, this.bridge)
  }

  /**
   * Remove a top-level entry.
   *
   * A NO-OP for content, by design. Removing a tile appends a new layer with
   * one less child; the old layer is still history. Content is reclaimed only
   * by collection, and only when no committed layer ever referenced it.
   *
   * Does not throw — callers treat removal as best-effort, and throwing here
   * would break drain paths that expect absence to be fine.
   */
  async removeEntry(name: string): Promise<void> {
    if (SIG.test(name)) {
      await this.bridge.invoke('raw_remove', { sig: name })
    }
    // Anything else is a legacy typed folder. Nothing to remove.
  }

  async isSameEntry(other: unknown): Promise<boolean> {
    return other instanceof NativeRootDirectory
  }

  /** Permissions are a browser concept. The native store is simply ours. */
  async queryPermission(): Promise<'granted'> {
    return 'granted'
  }

  async requestPermission(): Promise<'granted'> {
    return 'granted'
  }

  async #entries(): Promise<RawEntry[]> {
    return (await this.bridge.invoke('raw_root_entries')) as RawEntry[]
  }

  async *keys(): AsyncGenerator<string> {
    for (const entry of await this.#entries()) yield entry.name
  }

  async *values(): AsyncGenerator<NativeFileHandle | NativeSigDirectory> {
    for (const entry of await this.#entries()) {
      yield entry.directory
        ? new NativeSigDirectory(entry.name, this.bridge)
        : await this.getFileHandle(entry.name)
    }
  }

  async *entries(): AsyncGenerator<[string, NativeFileHandle | NativeSigDirectory]> {
    for (const entry of await this.#entries()) {
      yield [
        entry.name,
        entry.directory
          ? new NativeSigDirectory(entry.name, this.bridge)
          : await this.getFileHandle(entry.name),
      ]
    }
  }

  [Symbol.asyncIterator]() {
    return this.entries()
  }
}

/** Matches what OPFS throws, so existing `catch` blocks behave identically. */
const notFound = (name: string, where = ""): DOMException =>
  typeof DOMException !== 'undefined'
    ? new DOMException(`${name} not found${where ? ' in ' + where : ''}`, 'NotFoundError')
    : Object.assign(new Error(`${name} not found`), { name: 'NotFoundError' }) as unknown as DOMException

/** The native hive root, or null in a browser. */
export const nativeRoot = (): NativeRootDirectory | null => {
  const bridge = ambientBridge()
  return bridge ? new NativeRootDirectory(bridge) : null
}

/**
 * Route `navigator.storage.getDirectory()` itself to the native root.
 *
 * WHY THIS EXISTS. `Store.opfsRoot` was swapped to the native root, but nine
 * further files call `navigator.storage.getDirectory()` DIRECTLY —
 * runtime-initializer, viewport-store, sweep, translation service,
 * folder-sync, SignatureStore's install path, and friends. WebView2 supports
 * real OPFS, so inside the native window those calls silently succeed against
 * the webview's own OPFS bucket — a parallel store the native host never
 * sees. Measured result: a first install "wrote" 107 bees into that bucket,
 * verification read the native store, and the count was 0/107 with no error
 * anywhere, because both halves worked perfectly — against different stores.
 *
 * Overriding the entry point ends the class: every acquisition of an OPFS
 * root, present or future, lands on the ONE hive. In a browser this is a
 * no-op.
 *
 * Must run before any code that might capture the original function —
 * i.e. first thing in the shell's main module.
 */
/**
 * Answer the service worker's byte requests from the native store.
 *
 * The SW serves `/opfs/**` modules/layers and `/@resource/` site composition
 * by reading OPFS — which, inside the native shell, is empty (the hive lives
 * in the native store, and the SW is a separate global where neither the
 * Tauri bridge nor the storage override exists). On a miss the SW posts
 * `hc:bytes-request` over a MessageChannel; this listener resolves it:
 *
 *   kind 'content'          → content by signature (layers, site resources)
 *   kind 'dir'  fenced meaning      → that pool's member, if the registry
 *                                     knows the meaning; otherwise content by
 *                                     the signature in `name` (layers, whose
 *                                     `.json` suffix is the frozen URL shape)
 *               <64-hex>            → that sig-dir's member (bag or pool)
 *
 * Plain browsers never advertise this bridge, so their SW misses fall through
 * immediately without paying a response timeout.
 */
export const installNativeSwBridge = (): boolean => {
  const bridge = ambientBridge()
  return bridge ? installSwBytesBridge(bridge) : false
}

/** Normalize whatever shape a bridge hands back. The Tauri host returns a
 *  number array for `pool_get` and an ArrayBuffer for the `*_raw` commands;
 *  the packed-store worker transfers ArrayBuffers throughout. Both are bytes,
 *  and the caller should not have to care which backend answered. */
const asBytes = (value: unknown): Uint8Array | null => {
  if (!value) return null
  if (value instanceof Uint8Array) return value.byteLength ? value : null
  if (value instanceof ArrayBuffer) return value.byteLength ? new Uint8Array(value) : null
  if (Array.isArray(value)) return value.length ? Uint8Array.from(value as number[]) : null
  return null
}

/**
 * Install the listener over ANY bridge — the native host or the packed store.
 *
 * Same seam as the rest of this file: the service worker neither knows nor
 * cares which store is underneath, it just asks the page for bytes it could
 * not find in OPFS. The native shell needs this because its OPFS is empty.
 * The web packed store needs it for exactly the same reason — once records
 * are drained into the pack, the SW's own reads miss, and without this the
 * modules, layers and `/@resource/` site composition it serves would 404.
 */
export const installSwBytesBridge = (bridge: NativeBridge): boolean => {
  if (!('serviceWorker' in navigator)) return false

  const advertise = (): void => {
    const message = { type: 'hc:bytes-bridge', active: true }
    navigator.serviceWorker.controller?.postMessage(message)
    void navigator.serviceWorker.ready
      .then(registration => registration.active?.postMessage(message))
      .catch(() => undefined)
  }

  // Capability is held by worker client id. Re-advertise after a controller
  // transition so an activated/restarted worker never loses the bridge.
  advertise()
  navigator.serviceWorker.addEventListener('controllerchange', advertise)

  const readFor = async (kind: string, dir: string, name: string): Promise<Uint8Array | null> => {
    const content = async (sig: string): Promise<Uint8Array | null> => {
      if (!SIG.test(sig)) return null
      // Native serves content off the IPC channel; the packed store has no
      // scheme and answers 'unavailable', falling through unchanged.
      const served = await viaScheme(sig)
      if (served !== 'unavailable') return served
      try {
        return asBytes(await bridge.invoke('content_get_raw', { sig }))
      } catch { return null }
    }
    const pool = async (meaning: string, key: string): Promise<Uint8Array | null> =>
      asBytes(await bridge.invoke('pool_get', { meaning, key }).catch(() => null))

    if (kind === 'content') return content(dir)
    if (kind !== 'dir') return null
    // A fenced legacy dir is the drain-era spelling of a pool meaning. Ask the
    // registry rather than branching per name: a fence whose meaning is NOT a
    // registered pool was never a pool at all (layers are content, addressed by
    // the signature in `name` — the `.json` suffix is the frozen legacy URL
    // shape), so the fallthrough is the correct answer, not a missing case.
    const fenced = FENCED.exec(dir)?.[1]
    if (fenced) {
      const meanings = await poolMeanings()
      const known = [...meanings.values()].includes(fenced)
      return known ? pool(fenced, name) : content(name.replace(/\.json$/, ''))
    }
    if (SIG.test(dir)) {
      try {
        return asBytes(await bridge.invoke('dir_get_raw', { sig: dir, name }))
      } catch { return null }
    }
    return null
  }

  navigator.serviceWorker.addEventListener('message', (event: MessageEvent) => {
    const data = event.data as { type?: string; kind?: string; dir?: string; name?: string }
    if (data?.type !== 'hc:bytes-request' || !event.ports[0]) return
    void (async () => {
      const bytes = await readFor(data.kind ?? '', data.dir ?? '', data.name ?? '')
      if (bytes) {
        // Transfer, don't copy — bee bundles and images are not small.
        event.ports[0].postMessage({ bytes: bytes.buffer }, [bytes.buffer])
      } else {
        event.ports[0].postMessage({ bytes: null })
      }
    })()
  })
  return true
}

export const installNativeStorageOverride = (): boolean => {
  const root = nativeRoot()
  if (!root) return false
  try {
    Object.defineProperty(navigator.storage, 'getDirectory', {
      configurable: true,
      value: async () => root as unknown as FileSystemDirectoryHandle,
    })
    return true
  } catch {
    return false
  }
}
