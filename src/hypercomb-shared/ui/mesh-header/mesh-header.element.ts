// Framework-free mesh posture control. The element owns the safe
// private -> review -> host cycle; the runtime owns actual mesh membership.
import {
  EffectBus,
  I18N_IOC_KEY,
  SECRET_CHANGED,
  SECRET_STRENGTH_KEY,
  type I18nProvider,
  type SecretStrengthProvider,
  type ZoneValueChange,
} from '@hypercomb/core'

const ELEMENT_NAME = 'hc-mesh-header'
const STAGE_PRIVATE = 0
const STAGE_WORLD = 1
const STAGE_HOST = 2

const FALLBACKS: Record<string, string> = {
  'controls.leave-swarm': 'leave the swarm',
  'controls.stage-world': "choose what you're sharing — click to set host & secret",
  'controls.stage-host': 'set host, location & secret — click to return to private',
  'controls.stage-private': "private — click to choose what you'd share",
}

const CSS = `${ELEMENT_NAME}{display:contents}`
let cssInstalled = false
const installCss = (): void => {
  if (cssInstalled || typeof document === 'undefined') return
  cssInstalled = true
  const style = document.createElement('style')
  style.setAttribute('data-hc-mesh-header', '')
  style.textContent = CSS
  document.head.appendChild(style)
}

type I18nTarget = I18nProvider & EventTarget

export class MeshHeaderElement extends HTMLElement {
  #connected = false
  #stage = STAGE_PRIVATE
  #meshPublic = false
  #secret = ''
  #draft: string | null = null
  #offs: Array<() => void> = []
  #i18n: I18nTarget | null = null

  connectedCallback(): void {
    if (this.#connected) return
    this.#connected = true
    installCss()
    this.#connectI18n()
    this.#offs.push(
      EffectBus.on<ZoneValueChange>(SECRET_CHANGED, ({ value }) => {
        this.#secret = value ?? ''
        this.#render()
      }),
      EffectBus.on<{ secret: string | null }>('mesh:secret-draft', ({ secret }) => {
        this.#draft = secret
        this.#render()
      }),
      EffectBus.on('mesh:privacy-step-back', () => {
        if (!this.#meshPublic) this.#setStage(STAGE_WORLD)
      }),
      EffectBus.on<{ open?: boolean; cancelled?: boolean }>('mesh:modal-open', ({ open, cancelled }) => {
        if (!open && cancelled && !this.#meshPublic) this.#setStage(STAGE_PRIVATE)
      }),
      EffectBus.on<{ public?: boolean }>('mesh:public-changed', ({ public: meshPublic }) => {
        const changed = this.#meshPublic !== !!meshPublic
        this.#meshPublic = !!meshPublic
        if (changed) this.#setStage(STAGE_PRIVATE)
        else this.#render()
      }),
      EffectBus.on('locale:changed', () => this.#render()),
    )

    // A refresh must never carry the sharing-preview posture forward.
    this.#setStage(STAGE_PRIVATE)
  }

  disconnectedCallback(): void {
    if (!this.#connected) return
    this.#connected = false
    for (const off of this.#offs) off()
    this.#offs.length = 0
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

  #skipReview(): boolean {
    try { return localStorage.getItem('hc:skip-privacy-review') === '1' }
    catch { return false }
  }

  #setStage(next: number): void {
    this.#stage = next
    const active = next >= STAGE_WORLD
    try { localStorage.setItem('hc:world-mode', active ? '1' : '0') } catch { /* unavailable */ }
    EffectBus.emit('world:mode', { active })
    this.#render()
  }

  #shieldColor(): string {
    const secret = (this.#draft !== null ? this.#draft : this.#secret).trim()
    if (!secret) return 'rgba(245, 245, 245, 0.45)'
    const provider = window.ioc?.get?.<SecretStrengthProvider>(SECRET_STRENGTH_KEY)
    const score = provider?.evaluate(secret) ?? 0.5
    return `hsl(${Math.round(score * 130)}, 70%, 50%)`
  }

  #titleKey(): string {
    if (this.#meshPublic) return 'controls.leave-swarm'
    if (this.#stage === STAGE_WORLD) return 'controls.stage-world'
    if (this.#stage === STAGE_HOST) return 'controls.stage-host'
    return 'controls.stage-private'
  }

  #glyph(): string {
    if (this.#meshPublic) return 'groups'
    if (this.#stage === STAGE_WORLD) return 'public'
    if (this.#stage === STAGE_HOST) return 'hub'
    return 'lock'
  }

  #toggle(): void {
    if (this.#meshPublic) {
      EffectBus.emit('keymap:invoke', { cmd: 'mesh.togglePublic' })
      return
    }
    if (this.#stage === STAGE_PRIVATE) {
      if (this.#skipReview()) {
        this.#setStage(STAGE_HOST)
        EffectBus.emit('mesh:open-modal', { join: true })
      } else {
        this.#setStage(STAGE_WORLD)
      }
      return
    }
    if (this.#stage === STAGE_WORLD) {
      this.#setStage(STAGE_HOST)
      EffectBus.emit('mesh:open-modal', { join: true })
      return
    }
    EffectBus.emit('mesh:close-modal', {})
    this.#setStage(STAGE_PRIVATE)
  }

  #render(): void {
    if (!this.#connected) return
    const wrapper = document.createElement('div')
    wrapper.className = 'mesh-header'
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'mode-toggle'
    button.classList.toggle('solo-mode', !this.#meshPublic && this.#stage === STAGE_PRIVATE)
    button.classList.toggle('shield-mode', this.#meshPublic)
    button.classList.toggle('prep-mode', !this.#meshPublic && this.#stage > STAGE_PRIVATE)
    button.style.setProperty('--shield-color', this.#shieldColor())
    const title = this.#t(this.#titleKey())
    button.title = title
    button.setAttribute('aria-label', title)
    button.addEventListener('click', () => this.#toggle())

    const glyph = document.createElement('span')
    glyph.className = 'mat-sym'
    glyph.classList.toggle('filled', this.#meshPublic || this.#stage > STAGE_PRIVATE)
    glyph.textContent = this.#glyph()
    button.appendChild(glyph)
    wrapper.appendChild(button)
    this.replaceChildren(wrapper)
  }
}

if (typeof customElements !== 'undefined' && !customElements.get(ELEMENT_NAME)) {
  customElements.define(ELEMENT_NAME, MeshHeaderElement)
}
