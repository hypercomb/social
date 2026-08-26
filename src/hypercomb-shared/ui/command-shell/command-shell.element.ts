// Framework-free presentational command-line shell.
// Owns the input, completion list and action rail; the parent owns all business logic.

import { I18N_IOC_KEY, type I18nProvider } from '@hypercomb/core'

const ELEMENT_NAME = 'hc-command-shell'
const VIEW_TOGGLE_LONG_PRESS_MS = 500

export interface CommandShellDetail {
  name: string
  kind?: string
  description?: string
  icon?: string
  count?: number
  options?: readonly string[]
}

export interface CommandShellIndicator {
  key: string
  icon: string
  label: string
  dismissable?: boolean
  actionable?: boolean
}

export interface CommandShellResource {
  previewUrl: string
  type: 'image' | 'youtube' | 'link' | 'document'
}

export interface CommandShellSubject {
  previewUrl?: string
  label: string
  icon?: string
}

export interface CommandShellReadingMark {
  text: string
  role: string
  color?: string
}

export interface CommandShellViewToggle {
  view: string
  icon: string
  label: string
  active: boolean
  isDefault?: boolean
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text) node.textContent = text
  return node
}

function setBooleanAttribute(node: Element, name: string, value: boolean): void {
  node.setAttribute(name, String(value))
}

export class CommandShellElement extends HTMLElement {
  #connected = false
  #renderQueued = false
  #reflowTeardown?: () => void
  #i18n: (I18nProvider & EventTarget) | null = null

  #suggestions: readonly string[] = []
  #placeholder = ''
  #ghostValue = ''
  #hoverEcho = ''
  #showSuggestions = false
  #typedPrefix = ''
  #descriptionMap: ReadonlyMap<string, string> = new Map()
  #activeDetail: CommandShellDetail | null = null
  #colorMap: ReadonlyMap<string, string> = new Map()
  #wideSwatches = false
  #indicators: readonly CommandShellIndicator[] = []
  #showOpenForSubscribersToggle = false
  #openForSubscribers = false
  #openForSubscribersLabel = 'Allow anyone to subscribe to my hive'
  #notesPanelOpen = false
  #notesLabel = 'notes'
  #chatPanelOpen = false
  #chatLabel = 'chat'
  #featuresPanelOpen = false
  #featuresLabel = 'features'
  #pheromoneScopeIcon = 'blur_on'
  #pheromonePanelOpen = false
  #pheromonesLabel = 'pheromones'
  #showMic = false
  #micActive = false
  #micLabel = 'voice'
  #viewToggles: readonly CommandShellViewToggle[] = []
  #lockedFlash = false
  #lockedLabel = 'Pinned — unpin to pan or zoom'
  #armedResource: CommandShellResource | null = null
  #subject: CommandShellSubject | null = null
  #promptSigil: 'chevron' | 'slash' | 'question' = 'chevron'
  #readingMarks: readonly CommandShellReadingMark[] | null = null

  #value = ''
  #activeIndex = 0
  #suppressed = false
  #inputScrollLeft = 0
  #lastListKey = ''
  #viewTogglePressTimer: ReturnType<typeof setTimeout> | null = null
  #viewToggleDisabled = false

  get suggestions(): readonly string[] { return this.#suggestions }
  set suggestions(value: readonly string[]) {
    const next = value ?? []
    const key = next.join('\u0000')
    if (key !== this.#lastListKey) {
      this.#lastListKey = key
      this.#activeIndex = 0
      this.#emitState()
    }
    if (Object.is(this.#suggestions, next)) return
    this.#suggestions = next
    this.#scheduleRender()
  }

  #update<T>(current: T, next: T, write: (value: T) => void): void {
    if (Object.is(current, next)) return
    write(next)
    this.#scheduleRender()
  }

  get placeholder(): string { return this.#placeholder }
  set placeholder(value: string) { this.#update(this.#placeholder, value ?? '', next => { this.#placeholder = next }) }
  get ghostValue(): string { return this.#ghostValue }
  set ghostValue(value: string) { this.#update(this.#ghostValue, value ?? '', next => { this.#ghostValue = next }) }
  get hoverEcho(): string { return this.#hoverEcho }
  set hoverEcho(value: string) { this.#update(this.#hoverEcho, value ?? '', next => { this.#hoverEcho = next }) }
  get showSuggestions(): boolean { return this.#showSuggestions }
  set showSuggestions(value: boolean) { this.#update(this.#showSuggestions, !!value, next => { this.#showSuggestions = next }) }
  get typedPrefix(): string { return this.#typedPrefix }
  set typedPrefix(value: string) { this.#update(this.#typedPrefix, value ?? '', next => { this.#typedPrefix = next }) }
  get descriptionMap(): ReadonlyMap<string, string> { return this.#descriptionMap }
  set descriptionMap(value: ReadonlyMap<string, string>) { this.#update(this.#descriptionMap, value ?? new Map(), next => { this.#descriptionMap = next }) }
  get activeDetail(): CommandShellDetail | null { return this.#activeDetail }
  set activeDetail(value: CommandShellDetail | null) { this.#update(this.#activeDetail, value ?? null, next => { this.#activeDetail = next }) }
  get colorMap(): ReadonlyMap<string, string> { return this.#colorMap }
  set colorMap(value: ReadonlyMap<string, string>) { this.#update(this.#colorMap, value ?? new Map(), next => { this.#colorMap = next }) }
  get wideSwatches(): boolean { return this.#wideSwatches }
  set wideSwatches(value: boolean) { this.#update(this.#wideSwatches, !!value, next => { this.#wideSwatches = next }) }
  get indicators(): readonly CommandShellIndicator[] { return this.#indicators }
  set indicators(value: readonly CommandShellIndicator[]) { this.#update(this.#indicators, value ?? [], next => { this.#indicators = next }) }
  get showOpenForSubscribersToggle(): boolean { return this.#showOpenForSubscribersToggle }
  set showOpenForSubscribersToggle(value: boolean) { this.#update(this.#showOpenForSubscribersToggle, !!value, next => { this.#showOpenForSubscribersToggle = next }) }
  get openForSubscribers(): boolean { return this.#openForSubscribers }
  set openForSubscribers(value: boolean) { this.#update(this.#openForSubscribers, !!value, next => { this.#openForSubscribers = next }) }
  get openForSubscribersLabel(): string { return this.#openForSubscribersLabel }
  set openForSubscribersLabel(value: string) { this.#update(this.#openForSubscribersLabel, value ?? '', next => { this.#openForSubscribersLabel = next }) }
  get notesPanelOpen(): boolean { return this.#notesPanelOpen }
  set notesPanelOpen(value: boolean) { this.#update(this.#notesPanelOpen, !!value, next => { this.#notesPanelOpen = next }) }
  get notesLabel(): string { return this.#notesLabel }
  set notesLabel(value: string) { this.#update(this.#notesLabel, value ?? '', next => { this.#notesLabel = next }) }
  get chatPanelOpen(): boolean { return this.#chatPanelOpen }
  set chatPanelOpen(value: boolean) { this.#update(this.#chatPanelOpen, !!value, next => { this.#chatPanelOpen = next }) }
  get chatLabel(): string { return this.#chatLabel }
  set chatLabel(value: string) { this.#update(this.#chatLabel, value ?? '', next => { this.#chatLabel = next }) }
  get featuresPanelOpen(): boolean { return this.#featuresPanelOpen }
  set featuresPanelOpen(value: boolean) { this.#update(this.#featuresPanelOpen, !!value, next => { this.#featuresPanelOpen = next }) }
  get featuresLabel(): string { return this.#featuresLabel }
  set featuresLabel(value: string) { this.#update(this.#featuresLabel, value ?? '', next => { this.#featuresLabel = next }) }
  get pheromoneScopeIcon(): string { return this.#pheromoneScopeIcon }
  set pheromoneScopeIcon(value: string) { this.#update(this.#pheromoneScopeIcon, value ?? 'blur_on', next => { this.#pheromoneScopeIcon = next }) }
  get pheromonePanelOpen(): boolean { return this.#pheromonePanelOpen }
  set pheromonePanelOpen(value: boolean) { this.#update(this.#pheromonePanelOpen, !!value, next => { this.#pheromonePanelOpen = next }) }
  get pheromonesLabel(): string { return this.#pheromonesLabel }
  set pheromonesLabel(value: string) { this.#update(this.#pheromonesLabel, value ?? '', next => { this.#pheromonesLabel = next }) }
  get showMic(): boolean { return this.#showMic }
  set showMic(value: boolean) { this.#update(this.#showMic, !!value, next => { this.#showMic = next }) }
  get micActive(): boolean { return this.#micActive }
  set micActive(value: boolean) { this.#update(this.#micActive, !!value, next => { this.#micActive = next }) }
  get micLabel(): string { return this.#micLabel }
  set micLabel(value: string) { this.#update(this.#micLabel, value ?? '', next => { this.#micLabel = next }) }
  get viewToggles(): readonly CommandShellViewToggle[] { return this.#viewToggles }
  set viewToggles(value: readonly CommandShellViewToggle[]) { this.#update(this.#viewToggles, value ?? [], next => { this.#viewToggles = next }) }
  get lockedFlash(): boolean { return this.#lockedFlash }
  set lockedFlash(value: boolean) { this.#update(this.#lockedFlash, !!value, next => { this.#lockedFlash = next }) }
  get lockedLabel(): string { return this.#lockedLabel }
  set lockedLabel(value: string) { this.#update(this.#lockedLabel, value ?? '', next => { this.#lockedLabel = next }) }
  get armedResource(): CommandShellResource | null { return this.#armedResource }
  set armedResource(value: CommandShellResource | null) { this.#update(this.#armedResource, value ?? null, next => { this.#armedResource = next }) }
  get subject(): CommandShellSubject | null { return this.#subject }
  set subject(value: CommandShellSubject | null) { this.#update(this.#subject, value ?? null, next => { this.#subject = next }) }
  get promptSigil(): 'chevron' | 'slash' | 'question' { return this.#promptSigil }
  set promptSigil(value: 'chevron' | 'slash' | 'question') { this.#update(this.#promptSigil, value ?? 'chevron', next => { this.#promptSigil = next }) }
  get readingMarks(): readonly CommandShellReadingMark[] | null { return this.#readingMarks }
  set readingMarks(value: readonly CommandShellReadingMark[] | null) { this.#update(this.#readingMarks, value ?? null, next => { this.#readingMarks = next }) }

  connectedCallback(): void {
    if (this.#connected) return
    this.#connected = true
    this.#connectI18n()
    this.#render()
    const reflow = (): void => { if (this.#effectiveShowCompletions()) this.#positionIntel() }
    window.addEventListener('resize', reflow)
    window.addEventListener('scroll', reflow, true)
    this.#reflowTeardown = () => {
      window.removeEventListener('resize', reflow)
      window.removeEventListener('scroll', reflow, true)
    }
    queueMicrotask(() => { if (this.isConnected) this.inputElement?.focus() })
  }

  disconnectedCallback(): void {
    this.#connected = false
    this.#reflowTeardown?.()
    this.#reflowTeardown = undefined
    this.#i18n?.removeEventListener?.('change', this.#onI18nChange)
    this.#i18n = null
    this.#clearViewTogglePress()
  }

  #connectI18n(): void {
    const connect = (provider: I18nProvider): void => {
      if (!this.#connected || this.#i18n === provider) return
      this.#i18n?.removeEventListener?.('change', this.#onI18nChange)
      this.#i18n = provider as I18nProvider & EventTarget
      this.#i18n.addEventListener?.('change', this.#onI18nChange)
      this.#scheduleRender()
    }
    const current = window.ioc?.get?.<I18nProvider>(I18N_IOC_KEY)
    if (current) connect(current)
    else window.ioc?.whenReady?.<I18nProvider>(I18N_IOC_KEY, connect)
  }

  readonly #onI18nChange = (): void => this.#scheduleRender()

  #t(key: string, params: Record<string, string | number> = {}): string {
    const translated = this.#i18n?.t(key, params)
    if (translated && translated !== key) return translated
    return key.replace(/\{(\w+)\}/g, (whole, token: string) =>
      params[token] !== undefined ? String(params[token]) : whole,
    )
  }

  private get inputElement(): HTMLInputElement | undefined {
    return this.querySelector<HTMLInputElement>('.command-input') ?? undefined
  }

  /** Signal-shaped compatibility reads used by the still-Angular command controller. */
  readonly value = (): string => this.#value
  readonly activeIndex = (): number => this.#activeIndex
  readonly suppressed = (): boolean => this.#suppressed
  getActiveIndex = (): number => this.#activeIndex

  setValue(value: string): void {
    this.#value = value
    this.#activeIndex = 0
    const input = this.inputElement
    if (input) input.value = value
    this.#syncInputDecorations()
    this.#syncActiveOption()
    this.#emitState()
  }

  clear(): void {
    this.#value = ''
    this.#activeIndex = 0
    this.#suppressed = false
    const input = this.inputElement
    if (input) input.value = ''
    this.#scheduleRender()
    this.#emitState()
  }

  override focus(): void { this.inputElement?.focus() }
  override blur(): void { this.inputElement?.blur() }

  placeCaretAtEnd(): void {
    const input = this.inputElement
    if (!input) return
    queueMicrotask(() => input.setSelectionRange(input.value.length, input.value.length))
  }

  selectAll(): void {
    const input = this.inputElement
    if (!input) return
    queueMicrotask(() => input.setSelectionRange(0, input.value.length))
  }

  selectRange(start: number, end: number): void {
    const input = this.inputElement
    if (!input) return
    queueMicrotask(() => {
      const max = input.value.length
      input.setSelectionRange(Math.max(0, Math.min(start, max)), Math.max(0, Math.min(end, max)))
    })
  }

  suppress(): void {
    if (this.#suppressed) return
    this.#suppressed = true
    this.#scheduleRender()
    this.#emitState()
  }

  unsuppress(): void {
    if (!this.#suppressed) return
    this.#suppressed = false
    this.#scheduleRender()
    this.#emitState()
  }

  #emit<T>(name: string, detail?: T): void {
    this.dispatchEvent(new CustomEvent<T>(name, { detail, bubbles: true, composed: true }))
  }

  #emitState(): void {
    if (!this.#connected) return
    this.#emit('stateChange', { activeIndex: this.#activeIndex, suppressed: this.#suppressed })
  }

  #scheduleRender(): void {
    if (!this.#connected || this.#renderQueued) return
    this.#renderQueued = true
    queueMicrotask(() => {
      this.#renderQueued = false
      if (this.#connected) this.#render()
    })
  }

  #effectivePlaceholder(): string {
    return this.#hoverEcho || this.#ghostSuffix() ? '' : this.#placeholder
  }

  #ghostSuffix(): string {
    const ghost = this.#ghostValue
    if (!ghost || ghost.length <= this.#value.length || !ghost.startsWith(this.#value)) return ''
    if (this.#inputScrollLeft > 0) return ''
    return ghost.slice(this.#value.length)
  }

  #echoPad(): string {
    const base = this.#ghostValue.length > this.#value.length && this.#ghostValue.startsWith(this.#value)
      ? this.#ghostValue
      : this.#value
    return base ? `${base} ` : ''
  }

  #effectiveShowCompletions(): boolean {
    return this.#showSuggestions && this.#suggestions.length > 0 && !this.#suppressed
  }

  #span(className: string, text = ''): HTMLSpanElement { return element('span', className, text) }

  #button(className: string, label: string, glyph: string, onMouseDown: (event: MouseEvent) => void): HTMLButtonElement {
    const button = element('button', className)
    button.type = 'button'
    button.setAttribute('aria-label', label)
    button.title = label
    button.addEventListener('mousedown', onMouseDown)
    button.appendChild(this.#span('mat-sym', glyph))
    return button
  }

  #renderPrompt(): HTMLSpanElement {
    const prompt = this.#span('prompt-glyph')
    prompt.classList.toggle('armed', !!this.#armedResource)
    prompt.classList.toggle('subject', !this.#armedResource && !!this.#subject)
    if (this.#armedResource) prompt.setAttribute('aria-label', this.#t('command-shell.armed-resource'))
    else if (this.#subject) {
      prompt.setAttribute('aria-label', this.#t('command-shell.subject', { name: this.#subject.label }))
      prompt.title = this.#subject.label
    }
    prompt.addEventListener('mousedown', this.#onPromptMouseDown)

    if (this.#armedResource) {
      if (this.#armedResource.previewUrl) {
        const image = element('img', 'prompt-thumb')
        image.src = this.#armedResource.previewUrl
        image.alt = ''
        image.draggable = false
        prompt.appendChild(image)
      } else {
        prompt.appendChild(this.#span('prompt-thumb prompt-thumb-fallback', this.#armedBadge() || '>'))
      }
      const badge = this.#armedBadge()
      if (this.#armedResource.previewUrl && badge) prompt.appendChild(this.#span('prompt-badge', badge))
    } else if (this.#subject) {
      if (this.#subject.previewUrl) {
        const image = element('img', 'prompt-thumb')
        image.src = this.#subject.previewUrl
        image.alt = ''
        image.draggable = false
        prompt.appendChild(image)
      } else if (this.#subject.icon) {
        const icon = this.#span('prompt-thumb prompt-thumb-fallback mat-sym', this.#subject.icon)
        icon.setAttribute('aria-hidden', 'true')
        prompt.appendChild(icon)
      } else {
        const monogram = this.#span('prompt-thumb prompt-thumb-fallback', this.#subjectMonogram())
        monogram.setAttribute('aria-hidden', 'true')
        prompt.appendChild(monogram)
      }
    } else if (this.#promptSigil === 'slash') {
      prompt.appendChild(this.#span('prompt-slash', '/'))
    } else if (this.#promptSigil === 'question') {
      prompt.appendChild(this.#span('prompt-question', '?'))
    } else {
      prompt.appendChild(this.#span('prompt-chevron mat-sym', 'chevron_right'))
    }
    prompt.firstElementChild?.setAttribute('aria-hidden', 'true')
    return prompt
  }

  #renderInputWrap(): HTMLDivElement {
    const wrap = element('div', 'input-wrap')
    const ghost = this.#span('ghost')
    ghost.setAttribute('aria-hidden', 'true')
    ghost.append(this.#span('ghost-pad', this.#value), this.#span('ghost-suffix', this.#ghostSuffix()))
    wrap.appendChild(ghost)

    if (this.#readingMarks) {
      const reading = this.#span('reading')
      reading.setAttribute('aria-hidden', 'true')
      const track = this.#span('reading-track')
      track.style.transform = `translateX(${-this.#inputScrollLeft}px)`
      for (const mark of this.#readingMarks) {
        const segment = this.#span(`seg-${mark.role}`, mark.text)
        if (mark.role === 'action' && mark.color) segment.style.color = mark.color
        track.appendChild(segment)
      }
      reading.appendChild(track)
      wrap.appendChild(reading)
    }

    const input = element('input', 'command-input')
    input.classList.toggle('input-marked', !!this.#readingMarks?.length)
    input.type = 'text'
    input.name = 'command-input'
    input.autocomplete = 'off'
    input.autocapitalize = 'off'
    input.spellcheck = false
    input.placeholder = this.#effectivePlaceholder()
    input.value = this.#value
    input.addEventListener('keydown', this.#onKeyDown)
    input.addEventListener('input', this.#onInput)
    input.addEventListener('focus', this.#onInputFocus)
    input.addEventListener('blur', this.#onInputBlur)
    input.addEventListener('scroll', this.#onInputScroll)
    wrap.appendChild(input)

    if (this.#hoverEcho) {
      const echo = this.#span('hover-echo')
      echo.setAttribute('aria-hidden', 'true')
      echo.append(this.#span('echo-pad', this.#echoPad()), this.#span('echo-name', `(${this.#hoverEcho})`))
      wrap.appendChild(echo)
    }
    return wrap
  }

  #renderIndicators(): HTMLDivElement | null {
    if (!this.#indicators.length) return null
    const group = element('div', 'indicators')
    for (const indicator of this.#indicators) {
      if (indicator.actionable) {
        const button = this.#button('indicator-pill action', indicator.label, indicator.icon, event => {
          event.preventDefault()
          this.#emit('indicatorActivate', indicator.key)
        })
        button.firstElementChild?.classList.add('indicator-icon')
        group.appendChild(button)
      } else if (indicator.dismissable !== false) {
        const button = this.#button('indicator-pill', indicator.label, indicator.icon, event => {
          event.preventDefault()
          this.#emit('indicatorDismiss', indicator.key)
        })
        button.firstElementChild?.classList.add('indicator-icon')
        button.appendChild(this.#span('indicator-x', '×'))
        group.appendChild(button)
      } else {
        const info = this.#span('indicator-pill info')
        info.title = indicator.label
        info.appendChild(this.#span('indicator-icon mat-sym', indicator.icon))
        group.appendChild(info)
      }
    }
    return group
  }

  #renderActions(): HTMLDivElement {
    const actions = element('div', 'shell-actions')
    if (this.#viewToggles.length) {
      const behaviours = element('div', 'action-group behaviours')
      for (const toggle of this.#viewToggles) {
        const suffix = toggle.isDefault ? ` — ${this.#t('features.default.on')}` : ''
        const button = this.#button('rail-btn view-toggle-btn', `${toggle.label}${suffix}`, toggle.icon, event => this.#onViewToggleDown(event, toggle.view))
        button.classList.toggle('on', toggle.active)
        button.classList.toggle('is-default', !!toggle.isDefault)
        setBooleanAttribute(button, 'aria-pressed', toggle.active)
        button.addEventListener('mouseup', () => this.#onViewToggleUp(toggle.view))
        button.addEventListener('mouseleave', this.#onViewToggleCancel)
        behaviours.appendChild(button)
      }
      actions.append(behaviours, this.#span('rail-divider'))
    }

    const tools = element('div', 'action-group tools')
    if (this.#showOpenForSubscribersToggle) {
      const button = element('button', 'rail-btn open-for-subscribers-btn')
      button.type = 'button'
      button.classList.toggle('on', this.#openForSubscribers)
      button.setAttribute('aria-label', this.#openForSubscribersLabel)
      button.title = this.#openForSubscribersLabel
      setBooleanAttribute(button, 'aria-pressed', this.#openForSubscribers)
      button.addEventListener('mousedown', event => { event.preventDefault(); this.#emit('openForSubscribersToggle') })
      button.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="2"></circle><path d="M16.24 7.76a6 6 0 0 1 0 8.49M7.76 16.24a6 6 0 0 1 0-8.49"></path><path d="M19.07 4.93a10 10 0 0 1 0 14.14M4.93 19.07a10 10 0 0 1 0-14.14"></path></svg>'
      tools.appendChild(button)
    }
    tools.append(
      this.#railToggle('features-toggle-btn', this.#featuresPanelOpen, this.#featuresLabel, 'extension', 'featuresToggle'),
      this.#railToggle('chat-toggle-btn', this.#chatPanelOpen, this.#chatLabel, 'chat', 'chatToggle'),
      this.#railToggle('notes-toggle-btn', this.#notesPanelOpen, this.#notesLabel, 'sticky_note_2', 'notesToggle'),
      this.#railToggle('pheromone-toggle-btn', this.#pheromonePanelOpen, this.#pheromonesLabel, this.#pheromoneScopeIcon, 'pheromonesToggle'),
    )
    if (this.#showMic) {
      const mic = element('button', 'rail-btn mic-rail-btn')
      mic.type = 'button'
      mic.setAttribute('aria-label', this.#micLabel)
      mic.title = this.#micLabel
      mic.appendChild(this.#span('mat-sym', 'mic'))
      mic.classList.toggle('on', this.#micActive)
      setBooleanAttribute(mic, 'aria-pressed', this.#micActive)
      mic.addEventListener('pointerdown', this.#onMicDown)
      for (const name of ['pointerup', 'pointercancel', 'pointerleave'] as const) {
        mic.addEventListener(name, () => this.#emit('micRelease'))
      }
      tools.appendChild(mic)
    }
    actions.appendChild(tools)
    return actions
  }

  #railToggle(className: string, active: boolean, label: string, glyph: string, eventName: string): HTMLButtonElement {
    const renderedLabel = className === 'features-toggle-btn' && active ? `${label} — open` : label
    const button = this.#button(`rail-btn ${className}`, renderedLabel, glyph, event => {
      event.preventDefault()
      this.#emit(eventName)
    })
    button.classList.toggle('on', active)
    setBooleanAttribute(button, 'aria-pressed', active)
    return button
  }

  #renderIntel(): HTMLDivElement | null {
    if (!this.#effectiveShowCompletions()) return null
    const intel = element('div', 'command-intel')
    intel.classList.toggle('has-detail', !!this.#activeDetail)
    const list = element('ul', 'command-results')
    list.classList.toggle('wide-swatches', this.#wideSwatches)
    list.setAttribute('role', 'listbox')
    this.#suggestions.forEach((suggestion, index) => {
      const row = element('li')
      row.setAttribute('role', 'option')
      row.classList.toggle('active', index === this.#activeIndex)
      row.dataset['index'] = String(index)
      row.addEventListener('mousedown', event => this.#onSuggestionMouseDown(event, suggestion, index))
      const color = this.#colorMap.get(suggestion)
      if (color) {
        const dot = this.#span('color-dot')
        dot.style.background = color
        row.appendChild(dot)
      }
      const split = Math.min(this.#typedPrefix.length, suggestion.length)
      row.append(this.#span('typed', this.#typedPrefix ? suggestion.slice(0, split) : ''), this.#span('rest', this.#typedPrefix ? suggestion.slice(split) : suggestion))
      const description = this.#descriptionMap.get(suggestion)
      if (description) row.appendChild(this.#span('slash-desc', description))
      list.appendChild(row)
    })
    intel.appendChild(list)

    if (this.#activeDetail) {
      const detail = element('aside', 'command-detail')
      detail.setAttribute('aria-live', 'polite')
      const head = element('div', 'detail-head')
      if (this.#activeDetail.icon) head.appendChild(this.#span('detail-icon mat-sym', this.#activeDetail.icon))
      head.appendChild(this.#span('detail-name', this.#activeDetail.name))
      if (this.#activeDetail.kind) head.appendChild(this.#span('detail-kind', this.#activeDetail.kind))
      detail.appendChild(head)
      if (this.#activeDetail.description) detail.appendChild(element('p', 'detail-desc', this.#activeDetail.description))
      if (this.#activeDetail.count != null) {
        const meta = element('div', 'detail-meta')
        meta.append(this.#span('detail-count', String(this.#activeDetail.count)), document.createTextNode(` ${this.#t('command-shell.detail-shared')}`))
        detail.appendChild(meta)
      }
      if (this.#activeDetail.options?.length) {
        const options = element('div', 'detail-options')
        options.appendChild(element('div', 'detail-options-label', this.#t('command-shell.detail-options')))
        const items = element('ul')
        for (const option of this.#activeDetail.options) items.appendChild(element('li', '', option))
        options.appendChild(items)
        detail.appendChild(options)
      }
      intel.appendChild(detail)
    }
    return intel
  }

  #render(): void {
    if (!this.#connected) return
    const oldInput = this.inputElement
    const focused = oldInput === document.activeElement
    const selectionStart = oldInput?.selectionStart ?? this.#value.length
    const selectionEnd = oldInput?.selectionEnd ?? selectionStart
    const scrollLeft = oldInput?.scrollLeft ?? this.#inputScrollLeft

    const bar = element('div', 'command-bar')
    const shell = element('div', 'command-shell')
    shell.classList.toggle('stance-command', this.#promptSigil === 'slash')
    shell.classList.toggle('stance-find', this.#promptSigil === 'question')
    shell.addEventListener('mousedown', this.#onShellMouseDown)
    const row = element('div', 'command-row')
    row.append(this.#renderPrompt(), this.#renderInputWrap())
    if (this.#lockedFlash) {
      const locked = this.#span('locked-flash mat-sym', 'push_pin')
      locked.setAttribute('role', 'status')
      locked.setAttribute('aria-label', this.#lockedLabel)
      locked.title = this.#lockedLabel
      row.appendChild(locked)
    }
    const indicators = this.#renderIndicators()
    if (indicators) row.appendChild(indicators)
    shell.appendChild(row)
    bar.append(shell, this.#renderActions())
    const intel = this.#renderIntel()
    if (intel) bar.appendChild(intel)
    this.replaceChildren(bar)

    const input = this.inputElement
    if (input) {
      input.scrollLeft = scrollLeft
      this.#inputScrollLeft = input.scrollLeft
      if (focused) {
        input.focus({ preventScroll: true })
        const max = input.value.length
        input.setSelectionRange(Math.min(selectionStart, max), Math.min(selectionEnd, max))
      }
    }
    if (intel) queueMicrotask(() => this.#positionIntel())
  }

  readonly #onInput = (): void => {
    const input = this.inputElement
    if (!input) return
    if (input.value !== input.value.trimStart()) input.value = input.value.trimStart()
    const wasSuppressed = this.#suppressed
    this.#suppressed = false
    this.#value = input.value
    this.#inputScrollLeft = input.scrollLeft
    this.#clampActiveIndex()
    if (wasSuppressed) this.#scheduleRender()
    else this.#syncInputDecorations()
    this.#emit('valueChange', this.#value)
    this.#emitState()
  }

  readonly #onInputScroll = (): void => {
    this.#inputScrollLeft = this.inputElement?.scrollLeft ?? 0
    this.#syncInputDecorations()
  }

  readonly #onInputFocus = (): void => this.#emit('caretPresence', true)
  readonly #onInputBlur = (): void => this.#emit('caretPresence', false)

  readonly #onShellMouseDown = (event: MouseEvent): void => {
    if (event.target === this.inputElement) return
    event.preventDefault()
    this.inputElement?.focus()
  }

  readonly #onPromptMouseDown = (event: MouseEvent): void => {
    event.preventDefault()
    if (this.#armedResource) this.#emit('armedResourceDismiss')
    else if (this.#subject) this.#emit('subjectDismiss')
    else this.#emit('promptSigilToggle')
  }

  #onSuggestionMouseDown(event: MouseEvent, suggestion: string, index: number): void {
    event.preventDefault()
    this.#activeIndex = index
    this.#syncActiveOption()
    this.#emitState()
    this.#emit('completionAccepted', suggestion)
  }

  readonly #onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Tab') { this.#handleTab(event); return }
    if (event.key === 'ArrowRight' && this.#handleArrowRightAccept(event)) return
    if ((event.key === 'ArrowUp' || event.key === 'ArrowDown') && this.#value === '') {
      this.#emit('shellKeydown', event)
      return
    }
    if (this.#handleCompletionKeys(event)) return
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      this.#emit('commit', this.#value)
      return
    }
    this.#emit('shellKeydown', event)
  }

  #handleTab(event: KeyboardEvent): void {
    if (event.shiftKey) {
      if (!this.#suggestions.length || this.#suppressed) return
      event.preventDefault()
      this.#activeIndex = Math.max(this.#activeIndex - 1, 0)
      this.#syncActiveOption()
      this.#emitState()
      return
    }
    event.preventDefault()
    if (this.#suppressed) {
      this.#suppressed = false
      this.#scheduleRender()
      this.#emitState()
      return
    }
    this.#emit('completionAcceptRequested', this.#activeIndex)
  }

  #handleCompletionKeys(event: KeyboardEvent): boolean {
    if (!this.#suggestions.length || this.#suppressed) return false
    if (event.key === 'Escape') {
      this.#suppressed = true
      this.#scheduleRender()
      this.#emitState()
      this.#emit('shellKeydown', event)
      return true
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      this.#activeIndex = Math.min(this.#activeIndex + 1, this.#suggestions.length - 1)
      this.#syncActiveOption()
      this.#emitState()
      return true
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      this.#activeIndex = Math.max(this.#activeIndex - 1, 0)
      this.#syncActiveOption()
      this.#emitState()
      return true
    }
    return false
  }

  #handleArrowRightAccept(event: KeyboardEvent): boolean {
    if (event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return false
    if (this.#suppressed || !this.#caretAtEnd()) return false
    event.preventDefault()
    this.#emit('completionAcceptRequested', this.#activeIndex)
    return true
  }

  #caretAtEnd(): boolean {
    const input = this.inputElement
    if (!input) return false
    const end = input.value.length
    return input.selectionStart === end && input.selectionEnd === end
  }

  #syncInputDecorations(): void {
    const input = this.inputElement
    if (input) input.placeholder = this.#effectivePlaceholder()
    const pad = this.querySelector<HTMLElement>('.ghost-pad')
    const suffix = this.querySelector<HTMLElement>('.ghost-suffix')
    if (pad) pad.textContent = this.#value
    if (suffix) suffix.textContent = this.#ghostSuffix()
    const echoPad = this.querySelector<HTMLElement>('.echo-pad')
    if (echoPad) echoPad.textContent = this.#echoPad()
    const reading = this.querySelector<HTMLElement>('.reading-track')
    if (reading) reading.style.transform = `translateX(${-this.#inputScrollLeft}px)`
    if (this.#effectiveShowCompletions()) queueMicrotask(() => this.#positionIntel())
  }

  #syncActiveOption(): void {
    for (const row of this.querySelectorAll<HTMLElement>('.command-results li')) {
      row.classList.toggle('active', Number(row.dataset['index']) === this.#activeIndex)
    }
    const active = this.querySelector<HTMLElement>('.command-results li.active')
    active?.scrollIntoView?.({ block: 'nearest' })
  }

  #clampActiveIndex(): void {
    this.#activeIndex = Math.max(0, Math.min(this.#activeIndex, this.#suggestions.length - 1))
  }

  readonly #onMicDown = (event: PointerEvent): void => {
    event.preventDefault()
    ;(event.currentTarget as HTMLElement | null)?.setPointerCapture?.(event.pointerId)
    this.#emit('micPress')
  }

  #onViewToggleDown(event: MouseEvent, view: string): void {
    event.preventDefault()
    this.#viewToggleDisabled = false
    if (event.metaKey || event.ctrlKey) {
      this.#viewToggleDisabled = true
      this.#emit('viewDefault', { view })
      return
    }
    this.#viewTogglePressTimer = setTimeout(() => {
      this.#viewToggleDisabled = true
      this.#viewTogglePressTimer = null
      this.#emit('viewToggle', { view, disable: true })
    }, VIEW_TOGGLE_LONG_PRESS_MS)
  }

  #onViewToggleUp(view: string): void {
    this.#clearViewTogglePress()
    if (this.#viewToggleDisabled) { this.#viewToggleDisabled = false; return }
    this.#emit('viewToggle', { view, disable: false })
  }

  readonly #onViewToggleCancel = (): void => {
    this.#clearViewTogglePress()
    this.#viewToggleDisabled = false
  }

  #clearViewTogglePress(): void {
    if (!this.#viewTogglePressTimer) return
    clearTimeout(this.#viewTogglePressTimer)
    this.#viewTogglePressTimer = null
  }

  #subjectMonogram(): string {
    const words = this.#subject?.label.trim().split(/\s+/).filter(Boolean) ?? []
    if (!words.length) return '·'
    if (words.length === 1) return [...words[0]].slice(0, 2).join('').toUpperCase()
    return `${[...words[0]][0]}${[...words[1]][0]}`.toUpperCase()
  }

  #armedBadge(): string {
    if (this.#armedResource?.type === 'youtube') return '▶'
    if (this.#armedResource?.type === 'link') return '↗'
    if (this.#armedResource?.type === 'document') return '📄'
    return ''
  }

  #positionIntel(): void {
    const bar = this.querySelector<HTMLElement>('.command-bar')
    const rect = (bar ?? this).getBoundingClientRect()
    if (rect.width === 0 && rect.height === 0) return
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight
    const isPhone = viewportWidth <= 599
    let left = isPhone ? rect.left : (this.#caretScreenX() ?? rect.left)
    left = Math.max(8, Math.min(left, viewportWidth - 224))
    this.style.setProperty('--intel-left', `${Math.round(left)}px`)
    this.style.setProperty('--intel-width', `${Math.round(rect.width)}px`)
    this.style.setProperty('--intel-maxw', `${Math.round(viewportWidth - left - 8)}px`)
    if (rect.top > viewportHeight / 2) {
      this.style.setProperty('--intel-top', 'auto')
      this.style.setProperty('--intel-bottom', `${Math.round(viewportHeight - rect.top + 10)}px`)
    } else {
      this.style.setProperty('--intel-bottom', 'auto')
      this.style.setProperty('--intel-top', `${Math.round(rect.bottom + 2)}px`)
    }
  }

  #caretScreenX(): number | null {
    const input = this.inputElement
    if (!input) return null
    const rect = input.getBoundingClientRect()
    const computed = getComputedStyle(input)
    const mirror = document.createElement('span')
    Object.assign(mirror.style, {
      position: 'absolute', visibility: 'hidden', whiteSpace: 'pre',
      fontFamily: computed.fontFamily, fontSize: computed.fontSize,
      fontWeight: computed.fontWeight, fontStyle: computed.fontStyle,
      letterSpacing: computed.letterSpacing,
    })
    const caret = input.selectionStart ?? input.value.length
    mirror.textContent = input.value.slice(0, caret)
    document.body.appendChild(mirror)
    const textWidth = mirror.getBoundingClientRect().width
    mirror.remove()
    return rect.left + (parseFloat(computed.paddingLeft) || 0) + textWidth - input.scrollLeft
  }
}

if (typeof customElements !== 'undefined' && !customElements.get(ELEMENT_NAME)) {
  customElements.define(ELEMENT_NAME, CommandShellElement)
}

declare global {
  interface HTMLElementTagNameMap {
    'hc-command-shell': CommandShellElement
  }
}
