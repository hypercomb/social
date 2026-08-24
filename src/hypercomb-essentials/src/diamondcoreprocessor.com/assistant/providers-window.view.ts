// diamondcoreprocessor.com/assistant/providers-window.view.ts
//
// THE PROVIDERS CONSOLE — one list, one form.
//
// Opened by `/providers` (or the `providers:open` effect). Every AI provider
// the registry knows — built-in vendors, discovered specs, local models —
// appears as one row in one list, and clicking a row opens the SAME panel
// for all of them: key field (when one is needed), endpoint (shown before a
// key ever travels to it), docs link, model roster, a test button, and the
// active switch the orchestrator honours. No vendor has a bespoke screen; if
// a spec ever needs a field this form lacks, the FORM grows the field, for
// everyone at once.
//
// Everything here is a pure read of four live sources — the provider
// registry (rows), the key store (lights), the activation store (switches),
// and localStorage's local-host override — plus one write path each. The
// window re-renders on any of their `change` events, so a provider
// discovered mid-session simply appears.
//
// A panel, not a takeover — cold chrome, DOM singleton, no Angular; the same
// shape as skills-window.view.

import { EffectBus, I18N_IOC_KEY, llmKeyStore, type I18nProvider } from '@hypercomb/core'
import { llmActivation } from './llm-activation.js'
import { callModel } from './llm-dispatch.js'
import { llmProviderRegistry } from './llm-provider-registry.js'
import './providers/builtin-providers.js'
import { importProviderSpec } from './providers/provider-discovery.js'
import type { LlmProviderDescriptor } from './providers/llm-provider.types.js'
import { LOCAL_HOST_STORAGE_KEY, localLlmHost } from './providers/local.provider.js'
import { modelPalette } from '../presentation/avatars/agent-model.js'

const STYLE_ID = 'hc-providers-styles'
const STEEL = '126, 182, 214'
const WIDTH_KEY = 'hc:providers-window-width'
const MIN_WIDTH = 340

const ioc = <T,>(key: string): T | undefined =>
  (window as unknown as { ioc?: { get?: (k: string) => unknown } }).ioc?.get?.(key) as T | undefined

/** Transport, said the way a participant would ask about it. */
const TRANSPORT_LABEL: Record<string, string> = {
  'browser-http': 'your key, this browser',
  'host-relay': 'a host you named',
  'agent-bridge': 'a live agent session',
}

export class ProvidersWindowView extends EventTarget {
  #panel: HTMLDivElement | null = null
  #body: HTMLDivElement | null = null
  #search = ''
  #openId: string | null = null
  #addOpen = false
  /** providerId → transient test/status line ('…' = running). */
  #status = new Map<string, string>()
  #resizeCleanup: (() => void) | null = null
  #unlisten: (() => void) | null = null

  #onKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && this.#panel) { event.stopPropagation(); this.close() }
  }

  constructor() {
    super()
    EffectBus.on('providers:open', () => { this.toggle() })
  }

  #t(key: string, fallback: string): string {
    const value = ioc<I18nProvider>(I18N_IOC_KEY)?.t?.(key)
    return value && value !== key ? value : fallback
  }

  toggle(): void {
    if (this.#panel) { this.close(); return }
    this.open()
  }

  open(): void {
    if (this.#panel) return
    this.#ensureStyles()

    const panel = document.createElement('div')
    panel.className = 'hc-providers'
    const savedWidth = Number.parseFloat(localStorage.getItem(WIDTH_KEY) ?? '')
    if (Number.isFinite(savedWidth)) panel.style.width = `${Math.max(MIN_WIDTH, savedWidth)}px`

    const resize = document.createElement('div')
    resize.className = 'hc-providers-resize'
    resize.setAttribute('aria-hidden', 'true')
    let dragging = false
    const onMove = (event: PointerEvent): void => {
      if (!dragging) return
      const width = Math.max(MIN_WIDTH, window.innerWidth - event.clientX - 8)
      panel.style.width = `${width}px`
    }
    const onUp = (): void => {
      if (!dragging) return
      dragging = false
      localStorage.setItem(WIDTH_KEY, String(panel.getBoundingClientRect().width))
    }
    resize.addEventListener('pointerdown', event => {
      dragging = true
      resize.setPointerCapture(event.pointerId)
    })
    resize.addEventListener('pointermove', onMove)
    resize.addEventListener('pointerup', onUp)
    this.#resizeCleanup = () => { dragging = false }
    panel.appendChild(resize)

    const header = document.createElement('div')
    header.className = 'hc-providers-head'
    const title = document.createElement('span')
    title.className = 'hc-providers-title'
    title.textContent = this.#t('providers.title', 'AI providers')
    const close = document.createElement('button')
    close.className = 'hc-providers-close'
    close.textContent = '×'
    close.setAttribute('aria-label', 'close')
    close.addEventListener('click', () => this.close())
    header.append(title, close)
    panel.appendChild(header)

    const search = document.createElement('input')
    search.className = 'hc-providers-search'
    search.placeholder = this.#t('providers.search', 'Search providers and models')
    search.value = this.#search
    search.addEventListener('input', () => { this.#search = search.value; this.#renderBody() })
    panel.appendChild(search)

    const body = document.createElement('div')
    body.className = 'hc-providers-body'
    panel.appendChild(body)
    this.#body = body

    document.body.appendChild(panel)
    this.#panel = panel
    window.addEventListener('keydown', this.#onKey, true)

    const rerender = (): void => this.#renderBody()
    const registry = llmProviderRegistry()
    registry.addEventListener('change', rerender)
    llmKeyStore.addEventListener('change', rerender)
    llmActivation.addEventListener('change', rerender)
    this.#unlisten = () => {
      registry.removeEventListener('change', rerender)
      llmKeyStore.removeEventListener('change', rerender)
      llmActivation.removeEventListener('change', rerender)
    }

    this.#renderBody()
    search.focus()
  }

  close(): void {
    this.#unlisten?.()
    this.#unlisten = null
    this.#resizeCleanup?.()
    this.#resizeCleanup = null
    window.removeEventListener('keydown', this.#onKey, true)
    this.#panel?.remove()
    this.#panel = null
    this.#body = null
  }

  // ── rows ────────────────────────────────────────────────────────────────

  #matches(provider: LlmProviderDescriptor): boolean {
    const needle = this.#search.trim().toLowerCase()
    if (!needle) return true
    return provider.id.includes(needle)
      || provider.label.toLowerCase().includes(needle)
      || provider.vendor.includes(needle)
      || provider.models.some(m => m.id.toLowerCase().includes(needle) || m.name.toLowerCase().includes(needle))
  }

  #renderBody(): void {
    const body = this.#body
    if (!body) return
    body.textContent = ''

    const providers = llmProviderRegistry().all().filter(p => this.#matches(p))
    for (const provider of providers) body.appendChild(this.#row(provider))

    if (!providers.length) {
      const empty = document.createElement('div')
      empty.className = 'hc-providers-empty'
      empty.textContent = this.#t('providers.empty', 'Nothing matches')
      body.appendChild(empty)
    }

    body.appendChild(this.#addSection())
  }

  #row(provider: LlmProviderDescriptor): HTMLElement {
    const needsKey = provider.requiresKey !== false
    const hasKey = llmKeyStore.has(provider.id)
    const enabled = llmActivation.isEnabled(provider.id)
    const usable = enabled && (!needsKey || hasKey)

    const row = document.createElement('div')
    row.className = 'hc-provider'

    const head = document.createElement('button')
    head.className = 'hc-provider-head'
    head.addEventListener('click', () => {
      this.#openId = this.#openId === provider.id ? null : provider.id
      this.#renderBody()
    })

    const dot = document.createElement('span')
    dot.className = 'hc-provider-dot'
    dot.style.background = modelPalette(provider.defaultModel).body
    if (usable) dot.classList.add('is-active')

    const name = document.createElement('span')
    name.className = 'hc-provider-name'
    name.textContent = provider.label

    const state = document.createElement('span')
    state.className = 'hc-provider-state'
    state.textContent = !enabled
      ? this.#t('providers.off', 'off')
      : usable
        ? this.#t('providers.active', 'active')
        : this.#t('providers.noKey', 'no key')
    state.classList.toggle('is-dim', !usable)

    head.append(dot, name, this.#badge(TRANSPORT_LABEL[provider.transport] ?? provider.transport), state)
    if (provider.readsHive) {
      head.insertBefore(this.#badge(this.#t('providers.readsHive', 'reads the hive'), 'hive'), state)
    }
    row.appendChild(head)

    if (this.#openId === provider.id) row.appendChild(this.#detail(provider))
    return row
  }

  #badge(text: string, kind = ''): HTMLElement {
    const badge = document.createElement('span')
    badge.className = `hc-provider-badge${kind ? ` is-${kind}` : ''}`
    badge.textContent = text
    return badge
  }

  // ── the universal panel ───────────────────────────────────────────────────

  #detail(provider: LlmProviderDescriptor): HTMLElement {
    const detail = document.createElement('div')
    detail.className = 'hc-provider-detail'
    const needsKey = provider.requiresKey !== false

    // endpoint — always shown BEFORE a key is entered: this is where it goes.
    const endpoint = document.createElement('div')
    endpoint.className = 'hc-provider-endpoint'
    if (provider.id === 'local') {
      const host = document.createElement('input')
      host.className = 'hc-provider-input'
      host.value = localLlmHost()
      host.addEventListener('change', () => {
        try { localStorage.setItem(LOCAL_HOST_STORAGE_KEY, host.value.trim()) } catch { /* session-only */ }
      })
      endpoint.append(this.#label(this.#t('providers.endpoint', 'Endpoint')), host)
    } else if (provider.endpoint) {
      endpoint.append(this.#label(this.#t('providers.endpoint', 'Endpoint')), this.#mono(provider.endpoint))
    }
    if (endpoint.childNodes.length) detail.appendChild(endpoint)

    // key — the one write into the key store.
    if (needsKey) {
      const keyRow = document.createElement('div')
      keyRow.className = 'hc-provider-keyrow'
      const key = document.createElement('input')
      key.className = 'hc-provider-input'
      key.type = 'password'
      key.autocomplete = 'off'
      key.placeholder = llmKeyStore.has(provider.id)
        ? this.#t('providers.keySet', 'Key saved — paste to replace')
        : this.#t('providers.keyPlaceholder', 'Paste API key')
      const save = document.createElement('button')
      save.className = 'hc-provider-btn'
      save.textContent = this.#t('providers.save', 'Save')
      save.addEventListener('click', () => {
        const value = key.value.trim()
        if (!value) return
        if (provider.keyPattern && !provider.keyPattern.test(value)) {
          this.#note(provider.id, this.#t('providers.keyLooksOff', 'That key does not look like this provider’s format — saved anyway.'))
        }
        llmKeyStore.set(provider.id, value)
      })
      const clear = document.createElement('button')
      clear.className = 'hc-provider-btn is-quiet'
      clear.textContent = this.#t('providers.clear', 'Clear')
      clear.addEventListener('click', () => llmKeyStore.clear(provider.id))
      keyRow.append(key, save, clear)

      const docs = document.createElement('a')
      docs.className = 'hc-provider-docs'
      docs.href = provider.docsUrl
      docs.target = '_blank'
      docs.rel = 'noopener noreferrer'
      docs.textContent = this.#t('providers.docs', 'Get a key')
      detail.append(this.#label(this.#t('providers.key', 'API key')), keyRow, docs)
    }

    // models — read-only roster, tiers spelled out.
    const models = document.createElement('div')
    models.className = 'hc-provider-models'
    for (const model of provider.models) {
      const chip = document.createElement('span')
      chip.className = `hc-provider-model is-${model.tier}`
      chip.textContent = model.name
      chip.title = model.id
      models.appendChild(chip)
    }
    detail.append(this.#label(this.#t('providers.models', 'Models')), models)

    // active switch + test — the two verbs.
    const actions = document.createElement('div')
    actions.className = 'hc-provider-actions'

    const toggle = document.createElement('label')
    toggle.className = 'hc-provider-toggle'
    const checkbox = document.createElement('input')
    checkbox.type = 'checkbox'
    checkbox.checked = llmActivation.isEnabled(provider.id)
    checkbox.addEventListener('change', () => llmActivation.setEnabled(provider.id, checkbox.checked))
    toggle.append(checkbox, document.createTextNode(this.#t('providers.enabled', 'Available to the orchestrator')))

    const test = document.createElement('button')
    test.className = 'hc-provider-btn'
    test.textContent = this.#t('providers.test', 'Test')
    test.addEventListener('click', () => { void this.#test(provider) })

    actions.append(toggle, test)
    detail.appendChild(actions)

    const status = this.#status.get(provider.id)
    if (status) {
      const line = document.createElement('div')
      line.className = 'hc-provider-status'
      line.textContent = status
      detail.appendChild(line)
    }
    return detail
  }

  #label(text: string): HTMLElement {
    const label = document.createElement('div')
    label.className = 'hc-provider-label'
    label.textContent = text
    return label
  }

  #mono(text: string): HTMLElement {
    const mono = document.createElement('code')
    mono.className = 'hc-provider-mono'
    mono.textContent = text
    return mono
  }

  #note(providerId: string, text: string): void {
    this.#status.set(providerId, text)
    this.#renderBody()
  }

  /** One tiny real call — the only honest key test there is. */
  async #test(provider: LlmProviderDescriptor): Promise<void> {
    this.#note(provider.id, this.#t('providers.testing', 'Testing…'))
    try {
      const result = await callModel({
        providerId: provider.id,
        maxTokens: 16,
        messages: [{ role: 'user', content: 'Reply with the single word OK.' }],
      })
      this.#note(provider.id, `✓ ${result.model}`)
    } catch (err) {
      this.#note(provider.id, `✗ ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // ── add a provider (paste a spec) ─────────────────────────────────────────

  #addSection(): HTMLElement {
    const section = document.createElement('div')
    section.className = 'hc-providers-add'

    const toggle = document.createElement('button')
    toggle.className = 'hc-provider-btn is-quiet'
    toggle.textContent = this.#addOpen
      ? this.#t('providers.addClose', 'Close')
      : this.#t('providers.add', '+ Add provider')
    toggle.addEventListener('click', () => { this.#addOpen = !this.#addOpen; this.#renderBody() })
    section.appendChild(toggle)
    if (!this.#addOpen) return section

    const hint = document.createElement('div')
    hint.className = 'hc-provider-label'
    hint.textContent = this.#t('providers.addHint', 'Paste a provider spec (llm-provider@1 JSON)')
    const input = document.createElement('textarea')
    input.className = 'hc-providers-spec'
    input.rows = 8
    input.spellcheck = false
    const submit = document.createElement('button')
    submit.className = 'hc-provider-btn'
    submit.textContent = this.#t('providers.import', 'Import')
    const status = document.createElement('div')
    status.className = 'hc-provider-status'
    submit.addEventListener('click', () => {
      void importProviderSpec(input.value)
        .then(spec => {
          this.#addOpen = false
          this.#openId = spec.id
          this.#renderBody()
        })
        .catch(err => { status.textContent = `✗ ${err instanceof Error ? err.message : String(err)}` })
    })
    section.append(hint, input, submit, status)
    return section
  }

  // ── chrome ────────────────────────────────────────────────────────────────

  #ensureStyles(): void {
    if (document.getElementById(STYLE_ID)) return
    const style = document.createElement('style')
    style.id = STYLE_ID
    style.textContent = `
      .hc-providers {
        position: fixed; top: 56px; right: 8px; bottom: 8px; width: 420px;
        display: flex; flex-direction: column; z-index: 99999;
        background: rgba(16, 22, 26, 0.96); border: 1px solid rgba(${STEEL}, 0.35);
        border-radius: var(--hc-radius-floating, 4px); color: rgba(${STEEL}, 0.95);
        font: 13px/1.45 system-ui, sans-serif; overflow: hidden;
      }
      .hc-providers-resize { position: absolute; left: -4px; top: 0; bottom: 0; width: 8px; cursor: ew-resize; }
      .hc-providers-head { display: flex; align-items: center; padding: 10px 12px 6px; }
      .hc-providers-title { flex: 1; font-weight: 600; letter-spacing: 0.04em; }
      .hc-providers-close {
        background: none; border: none; color: inherit; font-size: 18px;
        cursor: pointer; opacity: 0.7; padding: 0 4px;
      }
      .hc-providers-close:hover { opacity: 1; }
      .hc-providers-search {
        margin: 4px 12px 8px; padding: 6px 8px; background: rgba(${STEEL}, 0.08);
        border: 1px solid rgba(${STEEL}, 0.25); border-radius: var(--hc-radius-control, 2px); color: inherit; outline: none;
      }
      .hc-providers-body { flex: 1; overflow-y: auto; padding: 0 12px 12px; }
      .hc-providers-empty { opacity: 0.6; padding: 12px 2px; }
      .hc-provider { border-bottom: 1px solid rgba(${STEEL}, 0.12); }
      .hc-provider-head {
        display: flex; align-items: center; gap: 8px; width: 100%;
        background: none; border: none; color: inherit; font: inherit;
        text-align: left; padding: 9px 2px; cursor: pointer;
      }
      .hc-provider-head:hover { background: rgba(${STEEL}, 0.05); }
      .hc-provider-dot {
        width: 10px; height: 10px; border-radius: 50%; flex: none; opacity: 0.45;
      }
      .hc-provider-dot.is-active { opacity: 1; box-shadow: 0 0 6px currentColor; }
      .hc-provider-name { font-weight: 600; }
      .hc-provider-badge {
        font-size: 10px; padding: 1px 6px; border-radius: 999px;
        border: 1px solid rgba(${STEEL}, 0.3); opacity: 0.75; white-space: nowrap;
      }
      .hc-provider-badge.is-hive { border-color: rgba(240, 200, 90, 0.6); color: rgba(240, 200, 90, 0.95); }
      .hc-provider-state { margin-left: auto; font-size: 11px; }
      .hc-provider-state.is-dim { opacity: 0.5; }
      .hc-provider-detail { padding: 4px 2px 12px; }
      .hc-provider-label { font-size: 11px; opacity: 0.6; margin: 8px 0 3px; letter-spacing: 0.05em; }
      .hc-provider-keyrow { display: flex; gap: 6px; }
      .hc-provider-input {
        flex: 1; min-width: 0; padding: 5px 8px; background: rgba(${STEEL}, 0.08);
        border: 1px solid rgba(${STEEL}, 0.25); border-radius: var(--hc-radius-control, 2px); color: inherit; outline: none;
      }
      .hc-provider-btn {
        padding: 5px 12px; background: rgba(${STEEL}, 0.15); color: inherit;
        border: 1px solid rgba(${STEEL}, 0.35); border-radius: var(--hc-radius-control, 2px); cursor: pointer; font: inherit;
      }
      .hc-provider-btn:hover { background: rgba(${STEEL}, 0.25); }
      .hc-provider-btn.is-quiet { background: none; border-color: rgba(${STEEL}, 0.2); opacity: 0.8; }
      .hc-provider-docs { display: inline-block; margin-top: 5px; color: rgba(${STEEL}, 0.9); font-size: 12px; }
      .hc-provider-models { display: flex; flex-wrap: wrap; gap: 5px; }
      .hc-provider-model {
        font-size: 11px; padding: 2px 8px; border-radius: 999px; border: 1px solid rgba(${STEEL}, 0.3);
      }
      .hc-provider-model.is-deep { border-color: rgba(200, 150, 255, 0.5); }
      .hc-provider-model.is-fast { border-color: rgba(140, 220, 160, 0.5); }
      .hc-provider-actions { display: flex; align-items: center; gap: 10px; margin-top: 12px; }
      .hc-provider-toggle { display: flex; align-items: center; gap: 6px; cursor: pointer; flex: 1; }
      .hc-provider-status { margin-top: 8px; font-size: 12px; word-break: break-word; opacity: 0.9; }
      .hc-provider-mono { font-size: 11px; opacity: 0.85; word-break: break-all; }
      .hc-provider-endpoint { display: block; }
      .hc-providers-add { padding: 12px 2px; }
      .hc-providers-spec {
        width: 100%; margin: 4px 0 8px; padding: 6px 8px; background: rgba(${STEEL}, 0.06);
        border: 1px solid rgba(${STEEL}, 0.25); border-radius: var(--hc-radius-control, 2px); color: inherit;
        font: 11px/1.4 ui-monospace, monospace; outline: none; resize: vertical; box-sizing: border-box;
      }
    `
    document.head.appendChild(style)
  }
}

// ── slash behaviour: /providers toggles the window ──────────────────────────
type SlashRegistrar = { addProvider?: (provider: unknown) => void }

const _providersWindow = new ProvidersWindowView()
window.ioc.register('@diamondcoreprocessor.com/ProvidersWindowView', _providersWindow)

window.ioc.whenReady?.('@diamondcoreprocessor.com/SlashBehaviourDrone', (drone: SlashRegistrar) => {
  drone.addProvider?.({
    name: 'providers-provider',
    priority: 100,
    behaviours: [
      { name: 'providers', description: 'Manage AI providers and API keys', descriptionKey: 'slash.providers',
        examples: [{ input: '/providers', result: 'Opens the AI providers console' }] },
      { name: 'models', description: 'Manage AI providers and API keys', descriptionKey: 'slash.providers',
        examples: [{ input: '/models', result: 'Opens the AI providers console' }] },
    ],
    execute: () => { EffectBus.emit('providers:open', {}) },
  })
})
