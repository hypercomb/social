// sharing/backup-folder.ts
//
// A FOLDER AS A BACKUP PLACE (jwize 2026-11-28: "also simplify our option to save to windows explorer as well").
//
// The same ciphertext /backup keeps on a host, kept in a folder the participant picks once — a disk, a USB stick, a
// OneDrive folder. Inside `hypercomb-hive-backup/` every sealed atom, the door and the envelope are files named by
// their signature, and `backup-index.json` names the newest envelope for the key, as a host's signed index does. A
// file already there is not written again (the atoms seal convergently, so an unchanged atom is the same file), so a
// second backup writes only what changed.
//
// The folder holds NO secret: it is ciphertext only, so a synced cloud folder sees nothing it can read. Opening it
// needs the recovery file, exactly as a host backup does. /folder-sync stays what it is — the plain copy of everything.

import type { BackupTarget } from './hive-backup.js'
import { BACKUP_ROOT_KEY } from './hive-backup.js'

export const BACKUP_FOLDER_DIR = 'hypercomb-hive-backup'
export const BACKUP_FOLDER_INDEX = 'backup-index.json'
export const BACKUP_FOLDER_INDEX_KIND = 'hypercomb-backup-folder'
/** The one remembered folder handle /backup writes to. */
export const BACKUP_FOLDER_HANDLE_ID = 'backup:folder'

const SIG = /^[0-9a-f]{64}$/

/** What a backup needs from a folder: is a file there at this size, read one, write one. */
export type FolderIo = {
  readonly has: (name: string, size: number) => Promise<boolean>
  readonly read: (name: string) => Promise<Uint8Array | null>
  readonly write: (name: string, bytes: Uint8Array) => Promise<void>
}

type FolderIndex = { readonly kind: typeof BACKUP_FOLDER_INDEX_KIND; readonly v: 1; readonly publisher: string; readonly roots: Record<string, string>; readonly at: number }

const reason = (error: unknown): string => error instanceof Error ? error.message : String(error)

/** A folder as a place /backup keeps the hive. */
export const folderTarget = (io: FolderIo, name: string, now: () => number = Date.now): BackupTarget => ({
  kind: 'folder',
  name,
  devices: async () => [],
  upload: async atoms => {
    try {
      for (const [sig, bytes] of atoms) if (!(await io.has(sig, bytes.byteLength))) await io.write(sig, bytes)
      return { ok: true }
    } catch (error) { return { ok: false, reason: reason(error) } }
  },
  setRoot: async (publisher, key, sig) => {
    const index: FolderIndex = { kind: BACKUP_FOLDER_INDEX_KIND, v: 1, publisher, roots: { [key]: sig }, at: now() }
    try {
      await io.write(BACKUP_FOLDER_INDEX, new TextEncoder().encode(JSON.stringify(index, null, 2)))
      return { ok: true }
    } catch (error) { return { ok: false, reason: reason(error) } }
  },
})

/** The roots a folder's index names for `publisher`, or null when it names none. */
export const folderRoots = async (io: FolderIo, publisher: string): Promise<Record<string, string> | null> => {
  const bytes = await io.read(BACKUP_FOLDER_INDEX).catch(() => null)
  if (!bytes) return null
  let raw: Record<string, unknown>
  try { raw = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown> } catch { return null }
  if (raw?.['kind'] !== BACKUP_FOLDER_INDEX_KIND || String(raw['publisher'] ?? '').toLowerCase() !== publisher.toLowerCase()) return null
  const envelope = String((raw['roots'] as Record<string, unknown> | undefined)?.[BACKUP_ROOT_KEY] ?? '').toLowerCase()
  return SIG.test(envelope) ? { [BACKUP_ROOT_KEY]: envelope } : null
}

/** A file in the folder, read only when its name is a signature. */
export const folderFetcher = (io: FolderIo) => async (sig: string): Promise<Uint8Array | null> =>
  SIG.test(sig) ? io.read(sig).catch(() => null) : null

// ── the live folder ──

type Handle = FileSystemDirectoryHandle

/** A FolderIo over the backup directory inside `picked`. */
export const liveFolderIo = async (picked: Handle, create: boolean): Promise<FolderIo | null> => {
  // The participant may pick the folder they chose, or the backup folder inside it.
  const dir = picked.name === BACKUP_FOLDER_DIR ? picked : await picked.getDirectoryHandle(BACKUP_FOLDER_DIR, { create }).catch(() => null)
  if (!dir) return null
  const { writeFile, readFileBytes } = await import('./folder-sync.service.js')
  return {
    has: async (name, size) => {
      try { return (await (await dir.getFileHandle(name, { create: false })).getFile()).size === size } catch { return false }
    },
    read: async name => { const bytes = await readFileBytes(dir, name); return bytes ? new Uint8Array(bytes) : null },
    write: (name, bytes) => writeFile(dir, name, bytes),
  }
}

/** Ask for a folder to keep backups in, and remember it. Needs a user gesture; null when none was picked. */
export const pickBackupFolder = async (mode: 'read' | 'readwrite'): Promise<Handle | null> => {
  const picker = (window as unknown as { showDirectoryPicker?: (options: object) => Promise<Handle> }).showDirectoryPicker
  if (typeof picker !== 'function') return null
  const handle = await picker({ id: 'hypercomb-backup', mode }).catch(() => null)
  if (!handle) return null
  if (mode === 'readwrite') {
    const { saveHandle } = await import('../substrate/folder-handles.js')
    await saveHandle(BACKUP_FOLDER_HANDLE_ID, handle)
  }
  return handle
}

/** The remembered backup folder, with write access asked for again when the browser needs it (a user gesture must be
 *  fresh). Null when there is none or access was refused. */
export const rememberedBackupFolder = async (): Promise<Handle | null> => {
  const { getHandle, queryPermission, requestPermission } = await import('../substrate/folder-handles.js')
  const entry = await getHandle(BACKUP_FOLDER_HANDLE_ID)
  if (!entry) return null
  if ((await queryPermission(entry.handle, 'readwrite')) === 'granted') return entry.handle
  return (await requestPermission(entry.handle, 'readwrite')) === 'granted' ? entry.handle : null
}

/** Whether a backup folder is remembered at all, without asking for anything. */
export const hasBackupFolder = async (): Promise<boolean> => {
  const { getHandle } = await import('../substrate/folder-handles.js')
  return !!(await getHandle(BACKUP_FOLDER_HANDLE_ID).catch(() => null))
}
