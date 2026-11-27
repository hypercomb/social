// The Windows folder prompt for an intelligence group.
//
// Chromium asks with showDirectoryPicker. That grant is the right to the
// folder. It can lapse back to "prompt" without the folder moving. Start
// opens the prompt when nothing has been set. When a folder was set and the
// grant is gone, start does not open a second prompt: it reports that the
// folder should be reset. Reset is the next press, and that press asks again.

import { ensureGroup, LINEAGE_GROUP, LINEAGE_PROBLEM, type LayoutDirectory, type LayoutWriter } from './intelligence-layout.js'

export const INTELLIGENCE_PICKER_ID = 'hypercomb-intelligence'
const DB_NAME = 'hypercomb-intelligence-folder'
const STORE = 'handles'
const RECORD = 'home'

export type FolderGrant = 'granted' | 'prompt' | 'denied'

export type DirectoryHandle = FileSystemDirectoryHandle & {
  queryPermission?(options: { mode: 'readwrite' }): Promise<FolderGrant>
  requestPermission?(options: { mode: 'readwrite' }): Promise<FolderGrant>
}

export type FolderOutcome =
  | { kind: 'started'; name: string; already?: boolean }
  | { kind: 'reset'; name: string; reason: 'rights' | 'disconnected' }
  | { kind: 'cancelled' }
  | { kind: 'unsupported' }

type Store = {
  read(): Promise<DirectoryHandle | null>
  write(handle: DirectoryHandle): Promise<void>
}

const mode = { mode: 'readwrite' as const }

const faultOf = (error: unknown): 'missing' | 'rights' | null => {
  const name = (error as { name?: string })?.name
  if (name === 'NotFoundError') return 'missing'
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'rights'
  return null
}

const probeFolder = async (handle: DirectoryHandle): Promise<'ok' | 'missing' | 'rights'> => {
  try {
    await handle.entries().next()
    return 'ok'
  } catch (error) {
    const fault = faultOf(error)
    if (fault) return fault
    throw error
  }
}

const supported = (): boolean =>
  typeof window !== 'undefined' && typeof (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function'

const openDb = (): Promise<IDBDatabase> => new Promise((resolve, reject) => {
  const request = indexedDB.open(DB_NAME, 1)
  request.onupgradeneeded = () => {
    const db = request.result
    if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE)
  }
  request.onsuccess = () => resolve(request.result)
  request.onerror = () => reject(request.error)
})

/** True once this page has seen the handle database exist. */
let folderWasSet = false

const idbStore = (): Store => ({
  async read() {
    const db = await openDb()
    return new Promise((resolve, reject) => {
      const request = db.transaction(STORE, 'readonly').objectStore(STORE).get(RECORD)
      request.onsuccess = () => resolve((request.result as DirectoryHandle | undefined) ?? null)
      request.onerror = () => reject(request.error)
    })
  },
  async write(handle) {
    folderWasSet = true
    const db = await openDb()
    await new Promise<void>((resolve, reject) => {
      const request = db.transaction(STORE, 'readwrite').objectStore(STORE).put(handle, RECORD)
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  },
})

/** The folder /intelligence stored, when this page may still read it. A lapsed grant is not a prompt. */
export const grantedIntelligenceRoot = async (): Promise<DirectoryHandle | null> => {
  if (typeof indexedDB === 'undefined') return null
  try {
    // Every model call asks this. A hive that never typed `intelligence` has
    // no database, and asking must not make one.
    if (!folderWasSet) {
      const listed = await indexedDB.databases?.()
      if (listed && !listed.some(db => db.name === DB_NAME)) return null
      folderWasSet = true
    }
    const handle = await idbStore().read()
    if (!handle) return null
    if ((await grantOf(handle, false)) !== 'granted') return null
    return handle
  } catch {
    return null
  }
}

const pick = async (): Promise<DirectoryHandle | null> => {
  try {
    return await (window as unknown as {
      showDirectoryPicker: (options: { id: string; mode: 'readwrite' }) => Promise<DirectoryHandle>
    }).showDirectoryPicker({ id: INTELLIGENCE_PICKER_ID, mode: 'readwrite' })
  } catch (error) {
    if ((error as DOMException)?.name === 'AbortError') return null
    throw error
  }
}

const grantOf = async (handle: DirectoryHandle, ask: boolean): Promise<FolderGrant> => {
  const method = ask ? handle.requestPermission : handle.queryPermission
  if (!method) return 'granted'
  try {
    return await method.call(handle, mode)
  } catch {
    return 'denied'
  }
}

export type FolderDeps = {
  store?: Store
  pick?: () => Promise<DirectoryHandle | null>
  held?: DirectoryHandle | null
  write?: LayoutWriter
}

export const intelligenceFolder = (deps: FolderDeps = {}) => {
  const store = deps.store ?? idbStore()
  const choose = deps.pick ?? pick
  let held = deps.held ?? null

  const settle = async (handle: DirectoryHandle, already?: boolean): Promise<FolderOutcome> => {
    if (deps.write) {
      try {
        await ensureGroup(handle as LayoutDirectory, deps.write, LINEAGE_GROUP, LINEAGE_PROBLEM)
      } catch (error) {
        const fault = faultOf(error)
        if (!fault) throw error
        return { kind: 'reset', name: handle.name, reason: fault === 'missing' ? 'disconnected' : 'rights' }
      }
    }
    return already
      ? { kind: 'started', name: handle.name, already: true }
      : { kind: 'started', name: handle.name }
  }

  const remember = async (handle: DirectoryHandle): Promise<FolderOutcome> => {
    held = handle
    await store.write(handle)
    return settle(handle)
  }

  return {
    held: () => held,
    async start(): Promise<FolderOutcome> {
      if (!supported() && !deps.pick) return { kind: 'unsupported' }
      held = held ?? await store.read()
      if (!held) {
        const chosen = await choose()
        if (!chosen) return { kind: 'cancelled' }
        return remember(chosen)
      }
      const grant = await grantOf(held, false)
      if (grant !== 'granted') return { kind: 'reset', name: held.name, reason: 'rights' }
      const probed = await probeFolder(held)
      if (probed !== 'ok') return { kind: 'reset', name: held.name, reason: probed === 'missing' ? 'disconnected' : 'rights' }
      return settle(held, true)
    },
    async reset(): Promise<FolderOutcome> {
      if (!supported() && !deps.pick) return { kind: 'unsupported' }
      held = held ?? await store.read()
      if (held) {
        const grant = await grantOf(held, true)
        if (grant !== 'granted') return { kind: 'reset', name: held.name, reason: 'rights' }
        const probed = await probeFolder(held)
        if (probed === 'rights') return { kind: 'reset', name: held.name, reason: 'rights' }
        if (probed === 'ok') return remember(held)
      }
      const chosen = await choose()
      if (!chosen) return held
        ? { kind: 'reset', name: held.name, reason: 'rights' }
        : { kind: 'cancelled' }
      return remember(chosen)
    },
  }
}

export const folderMessage = (outcome: FolderOutcome): string => {
  if (outcome.kind === 'started') return `Intelligence started in ${outcome.name}. That folder is the intelligence root.`
  if (outcome.kind === 'cancelled') return 'The folder prompt was cancelled.'
  if (outcome.kind === 'unsupported') return 'This browser cannot ask Windows for a folder.'
  if (outcome.reason === 'disconnected') {
    return `The intelligence folder ${outcome.name} was set and is disconnected. Reset the folder: intelligence reset`
  }
  return `The intelligence folder ${outcome.name} was set and its access is disconnected. The folder did not give up its rights; this page needs them again. Reset the folder: intelligence reset`
}
