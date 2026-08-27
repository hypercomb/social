// Framework-free installer surface. The shell only imports this module; boot
// and install state arrive over EffectBus, while user intent leaves through
// the stable window events owned by main.ts. Keeping the face beside the
// installer machinery lets Phase 4 move both into the pinned bootstrap bundle
// as one unit.
import {
  buildRevisionName,
  EffectBus,
  I18N_IOC_KEY,
  type I18nProvider,
} from '@hypercomb/core'
import { nativeAvailable } from '@hypercomb/shared/core/native-filesystem'
import { checkForUpdate, upgradeFromBundled, type BootStatus } from './ensure-install'

const ELEMENT_NAME = 'hc-install-prompt'
const SNAPSHOT_QUEEN_KEY = '@diamondcoreprocessor.com/SnapshotQueenBee'
const SNAPSHOT_READY_TIMEOUT_MS = 15_000

type SnapshotQueen = {
  createRestorePoint?: (name: string) => Promise<boolean>
}

/**
 * The update affordance can appear while non-critical bees are still landing.
 * A fast click must wait for the checkpoint service instead of treating its
 * not-yet-registered state as a failed snapshot.
 */
export const waitForSnapshotQueen = async (
  timeoutMs = SNAPSHOT_READY_TIMEOUT_MS,
): Promise<SnapshotQueen | undefined> => {
  const current = window.ioc?.get?.<SnapshotQueen>(SNAPSHOT_QUEEN_KEY)
  if (current) return current
  return new Promise(resolve => {
    let settled = false
    let off: (() => void) | undefined
    const finish = (queen?: SnapshotQueen): void => {
      if (settled) return
      settled = true
      window.clearTimeout(timer)
      off?.()
      resolve(queen)
    }
    const timer = window.setTimeout(() => finish(), timeoutMs)
    off = window.ioc?.onRegister?.((key, value) => {
      if (key === SNAPSHOT_QUEEN_KEY) finish(value as SnapshotQueen)
    })
  })
}

const FALLBACKS: Record<string, string> = {
  'install.title': 'Welcome to Hypercomb',
  'install.storage-blocked': 'Hypercomb keeps your hive in persistent browser storage, which did not respond here. If this is a private window, open a regular one. Otherwise, fully close your browser, reopen it, and load this page again.',
  'install.update-needed': 'This browser can open Hypercomb storage but cannot write to it. Update your device or browser, then reload this page.',
  'install.start': 'Start',
  'install.starting': 'Starting…',
}

const CSS = `
${ELEMENT_NAME}{display:contents}
${ELEMENT_NAME} .install-prompt{position:fixed;inset:0;z-index:2147483646;display:flex;align-items:center;justify-content:center;background:rgba(8,8,12,.92);backdrop-filter:blur(8px);font-family:var(--hc-font,system-ui,sans-serif);color:rgba(255,255,255,.92)}
${ELEMENT_NAME} .install-card{display:flex;align-items:center;justify-content:space-between;gap:1.75rem;max-width:23rem;width:calc(100vw - 3rem);padding:.9rem .9rem .9rem 1.4rem;background:rgba(16,16,21,.97);border:1px solid rgba(255,255,255,.08);border-radius:3px;box-shadow:0 24px 80px rgba(0,0,0,.55)}
${ELEMENT_NAME} h2{margin:0;font-size:1.05rem;font-weight:500;letter-spacing:.04em;color:rgba(255,255,255,.92);white-space:nowrap}
${ELEMENT_NAME} .install-blocked{margin:0;font-size:.8rem;line-height:1.55;color:rgba(255,255,255,.6)}
${ELEMENT_NAME} .install-progress{margin:.5rem 0 0;font-size:.7rem;font-variant-numeric:tabular-nums;letter-spacing:.02em;color:rgba(255,255,255,.45)}
${ELEMENT_NAME} .install-cta{flex:none;padding:.55rem 1.5rem;margin:0;font-size:.85rem;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:#0a0a0a;background:rgba(255,255,255,.92);border:0;border-radius:2px;cursor:pointer;transition:background .15s ease}
${ELEMENT_NAME} .install-cta:hover:not(:disabled){background:#fff}
${ELEMENT_NAME} .install-cta:disabled{opacity:.55;cursor:default}
`

let cssInstalled = false
const installCss = (): void => {
  if (cssInstalled || typeof document === 'undefined') return
  cssInstalled = true
  const style = document.createElement('style')
  style.setAttribute('data-hc-install-prompt', '')
  style.textContent = CSS
  document.head.appendChild(style)
}

type I18nTarget = I18nProvider & EventTarget
type InstallSyncPayload = {
  active?: boolean
  source?: string
  phase?: string
  current?: number
  total?: number
}

export class InstallPromptElement extends HTMLElement {
  #connected = false
  #bootStatus: BootStatus | null = null
  #dcpPortalOpen = false
  #upgrading = false
  #installProgress = ''
  #nativeInstallTried = false
  #i18n: I18nTarget | null = null
  #offs: Array<() => void> = []
  #updateTimer: number | null = null
  #focusTimer: number | null = null

  connectedCallback(): void {
    if (this.#connected) return
    this.#connected = true
    installCss()
    this.#connectI18n()
    this.#offs.push(
      EffectBus.on<BootStatus>('boot:status', this.#onBootStatus),
      EffectBus.on<InstallSyncPayload>('install:sync', this.#onInstallSync),
      EffectBus.on('locale:changed', this.#render),
    )
    window.addEventListener('portal:open', this.#onPortalOpen)
    window.addEventListener('dcp:embed-closed', this.#onPortalClosed)
    window.addEventListener('hypercomb:apply-update', this.#onApplyUpdate)
    window.addEventListener('focus', this.#onFocus)
    ;(window as typeof window & { upgradeHypercomb?: () => Promise<void> }).upgradeHypercomb = this.#upgradeHook

    this.#render()
    if (this.#consumeUpgradeParam()) void this.#upgradeFromBundledClicked()
    else this.#updateTimer = window.setTimeout(() => void checkForUpdate(), 4000)
  }

  disconnectedCallback(): void {
    if (!this.#connected) return
    this.#connected = false
    for (const off of this.#offs) off()
    this.#offs.length = 0
    window.removeEventListener('portal:open', this.#onPortalOpen)
    window.removeEventListener('dcp:embed-closed', this.#onPortalClosed)
    window.removeEventListener('hypercomb:apply-update', this.#onApplyUpdate)
    window.removeEventListener('focus', this.#onFocus)
    if (this.#updateTimer !== null) window.clearTimeout(this.#updateTimer)
    if (this.#focusTimer !== null) window.clearTimeout(this.#focusTimer)
    this.#updateTimer = null
    this.#focusTimer = null
    this.#i18n?.removeEventListener('change', this.#onI18nChange)
    this.#i18n = null
    const target = window as typeof window & { upgradeHypercomb?: () => Promise<void> }
    if (target.upgradeHypercomb === this.#upgradeHook) delete target.upgradeHypercomb
    this.replaceChildren()
  }

  #connectI18n(): void {
    const connect = (provider: I18nProvider): void => {
      if (!this.#connected || this.#i18n === provider) return
      this.#i18n?.removeEventListener('change', this.#onI18nChange)
      this.#i18n = provider as I18nTarget
      this.#i18n.addEventListener?.('change', this.#onI18nChange)
      this.#render()
    }
    const current = window.ioc?.get?.<I18nProvider>(I18N_IOC_KEY)
    if (current) connect(current)
    else window.ioc?.whenReady?.<I18nProvider>(I18N_IOC_KEY, connect)
  }

  readonly #onI18nChange = (): void => this.#render()

  #t(key: string): string {
    const value = this.#i18n?.t(key)
    return value && value !== key ? value : (FALLBACKS[key] ?? key)
  }

  readonly #onBootStatus = (status: BootStatus): void => {
    this.#bootStatus = status
    if (status?.kind === 'install-needed') this.#upgrading = false

    // A native app already represents an explicit install decision, so unpack
    // its bundled hive once per launch instead of stopping on a Start button.
    if (status?.kind === 'install-needed' && nativeAvailable() && !this.#nativeInstallTried) {
      this.#nativeInstallTried = true
      let attempts = 0
      try { attempts = Number(sessionStorage.getItem('hc:auto-install-attempts') ?? '0') } catch {}
      if (attempts < 1) {
        try { sessionStorage.setItem('hc:auto-install-attempts', String(attempts + 1)) } catch {}
        queueMicrotask(() => this.#startWelcome())
      }
    }
    this.#render()
  }

  readonly #onInstallSync = ({ active, source, phase, current, total }: InstallSyncPayload): void => {
    if (!active) {
      this.#installProgress = ''
    } else {
      const counted = typeof current === 'number' && typeof total === 'number' && total > 0
        ? ` ${current}/${total}`
        : ''
      this.#installProgress = `${source ?? 'install'}${phase ? ` · ${phase}` : ''}${counted}`
    }
    this.#render()
  }

  readonly #onPortalOpen = (event: Event): void => {
    if ((event as CustomEvent).detail?.target !== 'dcp') return
    this.#dcpPortalOpen = true
    this.#render()
  }

  readonly #onPortalClosed = (): void => {
    this.#dcpPortalOpen = false
    this.#render()
  }

  readonly #onFocus = (): void => {
    if (this.#focusTimer !== null) window.clearTimeout(this.#focusTimer)
    this.#focusTimer = window.setTimeout(() => void checkForUpdate(), 500)
  }

  readonly #onApplyUpdate = (event: Event): void => {
    const detail = (event as CustomEvent<{ restorePointName?: string; packageSig?: string | null }>).detail
    const restorePointName = String(detail?.restorePointName ?? '').trim()
      || buildRevisionName({
        packageSig: detail?.packageSig,
        locale: String(window.ioc?.get<{ locale?: string }>(I18N_IOC_KEY)?.locale ?? 'en'),
      })
    const packageSig = String(detail?.packageSig ?? '').trim().toLowerCase()
    if (/^[a-f0-9]{64}$/.test(packageSig)) {
      void (globalThis as { __sentinelBridge?: { nameRevision?: (sig: string, name: string) => Promise<boolean> } })
        .__sentinelBridge?.nameRevision?.(packageSig, restorePointName)
    }
    void this.#upgradeFromBundledClicked(restorePointName, true)
  }

  readonly #upgradeHook = (): Promise<void> => this.#upgradeFromBundledClicked()

  #startWelcome(): void {
    if (this.#upgrading) return
    this.#upgrading = true
    this.#render()
    window.dispatchEvent(new CustomEvent('hypercomb:start-install'))
  }

  async #upgradeFromBundledClicked(
    restorePointName?: string,
    requireCheckpoint = false,
  ): Promise<void> {
    if (this.#upgrading) return
    this.#upgrading = true
    this.#render()
    try {
      if (requireCheckpoint) {
        EffectBus.emit('update:status', { phase: 'snapshotting', message: 'Saving restore point…' })
        const queen = await waitForSnapshotQueen()
        if (!queen?.createRestorePoint) {
          EffectBus.emit('update:status', {
            phase: 'error',
            message: 'Update stopped — the restore service did not finish loading',
          })
          this.#upgrading = false
          this.#render()
          return
        }
        const checkpointed = await queen?.createRestorePoint?.(String(restorePointName ?? '').trim())
        if (!checkpointed) {
          EffectBus.emit('update:status', {
            phase: 'error',
            message: 'Update stopped — the restore point was not saved',
          })
          this.#upgrading = false
          this.#render()
          return
        }
      }
      EffectBus.emit('update:status', { phase: 'applying', message: 'Updating packages and website…' })
      const ok = await upgradeFromBundled()
      if (ok) {
        EffectBus.emit('update:status', { phase: 'complete', message: 'Everything is updated' })
        location.reload()
      } else {
        EffectBus.emit('update:status', { phase: 'error', message: 'Update failed — nothing was adopted' })
        this.#upgrading = false
        this.#render()
      }
    } catch (error) {
      console.error('[install-prompt] upgradeFromBundled failed', error)
      EffectBus.emit('update:status', { phase: 'error', message: 'Update failed — nothing was adopted' })
      this.#upgrading = false
      this.#render()
    }
  }

  #consumeUpgradeParam(): boolean {
    try {
      const url = new URL(location.href)
      if (!url.searchParams.has('upgrade')) return false
      url.searchParams.delete('upgrade')
      history.replaceState(history.state, '', url.toString())
      return true
    } catch {
      return false
    }
  }

  readonly #render = (): void => {
    if (!this.#connected) return
    const needed = this.#bootStatus?.kind === 'install-needed' && !this.#dcpPortalOpen
    if (!needed) {
      this.replaceChildren()
      return
    }

    const prompt = document.createElement('div')
    prompt.className = 'install-prompt'
    prompt.setAttribute('role', 'dialog')
    prompt.setAttribute('aria-modal', 'true')
    prompt.setAttribute('aria-labelledby', 'install-title')

    const card = document.createElement('div')
    card.className = 'install-card'
    const title = document.createElement('h2')
    title.id = 'install-title'
    title.textContent = this.#t('install.title')
    card.appendChild(title)

    const reason = this.#bootStatus?.kind === 'install-needed'
      ? this.#bootStatus.reason
      : undefined
    if (reason === 'no-storage' || reason === 'no-writable') {
      const blocked = document.createElement('p')
      blocked.className = 'install-blocked'
      blocked.textContent = this.#t(reason === 'no-storage'
        ? 'install.storage-blocked'
        : 'install.update-needed')
      card.appendChild(blocked)
    } else {
      const button = document.createElement('button')
      button.className = 'install-cta'
      button.type = 'button'
      button.disabled = this.#upgrading
      button.textContent = this.#t(this.#upgrading ? 'install.starting' : 'install.start')
      button.addEventListener('click', () => this.#startWelcome())
      card.appendChild(button)
      if (this.#upgrading && this.#installProgress) {
        const progress = document.createElement('p')
        progress.className = 'install-progress'
        progress.textContent = this.#installProgress
        card.appendChild(progress)
      }
    }

    prompt.appendChild(card)
    this.replaceChildren(prompt)
  }
}

if (typeof customElements !== 'undefined' && !customElements.get(ELEMENT_NAME)) {
  customElements.define(ELEMENT_NAME, InstallPromptElement)
}

// Resolve the shell-owned registry through IoC instead of importing its
// implementation. This element is delivered inside the signed acquisition
// bundle; bundling the registry module would create a second singleton and
// replace the shell's live surface set when this module executes.
const registry = get('@hypercomb.social/ShellSurfaceRegistry') as {
  add(surface: { name: string; owner?: string; element: string; order?: number }): void
} | undefined
registry?.add({
  name: ELEMENT_NAME,
  owner: 'InstallerBootstrap',
  element: ELEMENT_NAME,
  order: 1000,
})

declare global {
  interface HTMLElementTagNameMap {
    'hc-install-prompt': InstallPromptElement
  }
}
