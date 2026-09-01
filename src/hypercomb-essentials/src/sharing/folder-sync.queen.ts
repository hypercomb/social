// `/folder-sync` — connect, update, inspect, and safely import a portable
// full-OPFS folder backup. The directory picker is always participant-driven;
// no filesystem permission is requested during passive boot.

import { EffectBus, get, QueenBee, requestConfirm } from '@hypercomb/core'
import {
  FOLDER_SYNC_KEY,
  type FolderImportResult,
  type FolderSyncService,
} from './folder-sync.service.js'

export class FolderSyncQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'folder-sync'
  override readonly description =
    'Back up the complete local hive to a private folder, USB disk, NAS, or cloud-synced directory'
  override readonly options = ['hard-copy', 'local', 'status', 'connect', 'resume', 'sync', 'now', 'verify', 'import', 'disconnect']
  override readonly examples = [
    { input: '/folder-sync', result: 'Choose or resume a folder and create a portable hard copy' },
    { input: '/folder-sync local', result: 'Copy the exact local OPFS tree without network reads' },
    { input: '/folder-sync verify', result: 'Re-hash every backed-up file and prove it still matches' },
    { input: '/folder-sync import', result: 'Safely merge a folder backup into this browser without overwriting conflicts' },
  ]

  protected async execute(raw: string): Promise<void> {
    const service = get<FolderSyncService>(FOLDER_SYNC_KEY)
    if (!service) {
      this.#toast('error', 'Folder backup', 'The folder-backup service is not ready yet.')
      return
    }

    // The command itself is an action, not a status page. `resume` is the
    // smart entry point: it reuses a remembered handle, requests permission
    // again when the browser requires it, and opens the picker when no handle
    // has ever been selected.
    const requested = raw.trim().toLowerCase()
    if (!requested) {
      EffectBus.emit('folder-sync:open', {})
      return
    }
    const action = requested === 'sync' ? 'resume' : requested
    if (!service.isSupported()) {
      this.#toast(
        'info',
        'Folder backup',
        'This browser cannot grant directory access. Use /download for a one-file snapshot that you can move privately between devices.',
      )
      return
    }

    switch (action) {
      case 'connect': {
        await service.connect('hard-copy')
        this.#showOutcome(service)
        break
      }
      case 'resume': {
        await service.resume('hard-copy')
        this.#showOutcome(service)
        break
      }
      case 'hard-copy': {
        await service.resume('hard-copy')
        this.#showOutcome(service)
        break
      }
      case 'local': {
        await service.resume('local')
        this.#showOutcome(service)
        break
      }
      case 'now': {
        await service.syncNow('hard-copy')
        this.#showOutcome(service)
        break
      }
      case 'verify': {
        await service.verify()
        this.#showOutcome(service)
        break
      }
      case 'disconnect': {
        await service.disconnect()
        this.#toast('info', 'Folder backup', 'Folder access forgotten. Existing backup files were not deleted.')
        break
      }
      case 'import': {
        const confirmed = await requestConfirm({
          title: 'Folder backup import',
          message: 'Choose a Hypercomb backup folder. Missing files will be added to this browser; existing differing files will never be overwritten.',
          confirmLabel: 'Choose backup',
          cancelLabel: 'Cancel',
        })
        if (!confirmed) return
        try {
          const result = await service.importFromFolder()
          if (!result) return
          this.#reportImport(result)
        } catch (error) {
          this.#toast('error', 'Folder backup import', error instanceof Error ? error.message : String(error))
        }
        break
      }
      case 'status': {
        this.#toast('info', 'Folder backup', this.#stateMessage(service.state()))
        break
      }
      default:
        this.#toast('tip', 'Folder backup', 'Use /folder-sync, hard-copy, local, connect, resume, now, import, status, or disconnect.')
    }
  }

  #reportImport(result: FolderImportResult): void {
    const problems = result.conflicts + result.invalid + result.unresolved + result.incompleteSources
    const sources = result.sourceDevices?.length ?? 1
    const message = [
      `${result.copied} files imported from ${sources} device snapshot${sources === 1 ? '' : 's'}.`,
      `${result.identical} were already present.`,
      result.conflicts ? `${result.conflicts} conflicts were left untouched.` : '',
      result.invalid ? `${result.invalid} invalid files were rejected.` : '',
      ...result.warnings,
    ].filter(Boolean).join(' ')
    this.#toast(problems ? 'info' : 'success', 'Folder backup import', message)
    if (result.copied > 0) {
      EffectBus.emit('activity:log', {
        message: `${message} Reload Hypercomb to open the imported state.`,
        icon: '●',
      })
      // The running shell still holds the pre-import heads and store indexes.
      // A restore is not complete until those imported bytes become the live
      // hive, so reopen this same origin after the result has been visible.
      setTimeout(() => window.location.reload(), 900)
    }
  }

  #stateMessage(state: ReturnType<FolderSyncService['state']>): string {
    switch (state.status) {
      case 'backed-up':
        return [
          state.damaged === 0 && state.verified
            ? `Backup re-hashed in ${state.folder ?? 'the selected folder'}: all ${state.verified} files match.`
            : [
                `${state.mode === 'hard-copy' ? 'Portable hard copy' : 'Local mirror'} complete in ${state.folder ?? 'the selected folder'}:`,
                `${state.scanned ?? 0} files, ${this.#formatBytes(state.totalBytes ?? 0)}.`,
                // Content is named by its own signature, so a file already
                // present at the right size is already correct. Claiming a
                // byte-level re-read here would be a lie — that is /verify.
                'Unchanged files were kept, not rewritten; run /folder-sync verify to re-hash every file.',
              ].join(' '),
          'Open hypercomb-backup/BACKUP-REPORT.txt for the full category and path inventory.',
        ].join(' ')
      case 'incomplete':
        return state.damaged
          ? [
              `${state.damaged} of ${state.scanned ?? 0} backed-up files did not match their recorded signature.`,
              'Run /folder-sync hard-copy to rewrite them, then verify again.',
            ].join(' ')
          : [
              `Local bytes were copied: ${state.scanned ?? 0} files, ${this.#formatBytes(state.totalBytes ?? 0)}.`,
              `This is not yet a complete portable hard copy because ${state.missingReferences ?? 0} referenced items could not be made local`,
              state.failedRoots
                ? `and ${state.failedRoots} closure root${state.failedRoots === 1 ? '' : 's'} produced no layer, leaving everything beneath unmeasured.`
                : '.',
              'Open hypercomb-backup/BACKUP-REPORT.txt and retry /folder-sync hard-copy while the sources are reachable.',
            ].join(' ')
      case 'syncing':
        return `${state.phase ?? 'Backing up'} — ${state.scanned ?? 0} files / ${this.#formatBytes(state.totalBytes ?? 0)} checked, ${state.copied ?? 0} copied.`
      case 'needs-permission':
        return `Folder backup is paused. Run /folder-sync resume to grant access to ${state.folder ?? 'the folder'} again.`
      case 'error':
        return `Folder backup needs attention: ${state.error ?? 'unknown error'}.`
      case 'unsupported':
        return 'Directory access is unavailable in this browser. Use /download for a portable one-file snapshot.'
      default:
        return 'No folder backup is connected. Run /folder-sync connect to choose a private directory.'
    }
  }

  #showOutcome(service: FolderSyncService): void {
    const state = service.state()
    if (['unconfigured', 'needs-permission'].includes(state.status)) return
    this.#toast(
      state.status === 'backed-up' ? 'success'
        : state.status === 'incomplete' ? 'warning'
          : 'error',
      'Folder backup',
      this.#stateMessage(state),
    )
  }

  #formatBytes(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
    const units = ['B', 'KB', 'MB', 'GB', 'TB']
    const unit = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
    const value = bytes / 1024 ** unit
    return `${value >= 10 || unit === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`
  }

  #toast(type: string, title: string, message: string): void {
    EffectBus.emit('toast:show', { type, title, message })
  }
}

const _folderSyncQueen = new FolderSyncQueenBee()
;(window as any).ioc?.register?.('@diamondcoreprocessor.com/FolderSyncQueenBee', _folderSyncQueen)
