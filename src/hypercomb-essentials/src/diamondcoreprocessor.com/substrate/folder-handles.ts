// folder-handles.ts
//
// Persists FileSystemDirectoryHandle objects (from File System Access API)
// in IndexedDB so substrate links to local folders survive page reloads.
// Small, dependency-free wrapper — uses the raw idb API.
//
// OPFS cannot hold handles to *other* filesystems, which is why this is IDB
// and not Store.putResource.
//
// Lives inside the substrate namespace so the essentials module never has to
// import `@hypercomb/shared`. Per the architecture rule in CLAUDE.md, modules
// must never depend on shared — pulling in shared causes esbuild to bundle
// Angular component code into the namespace dep file, which then fails to
// load with "Standard Angular field decorators are not supported in JIT mode"
// at runtime, taking the entire substrate (and every other bee in the same
// namespace bundle) down with it.

const DB_NAME = 'hypercomb-folder-handles'
const STORE_NAME = 'handles'
const DB_VERSION = 1

type Entry = {
  id: string
  handle: FileSystemDirectoryHandle
  label: string
  createdAt: number
}

let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}

function txn<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then((db) => new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode)
    const store = tx.objectStore(STORE_NAME)
    const req = fn(store)
    req.onsuccess = () => resolve(req.result as T)
    req.onerror = () => reject(req.error)
  }))
}

/** Check if the File System Access API is available in this environment. */
export function isFolderAccessSupported(): boolean {
  return typeof window !== 'undefined' && typeof (window as any).showDirectoryPicker === 'function'
}

/**
 * Prompt the user to pick a local directory and persist its handle. Must be
 * called from a user gesture. Returns the new entry, or null if the user
 * cancelled the picker.
 */
export async function linkFolder(label?: string): Promise<Entry | null> {
  if (!isFolderAccessSupported()) return null
  let handle: FileSystemDirectoryHandle
  try {
    handle = await (window as any).showDirectoryPicker({ mode: 'read' }) as FileSystemDirectoryHandle
  } catch {
    return null // user cancelled
  }
  const id = crypto.randomUUID()
  const entry: Entry = {
    id,
    handle,
    label: label ?? handle.name,
    createdAt: Date.now(),
  }
  await txn('readwrite', (store) => store.put(entry) as IDBRequest<any>)
  return entry
}

export async function getHandle(id: string): Promise<Entry | null> {
  try {
    const result = await txn<Entry | undefined>('readonly', (store) => store.get(id))
    return result ?? null
  } catch {
    return null
  }
}

export async function removeHandle(id: string): Promise<void> {
  try {
    await txn('readwrite', (store) => store.delete(id) as IDBRequest<any>)
  } catch { /* ignore */ }
}

export async function listHandles(): Promise<Entry[]> {
  try {
    return await txn<Entry[]>('readonly', (store) => store.getAll())
  } catch {
    return []
  }
}

type PermissionState = 'granted' | 'denied' | 'prompt'

/**
 * Check current read permission for a handle. Returns `'granted'` when
 * silent access is permitted (no user gesture needed).
 */
export async function queryPermission(handle: FileSystemDirectoryHandle): Promise<PermissionState> {
  try {
    const state = await (handle as any).queryPermission({ mode: 'read' }) as PermissionState
    return state
  } catch {
    return 'denied'
  }
}

/**
 * Request read permission for a handle. Must be called from a user gesture
 * when current state is `'prompt'`.
 */
export async function requestPermission(handle: FileSystemDirectoryHandle): Promise<PermissionState> {
  try {
    const state = await (handle as any).requestPermission({ mode: 'read' }) as PermissionState
    return state
  } catch {
    return 'denied'
  }
}

/**
 * Enumerate image files in a directory handle. Returns name+blob pairs for
 * every file whose MIME type starts with `image/` or whose extension is a
 * known image format.
 */
const IMAGE_EXTENSIONS = new Set(['webp', 'png', 'jpg', 'jpeg', 'gif', 'avif', 'svg', 'bmp'])

export async function readImagesFromHandle(handle: FileSystemDirectoryHandle): Promise<{ name: string; blob: Blob }[]> {
  const out: { name: string; blob: Blob }[] = []
  try {
    for await (const [name, entry] of (handle as any).entries() as AsyncIterable<[string, FileSystemHandle]>) {
      if (entry.kind !== 'file') continue
      const ext = name.split('.').pop()?.toLowerCase() ?? ''
      if (!IMAGE_EXTENSIONS.has(ext)) continue
      try {
        const file = await (entry as FileSystemFileHandle).getFile()
        if (file.type && !file.type.startsWith('image/') && !IMAGE_EXTENSIONS.has(ext)) continue
        out.push({ name, blob: file })
      } catch { /* skip unreadable */ }
    }
  } catch { /* directory no longer accessible */ }
  return out
}
