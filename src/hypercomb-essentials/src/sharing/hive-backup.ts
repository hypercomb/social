// sharing/hive-backup.ts
//
// THE WHOLE HIVE, KEPT ON YOUR HOSTS AS CIPHERTEXT, AND OPENED AGAIN AFTER A BROWSER CLEAR (jwize 2026-11-27: "have our
// host backup our files with a private key … a snapshot of the current operating system as it is but not a full history
// of everything just the genome … I might lose things if a browser clear happens").
//
//   back up:  the hive's seal (one signature for the current tree — no history) → a CARRIER atom { kind, head, at }
//             → the closure of the carrier this hive HOLDS, sealed atom by atom (sealed-publish.ts publishSealed,
//             unchanged) → an envelope sealing the door secret to this key, every device on its key list, AND the
//             RECOVERY KEY → ciphertext, door and envelope uploaded to each host → the envelope named in the signed index
//             under `backup:hive`. ONE slot: the newest backup replaces the last. History is not in it.
//   restore:  the recovery file says which hosts, which index and which recovery secret → the index on each host → the
//             envelope opens with the recovery key → every atom is opened, CHECKED against its signature and kept →
//             the caller makes the carried seal the live hive (seal-restore.ts, exactly as /restore does).
//
// WHY A RECOVERY KEY. This device's signing key lives in this browser's storage only (nostr-signer.ts), so a browser
// clear takes the key with the hive: a backup sealed to it alone could never be opened again. The recovery key is a
// second key, minted on the first backup and handed to the participant ONCE as a file they keep offline — the same
// shape as the mail recovery key (documentation/mail.md). Only its PUBLIC half is remembered here, so the doctrine holds:
// a secret never enters a pool, a layer, an event or an upload (documentation/becoming-a-host.md, jwize 2026-10-07).
//
// WHAT TRAVELS EACH TIME. Atoms are sealed CONVERGENTLY (content-cipher `sealAtom`): the same bytes always seal to the
// same ciphertext, and host sync sends nothing the host already holds (a HEAD first). So a second backup uploads only
// what changed since the first, and a resource that many participants hold — a public picture, a shared package —
// is ONE object on a flat-heap host (the Cloudflare worker dedups by signature for free). Only the door and the
// envelope are new every time.
//
// WHAT IS NOT IN IT. The closure is what this hive HOLDS: an atom the tree names but this browser never fetched (a
// resource it reads from a host on demand) is already on that host, and a restored tree resolves it the same way.
// Pools of meaning outside the tree (chat threads, settings, the hidden lens) are not in the seal and not in the backup.
//
// The orchestration takes its collaborators as arguments; `live*` wires them to the running hive.

import { collectClosure, signBytes } from './sealed-closure.js'
import { openSealedVersion, publishSealed, type SealedPublishDeps } from './sealed-publish.js'
import type { Nip44 } from './sealed-envelope.js'

const SIG = /^[0-9a-f]{64}$/
const HOST = /^[a-z0-9.-]+(:\d{1,5})?$/

/** The signed index's name for the one hive backup of a key: a colon root, so it is never a place, a door or a page. */
export const BACKUP_ROOT_KEY = 'backup:hive'
export const BACKUP_CARRIER_KIND = 'hive-backup'
/** The pool that remembers the recovery key's PUBLIC half: a colon meaning, so no tile can name it. */
export const BACKUP_RECOVERY_MEANING = 'backup:recovery'
export const RECOVERY_FILE_KIND = 'hypercomb-recovery'

// ── the carrier ──

export type BackupCarrier = { readonly kind: typeof BACKUP_CARRIER_KIND; readonly head: string; readonly at: number }

export const backupCarrierBytes = (head: string, at: number): Uint8Array =>
  new TextEncoder().encode(JSON.stringify({ kind: BACKUP_CARRIER_KIND, head, at }))

/** A carrier, believed only as far as its shape. */
export const parseBackupCarrier = (bytes: Uint8Array | null): BackupCarrier | null => {
  if (!bytes) return null
  let raw: Record<string, unknown>
  try { raw = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown> } catch { return null }
  const head = String(raw?.['head'] ?? '').toLowerCase()
  const at = Number(raw?.['at'])
  if (raw?.['kind'] !== BACKUP_CARRIER_KIND || !SIG.test(head) || !Number.isFinite(at)) return null
  return { kind: BACKUP_CARRIER_KIND, head, at }
}

// ── the recovery key ──

/** What this hive remembers about its recovery key: the public half, and the index it was made for. */
export type RecoveryRecord = { readonly v: 1; readonly recovery: string; readonly publisher: string; readonly at: number }

export const parseRecoveryRecord = (bytes: Uint8Array | null): RecoveryRecord | null => {
  if (!bytes) return null
  let raw: Record<string, unknown>
  try { raw = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown> } catch { return null }
  const recovery = String(raw?.['recovery'] ?? '').toLowerCase()
  const publisher = String(raw?.['publisher'] ?? '').toLowerCase()
  if (raw?.['v'] !== 1 || !SIG.test(recovery) || !SIG.test(publisher)) return null
  return { v: 1, recovery, publisher, at: Number(raw['at']) || 0 }
}

/** The file the participant keeps offline. It holds the recovery SECRET: it is never written anywhere but the
 *  participant's own download. */
export type RecoveryFile = {
  readonly kind: typeof RECOVERY_FILE_KIND
  readonly v: 1
  /** The key whose signed index names the backup. */
  readonly publisher: string
  /** Where the backup was kept, first to try first. */
  readonly hosts: readonly string[]
  readonly recovery: string
  readonly secret: string
  readonly made: string
}

export const recoveryFileText = (file: Omit<RecoveryFile, 'kind' | 'v'>): string =>
  JSON.stringify({
    kind: RECOVERY_FILE_KIND, v: 1,
    note: 'Keep this file somewhere safe and offline. It opens your hive backup after a browser clear. Anyone holding it can read that backup.',
    ...file,
  }, null, 2)

/** A recovery file, believed only as far as its shape. */
export const parseRecoveryFile = (text: string): RecoveryFile | null => {
  let raw: Record<string, unknown>
  try { raw = JSON.parse(String(text ?? '')) as Record<string, unknown> } catch { return null }
  const publisher = String(raw?.['publisher'] ?? '').toLowerCase()
  const recovery = String(raw?.['recovery'] ?? '').toLowerCase()
  const secret = String(raw?.['secret'] ?? '').toLowerCase()
  const hosts = Array.isArray(raw?.['hosts'])
    ? [...new Set((raw['hosts'] as unknown[]).map(host => String(host ?? '').trim().toLowerCase()).filter(host => HOST.test(host)))].slice(0, 16)
    : []
  if (raw?.['kind'] !== RECOVERY_FILE_KIND || raw?.['v'] !== 1) return null
  if (!SIG.test(publisher) || !SIG.test(recovery) || !SIG.test(secret) || hosts.length === 0) return null
  return { kind: RECOVERY_FILE_KIND, v: 1, publisher, hosts, recovery, secret, made: String(raw['made'] ?? '') }
}

/** NIP-44 for a raw secret: what the recovery key lends while a restore runs, and is then dropped. */
export const nip44FromSecret = async (secretHex: string): Promise<Nip44 | null> => {
  if (!SIG.test(secretHex)) return null
  const nip44 = await import('nostr-tools/nip44')
  const secret = Uint8Array.from(secretHex.match(/../g)!.map(pair => parseInt(pair, 16)))
  return {
    encrypt: async (peer, text) => { try { return nip44.encrypt(text, nip44.getConversationKey(secret, peer)) } catch { return null } },
    decrypt: async (peer, payload) => { try { return nip44.decrypt(payload, nip44.getConversationKey(secret, peer)) } catch { return null } },
  }
}

/** A fresh recovery key pair. The secret goes to the participant's file and nowhere else. */
export const mintRecoveryKey = async (): Promise<{ secret: string; recovery: string }> => {
  const { generateSecretKey, getPublicKey } = await import('nostr-tools/pure')
  const secretBytes = generateSecretKey()
  const secret = [...secretBytes].map(byte => byte.toString(16).padStart(2, '0')).join('')
  return { secret, recovery: getPublicKey(secretBytes).toLowerCase() }
}

// ── back up ──

export type BackupDeps = {
  /** The hosts that take uploads for the hive, first to try first. */
  readonly hosts: () => Promise<readonly string[]>
  /** The key the index is signed under, and this device's own. */
  readonly publisher: () => Promise<string>
  readonly own: () => Promise<string>
  /** The keys this key's list names on `host`: each device of the participant's. Empty when it holds no list. */
  readonly devices: (host: string, publisher: string) => Promise<readonly string[]>
  readonly nip44: () => Nip44 | null
  /** The hive's current seal — one signature for the whole current tree — or null when it cannot be sealed. */
  readonly seal: () => Promise<string | null>
  readonly getBytes: (sig: string) => Promise<Uint8Array | null>
  /** The recovery key's public half, when this hive holds one for `publisher`. */
  readonly recovery: (publisher: string) => Promise<string | null>
  readonly upload: (host: string) => SealedPublishDeps['upload']
  /** Name the envelope under `key` in this key's signed index on `host`. */
  readonly setRoot: (host: string, key: string, sig: string) => Promise<{ ok: boolean; reason?: string }>
  readonly now?: () => number
}

export type BackupResult =
  | { ok: true; head: string; hosts: string[]; atoms: number; failed: { host: string; reason: string }[] }
  | { ok: false; reason: 'no-nip44' | 'no-signer' | 'no-host' | 'no-seal' | 'no-recovery' | 'nowhere'; failed?: { host: string; reason: string }[] }

/** Keep the whole current hive on every upload host, as ciphertext only this key, its devices and the recovery key
 *  open. The newest backup replaces the last one in the index; atoms the host already holds are not sent again. */
export async function backupHive(deps: BackupDeps): Promise<BackupResult> {
  const nip44 = deps.nip44()
  if (!nip44) return { ok: false, reason: 'no-nip44' }
  const publisher = (await deps.publisher().catch(() => '')).toLowerCase()
  const own = (await deps.own().catch(() => '')).toLowerCase()
  if (!SIG.test(publisher) || !SIG.test(own)) return { ok: false, reason: 'no-signer' }
  const recovery = String((await deps.recovery(publisher).catch(() => null)) ?? '').toLowerCase()
  if (!SIG.test(recovery)) return { ok: false, reason: 'no-recovery' }
  const hosts = [...new Set(await deps.hosts().catch(() => [] as string[]))]
  if (!hosts.length) return { ok: false, reason: 'no-host' }
  const head = String((await deps.seal().catch(() => null)) ?? '').toLowerCase()
  if (!SIG.test(head)) return { ok: false, reason: 'no-seal' }

  const carrier = backupCarrierBytes(head, (deps.now ?? Date.now)())
  const carrierSig = await signBytes(carrier)
  const getBytes = async (sig: string): Promise<Uint8Array | null> => sig === carrierSig ? carrier : deps.getBytes(sig)
  // Walked once, then sealed from memory for every host. NO CEILING: the sharing walk stops at CLOSURE_ATOMS_MAX, and
  // jwize's own hive (12,634 places, ~22,000 atoms on 2026-11-27) is past it, so a capped backup refused the very hive
  // it exists for. A backup that keeps part of the tree would be worse than none; this one keeps all of it.
  const closure = await collectClosure(carrierSig, getBytes, Infinity)
  if (!closure.has(head)) return { ok: false, reason: 'no-seal' }
  const held = async (sig: string): Promise<Uint8Array | null> => closure.get(sig) ?? null

  const kept: string[] = []
  const failed: { host: string; reason: string }[] = []
  let atoms = 0
  for (const host of hosts) {
    const devices = (await deps.devices(host, publisher).catch(() => [] as string[])).map(key => key.toLowerCase()).filter(key => SIG.test(key))
    const result = await publishSealed(carrierSig, [...new Set([publisher, recovery, ...devices])], {
      getBytes: held, upload: deps.upload(host), nip44, publisher: own, limit: Infinity,
      // One backup per key: the newest envelope replaces the last, never a list. Not history — the genome.
      setSealed: async envelopes => deps.setRoot(host, BACKUP_ROOT_KEY, envelopes[0]!),
    })
    if (result.ok) { kept.push(host); atoms = result.atoms }
    else failed.push({ host, reason: result.detail ? `${result.reason}: ${result.detail}` : result.reason })
  }
  return kept.length ? { ok: true, head, hosts: kept, atoms, failed } : { ok: false, reason: 'nowhere', failed }
}

// ── restore ──

export type RestoreDeps = {
  /** The roots of `publisher`'s verified signed index on `host`; null when it could not be read. */
  readonly roots: (host: string, publisher: string) => Promise<Readonly<Record<string, string>> | null>
  readonly fetcher: (host: string) => (sig: string) => Promise<Uint8Array | null>
  /** Keep one verified plaintext atom under its signature. */
  readonly put: (sig: string, bytes: Uint8Array) => Promise<boolean>
  readonly nip44: (secret: string) => Promise<Nip44 | null>
}

export type RestoreResult =
  | { ok: true; head: string; at: number; host: string; atoms: number }
  | { ok: false; reason: 'no-file' | 'no-backup' | 'unopened' | 'incomplete' | 'write-failed'; unread: string[] }

/** Bring the backup a recovery file names into this hive's store: every atom opened, checked and kept, the head last.
 *  It does not make the backup live — the caller does that with the returned head, as a new revision. */
export async function restoreHive(file: RecoveryFile | null, deps: RestoreDeps): Promise<RestoreResult> {
  if (!file) return { ok: false, reason: 'no-file', unread: [] }
  const nip44 = await deps.nip44(file.secret).catch(() => null)
  if (!nip44) return { ok: false, reason: 'no-file', unread: [] }
  const unread: string[] = []
  let worst: 'no-backup' | 'unopened' | 'incomplete' | 'write-failed' = 'no-backup'
  const rank = { 'no-backup': 0, unopened: 1, incomplete: 2, 'write-failed': 3 } as const
  const note = (reason: typeof worst): void => { if (rank[reason] > rank[worst]) worst = reason }

  for (const host of file.hosts) {
    const roots = await deps.roots(host, file.publisher).catch(() => null)
    if (!roots) { unread.push(host); continue }
    const envelope = String(roots[BACKUP_ROOT_KEY] ?? '').toLowerCase()
    if (!SIG.test(envelope)) continue
    const opened = await openSealedVersion([envelope], file.recovery, nip44, deps.fetcher(host)).catch(() => null)
    const carrier = opened ? parseBackupCarrier(await opened.read(opened.head).catch(() => null)) : null
    if (!opened || !carrier) { note('unopened'); continue }
    const atoms = new Map<string, Uint8Array>()
    let complete = true
    for (const sig of opened.atoms) {
      if (sig === opened.head) continue
      const bytes = await opened.read(sig).catch(() => null)
      if (!bytes) { complete = false; break }
      atoms.set(sig, bytes)
    }
    if (!complete || !atoms.has(carrier.head)) { note('incomplete'); continue }
    // The head goes last: a hive that holds the head holds the whole tree.
    const order = [...atoms.keys()].filter(sig => sig !== carrier.head).concat(carrier.head)
    let written = true
    for (const sig of order) {
      const bytes = atoms.get(sig)!
      if (bytes.byteLength && !(await deps.put(sig, bytes).catch(() => false))) { written = false; break }
    }
    if (!written) { note('write-failed'); continue }
    return { ok: true, head: carrier.head, at: carrier.at, host, atoms: atoms.size }
  }
  return { ok: false, reason: worst, unread }
}

// ── the live collaborators ──

const ioc = <T,>(key: string): T | undefined => (window as unknown as { ioc?: { get?: (key: string) => unknown } }).ioc?.get?.(key) as T | undefined

type StoreLike = {
  getPool?: (meaning: string) => Promise<FileSystemDirectoryHandle | undefined>
  openPool?: (meaning: string) => Promise<FileSystemDirectoryHandle | undefined>
  getPoolDoc?: (pool: FileSystemDirectoryHandle | undefined) => Promise<ArrayBuffer | null>
  putPoolDoc?: (pool: FileSystemDirectoryHandle, bytes: ArrayBuffer, subKey?: string, options?: { keep?: 'current' }) => Promise<string | null>
  writeLayerBytes?: (signature: string, bytes: ArrayBuffer) => Promise<void>
}
const store = (): StoreLike | undefined => ioc<StoreLike>('@hypercomb.social/Store')

/** The recovery record this hive keeps, or null. */
export const readRecoveryRecord = async (): Promise<RecoveryRecord | null> => {
  const s = store()
  const pool = await (s?.openPool ?? s?.getPool)?.call(s, BACKUP_RECOVERY_MEANING).catch(() => undefined)
  const bytes = pool ? await s?.getPoolDoc?.(pool).catch(() => null) : null
  return parseRecoveryRecord(bytes ? new Uint8Array(bytes) : null)
}

/** Remember the recovery key's PUBLIC half. Replaces the last one: only the current recovery key seals new backups. */
export const writeRecoveryRecord = async (record: RecoveryRecord): Promise<boolean> => {
  const s = store()
  const pool = await s?.getPool?.(BACKUP_RECOVERY_MEANING).catch(() => undefined)
  if (!pool || !s?.putPoolDoc) return false
  const bytes = new TextEncoder().encode(JSON.stringify(record))
  return !!(await s.putPoolDoc(pool, bytes.buffer as ArrayBuffer, undefined, { keep: 'current' }).catch(() => null))
}

/** The hosts the hive's root publishes to — the same doors a root publish writes through. */
export const liveBackupHosts = async (): Promise<string[]> => {
  const { nodesFor } = await import('./publish-branch.js')
  const { isPublishNode } = await import('./zone-door.js')
  const { prepareAnchorHosts } = await import('./key-list.client.js')
  const hostSync = ioc<Parameters<typeof nodesFor>[1]>('@diamondcoreprocessor.com/HostSyncService')
  const hosts = (await nodesFor([], hostSync).catch(() => [] as string[])).filter(isPublishNode)
  // A device that keeps for an anchor has each host hold the anchor's list before any byte goes up.
  await prepareAnchorHosts(hosts).catch(() => undefined)
  return hosts
}

export const liveBackupDeps = async (seal: () => Promise<string | null>): Promise<BackupDeps> => {
  const sealed = await import('./sealed-publish.js')
  const pointer = await import('./hive-pointer.js')
  const { publisherKeyHex, listedKeys } = await import('./key-list.client.js')
  return {
    hosts: liveBackupHosts,
    publisher: publisherKeyHex,
    own: async () => String((await ioc<{ getPublicKeyHex?: () => Promise<string | null> }>('@diamondcoreprocessor.com/NostrSigner')?.getPublicKeyHex?.().catch(() => null)) ?? ''),
    devices: async (host, publisher) => [...((await listedKeys(host, publisher).catch(() => null)) ?? [])],
    nip44: sealed.liveNip44,
    seal,
    getBytes: sealed.liveGetBytes,
    recovery: async publisher => {
      const record = await readRecoveryRecord()
      return record && record.publisher === publisher ? record.recovery : null
    },
    upload: sealed.liveUpload,
    setRoot: async (host, key, sig) => {
      const set = await pointer.setHiveRoot(host, key, sig)
      return { ok: set.ok, ...(set.reason && !set.ok ? { reason: set.reason } : {}) }
    },
  }
}

export const liveRestoreDeps = async (): Promise<RestoreDeps> => {
  const sealed = await import('./sealed-publish.js')
  const pointer = await import('./hive-pointer.js')
  return {
    roots: async (host, publisher) => {
      const read = await pointer.fetchHiveIndex(host, publisher, undefined, { fresh: true })
      return read.ok ? read.manifest.roots : read.reason === 'http' && read.status === 404 ? {} : null
    },
    fetcher: sealed.hostFetcher,
    // `writeLayerBytes`, as private-keep.ts: a sig-named file at the flat root, refused when the bytes do not hash to
    // their name, and never announced as something the participant authored.
    put: async (sig, bytes) => {
      const s = store()
      if (!s?.writeLayerBytes) return false
      try {
        await s.writeLayerBytes(sig, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)
        return true
      } catch { return false }
    },
    nip44: nip44FromSecret,
  }
}
