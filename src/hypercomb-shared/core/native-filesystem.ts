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

/** The ambient bridge, when running inside the native window. */
export const ambientBridge = (): NativeBridge | null =>
  nativeAvailable() ? { invoke: (globalThis as any).__TAURI__.core.invoke } : null

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
    const entries = await this.#entries()
    if (!entries.some(e => e.name === name && !e.directory) && !options?.create) {
      throw notFound(name, `dir ${this.name.slice(0, 12)}…/${this.prefix}`)
    }
    const key = this.#key(name)
    return new NativeFileHandle(
      name,
      async () => {
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
      : await this.getFileHandle(entry.name)
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
    if (!options?.create) {
      const present = await this.bridge.invoke('content_has', { sig: name })
      if (!present) throw notFound(name, 'root content')
    }
    return new NativeFileHandle(
      name,
      async () => {
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
 *   kind 'dir'  __bees__            → sign('bees') pool member
 *               __dependencies__    → sign('dependencies') pool member
 *               __layers__ <sig>.json → content by signature (frozen URL shape)
 *               <64-hex>            → that sig-dir's member (bag or pool)
 *
 * No response in a plain browser (this never installs), so the SW's timeout
 * preserves web behavior exactly.
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

  const readFor = async (kind: string, dir: string, name: string): Promise<Uint8Array | null> => {
    const content = async (sig: string): Promise<Uint8Array | null> => {
      if (!SIG.test(sig)) return null
      try {
        return asBytes(await bridge.invoke('content_get_raw', { sig }))
      } catch { return null }
    }
    const pool = async (meaning: string, key: string): Promise<Uint8Array | null> =>
      asBytes(await bridge.invoke('pool_get', { meaning, key }).catch(() => null))

    if (kind === 'content') return content(dir)
    if (kind !== 'dir') return null
    if (dir === '__bees__') return pool('bees', name)
    if (dir === '__dependencies__') return pool('dependencies', name)
    if (dir === '__layers__') return content(name.replace(/\.json$/, ''))
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
