// Backup & Restore controller. The folder agent reports work; this window owns
// participant intent and policy so backup is not configured through a bee log.

import { EffectBus, requestConfirm } from '@hypercomb/core'
import {
  FOLDER_SYNC_KEY,
  type FolderImportResult,
  type FolderSyncMode,
  type FolderSyncService,
  type FolderSyncState,
} from './folder-sync.service.js'

const STYLE_ID = 'hc-backup-window-styles'

const service = (): FolderSyncService | undefined =>
  (window as any).ioc?.get?.(FOLDER_SYNC_KEY) as FolderSyncService | undefined

const formatBytes = (bytes = 0): string => {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const unit = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / 1024 ** unit
  return `${value >= 10 || unit === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`
}

export class FolderSyncView extends EventTarget {
  #window: HTMLDivElement | null = null
  #content: HTMLDivElement | null = null
  #busy = false

  constructor() {
    super()
    EffectBus.on('folder-sync:open', () => this.open())
    EffectBus.on<FolderSyncState>('folder-sync:state', () => this.#render())
  }

  open(): void {
    if (this.#window) {
      this.#window.focus()
      return
    }
    this.#ensureStyles()
    const win = document.createElement('div')
    win.className = 'hc-backup-window'
    win.tabIndex = -1

    const head = document.createElement('header')
    const title = document.createElement('div')
    title.innerHTML = '<strong>Backup &amp; Restore</strong><span>Private copies you control</span>'
    const close = this.#button('×', () => this.close(), 'Close')
    close.className = 'hc-backup-icon'
    head.append(title, close)

    const content = document.createElement('div')
    content.className = 'hc-backup-content'
    this.#content = content
    win.append(head, content)
    document.body.appendChild(win)
    this.#window = win
    this.#render()
    win.focus()
  }

  close(): void {
    this.#window?.remove()
    this.#window = null
    this.#content = null
  }

  #render(): void {
    const host = this.#content
    const sync = service()
    if (!host || !sync) return
    const state = sync.state()
    const settings = sync.settings()
    host.textContent = ''

    const summary = document.createElement('section')
    summary.className = `hc-backup-summary ${state.status}`
    const status = document.createElement('strong')
    status.textContent = this.#status(state)
    const details = document.createElement('span')
    details.textContent = state.folder
      ? `${state.folder} · ${(state.scanned ?? 0) + (state.dcpFiles ?? 0)} verified files · ${formatBytes(state.totalBytes)} total`
      : 'No backup folder selected'
    summary.append(status, details)

    const actions = document.createElement('section')
    actions.className = 'hc-backup-actions'
    const backup = this.#button('Back up now', async () => {
      const selected = host.querySelector<HTMLInputElement>('input[name="hc-backup-mode"]:checked')
      const visibleMode: FolderSyncMode = selected?.value === 'local' ? 'local' : 'hard-copy'
      sync.configure({ automatic: check.checked, mode: visibleMode })
      await this.#run(async () => {
        if (state.status === 'unconfigured') await sync.connect(visibleMode)
        else await sync.resume(visibleMode)
      })
    })
    backup.className = 'primary'
    const restore = this.#button('Restore from backup…', async () => {
      const confirmed = await requestConfirm({
        title: 'Restore from folder backup',
        message: 'Choose a completed Hypercomb backup. Missing files will be added; differing existing files will not be overwritten.',
        confirmLabel: 'Choose backup',
        cancelLabel: 'Cancel',
      })
      if (!confirmed) return
      await this.#run(async () => {
        const result = await sync.importFromFolder()
        if (result) this.#showImport(result)
      })
    })
    const choose = this.#button(state.folder ? 'Change folder…' : 'Choose folder…',
      () => this.#run(() => sync.connect(settings.mode)))
    const open = this.#button('Open backup folder', () => sync.showLocation())
    open.disabled = !state.folder
    actions.append(backup, restore, choose, open)

    const config = document.createElement('section')
    const heading = document.createElement('h3')
    heading.textContent = 'Automatic backup'
    const automatic = document.createElement('label')
    automatic.className = 'hc-backup-check'
    const check = document.createElement('input')
    check.type = 'checkbox'
    check.checked = settings.automatic
    automatic.append(check, document.createTextNode(' Slowly back up changes while the browser is idle'))

    const modes = document.createElement('div')
    modes.className = 'hc-backup-modes'
    modes.append(
      this.#mode('hard-copy', 'Portable hard copy', 'Include referenced packages and resources so the backup can stand alone.', settings.mode),
      this.#mode('local', 'Local files only', 'Copy only bytes already stored by this browser; never fetch missing resources.', settings.mode),
    )
    modes.addEventListener('change', () => {
      const selected = modes.querySelector<HTMLInputElement>('input[name="hc-backup-mode"]:checked')
      sync.configure({
        automatic: check.checked,
        mode: selected?.value === 'local' ? 'local' : 'hard-copy',
      })
    })
    check.addEventListener('change', () => {
      const selected = modes.querySelector<HTMLInputElement>('input[name="hc-backup-mode"]:checked')
      sync.configure({
        automatic: check.checked,
        mode: selected?.value === 'local' ? 'local' : 'hard-copy',
      })
    })
    const save = this.#button('Save settings', () => {
      const selected = host.querySelector<HTMLInputElement>('input[name="hc-backup-mode"]:checked')
      sync.configure({
        automatic: check.checked,
        mode: (selected?.value === 'local' ? 'local' : 'hard-copy'),
      })
      this.#render()
    })
    config.append(heading, automatic, modes, save)

    const note = document.createElement('p')
    note.className = 'hc-backup-note'
    note.textContent = 'Restore accepts only a completed, verified Hypercomb backup and never overwrites a conflicting local file.'
    host.append(summary, actions, config, note)
    host.querySelectorAll('button').forEach(button => { button.disabled ||= this.#busy })
  }

  #mode(value: FolderSyncMode, title: string, detail: string, selected: FolderSyncMode): HTMLElement {
    const label = document.createElement('label')
    label.className = 'hc-backup-mode'
    const radio = document.createElement('input')
    radio.type = 'radio'
    radio.name = 'hc-backup-mode'
    radio.value = value
    radio.checked = selected === value
    const copy = document.createElement('span')
    copy.innerHTML = `<strong>${title}</strong><small>${detail}</small>`
    label.append(radio, copy)
    return label
  }

  #button(label: string, action: () => unknown | Promise<unknown>, title?: string): HTMLButtonElement {
    const button = document.createElement('button')
    button.type = 'button'
    button.textContent = label
    if (title) {
      button.title = title
      button.setAttribute('aria-label', title)
    }
    button.addEventListener('click', () => { void action() })
    return button
  }

  async #run(action: () => unknown | Promise<unknown>): Promise<void> {
    if (this.#busy) return
    this.#busy = true
    this.#render()
    try { await action() } finally {
      this.#busy = false
      this.#render()
    }
  }

  #status(state: FolderSyncState): string {
    switch (state.status) {
      case 'backed-up': return 'Backup verified'
      case 'syncing': return state.phase ?? 'Backing up…'
      case 'incomplete': return 'Portable backup incomplete'
      case 'needs-permission': return 'Folder permission required'
      case 'error': return `Backup needs attention: ${state.error ?? 'unknown error'}`
      case 'unsupported': return 'Folder backup is unavailable in this browser'
      default: return 'Backup is not configured'
    }
  }

  #showImport(result: FolderImportResult): void {
    EffectBus.emit('toast:show', {
      type: result.conflicts || result.invalid ? 'info' : 'success',
      title: 'Restore complete',
      message: `${result.copied} files imported; ${result.identical} already present; ${result.conflicts} conflicts untouched.`,
    })
  }

  #ensureStyles(): void {
    if (document.getElementById(STYLE_ID)) return
    const style = document.createElement('style')
    style.id = STYLE_ID
    style.textContent = `
.hc-backup-window{position:fixed;z-index:100000;inset:clamp(1rem,8vh,5rem) clamp(1rem,8vw,7rem);
  margin:auto;max-width:54rem;max-height:44rem;display:flex;flex-direction:column;color:#eef4fa;
  background:rgba(7,10,15,.98);border:1px solid rgba(126,182,214,.38);border-radius:12px;
  box-shadow:0 1.5rem 5rem rgba(0,0,0,.55);font-family:var(--hc-sans,system-ui,sans-serif);}
.hc-backup-window header{display:flex;align-items:center;padding:1rem 1.15rem;border-bottom:1px solid rgba(255,255,255,.09);}
.hc-backup-window header>div{display:flex;flex:1;flex-direction:column;gap:.15rem;}
.hc-backup-window header strong{font-size:1rem;letter-spacing:.04em}.hc-backup-window header span{font-size:.75rem;color:#91a2ae}
.hc-backup-icon{border:0!important;background:none!important;font-size:1.5rem!important;padding:.25rem .55rem!important}
.hc-backup-content{overflow:auto;padding:1rem 1.15rem;display:flex;flex-direction:column;gap:1rem}
.hc-backup-content section{padding:1rem;border:1px solid rgba(255,255,255,.09);border-radius:9px}
.hc-backup-summary{display:flex;flex-direction:column;gap:.3rem}.hc-backup-summary span,.hc-backup-note{font-size:.8rem;color:#9babb6}
.hc-backup-summary.backed-up{border-color:rgba(126,196,142,.5)}
.hc-backup-actions{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.65rem}
.hc-backup-window button{min-height:2.35rem;padding:.45rem .75rem;border-radius:7px;border:1px solid rgba(255,255,255,.16);
  background:rgba(255,255,255,.05);color:#edf3f8;cursor:pointer}.hc-backup-window button:hover{background:rgba(255,255,255,.1)}
.hc-backup-window button.primary{background:rgb(126,182,214);border-color:rgb(126,182,214);color:#081017;font-weight:700}
.hc-backup-window button:disabled{opacity:.45;cursor:default}.hc-backup-window h3{margin:0 0 .75rem;font-size:.9rem}
.hc-backup-check{display:block;font-size:.85rem;margin-bottom:.75rem}.hc-backup-modes{display:grid;grid-template-columns:1fr 1fr;gap:.65rem;margin-bottom:.8rem}
.hc-backup-mode{display:flex;gap:.55rem;padding:.7rem;border:1px solid rgba(255,255,255,.1);border-radius:7px;cursor:pointer}
.hc-backup-mode span{display:flex;flex-direction:column;gap:.25rem}.hc-backup-mode small{color:#98a7b2;line-height:1.35}
.hc-backup-note{margin:0 .2rem}@media(max-width:600px){.hc-backup-window{inset:.5rem}.hc-backup-actions,.hc-backup-modes{grid-template-columns:1fr}}
`
    document.head.appendChild(style)
  }
}

const _folderSyncView = new FolderSyncView()
;(window as any).ioc?.register?.('@diamondcoreprocessor.com/FolderSyncView', _folderSyncView)
