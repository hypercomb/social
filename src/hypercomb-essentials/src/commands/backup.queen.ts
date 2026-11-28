// commands/backup.queen.ts
//
// `/backup` — keep the whole hive, as it is now, on your hosts as ciphertext.
//
//   /backup           → asks once, then seals the hive and keeps it on every host the root publishes to
//   /backup folder    → the same, and also into a folder you pick (a disk, a USB stick, a OneDrive folder); every
//                       later /backup keeps it there too. With no host turned on, /backup asks for a folder.
//   /backup restore   → asks once, then opens a recovery file and makes the kept hive live again — from the hosts it
//                       names, or from the backup folder when they do not hold it
//
// One gesture, one confirm. It backs up the GENOME — the seal of the current tree, one signature — never the history,
// and it sends only what the host does not already hold (sharing/hive-backup.ts says why both are true).
//
// THE RECOVERY FILE. A browser clear takes this device's signing key with the hive, so the first backup mints a
// recovery key and saves its secret as a file the participant keeps offline. Every backup is sealed to it as well. A
// restore asks for that file; nothing else can open the backup on a fresh browser. Only the key's public half is kept
// in the hive.
//
// Restore is a forward commit through the same walk as /restore (seal-restore.ts): nothing is deleted, and a restore
// point is taken first when there is anything to come back to.

import { EffectBus, get, requestConfirm, I18N_IOC_KEY, QueenBee, type I18nProvider } from '@hypercomb/core'
import { SNAPSHOTS_SLOT, readSnapshots } from '../history/snapshots-slot.js'
import { applySealAt } from '../history/seal-restore.js'
import {
  backupHive, liveBackupDeps, liveBackupHosts, liveRestoreDeps, mintRecoveryKey, parseRecoveryFile,
  readRecoveryRecord, recoveryFileText, restoreHive, writeRecoveryRecord, type BackupResult, type RestoreResult,
} from '../sharing/hive-backup.js'
import {
  folderFetcher, folderRoots, folderTarget, hasBackupFolder, liveFolderIo, pickBackupFolder, rememberedBackupFolder,
} from '../sharing/backup-folder.js'

const LINEAGE_KEY = '@hypercomb.social/Lineage'
const SNAPSHOT_QUEEN_KEY = '@diamondcoreprocessor.com/SnapshotQueenBee'

interface SnapshotQueenLike { createRestorePoint?: (name: string) => Promise<boolean> }
interface LineageLike { explorerSegments?: () => readonly string[] }

export class BackupQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'backup'
  override description = 'Keep the whole hive as it is now on your hosts, encrypted — only what changed is sent'
  override descriptionKey = 'slash.backup'
  override options = ['restore', 'folder']
  override examples = [
    { input: '/backup', result: 'Seals the hive and keeps it on your hosts as ciphertext only you can open' },
    { input: '/backup folder', result: 'Also keeps it in a folder you pick, as ciphertext; later backups keep it there too' },
    { input: '/backup restore', result: 'Opens your recovery file and makes the kept hive live again' },
  ]

  #running = false

  protected async execute(args: string): Promise<void> {
    if (this.#running) return
    this.#running = true
    try {
      const word = String(args ?? '').trim().toLowerCase()
      if (word === 'restore') await this.#restore()
      else await this.#backup(word === 'folder')
    } finally { this.#running = false }
  }

  // ── back up ─────────────────────────────────────────────

  async #backup(pickFolder: boolean): Promise<void> {
    const i18n = get(I18N_IOC_KEY) as I18nProvider | undefined
    const title = this.#t(i18n, 'backup.title', 'Backup')
    const hosts = await liveBackupHosts().catch(() => [] as string[])
    const remembered = await hasBackupFolder().catch(() => false)
    // No host and no folder yet: a folder is where it goes.
    if (!hosts.length && !remembered) pickFolder = true
    if (pickFolder && !this.#canPickFolder()) {
      if (!hosts.length) {
        this.#toast('error', title, this.#t(i18n, 'backup.no-host',
          'No host takes your uploads yet — turn on a host for your hive, then run /backup again.'))
        return
      }
      this.#toast('info', title, this.#t(i18n, 'backup.folder.unsupported', 'This browser cannot write to a folder, so only your hosts are used.'))
      pickFolder = false
    }
    const folderWord = pickFolder
      ? this.#t(i18n, 'backup.folder.pick-next', 'a folder you pick next')
      : remembered ? this.#t(i18n, 'backup.folder.yours', 'your backup folder') : ''
    const places = [...hosts, ...(folderWord ? [folderWord] : [])].join(', ')

    const { publisherKeyHex } = await import('../sharing/key-list.client.js')
    const publisher = String((await publisherKeyHex().catch(() => '')) ?? '').toLowerCase()
    if (!/^[0-9a-f]{64}$/.test(publisher)) {
      this.#toast('error', title, this.#t(i18n, 'backup.no-signer', 'This browser has no signing key to back up with.'))
      return
    }
    const record = await readRecoveryRecord().catch(() => null)
    const needsRecovery = !record || record.publisher !== publisher

    const confirmed = await requestConfirm({
      title: 'backup.confirm.title',
      message: 'backup.confirm.message',
      messageParams: { hosts: places },
      ...(needsRecovery ? { warning: 'backup.confirm.recovery' } : {}),
      confirmLabel: 'backup.confirm.go',
      cancelLabel: 'backup.confirm.cancel',
    })
    if (!confirmed) return

    // The folder first, while the confirm click still counts as the participant's gesture (the browser asks for it).
    const handle = pickFolder ? await pickBackupFolder('readwrite') : remembered ? await rememberedBackupFolder().catch(() => null) : null
    if (pickFolder && !handle && !hosts.length) return
    if ((pickFolder || remembered) && !handle) this.#activity(this.#t(i18n, 'backup.folder.skipped', 'backup folder not opened — keeping it on your hosts only'), '✕')
    const io = handle ? await liveFolderIo(handle, true).catch(() => null) : null

    // The recovery key first: a backup sealed to a key nobody saved could not be opened after a clear.
    if (needsRecovery) {
      const key = await mintRecoveryKey()
      this.#save(recoveryFileText({ publisher, hosts, recovery: key.recovery, secret: key.secret, made: new Date().toISOString() }))
      if (!(await writeRecoveryRecord({ v: 1, recovery: key.recovery, publisher, at: Date.now() }))) {
        this.#toast('error', title, this.#t(i18n, 'backup.recovery-failed', 'The recovery key could not be remembered — nothing was backed up.'))
        return
      }
      this.#activity(this.#t(i18n, 'backup.recovery-saved', 'recovery file saved — keep it offline'), '🔑')
    }

    // The seal is the snapshot's: one signature for the current tree, and a local restore point beside it.
    this.#activity(this.#t(i18n, 'backup.sealing', 'sealing your hive…'), '●')
    const seal = async (): Promise<string | null> => {
      const snapshot = get<SnapshotQueenLike>(SNAPSHOT_QUEEN_KEY)
      if (!snapshot?.createRestorePoint) return null
      const label = `host backup ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`
      if (!(await snapshot.createRestorePoint(label))) return null
      return (await readSnapshots()).at(-1)?.seal ?? null
    }
    const sendingTo = [...hosts, ...(io && handle ? [handle.name] : [])].join(', ')
    this.#activity(this.#t(i18n, 'backup.sending', 'keeping it on {hosts}…', { hosts: sendingTo }), '●')
    const result = await backupHive({
      ...(await liveBackupDeps(seal)),
      hosts: async () => hosts,
      folder: async () => io && handle ? folderTarget(io, handle.name) : null,
    })
    this.#reportBackup(i18n, title, result)
  }

  #reportBackup(i18n: I18nProvider | undefined, title: string, result: BackupResult): void {
    if (result.ok) {
      for (const miss of result.failed) this.#activity(`${miss.host}: ${miss.reason}`, '✕')
      this.#toast(result.failed.length ? 'info' : 'success', title, this.#t(i18n, 'backup.done',
        'Backed up {seal} to {hosts} — {atoms} files, only the new ones sent.',
        { seal: result.head.slice(0, 8), hosts: [...result.hosts, ...(result.folder ? [result.folder] : [])].join(', '), atoms: result.atoms }))
      return
    }
    for (const miss of result.failed ?? []) this.#activity(`${miss.host}: ${miss.reason}`, '✕')
    const reasons: Record<string, string> = {
      'no-nip44': 'This signer cannot encrypt (no NIP-44), so nothing was backed up.',
      'no-signer': 'This browser has no signing key to back up with.',
      'no-host': 'No host takes your uploads yet — turn on a host for your hive, then run /backup again.',
      'no-seal': 'The hive could not be sealed, so nothing was backed up.',
      'no-recovery': 'There is no recovery key for this hive yet — run /backup again.',
      nowhere: 'No host took the backup — see the activity log.',
    }
    this.#toast('error', title, this.#t(i18n, `backup.failed.${result.reason}`, reasons[result.reason] ?? result.reason))
  }

  // ── restore ─────────────────────────────────────────────

  async #restore(): Promise<void> {
    const i18n = get(I18N_IOC_KEY) as I18nProvider | undefined
    const title = this.#t(i18n, 'backup.restore.title', 'Restore backup')
    const confirmed = await requestConfirm({
      title: 'backup.restore.confirm.title',
      message: 'backup.restore.confirm.message',
      confirmLabel: 'backup.restore.confirm.go',
      cancelLabel: 'backup.restore.confirm.cancel',
    })
    if (!confirmed) return

    const text = await this.#pick()
    if (text === null) return
    const file = parseRecoveryFile(text)
    if (!file) {
      this.#toast('error', title, this.#t(i18n, 'backup.restore.bad-file', 'That is not a Hypercomb recovery file.'))
      return
    }

    const live = await liveRestoreDeps()
    let result: RestoreResult = { ok: false, reason: 'no-backup', unread: [] }
    if (file.hosts.length) {
      this.#activity(this.#t(i18n, 'backup.restore.fetching', 'opening your backup on {hosts}…', { hosts: file.hosts.join(', ') }), '●')
      result = await restoreHive(file, live)
    }
    // Not on the hosts (or none named, or no network): the backup folder. A fresh confirm, because picking a folder
    // needs the participant's own gesture.
    if (!result.ok && result.reason !== 'write-failed' && this.#canPickFolder()) {
      const fromFolder = await requestConfirm({
        title: 'backup.restore.folder.title',
        message: file.hosts.length ? 'backup.restore.folder.message' : 'backup.restore.folder.only',
        confirmLabel: 'backup.restore.folder.go',
        cancelLabel: 'backup.restore.confirm.cancel',
      })
      const handle = fromFolder ? await pickBackupFolder('read') : null
      const io = handle ? await liveFolderIo(handle, false).catch(() => null) : null
      if (handle && !io) {
        this.#toast('error', title, this.#t(i18n, 'backup.restore.folder.none', 'That folder holds no Hypercomb backup — pick the folder you backed up to.'))
        return
      }
      if (io && handle) {
        this.#activity(this.#t(i18n, 'backup.restore.fetching', 'opening your backup on {hosts}…', { hosts: handle.name }), '●')
        result = await restoreHive({ ...file, hosts: [handle.name] }, {
          ...live, roots: (_host, publisher) => folderRoots(io, publisher), fetcher: () => folderFetcher(io),
        })
      } else if (!file.hosts.length) return
    }
    if (!result.ok) return this.#reportRestoreFailure(i18n, title, result)

    // A way back that is one gesture — only when there is a hive here to come back to.
    if ((await readSnapshots().catch(() => [])).length > 0) {
      await get<SnapshotQueenLike>(SNAPSHOT_QUEEN_KEY)?.createRestorePoint?.('before host restore').catch(() => false)
    }
    const applied = await applySealAt([], result.head, [SNAPSHOTS_SLOT])
    this.#repaint()
    if (applied.failed > 0 && applied.changed === 0) {
      this.#toast('error', title, this.#t(i18n, 'backup.restore.apply-failed',
        'The backup was brought in, but its tree could not be made live.'))
      return
    }
    this.#toast('success', title, this.#t(i18n, 'backup.restore.done',
      'Restored the backup from {when} — {changed} places changed. Run /backup to save a new recovery file for this browser.',
      { when: new Date(result.at).toLocaleString(), changed: applied.changed }))
  }

  #reportRestoreFailure(i18n: I18nProvider | undefined, title: string, result: Extract<RestoreResult, { ok: false }>): void {
    for (const host of result.unread) this.#activity(`${host}: could not be read`, '✕')
    const reasons: Record<string, string> = {
      'no-file': 'That recovery file could not be used.',
      'no-backup': 'No backup was found on the hosts this file names.',
      unopened: 'A backup was found, but this recovery file does not open it.',
      incomplete: 'The backup is missing files on its host, so nothing was restored.',
      'write-failed': 'The backup could not be written into this browser.',
    }
    this.#toast('error', title, this.#t(i18n, `backup.restore.failed.${result.reason}`, reasons[result.reason] ?? result.reason))
  }

  // ── helpers ─────────────────────────────────────────────

  #canPickFolder = (): boolean => typeof (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function'

  /** Hand the participant their recovery file: their own download, never an upload. */
  #save(text: string): void {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
    try {
      const a = document.createElement('a')
      a.href = url
      a.download = `hypercomb-recovery-${new Date().toISOString().slice(0, 10)}.json`
      document.body.appendChild(a)
      a.click()
      a.remove()
    } finally { setTimeout(() => URL.revokeObjectURL(url), 0) }
  }

  /** The recovery file's text, or null when the participant picked nothing. */
  #pick(): Promise<string | null> {
    return new Promise(resolve => {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = 'application/json,.json'
      input.style.display = 'none'
      let settled = false
      const done = (value: string | null): void => { if (!settled) { settled = true; input.remove(); resolve(value) } }
      input.addEventListener('change', async () => {
        const chosen = input.files?.[0]
        done(chosen && chosen.size < 64 * 1024 ? await chosen.text().catch(() => null) : null)
      })
      input.addEventListener('cancel', () => done(null))
      document.body.appendChild(input)
      input.click()
    })
  }

  #repaint(): void {
    const lineage = get<LineageLike>(LINEAGE_KEY)
    const here = (lineage?.explorerSegments?.() ?? []).map(s => String(s ?? '').trim()).filter(Boolean)
    EffectBus.emit('fs:changed', { segments: [] })
    if (here.length > 0) EffectBus.emit('fs:changed', { segments: here })
  }

  #t = (i18n: I18nProvider | undefined, key: string, fallback: string, params?: Record<string, unknown>): string => {
    const said = i18n?.t(key, params as never)
    if (said && said !== key) return said
    return fallback.replace(/\{(\w+)\}/g, (whole, name: string) => params && name in params ? String(params[name]) : whole)
  }

  #activity = (message: string, icon: string): void => {
    EffectBus.emit('activity:log', { message, icon })
  }

  #toast = (type: string, title: string, message: string): void => {
    EffectBus.emit('toast:show', { type, title, message })
  }
}

// ── registration ────────────────────────────────────────

const _backup = new BackupQueenBee()
window.ioc.register('@diamondcoreprocessor.com/BackupQueenBee', _backup)
