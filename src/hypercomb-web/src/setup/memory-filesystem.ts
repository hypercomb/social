// Session-only File System Access API subset for published read-only sites.
//
// The normal participant shell owns an OPFS hive. A visitor site does not:
// its source of truth is the publisher's immutable HTTP signature heap.  The
// existing runtime still expects FileSystemDirectoryHandle-shaped scratch
// space while it loads signed modules and unfolds the preview, so the visitor
// build installs this in-memory root before importing the normal boot graph.
// Refresh drops everything; navigator.storage.getDirectory never reaches the
// browser's real OPFS implementation.

type Entry = MemoryDirectoryHandle | MemoryFileHandle

const notFound = (name: string): DOMException =>
  new DOMException(`The entry '${name}' was not found.`, 'NotFoundError')

class MemoryWritable {
  #file: MemoryFileHandle
  #bytes: Uint8Array<ArrayBufferLike>
  #position = 0

  constructor(file: MemoryFileHandle, keepExistingData: boolean) {
    this.#file = file
    this.#bytes = keepExistingData ? file.bytes.slice() : new Uint8Array()
  }

  async write(data: FileSystemWriteChunkType): Promise<void> {
    let payload: Blob | string | BufferSource = data as Blob | string | BufferSource
    if (typeof data === 'object' && data !== null && 'type' in data) {
      const command = data as WriteParams
      if (command.type === 'seek') {
        this.#position = Number(command.position ?? 0)
        return
      }
      if (command.type === 'truncate') {
        const size = Number(command.size ?? 0)
        const next = new Uint8Array(size)
        next.set(this.#bytes.subarray(0, size))
        this.#bytes = next
        if (this.#position > size) this.#position = size
        return
      }
      if (command.type === 'write') {
        if (command.position != null) this.#position = Number(command.position)
        payload = command.data!
      }
    }

    const bytes = payload instanceof Blob
      ? new Uint8Array(await payload.arrayBuffer())
      : typeof payload === 'string'
        ? new TextEncoder().encode(payload)
        : payload instanceof ArrayBuffer
          ? new Uint8Array(payload)
          // slice(), not Uint8Array.from(): a block copy rather than an
          // element-at-a-time iterator walk (see getFile below).
          : new Uint8Array(payload.buffer, payload.byteOffset, payload.byteLength).slice()
    const required = this.#position + bytes.byteLength
    if (required > this.#bytes.byteLength) {
      const grown = new Uint8Array(required)
      grown.set(this.#bytes)
      this.#bytes = grown
    }
    this.#bytes.set(bytes, this.#position)
    this.#position += bytes.byteLength
  }

  async close(): Promise<void> {
    this.#file.bytes = this.#bytes
    this.#file.invalidate(Date.now())
  }
  async abort(): Promise<void> {}
}

class MemoryFileHandle {
  readonly kind = 'file' as const
  bytes: Uint8Array<ArrayBufferLike> = new Uint8Array()
  #modified = Date.now()

  constructor(readonly name: string) {}

  /** Snapshot of the current bytes, rebuilt only when they change. A real
   *  OPFS `getFile()` hands back a lazy handle, so callers treat it as free
   *  and ask repeatedly — the queue walk reads one per entry per pass just
   *  to look at `lastModified`. Copying the bytes on each of those calls was
   *  two thirds of the visitor's CPU: the main thread never yielded and the
   *  page never painted. Caching restores the assumption the API sets.
   *  Safe because writes REPLACE `bytes` (MemoryWritable builds its own array
   *  and assigns on close), so a handed-out File can never be mutated. */
  #snapshot: File | null = null

  async getFile(): Promise<File> {
    if (!this.#snapshot) {
      this.#snapshot = new File([this.bytes.slice()], this.name, { lastModified: this.#modified })
    }
    return this.#snapshot
  }

  /** Invalidate the snapshot — called whenever bytes are replaced. */
  invalidate(modified: number): void {
    this.#modified = modified
    this.#snapshot = null
  }

  async createWritable(options?: FileSystemCreateWritableOptions): Promise<FileSystemWritableFileStream> {
    this.invalidate(Date.now())
    return new MemoryWritable(this, options?.keepExistingData === true) as unknown as FileSystemWritableFileStream
  }

  async isSameEntry(other: FileSystemHandle): Promise<boolean> { return other === this as unknown as FileSystemHandle }
}

class MemoryDirectoryHandle {
  readonly kind = 'directory' as const
  readonly #children = new Map<string, Entry>()

  constructor(readonly name: string) {}

  async getDirectoryHandle(name: string, options?: FileSystemGetDirectoryOptions): Promise<FileSystemDirectoryHandle> {
    const held = this.#children.get(name)
    if (held) {
      if (held.kind !== 'directory') throw new DOMException(`'${name}' is not a directory.`, 'TypeMismatchError')
      return held as unknown as FileSystemDirectoryHandle
    }
    if (!options?.create) throw notFound(name)
    const dir = new MemoryDirectoryHandle(name)
    this.#children.set(name, dir)
    return dir as unknown as FileSystemDirectoryHandle
  }

  async getFileHandle(name: string, options?: FileSystemGetFileOptions): Promise<FileSystemFileHandle> {
    const held = this.#children.get(name)
    if (held) {
      if (held.kind !== 'file') throw new DOMException(`'${name}' is not a file.`, 'TypeMismatchError')
      return held as unknown as FileSystemFileHandle
    }
    if (!options?.create) throw notFound(name)
    const file = new MemoryFileHandle(name)
    this.#children.set(name, file)
    return file as unknown as FileSystemFileHandle
  }

  async removeEntry(name: string, options?: FileSystemRemoveOptions): Promise<void> {
    const held = this.#children.get(name)
    if (!held) throw notFound(name)
    if (held.kind === 'directory' && !options?.recursive && held.#children.size > 0) {
      throw new DOMException(`The directory '${name}' is not empty.`, 'InvalidModificationError')
    }
    this.#children.delete(name)
  }

  async resolve(possibleDescendant: FileSystemHandle): Promise<string[] | null> {
    for (const [name, child] of this.#children) {
      if (child === possibleDescendant) return [name]
      if (child.kind === 'directory') {
        const rest = await child.resolve(possibleDescendant)
        if (rest) return [name, ...rest]
      }
    }
    return null
  }

  async isSameEntry(other: FileSystemHandle): Promise<boolean> { return other === this as unknown as FileSystemHandle }
  async *entries(): AsyncIterableIterator<[string, FileSystemHandle]> {
    for (const pair of this.#children) yield pair as [string, FileSystemHandle]
  }
  async *keys(): AsyncIterableIterator<string> { for (const key of this.#children.keys()) yield key }
  async *values(): AsyncIterableIterator<FileSystemHandle> {
    for (const value of this.#children.values()) yield value as unknown as FileSystemHandle
  }
  [Symbol.asyncIterator](): AsyncIterableIterator<[string, FileSystemHandle]> { return this.entries() }
}

/** Install once, before the normal web entrypoint is dynamically imported. */
export function installMemoryFilesystem(): void {
  const root = new MemoryDirectoryHandle('') as unknown as FileSystemDirectoryHandle
  // `navigator.storage` only exists in a SECURE context. Without this guard a
  // page served over plain http dies here with "Object.defineProperty called
  // on non-object" — before any of the shell's own error surfaces exist, so
  // the visitor sees a blank page and the console names a primitive, not the
  // cause. Install the shim on whatever object we can reach and let boot
  // continue; nothing else in the visitor needs the real StorageManager.
  const storage: Partial<StorageManager> = navigator.storage ?? {}
  if (!navigator.storage) {
    console.warn('[visitor] navigator.storage is unavailable (insecure context) — session-memory store only')
    Object.defineProperty(navigator, 'storage', { configurable: true, value: storage })
  }
  Object.defineProperty(storage, 'getDirectory', {
    configurable: true,
    value: async (): Promise<FileSystemDirectoryHandle> => root,
  })
  ;(window as Window & { __HC_READONLY__?: boolean }).__HC_READONLY__ = true
  document.documentElement.dataset['hypercombMode'] = 'visitor'
}
