// diamondcoreprocessor.com/sharing/folder-sync.service.ts
//
// Portable, private folder backup for the complete OPFS tree.
//
// The participant explicitly chooses a directory. Hypercomb then writes:
//
//   <chosen>/hypercomb-backup/
//     hypercomb-backup.json
//     devices/<device-id>/
//       manifest.json
//       opfs/<exact OPFS tree>
//
// Per-device snapshots avoid filename races when the chosen directory itself
// is synchronized by Dropbox, OneDrive, a NAS, or removable media. OPFS stays
// the hot store; folder writes are detached and serialized. Content and
// history-marker writes mirror incrementally, while `syncNow()` performs a
// complete reconciliation so less-frequent pools are covered too.
//
// Import is union-only. Missing files are copied into OPFS, byte-identical
// files are skipped, and conflicting files are reported but NEVER overwritten.
// Root-level sig-named content is sha256-verified before import.

import { EffectBus, SignatureService, poolMeanings } from '@hypercomb/core'
import { extractLayerSigFromMarker } from '../history/history.service.js'

export const FOLDER_SYNC_KEY = '@diamondcoreprocessor.com/FolderSyncService'

const DB_NAME = 'hypercomb-folder-sync'
const DB_VERSION = 1
const HANDLE_STORE = 'handles'
const HANDLE_KEY = 'backup-root'
const BACKUP_DIR = 'hypercomb-backup'
const DEVICES_DIR = 'devices'
const ROOT_MANIFEST = 'hypercomb-backup.json'
const DEVICE_MANIFEST = 'manifest.json'
const DEVICE_ID_KEY = 'hc:folder-sync:device-id'
const AUTO_KEY = 'hc:folder-sync:auto'
const AUTO_MODE_KEY = 'hc:folder-sync:auto-mode'
const SETTINGS_VERSION_KEY = 'hc:folder-sync:settings-version'
const SETTINGS_VERSION = '2'
const SIG_RE = /^[a-f0-9]{64}$/
const MARKER_RE = /^\d{8}$/
const CONTENT_BROKER_KEY = '@diamondcoreprocessor.com/ContentBrokerDrone'
const README_FILE = 'README.txt'
const BACKUP_REPORT = 'BACKUP-REPORT.txt'
const DEVICE_INVENTORY = 'INVENTORY.txt'
const DCP_DIR = 'dcp'
const DCP_MANIFEST = 'manifest.json'
const COMPLETE_RE = /^COMPLETE-([A-F0-9]{12})\.hypercomb$/
/** Files between manifest checkpoints. The manifest IS the resume cursor. */
const CHECKPOINT_FILES = 200

type FolderSyncStatus =
  | 'unsupported'
  | 'unconfigured'
  | 'needs-permission'
  | 'syncing'
  | 'backed-up'
  | 'incomplete'
  | 'error'

export type FolderSyncMode = 'local' | 'hard-copy'

export interface FolderSyncSettings {
  automatic: boolean
  mode: FolderSyncMode
}

export interface FolderSyncState {
  status: FolderSyncStatus
  mode?: FolderSyncMode
  phase?: string
  folder?: string
  deviceId: string
  copied?: number
  scanned?: number
  copiedBytes?: number
  totalBytes?: number
  dcpFiles?: number
  dcpBytes?: number
  categories?: Record<string, CategoryStamp>
  resolvedLayers?: number
  resolvedResources?: number
  missingReferences?: number
  closureRoots?: number
  failedRoots?: number
  verified?: number
  damaged?: number
  at: number
  error?: string
}

interface FileStamp {
  size: number
  modified: number
  sha256?: string
  category?: string
}

export interface CategoryStamp {
  files: number
  bytes: number
}

interface DeviceManifest {
  kind: 'hypercomb-folder-backup-device'
  version: 2
  deviceId: string
  updatedAt: number
  verifiedAt: number
  mode: FolderSyncMode
  closure: HardCopyResult
  fileCount: number
  totalBytes: number
  categories: Record<string, CategoryStamp>
  /**
   * Set while a full pass is mid-walk. The manifest is checkpointed during the
   * walk so a refresh resumes from the last checkpoint instead of restarting;
   * an active pass means `files` is a partial union, never a completion record.
   */
  pass?: { active: boolean; startedAt: number }
  files: Record<string, FileStamp>
}

interface HardCopyResult {
  /** Lineage markers seen while enumerating closure roots. */
  markers: number
  /**
   * Roots whose walk produced no layer at all. `adopt` reports such a root as
   * ONE failure and returns, so its entire unwalked subtree — potentially
   * hundreds of resources — never appears in `missing`. A single failed root
   * therefore means the closure is unmeasured, not merely one item short.
   */
  rootsFailed: number
  /** Signatures named by pool records rather than by any layer. */
  poolReferences: number
  /** References dropped because the walk hit its safety bound. */
  truncated: number
  roots: number
  layers: number
  resources: number
  missing: number
  resolverAvailable: boolean
}

const emptyClosure = (): HardCopyResult => ({
  markers: 0,
  rootsFailed: 0,
  poolReferences: 0,
  truncated: 0,
  roots: 0,
  layers: 0,
  resources: 0,
  missing: 0,
  resolverAvailable: true,
})

interface CompletionSeal {
  kind: 'hypercomb-backup-completion'
  version: 1
  deviceId: string
  manifestSha256: string
  completedAt: number
}

interface SentinelBackupBridge {
  exportBackup?: (
    onFile: (file: { path: string; sha256: string; bytes: ArrayBuffer }) => Promise<void>,
    onProgress?: (progress: { phase: string; current: number; total: number }) => void,
  ) => Promise<{ files: number; bytes: number } | null>
  importBackupFile?: (
    file: { path: string; sha256: string; bytes: ArrayBuffer },
  ) => Promise<boolean>
}

interface DcpBackupManifest {
  kind: 'hypercomb-dcp-backup'
  version: 1
  exportedAt: number
  files: number
  bytes: number
  entries: Record<string, { size: number; sha256: string }>
}

interface ContentBrokerLike {
  adopt?: (
    rootSig: string,
    options?: {
      layersOnly?: boolean
      deepResources?: boolean
      silent?: boolean
      quiet?: boolean
    },
  ) => Promise<{ layers: number; leaves: number; failed: number; truncated?: number }>
  adoptResources?: (
    sigs: readonly string[],
    options?: { deepResources?: boolean; quiet?: boolean },
  ) => Promise<{ leaves: number; failed: number; truncated?: number }>
}

interface PermissionHandle extends FileSystemDirectoryHandle {
  queryPermission?: (options?: { mode?: 'read' | 'readwrite' }) => Promise<PermissionState>
  requestPermission?: (options?: { mode?: 'read' | 'readwrite' }) => Promise<PermissionState>
}

export interface FolderImportResult {
  sourceDevice: string
  sourceDevices: string[]
  copied: number
  identical: number
  conflicts: number
  invalid: number
}

type MarkerPayload = {
  lineageSig: string
  markerName: string
  bytes: ArrayBuffer
}

const validSegment = (name: string): boolean =>
  !!name && name !== '.' && name !== '..' && !/[\\/]/.test(name)

// Effect payloads cross module and worker boundaries, where `instanceof`
// compares against a different realm's constructor and reports false for a
// perfectly good buffer. Tag inspection is realm-independent.
const isArrayBuffer = (value: unknown): value is ArrayBuffer =>
  Object.prototype.toString.call(value) === '[object ArrayBuffer]'

/** Every 64-hex signature reachable inside a parsed record. */
const collectSigs = (value: unknown, out: Set<string>): void => {
  if (typeof value === 'string') {
    const s = value.toLowerCase()
    if (SIG_RE.test(s)) out.add(s)
    return
  }
  if (Array.isArray(value)) { for (const v of value) collectSigs(v, out); return }
  if (value && typeof value === 'object') {
    for (const v of Object.values(value as Record<string, unknown>)) collectSigs(v, out)
  }
}

const equalBytes = (a: Uint8Array, b: Uint8Array): boolean => {
  if (a.byteLength !== b.byteLength) return false
  for (let i = 0; i < a.byteLength; i++) if (a[i] !== b[i]) return false
  return true
}

const formatBytes = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const unit = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / 1024 ** unit
  return `${value >= 10 || unit === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`
}

const categoryFor = (
  path: string,
  pools: ReadonlyMap<string, string>,
): string => {
  const parts = path.split('/')
  const first = parts[0]
  if (parts.length === 1) {
    return SIG_RE.test(first.replace(/\.js$/i, ''))
      ? 'root content and resources'
      : 'other root files'
  }
  const meaning = pools.get(first)
  if (meaning) return `pool: ${meaning}`
  if (SIG_RE.test(first)) return 'history folders'
  return `folder: ${first}`
}

const summarizeFiles = (
  files: Record<string, FileStamp>,
): { totalBytes: number; categories: Record<string, CategoryStamp> } => {
  let totalBytes = 0
  const categories: Record<string, CategoryStamp> = {}
  for (const stamp of Object.values(files)) {
    totalBytes += stamp.size
    const category = stamp.category ?? 'uncategorized'
    const summary = categories[category] ?? { files: 0, bytes: 0 }
    summary.files++
    summary.bytes += stamp.size
    categories[category] = summary
  }
  return { totalBytes, categories }
}

const readJson = async <T>(
  dir: FileSystemDirectoryHandle,
  name: string,
): Promise<T | null> => {
  try {
    const handle = await dir.getFileHandle(name, { create: false })
    return JSON.parse(await (await handle.getFile()).text()) as T
  } catch {
    return null
  }
}

const writeFile = async (
  dir: FileSystemDirectoryHandle,
  name: string,
  bytes: ArrayBuffer | ArrayBufferView | Blob | string,
): Promise<void> => {
  const handle = await dir.getFileHandle(name, { create: true })
  const writable = await handle.createWritable()
  try {
    await writable.write(bytes as FileSystemWriteChunkType)
  } finally {
    await writable.close()
  }
}

const readFileBytes = async (
  dir: FileSystemDirectoryHandle,
  name: string,
): Promise<ArrayBuffer | null> => {
  try {
    return await (await (await dir.getFileHandle(name, { create: false })).getFile()).arrayBuffer()
  } catch {
    return null
  }
}

const directoryAt = async (
  root: FileSystemDirectoryHandle,
  segments: readonly string[],
  create: boolean,
): Promise<FileSystemDirectoryHandle> => {
  let current = root
  for (const segment of segments) {
    if (!validSegment(segment)) throw new Error(`unsafe backup path segment: ${segment}`)
    current = await current.getDirectoryHandle(segment, { create })
  }
  return current
}

async function* walkFiles(
  dir: FileSystemDirectoryHandle,
  prefix = '',
): AsyncGenerator<{ path: string; handle: FileSystemFileHandle }> {
  for await (const [name, handle] of (dir as any).entries()) {
    if (!validSegment(name)) continue
    const path = prefix ? `${prefix}/${name}` : name
    if (handle.kind === 'file') {
      yield { path, handle: handle as FileSystemFileHandle }
    } else if (handle.kind === 'directory') {
      yield* walkFiles(handle as FileSystemDirectoryHandle, path)
    }
  }
}

export class FolderSyncService {
  readonly #deviceId = this.#loadDeviceId()
  #selected: FileSystemDirectoryHandle | null = null
  #backupHandle: FileSystemDirectoryHandle | null = null
  #manifest: DeviceManifest | null = null
  #serial: Promise<void> = Promise.resolve()
  #reconciling = false
  // A full pass is expensive and idempotent, so a second request while one is
  // in flight must JOIN it, never queue a repeat. Without this, `connect()` and
  // the boot-time passive reconciliation each enqueued a complete pass and the
  // second started the instant the first finished.
  #fullPass: Promise<void> | null = null
  #fullPassRanThisSession = false
  #pendingMirrors = new Map<string, { relativePath: string[]; bytes: ArrayBuffer }>()
  #mirrorDrainScheduled = false
  #lastPathReportAt = 0
  #lastState: FolderSyncState = {
    status: 'unconfigured',
    deviceId: this.#deviceId,
    at: Date.now(),
  }

  constructor() {
    EffectBus.on<{ sig: string; bytes: ArrayBuffer }>('content:wrote', payload => {
      if (!SIG_RE.test(payload?.sig ?? '') || !isArrayBuffer(payload?.bytes)) return
      // A full reconciliation scans OPFS after hard-copy materialization.
      // Mirroring each materialized object separately would duplicate that
      // work and, once the full pass finished, downgrade its inventory to a
      // succession of misleading local-mode snapshots.
      if (this.#reconciling) return
      this.#queueMirror([payload.sig], payload.bytes)
    })
    EffectBus.on<MarkerPayload>('history:marker-wrote', payload => {
      if (!SIG_RE.test(payload?.lineageSig ?? '')
          || !/^\d{8}$/.test(payload?.markerName ?? '')
          || !isArrayBuffer(payload?.bytes)) return
      if (this.#reconciling) return
      this.#queueMirror([payload.lineageSig, payload.markerName], payload.bytes)
    })
    EffectBus.on('folder-sync:show-location', () => {
      void this.#showBackupLocation()
    })

    // Handle lookup is detached from boot. Merely loading a stored handle
    // never prompts; a later explicit `/folder-sync resume` may re-authorize.
    setTimeout(() => { void this.initialize() }, 2_000)
  }

  public readonly isSupported = (): boolean =>
    typeof (window as any).showDirectoryPicker === 'function'

  public readonly state = (): FolderSyncState => ({ ...this.#lastState })

  public readonly settings = (): FolderSyncSettings => ({
    automatic: localStorage.getItem(AUTO_KEY) !== 'false',
    // Before settings v2 the passive drain silently stored `local`, which is
    // not a portable backup. Migrate that legacy value once to the safe mode.
    mode: localStorage.getItem(SETTINGS_VERSION_KEY) === SETTINGS_VERSION
      && localStorage.getItem(AUTO_MODE_KEY) === 'local'
      ? 'local'
      : 'hard-copy',
  })

  public readonly configure = (settings: FolderSyncSettings): void => {
    localStorage.setItem(AUTO_KEY, String(settings.automatic))
    localStorage.setItem(AUTO_MODE_KEY, settings.mode)
    localStorage.setItem(SETTINGS_VERSION_KEY, SETTINGS_VERSION)
    EffectBus.emit('folder-sync:settings', this.settings())
  }

  public readonly showLocation = async (): Promise<void> => this.#showBackupLocation()

  public readonly initialize = async (): Promise<void> => {
    if (!this.isSupported()) {
      this.#report('unsupported')
      return
    }
    // A handle established by an explicit connect/resume outranks the stored
    // lookup. Overwriting it with a null read silently disabled every
    // subsequent drain — the boot lookup lands AFTER an early connect.
    this.#selected ??= await this.#loadHandle()
    if (!this.#selected) {
      this.#report('unconfigured')
      return
    }
    const permission = await this.#permission(this.#selected, false)
    if (permission !== 'granted') {
      this.#report('needs-permission', { folder: this.#selected.name })
      return
    }
    this.#report('backed-up', { folder: this.#selected.name })
    // Resume as a slow one-way drain. This never performs network reads and
    // waits for an idle slice so startup and first paint do not contend with a
    // complete OPFS reconciliation.
    if (this.settings().automatic) this.#schedulePassiveReconciliation()
  }

  /** Must be called from a user gesture: opens the directory picker. */
  public readonly connect = async (mode: FolderSyncMode = 'hard-copy'): Promise<boolean> => {
    if (!this.isSupported()) {
      this.#report('unsupported')
      return false
    }
    let selected: FileSystemDirectoryHandle
    try {
      selected = await (window as any).showDirectoryPicker({
        id: 'hypercomb-folder-backup',
        mode: 'readwrite',
      }) as FileSystemDirectoryHandle
    } catch (error) {
      if ((error as DOMException)?.name !== 'AbortError') {
        this.#report('error', { error: String(error) })
      }
      return false
    }
    this.#selected = selected
    this.#backupHandle = null
    await this.#saveHandle(selected)
    await this.syncNow(mode)
    return ['backed-up', 'incomplete'].includes(this.#lastState.status)
  }

  /** Re-authorize a remembered handle, or choose one when none is stored. */
  public readonly resume = async (mode: FolderSyncMode = 'hard-copy'): Promise<boolean> => {
    if (!this.#selected) this.#selected = await this.#loadHandle()
    if (!this.#selected) return this.connect(mode)
    const permission = await this.#permission(this.#selected, true)
    if (permission !== 'granted') {
      this.#report('needs-permission', { folder: this.#selected.name })
      return false
    }
    await this.syncNow(mode)
    return ['backed-up', 'incomplete'].includes(this.#lastState.status)
  }

  /** Forget access only. Existing backup bytes are intentionally untouched. */
  public readonly disconnect = async (): Promise<void> => {
    this.#selected = null
    this.#backupHandle = null
    this.#manifest = null
    await this.#deleteHandle()
    this.#report('unconfigured')
  }

  /**
   * Complete OPFS reconciliation. Serialized behind incremental writes, and
   * deduplicated: a request made while a pass is in flight joins that pass.
   */
  public readonly syncNow = (mode: FolderSyncMode = 'hard-copy'): Promise<void> => {
    if (this.#fullPass) return this.#fullPass
    const run = this.#enqueue(() => this.#syncAll(mode)).finally(() => {
      this.#fullPass = null
      this.#fullPassRanThisSession = true
    })
    this.#fullPass = run
    return run
  }

  /**
   * Re-hash every file this device's manifest lists and compare it against the
   * recorded signature. A copy pass deliberately does NOT do this — it skips
   * unchanged content on name and size, which is sound because content is
   * addressed by its own hash. This is where the participant can demand the
   * expensive proof instead, and it is the only thing that legitimately
   * advances `verifiedAt`.
   */
  public readonly verify = (): Promise<void> => this.#enqueue(() => this.#verifyAll())

  /**
   * Choose a portable backup and union its newest device snapshot into OPFS.
   * Existing differing files are conflicts and are never overwritten.
   */
  public readonly importFromFolder = async (): Promise<FolderImportResult | null> => {
    if (!this.isSupported()) return null
    let selected: FileSystemDirectoryHandle
    try {
      selected = await (window as any).showDirectoryPicker({
        id: 'hypercomb-folder-import',
        mode: 'read',
      }) as FileSystemDirectoryHandle
    } catch {
      return null
    }

    const backup = await this.#resolveBackupRoot(selected)
    if (!backup) throw new Error('The selected folder is not a Hypercomb backup.')
    // A DCP snapshot is an OPTIONAL component of a backup. A browser without
    // the installer writes a complete participant tree and no dcp/ directory;
    // requiring one made every such backup permanently unimportable, and made
    // import impossible in a private window, where DCP can never be present.
    const dcpSnapshot = await this.#verifiedDcpSnapshot(backup)
    if (dcpSnapshot === null) {
      throw new Error('This backup contains a DCP snapshot, but it is not sealed, complete, and verified.')
    }
    const sources = await this.#deviceSnapshots(backup)
    if (sources.length === 0) {
      throw new Error('The selected folder contains no sealed, complete, verified hard-copy snapshots.')
    }

    if (dcpSnapshot !== 'absent') {
      const getSentinel = (globalThis as any).__getSentinel as
        | (() => Promise<SentinelBackupBridge | null>)
        | undefined
      const existingBridge = (globalThis as any).__sentinelBridge as SentinelBackupBridge | undefined
      const restoreBridge = existingBridge?.importBackupFile ? existingBridge : await getSentinel?.()
      // The participant tree below is still importable without DCP; only the
      // profile half of this backup is skipped, and it is reported as such.
      if (restoreBridge?.importBackupFile) {
        for (const [path, stamp] of Object.entries(dcpSnapshot.manifest.entries)) {
          const bytes = await this.#readPath(dcpSnapshot.opfs, path)
          if (!bytes || !(await restoreBridge.importBackupFile({
            path,
            sha256: stamp.sha256,
            bytes,
          }))) {
            throw new Error(`DCP restore failed for "${path}". No profile files were imported.`)
          }
        }
      }
    }

    const opfs = await navigator.storage.getDirectory()
    const result: FolderImportResult = {
      sourceDevice: sources[0].deviceId,
      sourceDevices: sources.map(source => source.deviceId),
      copied: 0,
      identical: 0,
      conflicts: 0,
      invalid: 0,
    }

    const agentId = `folder-import:${this.#deviceId}`
    EffectBus.emit('agent:start', {
      id: agentId,
      behavior: 'folder-sync',
      kind: 'script',
      request: `Import private folder backup from ${sources.length} device snapshot${sources.length === 1 ? '' : 's'}`,
      targets: ['opfs'],
      segments: [],
    })
    try {
      let seen = 0
      // Newest snapshots go first. When ordinary mutable paths differ,
      // the newest backup supplies a missing local file and older variants
      // are then reported as conflicts. Existing local bytes still always
      // win: import is union-only and never overwrites.
      for (const source of sources) {
        for await (const entry of walkFiles(source.opfs)) {
          const parts = entry.path.split('/')
          const name = parts.pop()!
          if (!parts.every(validSegment) || !validSegment(name)) {
            result.invalid++
            continue
          }
          const incomingFile = await entry.handle.getFile()
          const incoming = new Uint8Array(await incomingFile.arrayBuffer())

          // Flat root content is addressed by sha256. Never import poisoned
          // bytes under a trusted-looking signature.
          if (parts.length === 0 && SIG_RE.test(name)) {
            const actual = await SignatureService.sign(incoming.buffer as ArrayBuffer)
            if (actual !== name) {
              result.invalid++
              continue
            }
          }

          const destinationDir = await directoryAt(opfs, parts, true)
          let existing: FileSystemFileHandle | null = null
          try {
            existing = await destinationDir.getFileHandle(name, { create: false })
          } catch {
            existing = null
          }

          if (existing) {
            const current = new Uint8Array(await (await existing.getFile()).arrayBuffer())
            if (equalBytes(current, incoming)) result.identical++
            else result.conflicts++
          } else {
            await writeFile(destinationDir, name, incoming)
            result.copied++
          }

          if (++seen % 50 === 0) {
            EffectBus.emit('agent:progress', {
              id: agentId,
              activity: `verified ${seen} files; imported ${result.copied}`,
            })
          }
        }
      }
      EffectBus.emit('agent:end', {
        id: agentId,
        ok: result.conflicts === 0 && result.invalid === 0,
        summary: `imported ${result.copied}; ${result.conflicts} conflicts; ${result.invalid} invalid`,
      })
      return result
    } catch (error) {
      EffectBus.emit('agent:end', {
        id: agentId,
        ok: false,
        summary: String(error),
      })
      throw error
    }
  }

  readonly #syncAll = async (mode: FolderSyncMode): Promise<void> => {
    const selected = this.#selected
    if (!selected) {
      this.#report('unconfigured')
      return
    }
    if (await this.#permission(selected, false) !== 'granted') {
      this.#report('needs-permission', { folder: selected.name })
      return
    }
    // Resolve and retain the exact directory receiving the backup. UI actions
    // must open this handle, not the participant-selected parent.
    this.#backupHandle = await selected.getDirectoryHandle(BACKUP_DIR, { create: true })

    const agentId = `folder-sync:${this.#deviceId}`
    this.#report('syncing', {
      folder: selected.name,
      mode,
      phase: mode === 'hard-copy'
        ? 'Finding and materializing referenced content'
        : 'Scanning every local OPFS file',
    })
    EffectBus.emit('agent:start', {
      id: agentId,
      behavior: 'folder-sync',
      kind: 'script',
      request: `Back up this device to ${selected.name}`,
      targets: ['folder-backup'],
      segments: [],
    })
    if (mode === 'hard-copy') {
      EffectBus.emit('toast:show', {
        type: 'info',
        title: 'Folder backup destination',
        message: `${selected.name}\\${BACKUP_DIR} — click to open the native folder window at this location.`,
        duration: 0,
        actionLabel: 'Open backup folder',
        actionEffect: 'folder-sync:show-location',
      })
    }

    this.#reconciling = true
    // Anything already waiting in the passive drain is covered by the full
    // root walk below; discard the duplicate work, never the source bytes.
    this.#pendingMirrors.clear()

    try {
      const source = await navigator.storage.getDirectory()
      const hardCopy = mode === 'hard-copy'
        ? await this.#materializeHardCopy(source, selected.name, mode, agentId)
        : emptyClosure()

      const backup = this.#backupHandle
      await this.#writeRootManifest(backup)
      if (mode === 'hard-copy') {
        const dcpSnapshot = await this.#exportDcpBackup(backup, agentId)
        if (dcpSnapshot === null) {
          hardCopy.resolverAvailable = false
          hardCopy.missing++
        } else if (dcpSnapshot !== 'absent') {
          this.#report('syncing', {
            folder: selected.name,
            mode,
            phase: 'DCP packages and resources copied and verified',
            dcpFiles: dcpSnapshot.files,
            dcpBytes: dcpSnapshot.bytes,
          })
        }
      }
      const devices = await backup.getDirectoryHandle(DEVICES_DIR, { create: true })
      const device = await devices.getDirectoryHandle(this.#deviceId, { create: true })
      const destination = await device.getDirectoryHandle('opfs', { create: true })
      const prior = await readJson<DeviceManifest>(device, DEVICE_MANIFEST)
      const manifest: DeviceManifest = prior?.kind === 'hypercomb-folder-backup-device'
        && prior.deviceId === this.#deviceId
        ? {
            ...this.#freshManifest(),
            ...prior,
            version: 2,
            files: prior.files ?? {},
            categories: prior.categories ?? {},
          }
        : this.#freshManifest()
      const previousFiles = manifest.files
      const nextFiles: Record<string, FileStamp> = {}
      manifest.pass = { active: true, startedAt: Date.now() }
      const pools = await poolMeanings()
      let scanned = 0
      let copied = 0
      let copiedBytes = 0
      let totalBytes = 0

      for await (const entry of walkFiles(source)) {
        const file = await entry.handle.getFile()
        const parts = entry.path.split('/')
        const name = parts.pop()!
        // A root-level sig-named file is content-addressed: the NAME is the
        // hash, and the bytes behind a signature can never change. Presence at
        // the right size is therefore a complete answer — no read, no hash.
        const contentSig = parts.length === 0 && SIG_RE.test(name) ? name : null
        const old = previousFiles[entry.path]
        const stamp: FileStamp = {
          size: file.size,
          modified: file.lastModified,
          sha256: contentSig ?? old?.sha256,
          category: categoryFor(entry.path, pools),
        }
        // Mutable paths (markers, records) fall back to size + mtime against
        // the recorded stamp; a recorded hash is required so the import-time
        // verifier still has something to check.
        const cheapMatch = contentSig !== null
          || (!!old?.sha256 && old.size === file.size && old.modified === file.lastModified)

        const targetDir = await directoryAt(destination, parts, true)
        let present = false
        if (cheapMatch) {
          try {
            present = (await (
              await targetDir.getFileHandle(name, { create: false })
            ).getFile()).size === file.size
          } catch {
            present = false
          }
        }
        if (!present) {
          // The only path that touches bytes: one read, one write. Byte-level
          // re-verification of the whole mirror belongs to import (which
          // re-hashes every listed file) and to an explicit verify pass —
          // not to every drain.
          const sourceBuffer = await file.arrayBuffer()
          stamp.sha256 = contentSig ?? await SignatureService.sign(sourceBuffer)
          await writeFile(targetDir, name, sourceBuffer)
          copied++
          copiedBytes += stamp.size
        }
        nextFiles[entry.path] = stamp
        scanned++
        totalBytes += stamp.size
        if (scanned % CHECKPOINT_FILES === 0) {
          // Checkpoint: the manifest is the resume cursor. Union with the
          // prior record so an interrupted pass never discards knowledge of
          // files it has not reached yet, and mark the pass active so this
          // partial record is never mistaken for a completion.
          await this.#checkpoint(device, manifest, { ...previousFiles, ...nextFiles })
        }
        this.#reportLatestPath(
          agentId,
          `${selected.name}\\${BACKUP_DIR}\\${DEVICES_DIR}\\${this.#deviceId}\\opfs\\${entry.path.replaceAll('/', '\\')}`,
        )
        if (scanned % 25 === 0) {
          this.#report('syncing', {
            folder: selected.name,
            mode,
            phase: 'Copying every new or changed root file and folder',
            copied,
            scanned,
            copiedBytes,
            totalBytes,
            resolvedLayers: hardCopy.layers,
            resolvedResources: hardCopy.resources,
            missingReferences: hardCopy.missing,
          })
          EffectBus.emit('agent:progress', {
            id: agentId,
            activity: `verified ${scanned} files (${formatBytes(totalBytes)}); wrote ${formatBytes(copiedBytes)}`,
          })
        }
      }

      manifest.files = nextFiles
      manifest.pass = { active: false, startedAt: manifest.pass?.startedAt ?? Date.now() }
      manifest.updatedAt = Date.now()
      manifest.verifiedAt = manifest.updatedAt
      const retainedPortable = mode === 'local'
        && prior?.mode === 'hard-copy'
        && prior.closure?.resolverAvailable
        && prior.closure.missing === 0
      manifest.mode = retainedPortable ? 'hard-copy' : mode
      manifest.closure = retainedPortable ? prior.closure : hardCopy
      manifest.fileCount = scanned
      const summary = summarizeFiles(nextFiles)
      manifest.totalBytes = summary.totalBytes
      manifest.categories = summary.categories
      const complete = manifest.mode === 'hard-copy'
        && manifest.closure.resolverAvailable
        && manifest.closure.missing === 0
        && (manifest.closure.rootsFailed ?? 0) === 0
      await this.#writeManifestAndSeal(device, manifest, complete)
      await this.#writeDeviceInventory(device, manifest, manifest.mode, manifest.closure)
      await this.#writeBackupReport(backup)
      this.#manifest = manifest
      const passSucceeded = mode === 'local'
        || (hardCopy.resolverAvailable && hardCopy.missing === 0 && hardCopy.rootsFailed === 0)
      let dcpManifest: DcpBackupManifest | null = null
      if (mode === 'hard-copy') {
        try {
          dcpManifest = await readJson<DcpBackupManifest>(
            await backup.getDirectoryHandle(DCP_DIR, { create: false }),
            DCP_MANIFEST,
          )
        } catch { /* the incomplete state below explains the absent DCP copy */ }
      }
      this.#report(passSucceeded ? 'backed-up' : 'incomplete', {
        folder: selected.name,
        mode: manifest.mode,
        phase: passSucceeded
          ? mode === 'hard-copy' ? 'Portable hard copy verified' : 'Exact local mirror verified'
          : 'Local bytes verified; some referenced bytes could not be materialized',
        copied,
        scanned,
        copiedBytes,
        totalBytes: manifest.totalBytes + (dcpManifest?.bytes ?? 0),
        dcpFiles: dcpManifest?.files ?? 0,
        dcpBytes: dcpManifest?.bytes ?? 0,
        categories: manifest.categories,
        resolvedLayers: hardCopy.layers,
        resolvedResources: hardCopy.resources,
        missingReferences: hardCopy.missing,
        closureRoots: hardCopy.roots,
        failedRoots: hardCopy.rootsFailed,
        error: passSucceeded
          ? undefined
          : hardCopy.resolverAvailable
            ? `${hardCopy.missing} referenced item${hardCopy.missing === 1 ? '' : 's'} could not be made local`
              + (hardCopy.rootsFailed > 0
                ? ` — and ${hardCopy.rootsFailed} of ${hardCopy.roots} closure roots produced no layer, so everything beneath them is unmeasured`
                : '')
            : 'the content resolver was unavailable, so remote references could not be audited',
      })
      EffectBus.emit('agent:end', {
        id: agentId,
        ok: passSucceeded,
        summary: `${scanned} files / ${formatBytes(totalBytes)} verified; ${copied} files / ${formatBytes(copiedBytes)} written; ${hardCopy.missing} references missing`,
      })
      EffectBus.emit('activity:log', {
        message: passSucceeded
          ? `${mode === 'hard-copy' ? 'portable hard copy' : 'local mirror'} verified: ${scanned} files (${formatBytes(totalBytes)}) in ${selected.name}; see ${BACKUP_DIR}/${BACKUP_REPORT}`
          : `backup copied ${scanned} local files (${formatBytes(totalBytes)}) but is not fully portable: ${hardCopy.missing} referenced items are missing`,
        icon: passSucceeded ? '◈' : '!',
      })
    } catch (error) {
      this.#report('error', {
        folder: selected.name,
        error: error instanceof Error ? error.message : String(error),
      })
      EffectBus.emit('agent:end', {
        id: agentId,
        ok: false,
        summary: String(error),
      })
    } finally {
      this.#reconciling = false
    }
  }

  readonly #verifyAll = async (): Promise<void> => {
    const selected = this.#selected
    if (!selected) {
      this.#report('unconfigured')
      return
    }
    if (await this.#permission(selected, false) !== 'granted') {
      this.#report('needs-permission', { folder: selected.name })
      return
    }

    const agentId = `folder-verify:${this.#deviceId}`
    EffectBus.emit('agent:start', {
      id: agentId,
      behavior: 'folder-sync',
      kind: 'script',
      request: `Re-hash every backed-up file in ${selected.name}`,
      targets: ['folder-backup'],
      segments: [],
    })
    try {
      const backup = await selected.getDirectoryHandle(BACKUP_DIR, { create: false })
      const devices = await backup.getDirectoryHandle(DEVICES_DIR, { create: false })
      const device = await devices.getDirectoryHandle(this.#deviceId, { create: false })
      const opfs = await device.getDirectoryHandle('opfs', { create: false })
      const manifest = await readJson<DeviceManifest>(device, DEVICE_MANIFEST)
      if (manifest?.kind !== 'hypercomb-folder-backup-device') {
        throw new Error('this device has no backup manifest to verify against')
      }

      const entries = Object.entries(manifest.files ?? {})
      const damaged: string[] = []
      let verified = 0
      let verifiedBytes = 0
      for (const [path, stamp] of entries) {
        const bytes = await this.#readPath(opfs, path)
        // A stamp with no recorded hash cannot be proven. Copying it again is
        // the fix, so it counts as damaged rather than quietly passing.
        if (!bytes || !stamp.sha256
            || bytes.byteLength !== stamp.size
            || await SignatureService.sign(bytes) !== stamp.sha256) {
          damaged.push(path)
        } else {
          verified++
          verifiedBytes += bytes.byteLength
        }
        if ((verified + damaged.length) % 25 === 0) {
          this.#report('syncing', {
            folder: selected.name,
            mode: manifest.mode,
            phase: `Re-hashing every backed-up file (${verified + damaged.length}/${entries.length})`,
            verified,
            damaged: damaged.length,
            scanned: entries.length,
            totalBytes: verifiedBytes,
          })
          EffectBus.emit('agent:progress', {
            id: agentId,
            activity: `re-hashed ${verified + damaged.length}/${entries.length}; ${damaged.length} damaged`,
          })
        }
      }

      const sound = damaged.length === 0
      if (sound) {
        // Only a real re-hash may advance this. The copy pass moves
        // `updatedAt` alone.
        manifest.verifiedAt = Date.now()
        const complete = manifest.mode === 'hard-copy'
          && manifest.closure?.resolverAvailable === true
          && manifest.closure.missing === 0
          && (manifest.closure.rootsFailed ?? 0) === 0
        await this.#writeManifestAndSeal(device, manifest, complete)
        await this.#writeDeviceInventory(device, manifest, manifest.mode, manifest.closure)
        await this.#writeBackupReport(backup)
        this.#manifest = manifest
      }
      this.#report(sound ? 'backed-up' : 'incomplete', {
        folder: selected.name,
        mode: manifest.mode,
        phase: sound
          ? `Re-hashed and matched all ${verified} backed-up files`
          : `${damaged.length} backed-up file${damaged.length === 1 ? '' : 's'} did not match`,
        verified,
        damaged: damaged.length,
        scanned: entries.length,
        totalBytes: verifiedBytes,
        error: sound
          ? undefined
          : `${damaged.length} file${damaged.length === 1 ? '' : 's'} damaged or missing`
            + ` (first: ${damaged.slice(0, 3).join(', ')}) — run /folder-sync hard-copy to rewrite them`,
      })
      EffectBus.emit('agent:end', {
        id: agentId,
        ok: sound,
        summary: `${verified} verified (${formatBytes(verifiedBytes)}); ${damaged.length} damaged`,
      })
      EffectBus.emit('activity:log', {
        message: sound
          ? `backup verified byte for byte: ${verified} files (${formatBytes(verifiedBytes)}) in ${selected.name}`
          : `backup verification FAILED: ${damaged.length} of ${entries.length} files damaged or missing`,
        icon: sound ? '◈' : '!',
      })
    } catch (error) {
      this.#report('error', {
        folder: selected.name,
        error: error instanceof Error ? error.message : String(error),
      })
      EffectBus.emit('agent:end', { id: agentId, ok: false, summary: String(error) })
    }
  }

  /**
   * Make every history revision's reachable layer/resource closure physical
   * before a hard-copy pass. The broker's adopt walker first checks OPFS, then
   * resolves only missing bytes from configured hosts/peers, verifies their
   * signatures, and writes them into OPFS. The folder pass that follows copies
   * those actual bytes. A failed resolution is counted and makes the final
   * state `incomplete`; it can never be reported as a portable hard copy.
   */
  readonly #materializeHardCopy = async (
    source: FileSystemDirectoryHandle,
    folder: string,
    mode: FolderSyncMode,
    agentId: string,
  ): Promise<HardCopyResult> => {
    const roots = new Set<string>()
    // Content named by pool records — threads, clipboard, manifests — that no
    // layer references. Nothing else in the walk would ever pull it local, so
    // without this a hard copy silently omits it.
    const poolReferenced = new Set<string>()
    const pools = await poolMeanings()
    let markers = 0
    let markersUnread = 0

    for await (const [name, handle] of (source as any).entries()) {
      if (handle.kind === 'directory' && pools.has(name)) {
        await this.#collectPoolReferences(handle as FileSystemDirectoryHandle, poolReferenced)
        continue
      }
      if (handle.kind !== 'directory' || !SIG_RE.test(name)) continue
      for await (const [markerName, markerHandle] of (handle as any).entries()) {
        if (markerHandle.kind !== 'file' || !MARKER_RE.test(markerName)) continue
        markers++
        try {
          const marker = await (markerHandle as FileSystemFileHandle).getFile()
          const extracted = await extractLayerSigFromMarker(await marker.arrayBuffer())
          if (SIG_RE.test(extracted.layerSig)) roots.add(extracted.layerSig.toLowerCase())
        } catch {
          // Extraction itself does not throw (a legacy marker falls back to
          // hashing its own bytes), so this is only reached when the marker
          // file cannot be read. The root it would have named is lost, which
          // the pass must not treat as "nothing to fetch".
          markersUnread++
        }
      }
    }

    const broker = (window as any).ioc?.get?.(CONTENT_BROKER_KEY) as ContentBrokerLike | undefined
    if ((roots.size > 0 || poolReferenced.size > 0) && !broker?.adopt) {
      return {
        ...emptyClosure(),
        markers,
        roots: roots.size,
        rootsFailed: roots.size,
        missing: roots.size + markersUnread,
        resolverAvailable: false,
      }
    }

    const result: HardCopyResult = {
      ...emptyClosure(),
      markers,
      roots: roots.size,
      // An unread marker names a root that was never walked. That is an
      // unaudited closure, and must never pass as portable just because no
      // fetch was attempted for it.
      missing: markersUnread,
    }
    let index = 0
    for (const root of roots) {
      index++
      this.#report('syncing', {
        folder,
        mode,
        phase: `Materializing referenced content ${index}/${roots.size}`,
        resolvedLayers: result.layers,
        resolvedResources: result.resources,
        missingReferences: result.missing,
      })
      EffectBus.emit('agent:progress', {
        id: agentId,
        activity: `materializing referenced content ${index}/${roots.size}`,
      })
      try {
        // deepResources: a hard copy is everything. A layer names content by
        // signature, and so do many resources — without descent the pass
        // fetches the contracts and calls it complete while the bytes they
        // name stay remote.
        const stats = await broker!.adopt!(root, {
          deepResources: true,
          silent: true,
          quiet: true,
        })
        result.layers += stats.layers
        result.resources += stats.leaves
        // A walk that hit its safety bound left content unfetched. That is
        // missing content, not a completed closure.
        result.missing += stats.failed + (stats.truncated ?? 0)
        result.truncated += stats.truncated ?? 0
        // No layer at all means the walk stopped at the root: nothing below
        // it was enumerated, so `missing` (which grew by exactly one) is not
        // a measure of what this closure actually lacks.
        if (stats.layers === 0) result.rootsFailed++
      } catch {
        result.rootsFailed++
        result.missing++
      }
    }

    // Pool-named content last: by now the layer closure is local, so most of
    // these are already-present sigs the broker resolves for free.
    if (poolReferenced.size > 0 && broker?.adoptResources) {
      this.#report('syncing', {
        folder,
        mode,
        phase: `Materializing ${poolReferenced.size} items named by pool records`,
        resolvedLayers: result.layers,
        resolvedResources: result.resources,
        missingReferences: result.missing,
      })
      try {
        const stats = await broker.adoptResources([...poolReferenced], {
          deepResources: true,
          quiet: true,
        })
        result.poolReferences = poolReferenced.size
        result.resources += stats.leaves
        result.missing += stats.failed + (stats.truncated ?? 0)
        result.truncated += stats.truncated ?? 0
      } catch {
        result.poolReferences = poolReferenced.size
        result.missing += poolReferenced.size
      }
    } else if (poolReferenced.size > 0) {
      // No resource-rooted entry point available: this content is unaudited,
      // which is a missing closure, not a clean pass.
      result.poolReferences = poolReferenced.size
      result.missing += poolReferenced.size
    }
    return result
  }

  /**
   * Signatures named by the records in one pool of meaning. Records are JSON;
   * anything that does not parse as an object/array is a leaf and is never
   * scanned, so this can never blind-harvest hex out of binary content.
   */
  readonly #collectPoolReferences = async (
    pool: FileSystemDirectoryHandle,
    out: Set<string>,
  ): Promise<void> => {
    for await (const entry of walkFiles(pool)) {
      try {
        const text = (await (await entry.handle.getFile()).text()).trim()
        if (!text.startsWith('{') && !text.startsWith('[')) continue
        collectSigs(JSON.parse(text), out)
      } catch {
        // An unreadable or non-JSON pool record names nothing we can follow.
        // Its own bytes are still copied verbatim by the OPFS walk.
      }
    }
  }

  readonly #mirrorIncremental = async (
    entries: Array<{ relativePath: string[]; bytes: ArrayBuffer }>,
  ): Promise<void> => {
    const selected = this.#selected
    if (!selected || entries.length === 0
        || await this.#permission(selected, false) !== 'granted') return
    try {
      const backup = await selected.getDirectoryHandle(BACKUP_DIR, { create: true })
      const devices = await backup.getDirectoryHandle(DEVICES_DIR, { create: true })
      const device = await devices.getDirectoryHandle(this.#deviceId, { create: true })
      const opfs = await device.getDirectoryHandle('opfs', { create: true })
      const manifest = this.#manifest ?? await readJson<DeviceManifest>(device, DEVICE_MANIFEST)
        ?? this.#freshManifest()
      const pools = await poolMeanings()
      let copiedBytes = 0
      for (const entry of entries) {
        const parts = [...entry.relativePath]
        const name = parts.pop()!
        const target = await directoryAt(opfs, parts, true)
        await writeFile(target, name, entry.bytes)
        const written = new Uint8Array(await (
          await (await target.getFileHandle(name, { create: false })).getFile()
        ).arrayBuffer())
        const incoming = new Uint8Array(entry.bytes)
        if (!equalBytes(incoming, written)) {
          throw new Error(`read-back verification failed for OPFS path "${entry.relativePath.join('/')}"`)
        }
        const path = entry.relativePath.join('/')
        manifest.files[path] = {
          size: entry.bytes.byteLength,
          modified: Date.now(),
          sha256: await SignatureService.sign(entry.bytes),
          category: categoryFor(path, pools),
        }
        copiedBytes += entry.bytes.byteLength
      }
      manifest.updatedAt = Date.now()
      manifest.verifiedAt = manifest.updatedAt
      // A drain only ADDS bytes, so it must never restate closure facts.
      // Overwriting them erased the record of what a full pass reported
      // missing AND dropped the snapshot below the bar `#deviceSnapshots`
      // requires, quietly making a backup unrestorable with no signal.
      const remainsPortable = manifest.mode === 'hard-copy'
        && manifest.closure?.resolverAvailable === true
        && manifest.closure.missing === 0
        && (manifest.closure.rootsFailed ?? 0) === 0
      manifest.fileCount = Object.keys(manifest.files).length
      const summary = summarizeFiles(manifest.files)
      manifest.totalBytes = summary.totalBytes
      manifest.categories = summary.categories
      await this.#writeManifestAndSeal(device, manifest, remainsPortable)
      await this.#writeDeviceInventory(device, manifest, manifest.mode, manifest.closure)
      await this.#writeBackupReport(backup)
      this.#manifest = manifest
      this.#report('backed-up', {
        folder: selected.name,
        mode: manifest.mode,
        phase: 'New local bytes drained and verified',
        copied: entries.length,
        scanned: entries.length,
        copiedBytes,
        totalBytes: manifest.totalBytes,
        categories: manifest.categories,
      })
    } catch (error) {
      this.#report('error', {
        folder: selected.name,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  readonly #queueMirror = (relativePath: readonly string[], bytes: ArrayBuffer): void => {
    const path = relativePath.join('/')
    this.#pendingMirrors.set(path, {
      relativePath: [...relativePath],
      bytes: bytes.slice(0),
    })
    if (this.#mirrorDrainScheduled) return
    this.#mirrorDrainScheduled = true
    setTimeout(() => {
      const run = (): void => {
        this.#mirrorDrainScheduled = false
        const entries = [...this.#pendingMirrors.values()]
        this.#pendingMirrors.clear()
        if (entries.length > 0) void this.#enqueue(() => this.#mirrorIncremental(entries))
      }
      const idle = (globalThis as any).requestIdleCallback as
        | ((callback: () => void, options?: { timeout: number }) => number)
        | undefined
      if (idle) idle(run, { timeout: 10_000 })
      else run()
    }, 1_500)
  }

  readonly #resolveBackupRoot = async (
    selected: FileSystemDirectoryHandle,
  ): Promise<FileSystemDirectoryHandle | null> => {
    if (await readJson(selected, ROOT_MANIFEST)) return selected
    try {
      const nested = await selected.getDirectoryHandle(BACKUP_DIR, { create: false })
      return await readJson(nested, ROOT_MANIFEST) ? nested : null
    } catch {
      return null
    }
  }

  readonly #deviceSnapshots = async (
    backup: FileSystemDirectoryHandle,
  ): Promise<Array<{
    deviceId: string
    updatedAt: number
    opfs: FileSystemDirectoryHandle
  }>> => {
    let devices: FileSystemDirectoryHandle
    try {
      devices = await backup.getDirectoryHandle(DEVICES_DIR, { create: false })
    } catch {
      return []
    }
    const snapshots: Array<{
      deviceId: string
      updatedAt: number
      opfs: FileSystemDirectoryHandle
    }> = []
    for await (const [deviceId, handle] of (devices as any).entries()) {
      if (handle.kind !== 'directory' || !validSegment(deviceId)) continue
      const dir = handle as FileSystemDirectoryHandle
      const manifestBytes = await readFileBytes(dir, DEVICE_MANIFEST)
      if (!manifestBytes) continue
      let manifest: DeviceManifest
      try {
        manifest = JSON.parse(new TextDecoder().decode(manifestBytes)) as DeviceManifest
      } catch {
        continue
      }
      if (manifest.kind !== 'hypercomb-folder-backup-device'
          || manifest.pass?.active === true
          || manifest.mode !== 'hard-copy'
          || !manifest.closure?.resolverAvailable
          || manifest.closure.missing !== 0
          || (manifest.closure.rootsFailed ?? 0) !== 0) continue
      const manifestSha256 = await SignatureService.sign(manifestBytes)
      if (!(await this.#hasValidCompletionSeal(dir, manifestSha256, deviceId))) continue
      try {
        const opfs = await dir.getDirectoryHandle('opfs', { create: false })
        if (!(await this.#verifySnapshotFiles(opfs, manifest))) continue
        snapshots.push({ deviceId, updatedAt: manifest.updatedAt, opfs })
      } catch {
        // Incomplete device snapshot.
      }
    }
    return snapshots.sort((a, b) => b.updatedAt - a.updatedAt)
  }

  readonly #writeRootManifest = async (backup: FileSystemDirectoryHandle): Promise<void> => {
    await writeFile(backup, ROOT_MANIFEST, JSON.stringify({
      kind: 'hypercomb-folder-backup',
      version: 3,
      scope: 'complete OPFS root: every root file and every file in every folder',
      updatedAt: Date.now(),
    }, null, 2))
    await writeFile(backup, README_FILE, [
      'HYPERCOMB PORTABLE BACKUP',
      '',
      'WHAT IS HERE',
      'This backup contains a physical byte copy of the complete Origin Private',
      'File System (OPFS) root: every root-level file and every file inside every',
      'folder, recursively. The real bytes are under:',
      '',
      '  devices/<device-id>/opfs/',
      '  dcp/opfs/',
      '',
      'Hypercomb uses content signatures as filenames, so many resources look like',
      'long hexadecimal names. They are real local files, not internet shortcuts.',
      'The dcp/ snapshot is streamed from DCP itself and verified separately. It is',
      'present only when this browser has DCP attached; a browser without it writes',
      'a complete participant backup and no dcp/ directory.',
      '',
      'HOW TO VERIFY IT',
      `Open ${BACKUP_REPORT} for the total file count, byte count, category`,
      'breakdown, and status of every contributing device. Each device directory',
      `also contains ${DEVICE_INVENTORY}, listing every copied OPFS path and size.`,
      '',
      'MODES',
      'local: exact hard bytes already held by this browser; never uses the network.',
      'hard-copy: first materializes everything the hive references, then copies',
      'the expanded OPFS. A signature can name content that itself names more',
      'content, so the walk follows those chains to the end rather than stopping',
      'at the records that hold them, and it also follows content named by pool',
      'records (threads, clipboard, manifests) that no layer points at.',
      'Missing items are reported as incomplete, as is any closure root that',
      'produced no layer — everything beneath such a root is unmeasured, so the',
      'copy cannot be called portable.',
      '',
      'A pass copies only new or changed files: content here is named by its own',
      'signature, so a file already present at the right size is already correct.',
      'Every listed file IS re-hashed and checked at restore time, before any of',
      'it is accepted.',
      '',
      'RESTORE',
      'Use /folder-sync import and choose this directory or its parent.',
      'Import accepts only a complete, cryptographically sealed hard-copy export.',
      'A dcp/ snapshot, when present, is verified and restored first; when this',
      'backup has none, the participant tree is imported on its own.',
      'Existing differing local files are never overwritten automatically.',
      '',
    ].join('\n'))
  }

  readonly #writeDeviceInventory = async (
    device: FileSystemDirectoryHandle,
    manifest: DeviceManifest,
    mode: FolderSyncMode,
    hardCopy: HardCopyResult,
  ): Promise<void> => {
    const lines = [
      'HYPERCOMB DEVICE BACKUP INVENTORY',
      '',
      `Device: ${manifest.deviceId}`,
      `Verified: ${new Date(manifest.verifiedAt).toISOString()}`,
      `Mode: ${mode}`,
      'Scope: complete OPFS root (all root files and all nested folders)',
      `Files: ${manifest.fileCount}`,
      `Physical bytes: ${manifest.totalBytes} (${formatBytes(manifest.totalBytes)})`,
      'This device inventory covers participant/profile OPFS only.',
      `DCP packages and behaviors are inventoried separately in ../../${DCP_DIR}/${DCP_MANIFEST}.`,
      `History markers seen: ${hardCopy.markers}`,
      `Closure roots checked: ${hardCopy.roots}`,
      `Roots that produced no layer (subtree unmeasured): ${hardCopy.rootsFailed}`,
      `Items named by pool records (no layer references them): ${hardCopy.poolReferences}`,
      `References dropped at the safety bound (copy is NOT portable): ${hardCopy.truncated}`,
      `Referenced layers made local: ${hardCopy.layers}`,
      `Referenced resources made local: ${hardCopy.resources}`,
      `Missing referenced items: ${hardCopy.missing}`,
      '',
      'CATEGORY BREAKDOWN',
      ...Object.entries(manifest.categories)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([category, summary]) =>
          `${category}: ${summary.files} files, ${summary.bytes} bytes (${formatBytes(summary.bytes)})`),
      '',
      'EVERY OPFS FILE',
      ...Object.entries(manifest.files)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([path, stamp]) =>
          `${String(stamp.size).padStart(12)}  ${stamp.category ?? 'uncategorized'}  ${path}`),
      '',
      'All paths above exist physically under this device directory\'s opfs/ folder.',
      '',
    ]
    await writeFile(device, DEVICE_INVENTORY, lines.join('\n'))
  }

  readonly #writeBackupReport = async (
    backup: FileSystemDirectoryHandle,
  ): Promise<void> => {
    let devices: FileSystemDirectoryHandle
    try {
      devices = await backup.getDirectoryHandle(DEVICES_DIR, { create: false })
    } catch {
      return
    }
    const manifests: DeviceManifest[] = []
    for await (const [, handle] of (devices as any).entries()) {
      if (handle.kind !== 'directory') continue
      const manifest = await readJson<DeviceManifest>(
        handle as FileSystemDirectoryHandle,
        DEVICE_MANIFEST,
      )
      if (manifest?.kind === 'hypercomb-folder-backup-device') manifests.push(manifest)
    }
    manifests.sort((a, b) => b.updatedAt - a.updatedAt)
    const aggregateFiles = manifests.reduce((sum, manifest) => sum + (manifest.fileCount ?? 0), 0)
    const aggregateBytes = manifests.reduce((sum, manifest) => sum + (manifest.totalBytes ?? 0), 0)
    // Never `create: true` here. An empty dcp/ minted by the report writer
    // reads at import time as "a DCP snapshot that fails verification".
    let dcp: DcpBackupManifest | null = null
    try {
      dcp = await readJson<DcpBackupManifest>(
        await backup.getDirectoryHandle(DCP_DIR, { create: false }),
        DCP_MANIFEST,
      )
    } catch { /* participant-only backup: no DCP half */ }
    const lines = [
      'HYPERCOMB BACKUP REPORT',
      '',
      `Generated: ${new Date().toISOString()}`,
      'Scope: every OPFS root file and every file in every OPFS folder, recursively.',
      `Device snapshots: ${manifests.length}`,
      `Snapshot files: ${aggregateFiles}`,
      `Snapshot bytes: ${aggregateBytes} (${formatBytes(aggregateBytes)})`,
      `DCP files: ${dcp?.files ?? 0}`,
      `DCP bytes: ${dcp?.bytes ?? 0} (${formatBytes(dcp?.bytes ?? 0)})`,
      `Total portable files: ${aggregateFiles + (dcp?.files ?? 0)}`,
      `Total portable bytes: ${aggregateBytes + (dcp?.bytes ?? 0)} (${formatBytes(aggregateBytes + (dcp?.bytes ?? 0))})`,
      '',
      'Each device has its own snapshot so a shared disk, NAS, or synchronized',
      'folder never lets two computers overwrite one another.',
      '',
      ...manifests.flatMap(manifest => [
        `DEVICE ${manifest.deviceId}`,
        `  verified: ${new Date(manifest.verifiedAt || manifest.updatedAt).toISOString()}`,
        `  mode: ${manifest.mode ?? 'legacy local snapshot'}`,
        `  portable closure: ${manifest.mode === 'hard-copy' && manifest.closure?.resolverAvailable && manifest.closure.missing === 0 && (manifest.closure.rootsFailed ?? 0) === 0 ? 'complete' : 'not asserted'}`,
        `  closure roots: ${manifest.closure?.roots ?? 'unknown'} (${manifest.closure?.rootsFailed ?? 'unknown'} produced no layer)`,
        `  missing referenced items: ${manifest.closure?.missing ?? 'unknown'}`,
        `  files: ${manifest.fileCount}`,
        `  bytes: ${manifest.totalBytes ?? 0} (${formatBytes(manifest.totalBytes ?? 0)})`,
        `  inventory: devices/${manifest.deviceId}/${DEVICE_INVENTORY}`,
        ...Object.entries(manifest.categories ?? {})
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([category, summary]) =>
            `    ${category}: ${summary.files} files / ${formatBytes(summary.bytes)}`),
        '',
      ]),
    ]
    await writeFile(backup, BACKUP_REPORT, lines.join('\n'))
  }

  readonly #freshManifest = (): DeviceManifest => ({
    kind: 'hypercomb-folder-backup-device',
    version: 2,
    deviceId: this.#deviceId,
    updatedAt: Date.now(),
    verifiedAt: 0,
    mode: 'local',
    closure: emptyClosure(),
    fileCount: 0,
    totalBytes: 0,
    categories: {},
    files: {},
  })

  /**
   * Persist mid-walk progress. Never sealed and never marked complete: an
   * interrupted pass must resume, not masquerade as a finished backup.
   */
  readonly #checkpoint = async (
    device: FileSystemDirectoryHandle,
    manifest: DeviceManifest,
    files: Record<string, FileStamp>,
  ): Promise<void> => {
    const summary = summarizeFiles(files)
    await writeFile(device, DEVICE_MANIFEST, new TextEncoder().encode(JSON.stringify({
      ...manifest,
      files,
      fileCount: Object.keys(files).length,
      totalBytes: summary.totalBytes,
      categories: summary.categories,
      updatedAt: Date.now(),
      pass: { active: true, startedAt: manifest.pass?.startedAt ?? Date.now() },
    } satisfies DeviceManifest, null, 2)))
  }

  readonly #writeManifestAndSeal = async (
    device: FileSystemDirectoryHandle,
    manifest: DeviceManifest,
    complete: boolean,
  ): Promise<void> => {
    const bytes = new TextEncoder().encode(JSON.stringify(manifest, null, 2))
    await writeFile(device, DEVICE_MANIFEST, bytes)
    if (!complete) return
    const manifestSha256 = await SignatureService.sign(bytes.buffer as ArrayBuffer)
    const seal: CompletionSeal = {
      kind: 'hypercomb-backup-completion',
      version: 1,
      deviceId: manifest.deviceId,
      manifestSha256,
      completedAt: Date.now(),
    }
    await writeFile(
      device,
      `COMPLETE-${manifestSha256.slice(0, 12).toUpperCase()}.hypercomb`,
      JSON.stringify(seal, null, 2),
    )
  }

  /**
   * `'absent'` — no DCP is attached to this browser, so there is no profile
   * half to copy. That is a complete participant backup, not a failure.
   * `null` — DCP IS present but its export was broken or empty, which must
   * make the pass incomplete.
   */
  readonly #exportDcpBackup = async (
    backup: FileSystemDirectoryHandle,
    agentId: string,
  ): Promise<{ files: number; bytes: number } | 'absent' | null> => {
    const getSentinel = (globalThis as any).__getSentinel as
      | (() => Promise<SentinelBackupBridge | null>)
      | undefined
    const existing = (globalThis as any).__sentinelBridge as SentinelBackupBridge | undefined
    const bridge = existing?.exportBackup ? existing : await getSentinel?.()
    if (!bridge?.exportBackup) return 'absent'

    const dcp = await backup.getDirectoryHandle(DCP_DIR, { create: true })
    const destination = await dcp.getDirectoryHandle('opfs', { create: true })
    const entries: Record<string, { size: number; sha256: string }> = {}
    let writtenFiles = 0
    let writtenBytes = 0
    const result = await bridge.exportBackup(async file => {
      const parts = file.path.split('/')
      const name = parts.pop()
      if (!name || !validSegment(name) || !parts.every(validSegment)
          || !SIG_RE.test(file.sha256)) throw new Error('DCP returned an unsafe backup entry')
      if (await SignatureService.sign(file.bytes) !== file.sha256) {
        throw new Error(`DCP backup hash mismatch for "${file.path}"`)
      }
      const target = await directoryAt(destination, parts, true)
      await writeFile(target, name, new Uint8Array(file.bytes))
      const readBack = await (await (
        await target.getFileHandle(name, { create: false })
      ).getFile()).arrayBuffer()
      if (await SignatureService.sign(readBack) !== file.sha256) {
        throw new Error(`DCP backup read-back failed for "${file.path}"`)
      }
      entries[file.path] = { size: file.bytes.byteLength, sha256: file.sha256 }
      writtenFiles++
      writtenBytes += file.bytes.byteLength
      this.#reportLatestPath(
        agentId,
        `${backup.name}\\${DCP_DIR}\\opfs\\${file.path.replaceAll('/', '\\')}`,
      )
    }, progress => {
      EffectBus.emit('agent:progress', {
        id: agentId,
        activity: `${progress.phase}: ${progress.current} DCP files`,
      })
    })
    // A connected DCP always has at least its registry/module state. An empty
    // stream is a broken bridge, not a valid portable backup.
    if (!result || result.files < 1 || result.bytes < 1
        || result.files !== writtenFiles || result.bytes !== writtenBytes) return null

    const manifest: DcpBackupManifest = {
      kind: 'hypercomb-dcp-backup',
      version: 1,
      exportedAt: Date.now(),
      files: writtenFiles,
      bytes: writtenBytes,
      entries,
    }
    const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest, null, 2))
    await writeFile(dcp, DCP_MANIFEST, manifestBytes)
    const hash = await SignatureService.sign(manifestBytes.buffer as ArrayBuffer)
    await writeFile(dcp, `COMPLETE-${hash.slice(0, 12).toUpperCase()}.hypercomb`, JSON.stringify({
      kind: 'hypercomb-dcp-backup-completion',
      version: 1,
      manifestSha256: hash,
      completedAt: Date.now(),
    }, null, 2))
    return { files: writtenFiles, bytes: writtenBytes }
  }

  /**
   * `'absent'` — this backup carries no DCP half at all (no dcp/ directory or
   * no manifest in it), which is a valid participant-only backup.
   * `null` — a DCP snapshot IS present but fails verification, which is a
   * corrupt backup and must never be restored.
   */
  readonly #verifiedDcpSnapshot = async (
    backup: FileSystemDirectoryHandle,
  ): Promise<{ manifest: DcpBackupManifest; opfs: FileSystemDirectoryHandle } | 'absent' | null> => {
    let dcp: FileSystemDirectoryHandle
    try {
      dcp = await backup.getDirectoryHandle(DCP_DIR, { create: false })
    } catch {
      return 'absent'
    }
    try {
      const manifestBytes = await readFileBytes(dcp, DCP_MANIFEST)
      if (!manifestBytes) return 'absent'
      const manifest = JSON.parse(new TextDecoder().decode(manifestBytes)) as DcpBackupManifest
      if (manifest?.kind !== 'hypercomb-dcp-backup' || manifest.version !== 1) return null
      const hash = await SignatureService.sign(manifestBytes)
      const seal = await readJson<{
        kind?: string
        version?: number
        manifestSha256?: string
      }>(dcp, `COMPLETE-${hash.slice(0, 12).toUpperCase()}.hypercomb`)
      if (seal?.kind !== 'hypercomb-dcp-backup-completion'
          || seal.version !== 1
          || seal.manifestSha256 !== hash) return null
      const opfs = await dcp.getDirectoryHandle('opfs', { create: false })
      let files = 0
      let bytes = 0
      for (const [path, stamp] of Object.entries(manifest.entries ?? {})) {
        const data = await this.#readPath(opfs, path)
        if (!data || data.byteLength !== stamp.size
            || await SignatureService.sign(data) !== stamp.sha256) return null
        files++
        bytes += data.byteLength
      }
      if (files !== manifest.files || bytes !== manifest.bytes) return null
      return { manifest, opfs }
    } catch {
      return null
    }
  }

  readonly #readPath = async (
    root: FileSystemDirectoryHandle,
    path: string,
  ): Promise<ArrayBuffer | null> => {
    const parts = path.split('/')
    const name = parts.pop()
    if (!name || !validSegment(name) || !parts.every(validSegment)) return null
    try {
      const dir = await directoryAt(root, parts, false)
      return await (await (await dir.getFileHandle(name, { create: false })).getFile()).arrayBuffer()
    } catch {
      return null
    }
  }

  readonly #hasValidCompletionSeal = async (
    device: FileSystemDirectoryHandle,
    manifestSha256: string,
    deviceId: string,
  ): Promise<boolean> => {
    const expected = manifestSha256.slice(0, 12).toUpperCase()
    try {
      for await (const [name, handle] of (device as any).entries()) {
        if (handle.kind !== 'file' || COMPLETE_RE.exec(name)?.[1] !== expected) continue
        const seal = await readJson<CompletionSeal>(device, name)
        if (seal?.kind === 'hypercomb-backup-completion'
            && seal.version === 1
            && seal.deviceId === deviceId
            && seal.manifestSha256 === manifestSha256) return true
      }
    } catch {
      return false
    }
    return false
  }

  readonly #verifySnapshotFiles = async (
    opfs: FileSystemDirectoryHandle,
    manifest: DeviceManifest,
  ): Promise<boolean> => {
    for (const [path, stamp] of Object.entries(manifest.files ?? {})) {
      const parts = path.split('/')
      const name = parts.pop()
      if (!name || !validSegment(name) || !parts.every(validSegment) || !stamp.sha256) return false
      try {
        const dir = await directoryAt(opfs, parts, false)
        const bytes = await (await (await dir.getFileHandle(name, { create: false })).getFile()).arrayBuffer()
        if (bytes.byteLength !== stamp.size
            || await SignatureService.sign(bytes) !== stamp.sha256) return false
      } catch {
        return false
      }
    }
    return true
  }

  readonly #schedulePassiveReconciliation = (): void => {
    const run = (): void => {
      // An explicit connect/resume already covers this boot. Re-running would
      // repeat the whole materialization for no new bytes.
      if (this.#fullPass || this.#fullPassRanThisSession) return
      const settings = this.settings()
      if (settings.automatic) void this.syncNow(settings.mode)
    }
    const idle = (globalThis as any).requestIdleCallback as
      | ((callback: () => void, options?: { timeout: number }) => number)
      | undefined
    if (idle) idle(run, { timeout: 30_000 })
    else setTimeout(run, 10_000)
  }

  readonly #reportLatestPath = (agentId: string, path: string): void => {
    const now = performance.now()
    if (now - this.#lastPathReportAt < 100) return
    this.#lastPathReportAt = now
    EffectBus.emit('agent:progress', {
      id: agentId,
      latest: true,
      activity: `Latest file: ${path}`,
    })
  }

  readonly #showBackupLocation = async (): Promise<void> => {
    const selected = this.#selected
    if (!selected || !this.isSupported()) return
    const destination = this.#backupHandle ?? selected
    try {
      // Browsers deliberately hide the absolute C:\ path from JavaScript.
      // A participant click may, however, reopen the native chooser at the
      // granted handle, which exposes the real breadcrumb and files without
      // granting the page any broader filesystem visibility.
      await (window as any).showDirectoryPicker({
        id: 'hypercomb-folder-backup-location',
        mode: 'readwrite',
        startIn: destination,
      })
    } catch {
      // Cancel simply closes the native window; the remembered backup remains.
    }
  }

  readonly #enqueue = (operation: () => Promise<void>): Promise<void> => {
    const run = this.#serial.then(operation, operation)
    this.#serial = run.catch(() => {})
    return run
  }

  readonly #permission = async (
    handle: FileSystemDirectoryHandle,
    request: boolean,
  ): Promise<PermissionState> => {
    const capable = handle as PermissionHandle
    try {
      const current = await capable.queryPermission?.({ mode: 'readwrite' })
      if (current === 'granted') return current
      if (request && capable.requestPermission) {
        return await capable.requestPermission({ mode: 'readwrite' })
      }
      return current ?? 'prompt'
    } catch {
      return 'denied'
    }
  }

  readonly #report = (
    status: FolderSyncStatus,
    detail: Partial<FolderSyncState> = {},
  ): void => {
    this.#lastState = {
      status,
      deviceId: this.#deviceId,
      at: Date.now(),
      ...detail,
    }
    EffectBus.emit('folder-sync:state', this.#lastState)
  }

  #loadDeviceId(): string {
    try {
      const stored = localStorage.getItem(DEVICE_ID_KEY)
      if (stored && /^[a-z0-9-]{8,64}$/i.test(stored)) return stored
      const fresh = crypto.randomUUID()
      localStorage.setItem(DEVICE_ID_KEY, fresh)
      return fresh
    } catch {
      return crypto.randomUUID()
    }
  }

  #openDb(): Promise<IDBDatabase | null> {
    if (typeof indexedDB === 'undefined') return Promise.resolve(null)
    return new Promise(resolve => {
      const request = indexedDB.open(DB_NAME, DB_VERSION)
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(HANDLE_STORE)) {
          request.result.createObjectStore(HANDLE_STORE)
        }
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => resolve(null)
      request.onblocked = () => resolve(null)
    })
  }

  async #loadHandle(): Promise<FileSystemDirectoryHandle | null> {
    const db = await this.#openDb()
    if (!db) return null
    return new Promise(resolve => {
      const request = db.transaction(HANDLE_STORE).objectStore(HANDLE_STORE).get(HANDLE_KEY)
      request.onsuccess = () => {
        db.close()
        resolve((request.result as FileSystemDirectoryHandle | undefined) ?? null)
      }
      request.onerror = () => {
        db.close()
        resolve(null)
      }
    })
  }

  async #saveHandle(handle: FileSystemDirectoryHandle): Promise<void> {
    const db = await this.#openDb()
    if (!db) return
    await new Promise<void>(resolve => {
      const transaction = db.transaction(HANDLE_STORE, 'readwrite')
      transaction.objectStore(HANDLE_STORE).put(handle, HANDLE_KEY)
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => resolve()
      transaction.onabort = () => resolve()
    })
    db.close()
  }

  async #deleteHandle(): Promise<void> {
    const db = await this.#openDb()
    if (!db) return
    await new Promise<void>(resolve => {
      const transaction = db.transaction(HANDLE_STORE, 'readwrite')
      transaction.objectStore(HANDLE_STORE).delete(HANDLE_KEY)
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => resolve()
      transaction.onabort = () => resolve()
    })
    db.close()
  }
}

const _folderSync = new FolderSyncService()
;(window as any).ioc?.register?.(FOLDER_SYNC_KEY, _folderSync)
