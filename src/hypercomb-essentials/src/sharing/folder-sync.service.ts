// sharing/folder-sync.service.ts
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

import { EffectBus, SignatureService, classifyDirectoryEntry, poolMeanings } from '@hypercomb/core'
import { extractLayerSigFromMarker } from '../history/history.service.js'
// TYPE ONLY — erased at compile time, so this stays an IoC relationship at
// runtime and no bundle edge is created between the two drones.
import type { MirrorSink, UnresolvedRef } from './content-broker.drone.js'

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
  /** Source paths this filesystem refused — a Windows-illegal name, a full
   *  disk. Capped for size; `unrepresentableCount` is the true total. */
  unrepresentable?: string[]
  unrepresentableCount?: number
  /** Entries gone between enumeration and read. Not a fault — a live hive
   *  rewrites as the walk runs — but never silent either. */
  vanishedCount?: number
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
  /** Items written straight into the backup as they verified. */
  mirrored: number
  /** Items the backup already held, and so were never fetched at all. */
  alreadyMirrored: number
  /** Items that resolved but could not be written to the backup. */
  mirrorFailed: number
  /** Signatures nothing could resolve, NAMED. `missing: 3` reads as three lost
   *  pictures; naming them is what shows that `payload.targetSig` was a
   *  location and never content at all. */
  unresolved: UnresolvedRef[]
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
  mirrored: 0,
  alreadyMirrored: 0,
  mirrorFailed: 0,
  unresolved: [],
})

interface CompletionSeal {
  kind: 'hypercomb-backup-completion'
  version: 1
  deviceId: string
  manifestSha256: string
  completedAt: number
}

interface ContentBrokerLike {
  adopt?: (
    rootSig: string,
    options?: {
      layersOnly?: boolean
      deepResources?: boolean
      silent?: boolean
      quiet?: boolean
      /** Write-through destination: saves each item as it verifies, and skips
       *  anything the destination already holds without fetching it. */
      mirror?: MirrorSink
    },
  ) => Promise<{
    layers: number
    leaves: number
    failed: number
    truncated?: number
    mirrored?: number
    alreadyMirrored?: number
    mirrorFailed?: number
    unresolved?: UnresolvedRef[]
  }>
  adoptResources?: (
    sigs: readonly string[],
    options?: { deepResources?: boolean; quiet?: boolean; mirror?: MirrorSink },
  ) => Promise<{
    leaves: number
    failed: number
    truncated?: number
    mirrored?: number
    alreadyMirrored?: number
    mirrorFailed?: number
    unresolved?: UnresolvedRef[]
  }>
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
  /** Manifest entries the source checkpoint could not carry or resolve. */
  unresolved: number
  /** Sources without a receipt proving a complete portable checkpoint. */
  incompleteSources: number
  warnings: string[]
}

interface ImportSnapshot {
  deviceId: string
  updatedAt: number
  opfs: FileSystemDirectoryHandle
  manifest: DeviceManifest
  checkpointComplete: boolean
}

type MarkerPayload = {
  lineageSig: string
  markerName: string
  bytes: ArrayBuffer
}

/** Windows device names, reserved at EVERY directory level, with or without
 *  an extension. */
const RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i

/**
 * Can this name be written as a real file or directory on the destination?
 *
 * The File System Access API enforces the HOST platform's rules, and Windows
 * is the strict one: `: * ? " < > |` are forbidden, and so are control
 * characters, trailing dots and spaces, and the reserved device names. A name
 * that passed a slashes-only check and then reached `getDirectoryHandle` threw
 * `Name is not allowed` — which is how a single entry took an entire backup
 * down at 65 MB.
 *
 * OPFS is bound by none of those rules, so a hive can legitimately hold a name
 * that simply cannot exist in a Windows folder. That is a fact to REPORT, not
 * a reason to stop copying the other ten thousand files.
 */
const validSegment = (name: string): boolean =>
  !!name
  && name !== '.'
  && name !== '..'
  && !/[\\/:*?"<>|]/.test(name)
  // eslint-disable-next-line no-control-regex
  && !/[\x00-\x1f]/.test(name)
  && !/[. ]$/.test(name)
  && !RESERVED_NAMES.test(name)

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

/** Locate the existing per-device OPFS tree used by the current backup shape.
 * Recovery also accepts a folder-root hive, so absence is not an error. */
const legacyHiveRoot = async (
  device: FileSystemDirectoryHandle,
): Promise<FileSystemDirectoryHandle | undefined> => {
  try {
    return await device.getDirectoryHandle('opfs', { create: false })
  } catch {
    return undefined
  }
}

/**
 * Every file under `dir`, depth-unlimited.
 *
 * A name the destination cannot hold is COLLECTED into `refused`, never
 * dropped on the floor. Skipping it silently was survivable while the check
 * only rejected slashes; once it rejects everything Windows rejects, a silent
 * skip becomes silent data loss — the copy would simply not contain files
 * nobody was told about. A backup is allowed to be incomplete. It is not
 * allowed to be quietly incomplete.
 */
/**
 * Everything the backup must carry: the hive through the facade, plus whatever
 * the facade hides.
 *
 * The facade surfaces only SIGNATURE-named entries — that is what makes it the
 * interchange form, and it is why the pack file never appears. But the raw root
 * also holds the legacy typed directories (`__hive__`, `__layers__`,
 * `__visuals__`, …), which are read-fallback sources still holding real records
 * until the store finishes draining them. Move the walk to the facade and they
 * would silently stop being backed up.
 *
 * So the second pass takes every raw entry the facade did NOT cover, by
 * ENUMERATING rather than by keeping a list of legacy names. A list drifts, and
 * the failure mode of a stale one is a directory nobody remembered quietly
 * dropping out of the backup.
 */
async function* walkHive(
  source: FileSystemDirectoryHandle,
  raw: FileSystemDirectoryHandle,
  refused: string[],
): AsyncGenerator<{ path: string; handle: FileSystemFileHandle }> {
  yield* walkFiles(source, '', refused)
  if (source === raw) return // not packed — the facade IS the raw root
  for await (const [name, handle] of (raw as any).entries()) {
    // Signature-named entries are the hive, and the facade already yielded
    // them — including the undrained flat ones it unions in.
    if (SIG_RE.test(name)) continue
    if (handle.kind === 'directory') {
      yield* walkFiles(handle as FileSystemDirectoryHandle, name, refused)
    } else if (validSegment(name)) {
      yield { path: name, handle: handle as FileSystemFileHandle }
    }
  }
}

async function* walkFiles(
  dir: FileSystemDirectoryHandle,
  prefix = '',
  refused: string[] = [],
): AsyncGenerator<{ path: string; handle: FileSystemFileHandle }> {
  for await (const [name, handle] of (dir as any).entries()) {
    const path = prefix ? `${prefix}/${name}` : name
    // Chromium writes `<name>.crswap` beside a file for the duration of a
    // createWritable() and removes it on close. They are not content, they are
    // MID-WRITE, and the hive writes while the backup reads — so copying one
    // is both meaningless and a race that ends in NotFoundError. Not counted
    // as refused: nothing was lost by skipping something that is not data.
    if (name.endsWith('.crswap')) continue
    if (!validSegment(name)) {
      refused.push(path)
      continue
    }
    if (handle.kind === 'file') {
      yield { path, handle: handle as FileSystemFileHandle }
    } else if (handle.kind === 'directory') {
      yield* walkFiles(handle as FileSystemDirectoryHandle, path, refused)
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
    // A backup carries the participant tree and nothing else. The optional
    // `dcp/` half an installer used to write is no longer produced or read;
    // an older backup that still carries one is imported by its participant
    // tree exactly as before, and the stale half is simply left alone.
    const sources = await this.#deviceSnapshots(backup, selected)
    if (sources.length === 0) throw new Error('The selected folder contains no readable device snapshots.')

    const opfs = await navigator.storage.getDirectory()
    const result: FolderImportResult = {
      sourceDevice: sources[0].deviceId,
      sourceDevices: sources.map(source => source.deviceId),
      copied: 0,
      identical: 0,
      conflicts: 0,
      invalid: 0,
      unresolved: sources.reduce((total, source) => total
        + (source.manifest.unrepresentableCount ?? source.manifest.unrepresentable?.length ?? 0)
        + (source.manifest.closure?.unresolved?.length ?? 0), 0),
      incompleteSources: sources.filter(source => !source.checkpointComplete).length,
      warnings: [],
    }
    if (result.incompleteSources) {
      result.warnings.push(
        `${result.incompleteSources} source snapshot${result.incompleteSources === 1 ? '' : 's'} had no complete portable-checkpoint receipt; individually verified files were imported.`,
      )
    }
    if (result.unresolved) {
      result.warnings.push(
        `${result.unresolved} source item${result.unresolved === 1 ? '' : 's'} could not be represented or resolved by the backup and remain unresolved.`,
      )
    }

    const agentId = `folder-import:${this.#deviceId}`
    EffectBus.emit('agent:start', {
      id: agentId,
      behavior: 'folder-sync',
      kind: 'script',
      request: `Import private folder backup from ${sources.length} device snapshot${sources.length === 1 ? '' : 's'}`,
      // Hive-wide, deliberately. `targets` are TILE labels — a pseudo-label
      // ('opfs', 'folder-backup') matches no painted tile, so the bee never
      // showed anywhere and the orchestrator's audit gathered a phantom husk
      // tile named after it. No targets = the bee dances in the open, where
      // it can actually be clicked (the click opens the Backup & Restore
      // window, agent-panel.view.ts).
      targets: [],
      segments: [],
    })
    try {
      let seen = 0
      // Newest snapshots go first. When ordinary mutable paths differ,
      // the newest backup supplies a missing local file and older variants
      // are then reported as conflicts. Existing local bytes still always
      // win: import is union-only and never overwrites.
      for (const source of sources) {
        for (const [path, stamp] of Object.entries(source.manifest.files ?? {})) {
          const parts = path.split('/')
          const name = parts.pop()!
          if (!parts.every(validSegment) || !validSegment(name)) {
            result.invalid++
            continue
          }
          const incomingBuffer = await this.#readPath(source.opfs, path)
          if (!incomingBuffer || !stamp.sha256 || incomingBuffer.byteLength !== stamp.size
              || await SignatureService.sign(incomingBuffer) !== stamp.sha256) {
            result.invalid++
            continue
          }
          const incoming = new Uint8Array(incomingBuffer)

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
              activity: `checked ${seen} files; imported ${result.copied}; rejected ${result.invalid}`,
            })
          }
        }
      }
      EffectBus.emit('agent:end', {
        id: agentId,
        ok: result.conflicts === 0 && result.invalid === 0,
        summary: `imported ${result.copied}; ${result.conflicts} conflicts; ${result.invalid} invalid; ${result.incompleteSources} incomplete checkpoints`,
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
      // Hive-wide — 'folder-backup' is not a tile (see the import agent above).
      targets: [],
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
      // THE HIVE, not the storage it happens to sit in.
      //
      // `navigator.storage.getDirectory()` is the RAW OPFS, and in packed mode
      // the hive does not live there as records — it lives inside one
      // `hive.pack` file, which the raw walk then copies WHOLE. Measured on the
      // real hive: a 651 MB pack copied alongside the same content expanded,
      // making the folder 1,024 MB against 504 MB of storage. Worse, the pack
      // is append-only, so its size and mtime change on any hive change and
      // `cheapMatch` never matches — every pass re-copied 651 MB. That is the
      // exact opposite of an incremental backup.
      //
      // `Store.opfsRoot` is the FACADE. Its `rootEntries` unions packed records
      // with undrained flat ones and deliberately hides the pack pool ("the
      // pack pool dir is internal representation and never surfaces in the
      // virtual root"), so the walk sees the interchange form whatever the
      // storage engine underneath is doing. On a hive that is not packed the
      // facade IS the raw root, so nothing changes there.
      const raw = await navigator.storage.getDirectory()
      const source = (window as any).ioc?.get?.('@hypercomb.social/Store')?.opfsRoot ?? raw

      // The destination is opened BEFORE materialization, not after, because
      // materialization now writes THROUGH it. Nothing waits for the closure
      // to finish before bytes start landing: a pass interrupted at ninety
      // percent leaves ninety percent saved, and a pass over a folder that is
      // already current fetches nothing at all.
      const backup = this.#backupHandle
      const devicesEarly = await backup.getDirectoryHandle(DEVICES_DIR, { create: true })
      const deviceEarly = await devicesEarly.getDirectoryHandle(this.#deviceId, { create: true })
      const destination = await deviceEarly.getDirectoryHandle('opfs', { create: true })

      const hardCopy = mode === 'hard-copy'
        ? await this.#materializeHardCopy(source, selected.name, mode, agentId, destination)
        : emptyClosure()

      await this.#writeRootManifest(backup)
      const device = deviceEarly
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
      /** Paths this filesystem refused. Reported, never fatal. */
      const unrepresentable: string[] = []
      /** Entries that existed at enumeration and were gone at read. A live
       *  hive does this; the next pass picks up whatever replaced them. */
      let vanished = 0

      for await (const entry of walkHive(source, raw, unrepresentable)) {
        // The source is a LIVE filesystem: the hive keeps writing while this
        // walk runs, so an entry can be enumerated and then be gone before it
        // is read. That is ordinary, and it threw `NotFoundError` straight out
        // of the pass — measured on the real hive, reported as
        // "A requested file or directory could not be found".
        let file: File
        try {
          file = await entry.handle.getFile()
        } catch (error) {
          vanished++
          console.warn('[folder-sync] entry disappeared mid-walk:', entry.path, error)
          continue
        }
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

        // A destination the source can name but the platform cannot hold is a
        // FINDING, not a stopping condition. Before this, one such entry threw
        // out of the loop and took the whole pass with it — measured on a real
        // hive, `getDirectoryHandle: Name is not allowed` at 65 MB, with
        // everything after it uncopied and nothing saying which name did it.
        let targetDir: FileSystemDirectoryHandle
        try {
          targetDir = await directoryAt(destination, parts, true)
        } catch (error) {
          unrepresentable.push(entry.path)
          console.warn('[folder-sync] cannot represent on this filesystem:', entry.path, error)
          continue
        }
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
          // arrayBuffer() is the SAME vanishing race as getFile(), one step
          // later — the bytes are read here, not at getFile(), so a file
          // replaced in between throws right at this line. Signing and writing
          // share the guard: a full disk, an unrepresentable name and a
          // rewritten source all land here, and every one of them is worth
          // finishing the other ten thousand files for.
          let sourceBuffer: ArrayBuffer
          try {
            sourceBuffer = await file.arrayBuffer()
          } catch (error) {
            vanished++
            console.warn('[folder-sync] entry rewritten before its bytes were read:', entry.path, error)
            continue
          }
          try {
            stamp.sha256 = contentSig ?? await SignatureService.sign(sourceBuffer)
            await writeFile(targetDir, name, sourceBuffer)
          } catch (error) {
            unrepresentable.push(entry.path)
            console.warn('[folder-sync] could not write:', entry.path, error)
            continue
          }
          copied++
          copiedBytes += stamp.size
        }
        nextFiles[entry.path] = stamp
        scanned++
        totalBytes += stamp.size
        if (scanned % CHECKPOINT_FILES === 0) {
          // Best-effort: the checkpoint is a RESUME HINT, not the copy. Losing
          // one costs a little repeated work next pass; throwing here would
          // discard the copy it was recording.
          // Checkpoint: the manifest is the resume cursor. Union with the
          // prior record so an interrupted pass never discards knowledge of
          // files it has not reached yet, and mark the pass active so this
          // partial record is never mistaken for a completion.
          try {
            await this.#checkpoint(device, manifest, { ...previousFiles, ...nextFiles })
          } catch (error) {
            console.warn('[folder-sync] checkpoint failed; the copy continues', error)
          }
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
      manifest.unrepresentable = unrepresentable.slice(0, 200)
      manifest.unrepresentableCount = unrepresentable.length
      manifest.vanishedCount = vanished
      const complete = manifest.mode === 'hard-copy'
        && manifest.closure.resolverAvailable
        && manifest.closure.missing === 0
        && (manifest.closure.rootsFailed ?? 0) === 0
        // A file the destination refused is a file the restore will not find.
        // The copy is then a partial one and must never be sealed as portable.
        && unrepresentable.length === 0
      await this.#writeManifestAndSeal(device, manifest, complete)
      await this.#writeDeviceInventory(device, manifest, manifest.mode, manifest.closure)
      await this.#writeBackupReport(backup)
      this.#manifest = manifest
      const passSucceeded = unrepresentable.length === 0
        && (mode === 'local'
          || (hardCopy.resolverAvailable && hardCopy.missing === 0 && hardCopy.rootsFailed === 0))
      this.#report(passSucceeded ? 'backed-up' : 'incomplete', {
        folder: selected.name,
        mode: manifest.mode,
        phase: passSucceeded
          ? mode === 'hard-copy' ? 'Portable hard copy verified' : 'Exact local mirror verified'
          : unrepresentable.length > 0
            ? `${unrepresentable.length} item${unrepresentable.length === 1 ? '' : 's'} could not be written to this filesystem — see BACKUP-REPORT.txt`
            : 'Local bytes verified; some referenced bytes could not be materialized',
        copied,
        scanned,
        copiedBytes,
        totalBytes: manifest.totalBytes,
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
      // Hive-wide — 'folder-backup' is not a tile (see the import agent above).
      targets: [],
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
      // Hashed in BATCHES, not one at a time: re-hashing a whole backup is
      // megabytes of SHA-256, and on the main thread that lands directly on
      // the render budget. `signMany` hands the batch to the packed-store
      // worker when one is up and signs inline otherwise — same answers,
      // off the thread that draws. The batch size matches the progress
      // cadence so reporting is unchanged.
      const BATCH = 25
      for (let at = 0; at < entries.length; at += BATCH) {
        const batch = entries.slice(at, at + BATCH)
        const loaded = await Promise.all(
          batch.map(async ([path]) => await this.#readPath(opfs, path)),
        )
        // Only readable files are worth hashing; the rest are damaged
        // whatever their bytes would have signed as.
        const hashable = loaded
          .map((bytes, i) => ({ bytes, index: i }))
          .filter((e): e is { bytes: ArrayBuffer; index: number } => !!e.bytes)
        const sigs = await SignatureService.signMany(hashable.map(e => e.bytes))
        const sigByIndex = new Map(hashable.map((e, n) => [e.index, sigs[n]]))

        for (let i = 0; i < batch.length; i++) {
          const [path, stamp] = batch[i]
          const bytes = loaded[i]
          // A stamp with no recorded hash cannot be proven. Copying it again
          // is the fix, so it counts as damaged rather than quietly passing.
          if (!bytes || !stamp.sha256
              || bytes.byteLength !== stamp.size
              || sigByIndex.get(i) !== stamp.sha256) {
            damaged.push(path)
          } else {
            verified++
            verifiedBytes += bytes.byteLength
          }
        }
        {
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
    destination: FileSystemDirectoryHandle,
  ): Promise<HardCopyResult> => {
    // The backup folder, handed to the walk as a write-through destination.
    //
    // `has` is a COMPLETE answer, not a hint: content is immutable and named
    // by the hash of its own bytes, so a signature this folder already holds
    // can never need fetching again. That is what turns the second pass over
    // an unchanged hive into a stat sweep — and what stops a new folder from
    // being the only case that ever does real work.
    const mirror: MirrorSink = {
      has: async (sig) => {
        try {
          return (await (await destination.getFileHandle(sig, { create: false })).getFile()).size
        } catch {
          return null
        }
      },
      read: async (sig) => {
        try {
          const file = await (await destination.getFileHandle(sig, { create: false })).getFile()
          return new Uint8Array(await file.arrayBuffer())
        } catch {
          return null
        }
      },
      // A File is a Blob: slicing it reads only the requested range off disk,
      // so this is genuinely one byte and not a full read discarded.
      peek: async (sig, bytes) => {
        try {
          const file = await (await destination.getFileHandle(sig, { create: false })).getFile()
          return new Uint8Array(await file.slice(0, bytes).arrayBuffer())
        } catch {
          return null
        }
      },
      // writeFile commits through createWritable().close(), so a partial write
      // never lands under the real name. Presence is therefore trustworthy,
      // which is the assumption `has` above is built on.
      write: async (sig, bytes) => { await writeFile(destination, sig, bytes) },
    }
    const roots = new Set<string>()
    // Content named by pool records — threads, clipboard, manifests — that no
    // layer references. Nothing else in the walk would ever pull it local, so
    // without this a hard copy silently omits it.
    const poolReferenced = new Set<string>()
    let markers = 0
    let markersUnread = 0

    // ADDITIVE, NEVER EITHER/OR. This used to `continue` on a registered pool
    // address, so a directory that is BOTH a pool and a lineage bag — which is
    // what a bare-word meaning IS — never had its markers walked, its layer
    // roots never entered `roots`, and the pass then SEALED the copy as
    // portable because `closure.missing === 0`: the missing roots were never
    // counted. Loss by omission, discovered only on restore, and invisible to
    // any grep for a destructive call.
    //
    // The registry was wrong in the other direction too: an UNREGISTERED
    // molecule took the second branch and was treated purely as a bag, so its
    // pool members were never collected. So: classify per ENTRY, do both for
    // every sig-named directory, and keep the registry only as a log label.
    for await (const [name, handle] of (source as any).entries()) {
      if (handle.kind !== 'directory' || !SIG_RE.test(name)) continue
      // Both, for EVERY sig-named directory. An unregistered address may still
      // be a pool (a molecule anyone mints by typing a word), and a registered
      // one may still hold markers.
      await this.#collectPoolReferences(handle as FileSystemDirectoryHandle, poolReferenced)
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
          mirror,
        })
        result.mirrored += stats.mirrored ?? 0
        result.alreadyMirrored += stats.alreadyMirrored ?? 0
        result.mirrorFailed += stats.mirrorFailed ?? 0
        for (const ref of stats.unresolved ?? []) {
          if (!result.unresolved.some(u => u.sig === ref.sig)) result.unresolved.push(ref)
        }
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
          mirror,
        })
        result.mirrored += stats.mirrored ?? 0
        result.alreadyMirrored += stats.alreadyMirrored ?? 0
        result.mirrorFailed += stats.mirrorFailed ?? 0
        for (const ref of stats.unresolved ?? []) {
          if (!result.unresolved.some(u => u.sig === ref.sig)) result.unresolved.push(ref)
        }
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
      // A MARKER IS NOT A POOL RECORD. The walk above already reads every
      // marker and puts the layer it names into `roots`, where it is fetched
      // as a closure root. Reading it AGAIN here filed the same sig as a loose
      // pool reference, and a broker with `adopt` but no `adoptResources` then
      // counted it missing — so a complete hard copy reported itself
      // `incomplete`. Classify by NAME, the one rule this tree shares.
      const leaf = entry.path.slice(entry.path.lastIndexOf('/') + 1)
      if (classifyDirectoryEntry(leaf) === 'marker') continue
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
    hive: FileSystemDirectoryHandle,
  ): Promise<ImportSnapshot[]> => {
    let devices: FileSystemDirectoryHandle
    try {
      devices = await backup.getDirectoryHandle(DEVICES_DIR, { create: false })
    } catch {
      return []
    }
    const snapshots: ImportSnapshot[] = []
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
      if (manifest.kind !== 'hypercomb-folder-backup-device' || !manifest.files) continue
      const manifestSha256 = await SignatureService.sign(manifestBytes)
      try {
        // The shape puts the hive at the folder root; a legacy backup keeps a
        // per-device `opfs/` nest. Both import, each verified where it sits.
        const opfs = (await legacyHiveRoot(dir)) ?? hive
        const checkpointComplete = manifest.pass?.active !== true
          && manifest.mode === 'hard-copy'
          && !!manifest.closure?.resolverAvailable
          && manifest.closure.missing === 0
          && (manifest.closure.rootsFailed ?? 0) === 0
          && await this.#hasValidCompletionSeal(dir, manifestSha256, deviceId)
        snapshots.push({ deviceId, updatedAt: manifest.updatedAt, opfs, manifest, checkpointComplete })
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
      '',
      'Hypercomb uses content signatures as filenames, so many resources look like',
      'long hexadecimal names. They are real local files, not internet shortcuts.',
      'A backup carries the participant tree only.',
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
      'The participant tree is verified before it is restored; when this',
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
      `History markers seen: ${hardCopy.markers}`,
      `Closure roots checked: ${hardCopy.roots}`,
      `Roots that produced no layer (subtree unmeasured): ${hardCopy.rootsFailed}`,
      `Items named by pool records (no layer references them): ${hardCopy.poolReferences}`,
      `References dropped at the safety bound (copy is NOT portable): ${hardCopy.truncated}`,
      `Referenced layers made local: ${hardCopy.layers}`,
      `Referenced resources made local: ${hardCopy.resources}`,
      `Missing referenced items: ${hardCopy.missing}`,
      // NAMED, not just counted. `missing: 3` reads as three lost pictures;
      // the key path is what shows that `payload.targetSig` is a LOCATION and
      // was never content, so it can never resolve however many hosts answer.
      // That distinction matters twice over, because `missing > 0` blocks both
      // the portable verdict and the seal — an unexplained permanent
      // "incomplete" is exactly what this list prevents.
      ...(hardCopy.unresolved.length
        ? [
            'Signatures nothing could resolve:',
            ...hardCopy.unresolved.map(u =>
              `  ${u.sig}  named by ${u.from || '(unknown)'} at ${u.at || '(unknown key)'}`),
            'A key like `payload.targetSig` or `payload.id` is a LOCATION or an',
            'identifier, not content — it is not missing and never will resolve.',
          ]
        : []),
      // Named, not just counted: "3 files could not be written" is unusable,
      // and the whole point of a report is that the next person can act on it.
      ...(manifest.vanishedCount
        ? [`Entries rewritten by the hive mid-walk (next pass catches them): ${manifest.vanishedCount}`]
        : []),
      ...(manifest.unrepresentableCount
        ? [
            `Items this filesystem refused (copy is NOT portable): ${manifest.unrepresentableCount}`,
            ...(manifest.unrepresentable ?? []).map(path => `  refused: ${path}`),
          ]
        : []),
      // The three numbers that answer "am I actually getting payloads". A pass
      // over an unchanged hive is all `already here` and no fetching; a first
      // pass into a new folder is the reverse. `could not be written` is never
      // silent — a backup that cannot say what it failed to save is the thing
      // this whole path exists to prevent.
      `Payload items saved as they resolved: ${hardCopy.mirrored}`,
      `Payload items already here (never re-fetched): ${hardCopy.alreadyMirrored}`,
      `Payload items that could not be written: ${hardCopy.mirrorFailed}`,
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
    const lines = [
      'HYPERCOMB BACKUP REPORT',
      '',
      `Generated: ${new Date().toISOString()}`,
      'Scope: every OPFS root file and every file in every OPFS folder, recursively.',
      `Device snapshots: ${manifests.length}`,
      `Snapshot files: ${aggregateFiles}`,
      `Snapshot bytes: ${aggregateBytes} (${formatBytes(aggregateBytes)})`,
      `Total portable files: ${aggregateFiles}`,
      `Total portable bytes: ${aggregateBytes} (${formatBytes(aggregateBytes)})`,
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
