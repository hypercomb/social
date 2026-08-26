// Framework-free bottom-right document action cluster.
import { EffectBus, ensureViewportInsetVars, I18N_IOC_KEY, type I18nProvider } from '@hypercomb/core'

const ELEMENT_NAME = 'hc-edit-actions'

type CursorStateLike = { position?: number; total?: number; rewound?: boolean }
type CursorLike = {
  state?: { locationSig?: string }
  currentLayerSig?: string
  load?: (locationSig: string) => Promise<void>
  jumpToLatest?: () => void
}
type HistoryLike = { promoteToHead?: (locationSig: string, layerSig: string) => Promise<string | null> }
type PushQueueLike = { drain?: () => Promise<void>; pending?: () => Promise<string[]> }
type SentinelBridgeLike = { saveBranch?: (name: string) => Promise<string | null> }
type I18nTarget = I18nProvider & EventTarget

const FALLBACKS: Record<string, string> = {
  'controls.edit-actions': 'undo, redo & save',
  'controls.undo': 'undo',
  'controls.redo': 'redo',
  'controls.save': 'save',
  'editor.switch-to-point': 'switch to point-top',
  'editor.switch-to-flat': 'switch to flat-top',
  'feedback.button': 'feedback',
  'selection.remove': 'remove',
  'selection.copy': 'copy',
  'selection.cut': 'cut',
}

const CSS = `
${ELEMENT_NAME}{display:contents}
${ELEMENT_NAME} .edit-actions{position:fixed;right:calc(.675rem + var(--hc-inset-right,0px));bottom:.525rem;z-index:59995;display:flex;flex-direction:row-reverse;align-items:center;gap:.3rem}
${ELEMENT_NAME} .ea-btn{display:flex;align-items:center;justify-content:center;width:1.9rem;height:1.9rem;padding:0;background:none;border:none;color:rgba(206,224,240,.5);cursor:pointer;transition:color 150ms ease,transform 120ms ease}
${ELEMENT_NAME} .ea-btn .mat-sym{font-family:'Material Symbols Outlined';font-size:1.25rem;line-height:1}
${ELEMENT_NAME} .ea-btn:hover:not(:disabled){color:#eaf5fb}
${ELEMENT_NAME} .ea-btn:active:not(:disabled){transform:scale(.9)}
${ELEMENT_NAME} .ea-btn:focus-visible{outline:1px solid rgba(126,182,214,.6);outline-offset:2px;border-radius:var(--hc-radius-control)}
${ELEMENT_NAME} .ea-btn:disabled{opacity:.25;cursor:default}
${ELEMENT_NAME} .ea-btn.on{color:rgb(126,182,214)}
${ELEMENT_NAME} .ea-divider{width:1px;height:1.2rem;margin:0 .1rem;background:rgba(126,182,214,.22)}
${ELEMENT_NAME} .ea-save{display:flex;align-items:center;justify-content:center;height:1.9rem;padding:0 .85rem;font-family:inherit;font-size:.74rem;letter-spacing:.04em;color:rgba(206,224,240,.95);background:rgba(126,182,214,.16);border:1px solid rgba(126,182,214,.55);border-radius:var(--hc-radius-control);cursor:pointer;transition:color 150ms ease,border-color 150ms ease,background 150ms ease,transform 120ms ease}
${ELEMENT_NAME} .ea-save:hover:not(:disabled){color:#fff;background:rgba(126,182,214,.3);border-color:rgba(126,182,214,.9)}
${ELEMENT_NAME} .ea-save:active:not(:disabled){transform:scale(.95)}
${ELEMENT_NAME} .ea-save:focus-visible{outline:1px solid rgba(126,182,214,.6);outline-offset:2px}
${ELEMENT_NAME} .ea-save:disabled{opacity:.55;cursor:default}
@media(max-width:599px),(max-height:449px){${ELEMENT_NAME} .edit-actions{display:none}}
`

let cssInstalled = false
const installCss = (): void => {
  if (cssInstalled || typeof document === 'undefined') return
  cssInstalled = true
  const style = document.createElement('style')
  style.setAttribute('data-hc-edit-actions', '')
  style.textContent = CSS
  document.head.appendChild(style)
}

const get = <T,>(key: string): T | undefined => window.ioc?.get?.<T>(key)

export class EditActionsElement extends HTMLElement {
  #connected = false
  #canUndo = false
  #canRedo = false
  #rewound = false
  #saving = false
  #selectionCount = 0
  #flatTop = false
  #viewActive = false
  #feedbackOpen = false
  #offs: Array<() => void> = []
  #i18n: I18nTarget | null = null

  connectedCallback(): void {
    if (this.#connected) return
    this.#connected = true
    installCss()
    ensureViewportInsetVars()
    this.#connectI18n()
    try { this.#flatTop = localStorage.getItem('hc:hex-orientation') === 'flat-top' } catch { /* unavailable */ }
    this.#offs.push(
      EffectBus.on<CursorStateLike>('history:cursor-changed', state => {
        const position = state?.position ?? 0
        const total = state?.total ?? 0
        const rewound = !!state?.rewound || position < total
        this.#canUndo = position > 0
        this.#canRedo = rewound
        this.#rewound = rewound
        this.#render()
      }),
      EffectBus.on<{ selected?: string[] }>('selection:changed', state => {
        this.#selectionCount = state?.selected?.length ?? 0
        this.#render()
      }),
      EffectBus.on<{ flat?: boolean }>('render:set-orientation', ({ flat }) => {
        this.#flatTop = !!flat
        this.#render()
      }),
      EffectBus.on<{ active?: boolean }>('view:active', ({ active }) => {
        this.#viewActive = !!active
        this.#render()
      }),
      EffectBus.on<{ open?: boolean }>('feedback:panel-state', ({ open }) => {
        this.#feedbackOpen = !!open
        this.#render()
      }),
      EffectBus.on('locale:changed', () => this.#render()),
    )
    this.#render()
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
    const current = get<I18nProvider>(I18N_IOC_KEY)
    if (current) connect(current)
    else window.ioc?.whenReady?.<I18nProvider>(I18N_IOC_KEY, connect)
  }

  readonly #onI18nChange = (): void => this.#render()

  #t(key: string): string {
    const value = this.#i18n?.t(key)
    return value && value !== key ? value : (FALLBACKS[key] ?? key)
  }

  #iconButton(glyph: string, labelKey: string, action: () => void, options: {
    disabled?: boolean
    on?: boolean
    pressed?: boolean
  } = {}): HTMLButtonElement {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'ea-btn'
    button.disabled = !!options.disabled
    button.classList.toggle('on', !!options.on)
    const label = this.#t(labelKey)
    button.title = label
    button.setAttribute('aria-label', label)
    if (options.pressed !== undefined) button.setAttribute('aria-pressed', String(options.pressed))
    button.addEventListener('click', action)
    const icon = document.createElement('span')
    icon.className = 'mat-sym'
    icon.textContent = glyph
    button.appendChild(icon)
    return button
  }

  #divider(): HTMLSpanElement {
    const divider = document.createElement('span')
    divider.className = 'ea-divider'
    divider.setAttribute('aria-hidden', 'true')
    return divider
  }

  async #save(): Promise<void> {
    if (this.#saving || !this.#rewound) return
    const cursor = get<CursorLike>('@diamondcoreprocessor.com/HistoryCursorService')
    const history = get<HistoryLike>('@diamondcoreprocessor.com/HistoryService')
    const locationSig = cursor?.state?.locationSig
    const layerSig = cursor?.currentLayerSig
    if (!history?.promoteToHead || !cursor || !locationSig || !layerSig) return

    this.#saving = true
    this.#render()
    try {
      await history.promoteToHead(locationSig, layerSig)
      await cursor.load?.(locationSig)
      cursor.jumpToLatest?.()
      const bridge = (globalThis as { __sentinelBridge?: SentinelBridgeLike }).__sentinelBridge
      if (bridge?.saveBranch) {
        const queue = get<PushQueueLike>('@diamondcoreprocessor.com/PushQueueService')
        if (queue) {
          await queue.drain?.()
          await this.#waitForPushDrain(queue)
        }
        await bridge.saveBranch('')
      }
    } finally {
      this.#saving = false
      this.#render()
    }
  }

  async #waitForPushDrain(queue: PushQueueLike, timeoutMs = 8_000): Promise<void> {
    const started = Date.now()
    for (;;) {
      const pending = (await queue.pending?.()) ?? []
      if (pending.length === 0 || Date.now() - started > timeoutMs) return
      await new Promise(resolve => setTimeout(resolve, 200))
    }
  }

  #render(): void {
    if (!this.#connected) return
    const group = document.createElement('div')
    group.className = 'edit-actions'
    group.setAttribute('role', 'group')
    group.setAttribute('aria-label', this.#t('controls.edit-actions'))
    if (this.#viewActive) group.style.display = 'none'

    group.appendChild(this.#iconButton(
      'crop_rotate',
      this.#flatTop ? 'editor.switch-to-point' : 'editor.switch-to-flat',
      () => EffectBus.emit('keymap:invoke', { cmd: 'render.toggleOrientation' }),
    ))
    group.appendChild(this.#iconButton(
      'forum', 'feedback.button',
      () => EffectBus.emit('feedback:toggle', {}),
      { on: this.#feedbackOpen, pressed: this.#feedbackOpen },
    ))
    group.appendChild(this.#iconButton(
      'undo', 'controls.undo',
      () => { if (this.#canUndo) EffectBus.emit('keymap:invoke', { cmd: 'history.undo' }) },
      { disabled: !this.#canUndo },
    ))

    if (this.#canRedo) {
      group.appendChild(this.#iconButton(
        'redo', 'controls.redo',
        () => EffectBus.emit('keymap:invoke', { cmd: 'history.redo' }),
      ))
    }
    if (this.#rewound) {
      group.appendChild(this.#divider())
      const save = document.createElement('button')
      save.type = 'button'
      save.className = 'ea-save'
      save.disabled = this.#saving
      save.textContent = this.#t('controls.save')
      save.title = this.#t('controls.save')
      save.setAttribute('aria-label', this.#t('controls.save'))
      save.addEventListener('click', () => { void this.#save() })
      group.appendChild(save)
    }
    if (!this.#rewound && this.#selectionCount > 0) {
      group.appendChild(this.#divider())
      group.appendChild(this.#iconButton(
        'delete', 'selection.remove',
        () => EffectBus.emit('controls:action', { action: 'remove' }),
      ))
      group.appendChild(this.#iconButton(
        'content_copy', 'selection.copy',
        () => EffectBus.emit('controls:action', { action: 'copy' }),
      ))
      group.appendChild(this.#iconButton(
        'content_cut', 'selection.cut',
        () => EffectBus.emit('controls:action', { action: 'cut' }),
      ))
    }
    this.replaceChildren(group)
  }
}

if (typeof customElements !== 'undefined' && !customElements.get(ELEMENT_NAME)) {
  customElements.define(ELEMENT_NAME, EditActionsElement)
}
