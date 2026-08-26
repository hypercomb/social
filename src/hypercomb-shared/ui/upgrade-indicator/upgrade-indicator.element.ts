// Framework-free update notice. Update discovery/status arrive over EffectBus;
// adoption and installer review leave through stable window events.
import { buildRevisionName, EffectBus, I18N_IOC_KEY, type I18nProvider } from '@hypercomb/core'

interface UpdateAvailablePayload {
  available?: boolean
  newCount?: number
  packageSig?: string
  newBees?: string[]
  previous?: string | null
  label?: string
}

type UpdatePhase = 'idle' | 'available' | 'snapshotting' | 'applying' | 'complete' | 'error'
interface UpdateStatusPayload {
  phase?: Exclude<UpdatePhase, 'idle' | 'available'>
  message?: string
}

const ELEMENT_NAME = 'hc-upgrade-indicator'
const SAVED_KEY = 'hc:features-saved'
const DISCARDED_KEY = 'hc:features-discarded'
const SNOOZE_KEY = 'hc:features-snoozed'
const COMPLETE_KEY = 'hc:update-complete'
const COMPLETE_VISIBLE_MS = 12_000

const FALLBACKS: Record<string, string> = {
  'upgrade.available': 'New features available',
  'upgrade.adopt': 'Adopt',
  'upgrade.save': 'Save',
  'upgrade.discard': 'Discard',
  'upgrade.revision': 'Name for this update',
  'upgrade.installer': 'Installer',
  'upgrade.installer-hint': 'Review the changes in the installer first — Adopt installs silently right here',
}

const CSS = `
${ELEMENT_NAME}{display:contents}
${ELEMENT_NAME} .upgrade-indicator{display:flex;align-items:center;gap:.42rem;flex-shrink:0;min-width:0;min-height:2.15rem;padding:.28rem .38rem;color:#74baff;border:1px solid rgba(116,186,255,.28);border-radius:var(--hc-radius-floating);background:rgba(9,14,20,.94);box-shadow:0 8px 28px rgba(0,0,0,.42);backdrop-filter:blur(12px);pointer-events:auto}
${ELEMENT_NAME} .upgrade-indicator[data-phase='complete']{color:#74c98a}
${ELEMENT_NAME} .upgrade-indicator[data-phase='error']{color:#e78b8b}
${ELEMENT_NAME} .status-button{display:inline-flex;align-items:center;gap:.45rem;min-height:1.55rem;padding:0 .5rem;border:0;border-radius:3px;color:inherit;background:transparent;cursor:pointer;white-space:nowrap;font:650 .66rem/1 var(--hc-ui-font,system-ui,sans-serif);letter-spacing:.025em}
${ELEMENT_NAME} .status-button:hover:not(:disabled){background:rgba(255,255,255,.07)}
${ELEMENT_NAME} .status-button:focus-visible{outline:1px solid currentColor;outline-offset:1px}
${ELEMENT_NAME} .status-button:disabled{cursor:default}
${ELEMENT_NAME} .upgrade-count{display:grid;place-items:center;min-width:.9rem;height:.9rem;padding:0 .15rem;border-radius:999px;background:#4da6ff;color:#07121c;font:700 .52rem/1 var(--hc-mono,ui-monospace,monospace)}
${ELEMENT_NAME} .upgrade-act{padding:.3rem .5rem;border:1px solid transparent;border-radius:4px;color:rgba(220,234,245,.68);background:transparent;cursor:pointer;white-space:nowrap;font:600 .62rem/1 var(--hc-ui-font,system-ui,sans-serif);text-transform:uppercase;letter-spacing:.035em}
${ELEMENT_NAME} .upgrade-act:hover:not(:disabled){color:#f0f6fb;background:rgba(255,255,255,.07)}
${ELEMENT_NAME} .upgrade-act:disabled{opacity:.4;cursor:default}
${ELEMENT_NAME} .upgrade-act.adopt{color:#74baff;border-color:rgba(116,186,255,.35);background:rgba(77,166,255,.1)}
${ELEMENT_NAME} .restore-name{display:flex;align-items:center;gap:.4rem;color:rgba(220,234,245,.55);font:600 .58rem/1 var(--hc-ui-font,system-ui,sans-serif);text-transform:uppercase;letter-spacing:.04em}
${ELEMENT_NAME} .restore-name input{width:min(13rem,22vw);height:1.8rem;box-sizing:border-box;padding:0 .5rem;border:1px solid rgba(116,186,255,.35);border-radius:4px;outline:0;color:#eaf4fc;background:rgba(6,12,18,.72);font:500 .68rem/1 var(--hc-ui-font,system-ui,sans-serif)}
${ELEMENT_NAME} .restore-name input:focus{border-color:#74baff}
@media(max-width:599px){${ELEMENT_NAME} .upgrade-indicator{max-width:calc(100vw - 1rem);flex-wrap:wrap}${ELEMENT_NAME} .restore-name{display:none}}
`

let cssInstalled = false
const installCss = (): void => {
  if (cssInstalled || typeof document === 'undefined') return
  cssInstalled = true
  const style = document.createElement('style')
  style.setAttribute('data-hc-upgrade-indicator', '')
  style.textContent = CSS
  document.head.appendChild(style)
}

type I18nTarget = I18nProvider & EventTarget

export class UpgradeIndicatorElement extends HTMLElement {
  #connected = false
  #available = false
  #newCount = 0
  #phase: UpdatePhase = 'idle'
  #expanded = false
  #restorePointName = ''
  #statusMessage = ''
  #packageSig = ''
  #newBees: string[] = []
  #previous: string | null = null
  #label = ''
  #offs: Array<() => void> = []
  #completeTimer: number | null = null
  #i18n: I18nTarget | null = null

  constructor() {
    super()
    this.#restoreCompletedState()
  }

  connectedCallback(): void {
    if (this.#connected) return
    this.#connected = true
    installCss()
    if (this.#phase === 'complete') this.#restoreCompletedState()
    this.#connectI18n()
    this.#offs.push(
      EffectBus.on<UpdateAvailablePayload>('update:available', payload => this.#onAvailable(payload)),
      EffectBus.on<UpdateStatusPayload>('update:status', payload => this.#onStatus(payload)),
      EffectBus.on('locale:changed', () => this.#render()),
    )
    this.#render()
  }

  disconnectedCallback(): void {
    if (!this.#connected) return
    this.#connected = false
    for (const off of this.#offs) off()
    this.#offs.length = 0
    if (this.#completeTimer !== null) window.clearTimeout(this.#completeTimer)
    this.#completeTimer = null
    this.#i18n?.removeEventListener('change', this.#onI18nChange)
    this.#i18n = null
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

  #onAvailable(payload: UpdateAvailablePayload): void {
    const sig = String(payload?.packageSig ?? '').trim().toLowerCase()
    this.#packageSig = sig
    this.#newBees = Array.isArray(payload?.newBees) ? payload.newBees.map(String) : []
    this.#previous = typeof payload?.previous === 'string' ? payload.previous : null
    this.#label = String(payload?.label ?? '').trim()
    this.#restorePointName = buildRevisionName({
      packageSig: sig,
      label: this.#label,
      locale: this.#locale(),
    })
    const suppressed = this.#inList(DISCARDED_KEY, sig, localStorage)
      || this.#inList(SNOOZE_KEY, sig, sessionStorage)
    this.#available = !!payload?.available && !suppressed
    this.#newCount = payload?.newCount ?? 0
    if (payload?.available && !suppressed && !this.#busy() && this.#phase !== 'complete') {
      this.#phase = 'available'
    } else if (!payload?.available && this.#phase === 'available') {
      this.#phase = 'idle'
    }
    this.#render()
  }

  #onStatus(payload: UpdateStatusPayload): void {
    const next = payload?.phase
    if (!next) return
    this.#statusMessage = String(payload.message ?? '').trim()
    this.#expanded = false
    this.#phase = next
    if (next === 'complete') {
      try { sessionStorage.setItem(COMPLETE_KEY, String(Date.now())) } catch { /* unavailable */ }
      this.#armCompleteTimer()
    }
    this.#render()
  }

  #busy(): boolean {
    return this.#phase === 'snapshotting' || this.#phase === 'applying'
  }

  #statusText(): string {
    if (this.#statusMessage) return this.#statusMessage
    switch (this.#phase) {
      case 'snapshotting': return 'Saving restore point…'
      case 'applying': return 'Updating…'
      case 'complete': return 'Everything is updated'
      case 'error': return 'Update stopped safely'
      default: return this.#t('upgrade.available')
    }
  }

  #adopt(): void {
    const restorePointName = this.#restorePointName.trim()
      || buildRevisionName({ packageSig: this.#packageSig, label: this.#label, locale: this.#locale() })
    this.#expanded = false
    this.#render()
    window.dispatchEvent(new CustomEvent('hypercomb:apply-update', {
      detail: {
        restorePointName,
        packageSig: this.#packageSig || null,
        newBees: this.#newBees,
        previous: this.#previous,
      },
    }))
  }

  #reviewInInstaller(): void {
    this.#expanded = false
    this.#render()
    window.dispatchEvent(new CustomEvent('portal:open', {
      detail: {
        target: 'dcp',
        upgrade: {
          packageSig: this.#packageSig || null,
          newBees: this.#newBees,
          previous: this.#previous,
        },
      },
    }))
  }

  #save(): void {
    this.#remember(SNOOZE_KEY, this.#packageSig, sessionStorage)
    this.#remember(SAVED_KEY, this.#packageSig, localStorage)
    this.#available = false
    this.#phase = 'idle'
    this.#render()
  }

  #discard(): void {
    this.#remember(DISCARDED_KEY, this.#packageSig, localStorage)
    this.#available = false
    this.#phase = 'idle'
    this.#render()
  }

  #returnToAvailable(): void {
    this.#statusMessage = ''
    this.#phase = this.#available ? 'available' : 'idle'
    this.#expanded = this.#available
    this.#render()
  }

  #locale(): string {
    return String(this.#i18n?.locale ?? window.ioc?.get?.<I18nProvider>(I18N_IOC_KEY)?.locale ?? 'en')
  }

  #restoreCompletedState(): void {
    try {
      const at = Number(sessionStorage.getItem(COMPLETE_KEY) ?? 0)
      if (at > 0 && Date.now() - at < COMPLETE_VISIBLE_MS) {
        this.#phase = 'complete'
        this.#armCompleteTimer(COMPLETE_VISIBLE_MS - (Date.now() - at))
      } else {
        sessionStorage.removeItem(COMPLETE_KEY)
      }
    } catch { /* unavailable */ }
  }

  #armCompleteTimer(delay = COMPLETE_VISIBLE_MS): void {
    if (this.#completeTimer !== null) window.clearTimeout(this.#completeTimer)
    this.#completeTimer = window.setTimeout(() => {
      this.#completeTimer = null
      try { sessionStorage.removeItem(COMPLETE_KEY) } catch { /* unavailable */ }
      this.#statusMessage = ''
      this.#phase = this.#available ? 'available' : 'idle'
      this.#render()
    }, Math.max(0, delay))
  }

  #inList(key: string, sig: string, store: Storage): boolean {
    if (!sig) return false
    try {
      const values = JSON.parse(store.getItem(key) ?? '[]')
      return Array.isArray(values) && values.includes(sig)
    } catch { return false }
  }

  #remember(key: string, sig: string, store: Storage): void {
    if (!sig) return
    try {
      const values = JSON.parse(store.getItem(key) ?? '[]')
      const next = new Set<string>(Array.isArray(values) ? values : [])
      next.add(sig)
      store.setItem(key, JSON.stringify([...next]))
    } catch { /* unavailable */ }
  }

  #button(className: string, label: string, action: () => void): HTMLButtonElement {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = className
    button.textContent = label
    button.addEventListener('click', action)
    return button
  }

  #render(): void {
    if (!this.#connected) return
    if (this.#phase === 'idle') {
      this.replaceChildren()
      return
    }
    const indicator = document.createElement('div')
    indicator.className = 'upgrade-indicator'
    indicator.setAttribute('role', 'status')
    indicator.setAttribute('aria-live', 'polite')
    indicator.dataset['phase'] = this.#phase

    const status = this.#button('status-button', '', () => {
      if (this.#phase !== 'available') return
      this.#expanded = !this.#expanded
      this.#render()
    })
    status.disabled = this.#busy()
    status.setAttribute('aria-expanded', String(this.#expanded))
    status.setAttribute('aria-label', this.#statusText())
    status.title = this.#statusText()
    const statusLabel = document.createElement('span')
    statusLabel.textContent = this.#statusText()
    status.appendChild(statusLabel)
    if (this.#phase === 'available' && this.#newCount > 0) {
      const count = document.createElement('span')
      count.className = 'upgrade-count'
      count.textContent = String(this.#newCount)
      status.appendChild(count)
    }
    indicator.appendChild(status)

    if (this.#phase === 'available' && this.#expanded) {
      const name = document.createElement('label')
      name.className = 'restore-name'
      const input = document.createElement('input')
      input.type = 'text'
      input.value = this.#restorePointName
      input.title = this.#t('upgrade.revision')
      input.setAttribute('aria-label', this.#t('upgrade.revision'))
      input.addEventListener('input', () => { this.#restorePointName = input.value })
      input.addEventListener('keydown', event => {
        if (event.key === 'Enter') this.#adopt()
        if (event.key === 'Escape') {
          this.#expanded = false
          this.#render()
        }
      })
      name.appendChild(input)
      indicator.appendChild(name)
      indicator.appendChild(this.#button('upgrade-act adopt', this.#t('upgrade.adopt'), () => this.#adopt()))
      const review = this.#button('upgrade-act review', this.#t('upgrade.installer'), () => this.#reviewInInstaller())
      review.title = this.#t('upgrade.installer-hint')
      indicator.appendChild(review)
      indicator.appendChild(this.#button('upgrade-act save', this.#t('upgrade.save'), () => this.#save()))
      indicator.appendChild(this.#button('upgrade-act discard', this.#t('upgrade.discard'), () => this.#discard()))
    }

    if (this.#phase === 'error') {
      indicator.appendChild(this.#button('upgrade-act save', 'Try again', () => this.#returnToAvailable()))
    }
    this.replaceChildren(indicator)
  }
}

if (typeof customElements !== 'undefined' && !customElements.get(ELEMENT_NAME)) {
  customElements.define(ELEMENT_NAME, UpgradeIndicatorElement)
}
