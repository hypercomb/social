// diamondcoreprocessor.com/assistant/providers-window.view.ts
//
// THE PROVIDERS CONSOLE — three ways of paying, one form.
//
// Opened by `/providers` (or the `providers:open` effect). Every AI provider
// the registry knows — built-in vendors, discovered specs, bridged CLI
// sessions, local and lent models — appears as one row under one of three
// tabs, and clicking a row opens the SAME panel for all of them: key field
// (when one is needed), endpoint (shown before a key ever travels to it),
// docs link, model roster, a test button, and the active switch the
// orchestrator honours. No vendor has a bespoke screen; if
// a spec ever needs a field this form lacks, the FORM grows the field, for
// everyone at once. The tabs group rows; they never change what a row IS.
//
// Everything here is a pure read of five live sources — the provider
// registry (rows), the key store (lights), the activation store (switches),
// the policy store (who answers by default), and localStorage's local-host
// override — plus one write path each. The window re-renders on any of their
// `change` events, so a provider discovered mid-session simply appears on
// whichever tab its cost class puts it.
//
// The standing instruction — who answers when nobody says — is the FOOT of
// the window, not its head: a status bar that always states who would answer
// right now, and opens into the pickers when you want to change it. It sits
// outside the tabs because it picks across the whole roster.
//
// A panel, not a takeover — cold chrome, DOM singleton, no Angular; the same
// shape as skills-window.view.

import { EffectBus, I18N_IOC_KEY, llmKeyStore, type I18nProvider } from '@hypercomb/core'
import { isLendingModels } from '../sharing/peer-models.drone.js'
import { llmActivation } from './llm-activation.js'
import { TIERS, availabilityOf, candidatesFor, chooseProvider, costOf, explainChoice, llmPolicy } from './model-policy.js'
import { callModel } from './llm-dispatch.js'
import { llmProviderRegistry } from './llm-provider-registry.js'
import './providers/builtin-providers.js'
import { importProviderSpec, providerOrigin } from './providers/provider-discovery.js'
import type { LlmProviderDescriptor } from './providers/llm-provider.types.js'
import { LOCAL_HOST_STORAGE_KEY, localLlmHost } from './providers/local.provider.js'
import { modelPalette } from '../presentation/avatars/agent-model.js'

const STYLE_ID = 'hc-providers-styles'
const STEEL = '126, 182, 214'
const WIDTH_KEY = 'hc:providers-window-width'
const TAB_KEY = 'hc:providers-window-tab'
const POLICY_OPEN_KEY = 'hc:providers-window-policy'
const MIN_WIDTH = 340

const ioc = <T,>(key: string): T | undefined =>
  (window as unknown as { ioc?: { get?: (k: string) => unknown } }).ioc?.get?.(key) as T | undefined

/**
 * THREE WAYS A MODEL GETS PAID FOR — and that is the whole grouping.
 *
 * A participant does not sort providers by protocol; they sort them by what
 * saying yes costs. A plan they already signed, answered by a CLI session on
 * this machine. A key that meters every request. Or a machine — theirs, or a
 * neighbour's — that bills nothing but has to be awake.
 *
 * So the tabs are a pure fold of the COST CLASS the selection policy already
 * reasons in (`costOf`), never a second classification: register a provider
 * anywhere and it lands on the right tab without this file learning its name.
 * Subscriptions is the tab that opens, because a plan already paid for is the
 * answer that costs the participant nothing more.
 */
export type ProviderTab = 'subscription' | 'api' | 'swarm'

const TABS: readonly { id: ProviderTab; label: string; hint: string }[] = [
  {
    id: 'subscription',
    label: 'Subscriptions',
    hint: 'A plan you already pay for. A CLI session running on this machine answers '
      + 'through its own account — and these are the only responders that can read your hive.',
  },
  {
    id: 'api',
    label: 'API requests',
    hint: 'Billed per request against a key you paste here. The key stays in this browser, '
      + 'and the endpoint it would travel to is shown before you paste it.',
  },
  {
    id: 'swarm',
    label: 'Swarm',
    hint: 'Models that answer from a machine instead of a bill — your own, and any a '
      + 'participant is lending right now. Free, but only while somebody is awake.',
  },
]

/** Which tab a provider sits on. A fold of its cost class, never a field. */
const tabOf = (provider: LlmProviderDescriptor): ProviderTab => {
  const cost = costOf(provider)
  return cost === 'bridge' ? 'subscription' : cost === 'keyed' ? 'api' : 'swarm'
}

/** The tab the console last showed — or Subscriptions, the plan already paid. */
const rememberedTab = (): ProviderTab => {
  try {
    const stored = localStorage.getItem(TAB_KEY) as ProviderTab | null
    if (stored && TABS.some(tab => tab.id === stored)) return stored
  } catch { /* session-only */ }
  return 'subscription'
}

/** Transport, said the way a participant would ask about it. */
const TRANSPORT_LABEL: Record<string, string> = {
  'browser-http': 'your key, this browser',
  'host-relay': 'a host you named',
  'agent-bridge': 'a live agent session',
  'peer-swarm': 'another participant’s machine',
}

/**
 * How this row is reached, in one phrase. A LOCAL server speaks the same HTTP
 * as a vendor but there is no key and no account behind it, so the transport
 * name would be a small lie — the cost class is what the participant actually
 * sees, and it decides the wording.
 */
const reachLabel = (provider: LlmProviderDescriptor): string =>
  costOf(provider) === 'local'
    ? 'this machine, no key'
    : TRANSPORT_LABEL[provider.transport] ?? provider.transport

export class ProvidersWindowView extends EventTarget {
  #panel: HTMLDivElement | null = null
  #footHost: HTMLDivElement | null = null
  #tabsHost: HTMLDivElement | null = null
  #body: HTMLDivElement | null = null
  #search = ''
  #tab: ProviderTab = rememberedTab()
  #policyOpen = (() => {
    try { return localStorage.getItem(POLICY_OPEN_KEY) === '1' } catch { return false }
  })()
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

    const tabsHost = document.createElement('div')
    tabsHost.className = 'hc-providers-tabs'
    tabsHost.setAttribute('role', 'tablist')
    panel.appendChild(tabsHost)
    this.#tabsHost = tabsHost

    const search = document.createElement('input')
    search.className = 'hc-providers-search'
    search.placeholder = this.#t('providers.search', 'Search providers and models')
    search.value = this.#search
    search.addEventListener('input', () => { this.#search = search.value; this.#render() })
    panel.appendChild(search)

    const body = document.createElement('div')
    body.className = 'hc-providers-body'
    panel.appendChild(body)
    this.#body = body

    // The foot of the window: a bar that always says who would answer, and
    // opens upward into the pickers. Last child, so it is the last word.
    const foot = document.createElement('div')
    foot.className = 'hc-providers-foot'
    panel.appendChild(foot)
    this.#footHost = foot

    document.body.appendChild(panel)
    this.#panel = panel
    window.addEventListener('keydown', this.#onKey, true)

    const rerender = (): void => this.#render()
    const registry = llmProviderRegistry()
    registry.addEventListener('change', rerender)
    llmKeyStore.addEventListener('change', rerender)
    llmActivation.addEventListener('change', rerender)
    llmPolicy.addEventListener('change', rerender)
    this.#unlisten = () => {
      registry.removeEventListener('change', rerender)
      llmKeyStore.removeEventListener('change', rerender)
      llmActivation.removeEventListener('change', rerender)
      llmPolicy.removeEventListener('change', rerender)
    }

    this.#render()
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
    this.#footHost = null
    this.#tabsHost = null
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

  /** Everything the console shows, in the order the panel stacks it. */
  #render(): void {
    this.#renderTabs()
    this.#renderBody()
    this.#renderFoot()
  }

  /**
   * The three chips. Each carries how many rows it holds RIGHT NOW — which
   * matters most while searching: a tab you are not on can be the one with
   * what you typed, and a count says so without making you hunt.
   */
  #renderTabs(): void {
    const host = this.#tabsHost
    if (!host) return
    host.textContent = ''
    for (const tab of TABS) {
      const active = this.#tab === tab.id
      const chip = document.createElement('button')
      chip.className = `hc-providers-tab${active ? ' is-active' : ''}`
      chip.setAttribute('role', 'tab')
      chip.setAttribute('aria-selected', String(active))
      chip.append(document.createTextNode(this.#t(`providers.tab.${tab.id}`, tab.label)))

      const count = document.createElement('span')
      count.className = 'hc-providers-count'
      count.textContent = String(this.#providersOn(tab.id).length)
      chip.appendChild(count)

      chip.addEventListener('click', () => this.#setTab(tab.id))
      host.appendChild(chip)
    }
  }

  /** Providers on one tab, already through the search filter. */
  #providersOn(tab: ProviderTab): LlmProviderDescriptor[] {
    return llmProviderRegistry().all().filter(p => tabOf(p) === tab && this.#matches(p))
  }

  /** Remember the tab without redrawing — for callers about to redraw anyway. */
  #rememberTab(tab: ProviderTab): void {
    this.#tab = tab
    try { localStorage.setItem(TAB_KEY, tab) } catch { /* session-only */ }
  }

  /** Switch tabs. The console reopens where you left it. */
  #setTab(tab: ProviderTab): void {
    if (this.#tab === tab) return
    this.#rememberTab(tab)
    this.#render()
  }

  #renderBody(): void {
    const body = this.#body
    if (!body) return
    body.textContent = ''

    const tab = TABS.find(entry => entry.id === this.#tab) ?? TABS[0]
    const hint = document.createElement('div')
    hint.className = 'hc-providers-hint'
    hint.textContent = this.#t(`providers.tabHint.${tab.id}`, tab.hint)
    body.appendChild(hint)

    // A badge that reads the same on every row of a tab is noise — the tab
    // already said it. It comes back the moment two rows disagree.
    const providers = this.#providersOn(tab.id)
    const varied = new Set(providers.map(reachLabel)).size > 1
    for (const provider of providers) body.appendChild(this.#row(provider, varied))
    if (!providers.length) body.appendChild(this.#emptyLine(tab.id))

    // The tab's own verb. Lending is the swarm's, and pasting a spec is the
    // API tab's — the two other tabs are filled by a CLI and by the mesh.
    if (tab.id === 'swarm') body.appendChild(this.#lendSection())
    if (tab.id === 'api') body.appendChild(this.#addSection())
  }

  /**
   * "Nothing here" is a different fact on each tab — no bridge running, no
   * neighbour awake, nothing matching what you typed — so each says its own.
   */
  #emptyLine(tab: ProviderTab): HTMLElement {
    const empty = document.createElement('div')
    empty.className = 'hc-providers-empty'
    if (this.#search.trim()) {
      const elsewhere = TABS.filter(entry => entry.id !== tab)
        .reduce((total, entry) => total + this.#providersOn(entry.id).length, 0)
      empty.textContent = elsewhere
        ? this.#t('providers.emptyHere', 'Nothing here — the counts above say which tab has it')
        : this.#t('providers.empty', 'Nothing matches')
      return empty
    }
    empty.textContent = tab === 'subscription'
      ? this.#t(
          'providers.emptySubscription',
          'No agent session is bridged to this machine yet. Start a CLI you already pay for — '
          + 'Claude Code, Codex, Gemini — and it announces itself here.',
        )
      : tab === 'swarm'
        ? this.#t('providers.emptySwarm', 'No machine is offering models right now.')
        : this.#t('providers.emptyApi', 'No provider on the roster takes a key.')
    return empty
  }

  // ── the foot: who answers when nobody says ───────────────────────────────

  /**
   * THE LAST WORD, not the first. The tabs above are the roster; this is the
   * standing instruction that picks from it, and it belongs at the foot for
   * two reasons: it is set once and then lives on, and it reaches across
   * every tab, so sitting inside one would read as that tab's setting.
   *
   * Collapsed it is a status line — the provider that would answer an
   * ordinary request right now, in its own vendor colour. That is the whole
   * point of a default: you should be able to see it without opening
   * anything. Clicking opens the three pickers upward.
   */
  #renderFoot(): void {
    const host = this.#footHost
    if (!host) return
    host.textContent = ''
    if (this.#policyOpen) host.appendChild(this.#policyPanel())
    host.appendChild(this.#policyBar())
  }

  #policyBar(): HTMLElement {
    const bar = document.createElement('button')
    bar.className = `hc-providers-footbar${this.#policyOpen ? ' is-open' : ''}`
    bar.setAttribute('aria-expanded', String(this.#policyOpen))
    bar.title = explainChoice({})

    const label = document.createElement('span')
    label.className = 'hc-foot-label'
    label.textContent = this.#t('providers.policyBrief', 'When nobody says')

    const value = document.createElement('span')
    value.className = 'hc-foot-value'
    const chosen = chooseProvider({})
    if (chosen) {
      const dot = document.createElement('span')
      dot.className = 'hc-provider-dot is-active'
      dot.style.background = modelPalette(chosen.defaultModel).body
      value.append(dot, document.createTextNode(chosen.label))
    } else {
      value.classList.add('is-dim')
      value.textContent = this.#t('providers.noAnswer', 'nobody yet')
    }

    const caret = document.createElement('span')
    caret.className = 'hc-foot-caret'
    caret.textContent = this.#policyOpen ? '▾' : '▴'

    bar.append(label, value, caret)
    bar.addEventListener('click', () => {
      this.#policyOpen = !this.#policyOpen
      try { localStorage.setItem(POLICY_OPEN_KEY, this.#policyOpen ? '1' : '0') } catch { /* session-only */ }
      this.#renderFoot()
    })
    return bar
  }

  /**
   * Three weights of work, each either pinned to one provider or left to the
   * policy. The picker itself carries the answer — "Decide for me — Claude"
   * — so the row is one line and you can still see what the default does
   * without opening anything else.
   *
   * The line UNDER a picker is reserved for the one case the picker cannot
   * state: a pin that fell through (its key is gone, or it cannot do this
   * work), where what you asked for and what will happen differ. Everything
   * else was repetition, and repetition is what made this block heavy.
   */
  #policyPanel(): HTMLElement {
    const section = document.createElement('div')
    section.className = 'hc-providers-policy'

    for (const tier of TIERS) {
      const row = document.createElement('div')
      row.className = 'hc-policy-row'

      const name = document.createElement('span')
      name.className = 'hc-policy-tier'
      name.textContent = this.#t(`providers.tier.${tier}`, tier)

      const pinned = llmPolicy.pin(tier)
      const chosen = chooseProvider({ tier })

      const wrap = document.createElement('span')
      wrap.className = 'hc-policy-pickwrap'
      const picker = document.createElement('select')
      picker.className = 'hc-policy-pick'
      picker.title = explainChoice({ tier })
      const auto = document.createElement('option')
      auto.value = ''
      const decide = this.#t('providers.decide', 'Decide for me')
      auto.textContent = chosen && !pinned ? `${decide} — ${chosen.label}` : decide
      picker.appendChild(auto)
      for (const provider of candidatesFor({ tier })) {
        const option = document.createElement('option')
        option.value = provider.id
        option.textContent = provider.label
        picker.appendChild(option)
      }
      picker.value = llmPolicy.pin(tier)
      picker.addEventListener('change', () => {
        llmPolicy.setPin(tier, picker.value)
        this.#render()
      })
      wrap.appendChild(picker)
      row.append(name, wrap)

      // ONLY when the pin is not what happens. See the doc comment.
      if (pinned && chosen?.id !== pinned) {
        const resolved = document.createElement('div')
        resolved.className = 'hc-policy-resolved'
        resolved.textContent = explainChoice({ tier })
        row.appendChild(resolved)
      }
      section.appendChild(row)
    }

    section.appendChild(this.#policySwitch(
      'providers.preferFree', 'Prefer models that cost nothing',
      llmPolicy.preferFree, on => { llmPolicy.preferFree = on },
    ))
    section.appendChild(this.#policySwitch(
      'providers.allowPeers', 'May use another participant’s machine automatically',
      llmPolicy.allowPeers, on => { llmPolicy.allowPeers = on },
    ))

    const note = document.createElement('div')
    note.className = 'hc-policy-note'
    note.textContent = this.#t(
      'providers.policyNote',
      'Naming a model yourself always wins over this.',
    )
    section.appendChild(note)
    return section
  }

  #policySwitch(key: string, fallback: string, value: boolean, set: (on: boolean) => void): HTMLElement {
    const label = document.createElement('label')
    label.className = 'hc-provider-toggle'
    const box = document.createElement('input')
    box.type = 'checkbox'
    box.checked = value
    box.addEventListener('change', () => { set(box.checked); this.#render() })
    label.append(box, document.createTextNode(this.#t(key, fallback)))
    return label
  }

  #row(provider: LlmProviderDescriptor, showReach = true): HTMLElement {
    const needsKey = provider.requiresKey !== false
    const hasKey = llmKeyStore.has(provider.id)
    const enabled = llmActivation.isEnabled(provider.id)
    const availability = availabilityOf(provider)
    const usable = enabled && (!needsKey || hasKey) && availability !== 'exhausted'

    const row = document.createElement('div')
    row.className = 'hc-provider'

    const head = document.createElement('button')
    head.className = 'hc-provider-head'
    head.addEventListener('click', () => {
      this.#openId = this.#openId === provider.id ? null : provider.id
      this.#render()
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
      ? (llmActivation.wasHeld(provider.id)
          ? this.#t('providers.held', 'held')
          : this.#t('providers.off', 'off'))
      : availability === 'exhausted'
        ? this.#t('providers.exhausted', 'limit reached')
      : usable
        ? this.#t('providers.active', 'active')
        : this.#t('providers.noKey', 'no key')
    state.classList.toggle('is-dim', !usable)

    head.append(dot, name)
    if (showReach) head.appendChild(this.#badge(reachLabel(provider)))
    if (provider.subscription?.windows.length) {
      const remaining = Math.min(...provider.subscription.windows.map(window => window.remainingPercent))
      head.appendChild(this.#badge(`${Math.round(remaining)}% left`, availability))
    } else if (provider.transport === 'agent-bridge') {
      head.appendChild(this.#badge(this.#t('providers.limitsUnknown', 'limits unknown'), 'unknown'))
    }
    head.appendChild(state)
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

    // WHERE THIS CAME FROM. A row the participant typed in themselves needs
    // no explanation; one a domain offered does, and it belongs above the
    // key field rather than below it — provenance is what the decision to
    // paste a key is made on.
    const origin = providerOrigin(provider.id)
    if (origin) {
      const from = document.createElement('div')
      from.className = 'hc-provider-origin'
      from.textContent = this.#t('providers.offeredBy', 'offered by {origin}').replace('{origin}', origin)
      detail.appendChild(from)
    }
    if (llmActivation.wasHeld(provider.id)) {
      const why = document.createElement('div')
      why.className = 'hc-provider-warn'
      why.textContent = this.#t(
        'providers.heldWhy',
        'This was offered by one domain but sends your key to another. Check the endpoint before switching it on.',
      )
      detail.appendChild(why)
    }

    if (provider.description) {
      const description = document.createElement('div')
      description.className = 'hc-provider-description'
      description.textContent = provider.description
      detail.appendChild(description)
    }
    if (provider.account) {
      detail.append(
        this.#label(this.#t('providers.account', 'Account')),
        this.#mono(provider.account),
      )
    }
    if (provider.subscription) detail.appendChild(this.#subscription(provider))

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
    } else if (provider.transport === 'agent-bridge') {
      const docs = document.createElement('a')
      docs.className = 'hc-provider-docs'
      docs.href = provider.docsUrl
      docs.target = '_blank'
      docs.rel = 'noopener noreferrer'
      docs.textContent = this.#t('providers.setup', 'CLI setup')
      detail.appendChild(docs)
    }

    // models — read-only roster, tiers spelled out.
    const models = document.createElement('div')
    models.className = 'hc-provider-models'
    for (const model of provider.models) {
      const chip = document.createElement('span')
      chip.className = `hc-provider-model is-${model.tier}`
      chip.textContent = model.label || model.name
      chip.title = model.label ? `/${model.name} · ${model.id}` : model.id
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

    actions.appendChild(toggle)
    if (provider.transport === 'agent-bridge') {
      const bridgeState = document.createElement('span')
      bridgeState.className = 'hc-provider-status'
      bridgeState.textContent = this.#t('providers.bridgeAnnounced', 'CLI detected and announced')
      actions.appendChild(bridgeState)
    } else {
      const test = document.createElement('button')
      test.className = 'hc-provider-btn'
      test.textContent = this.#t('providers.test', 'Test')
      test.addEventListener('click', () => { void this.#test(provider) })
      actions.appendChild(test)
    }
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

  #subscription(provider: LlmProviderDescriptor): HTMLElement {
    const usage = provider.subscription!
    const block = document.createElement('div')
    block.className = `hc-provider-usage is-${usage.status}`
    block.appendChild(this.#label(this.#t('providers.subscriptionUsage', 'Subscription availability')))
    if (usage.plan) {
      const plan = document.createElement('div')
      plan.className = 'hc-provider-usage-line'
      plan.textContent = usage.plan
      block.appendChild(plan)
    }
    for (const window of usage.windows) {
      const line = document.createElement('div')
      line.className = 'hc-provider-usage-line'
      const reset = window.resetsAt
        ? ` · resets ${new Date(window.resetsAt * (window.resetsAt < 10_000_000_000 ? 1000 : 1)).toLocaleString()}`
        : ''
      line.textContent = `${window.label}: ${Math.round(window.remainingPercent)}% left${reset}`
      block.appendChild(line)
    }
    if (!usage.windows.length) {
      const line = document.createElement('div')
      line.className = 'hc-provider-usage-line is-dim'
      line.textContent = usage.message || this.#t('providers.limitsUnknownDetail', 'This CLI did not report subscription limits.')
      block.appendChild(line)
    }
    if (usage.credits?.unlimited) {
      const line = document.createElement('div')
      line.className = 'hc-provider-usage-line'
      line.textContent = this.#t('providers.creditsUnlimited', 'Additional credits: unlimited')
      block.appendChild(line)
    } else if (usage.credits?.balance) {
      const line = document.createElement('div')
      line.className = 'hc-provider-usage-line'
      line.textContent = `${this.#t('providers.credits', 'Credits')}: ${usage.credits.balance}`
      block.appendChild(line)
    }
    return block
  }

  #mono(text: string): HTMLElement {
    const mono = document.createElement('code')
    mono.className = 'hc-provider-mono'
    mono.textContent = text
    return mono
  }

  #note(providerId: string, text: string): void {
    this.#status.set(providerId, text)
    this.#render()
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

  // ── what each tab lets you DO ────────────────────────────────────────────

  /**
   * LENDING — the other direction, and the swarm tab's own verb. Every row
   * above is about models answering FOR the participant; this is their
   * machine answering for somebody else, which is a decision and therefore a
   * switch they have to throw. Only ever offers models that cost nothing to
   * run — and it sits on the swarm tab because that tab is already the one
   * about machines rather than bills.
   */
  #lendSection(): HTMLElement {
    const section = document.createElement('div')
    section.className = 'hc-providers-lend'

    const toggle = document.createElement('label')
    toggle.className = 'hc-provider-toggle'
    const checkbox = document.createElement('input')
    checkbox.type = 'checkbox'
    checkbox.checked = isLendingModels()
    checkbox.addEventListener('change', () => {
      EffectBus.emit('peer-models:lend', { on: checkbox.checked })
      this.#render()
    })
    toggle.append(checkbox, document.createTextNode(
      this.#t('providers.lend', 'Let the swarm use my local models when I am not'),
    ))

    const hint = document.createElement('div')
    hint.className = 'hc-provider-label'
    hint.textContent = this.#t(
      'providers.lendHint',
      'Only models that need no key are offered — never one you pay for. One request at a time, and never while you are using it yourself.',
    )
    section.append(toggle, hint)
    return section
  }

  /** Pasting a spec — the API tab's verb, since a pasted `llm-provider@1` is
   *  nearly always a keyed endpoint. A bridge or peer spec still imports; the
   *  console just follows it to the tab it lands on. */
  #addSection(): HTMLElement {
    const section = document.createElement('div')
    section.className = 'hc-providers-add'

    const toggle = document.createElement('button')
    toggle.className = 'hc-provider-btn is-quiet'
    toggle.textContent = this.#addOpen
      ? this.#t('providers.addClose', 'Close')
      : this.#t('providers.add', '+ Add provider')
    toggle.addEventListener('click', () => { this.#addOpen = !this.#addOpen; this.#render() })
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
          // A pasted spec is usually keyed, but it may be a bridge or a peer.
          // Follow it to whichever tab it landed on rather than leaving the
          // participant staring at the tab it is not on.
          const landed = llmProviderRegistry().get(spec.id)
          if (landed) this.#rememberTab(tabOf(landed))
          this.#render()
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
      .hc-providers-tabs {
        display: flex; align-items: stretch; gap: 2px; padding: 0 10px; flex: none;
        border-bottom: 1px solid rgba(${STEEL}, 0.25);
      }
      .hc-providers-tab {
        display: flex; align-items: center; gap: 6px;
        background: none; border: 0; border-bottom: 2px solid transparent;
        color: rgba(${STEEL}, 0.55); font: inherit; font-weight: 600; letter-spacing: 0.03em;
        padding: 7px 10px 5px; cursor: pointer;
      }
      .hc-providers-tab:hover { color: rgba(${STEEL}, 0.85); }
      .hc-providers-tab.is-active { color: rgba(${STEEL}, 0.96); border-bottom-color: rgba(${STEEL}, 0.8); }
      .hc-providers-tab:focus-visible { outline: 1px solid rgba(${STEEL}, 0.7); outline-offset: -1px; }
      .hc-providers-count { font-size: 10px; font-weight: 500; opacity: 0.6; }
      .hc-providers-hint { font-size: 11px; line-height: 1.5; opacity: 0.6; padding: 9px 2px 7px; }
      .hc-providers-search {
        margin: 8px 12px; padding: 6px 8px; background: rgba(${STEEL}, 0.08);
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
      .hc-provider-badge.is-limited { border-color: rgba(240, 180, 90, 0.65); color: rgba(255, 204, 115, 0.95); }
      .hc-provider-badge.is-exhausted { border-color: rgba(240, 100, 100, 0.65); color: rgba(255, 145, 145, 0.95); }
      .hc-provider-badge.is-unknown { opacity: 0.5; }
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
      .hc-provider-toggle input[type="checkbox"] {
        appearance: none; -webkit-appearance: none; flex: none; margin: 0;
        width: 13px; height: 13px; border-radius: 2px; cursor: pointer;
        border: 1px solid rgba(${STEEL}, 0.4); background: rgba(${STEEL}, 0.08);
        display: grid; place-content: center;
      }
      .hc-provider-toggle input[type="checkbox"]::before {
        content: ''; width: 9px; height: 9px; transform: scale(0);
        background: rgba(${STEEL}, 0.95);
        clip-path: polygon(14% 44%, 0 65%, 50% 100%, 100% 16%, 80% 0%, 43% 62%);
      }
      .hc-provider-toggle input[type="checkbox"]:checked { border-color: rgba(${STEEL}, 0.65); }
      .hc-provider-toggle input[type="checkbox"]:checked::before { transform: scale(1); }
      .hc-provider-toggle input[type="checkbox"]:hover { border-color: rgba(${STEEL}, 0.6); }
      .hc-provider-toggle input[type="checkbox"]:focus-visible {
        outline: 1px solid rgba(${STEEL}, 0.7); outline-offset: 1px;
      }
      .hc-provider-status { margin-top: 8px; font-size: 12px; word-break: break-word; opacity: 0.9; }
      .hc-provider-origin { font-size: 11px; opacity: 0.7; margin: 6px 0 2px; }
      .hc-provider-description { font-size: 12px; line-height: 1.45; opacity: 0.82; margin: 5px 0 9px; }
      .hc-provider-usage { margin: 5px 0 9px; padding: 6px 8px; border-left: 2px solid rgba(${STEEL}, 0.45); background: rgba(${STEEL}, 0.05); }
      .hc-provider-usage.is-limited { border-left-color: rgba(240, 180, 90, 0.8); }
      .hc-provider-usage.is-exhausted { border-left-color: rgba(240, 100, 100, 0.8); }
      .hc-provider-usage-line { font-size: 12px; line-height: 1.45; }
      .hc-provider-usage-line.is-dim { opacity: 0.58; }
      .hc-provider-warn {
        font-size: 11px; line-height: 1.4; margin: 4px 0 2px; padding: 6px 8px;
        border: 1px solid rgba(240, 180, 90, 0.45); border-radius: var(--hc-radius-control, 2px);
        color: rgba(245, 205, 140, 0.95); background: rgba(240, 180, 90, 0.08);
      }
      .hc-provider-mono { font-size: 11px; opacity: 0.85; word-break: break-all; }
      .hc-provider-endpoint { display: block; }
      /* THE FOOT — a status bar that opens upward into the pickers. */
      .hc-providers-foot {
        flex: none; display: flex; flex-direction: column;
        border-top: 1px solid rgba(${STEEL}, 0.22); background: rgba(${STEEL}, 0.045);
      }
      .hc-providers-footbar {
        display: flex; align-items: center; gap: 8px; width: 100%;
        padding: 8px 12px; background: none; border: 0; color: inherit;
        font: inherit; font-size: 11px; letter-spacing: 0.04em;
        text-align: left; cursor: pointer;
      }
      .hc-providers-footbar:hover { background: rgba(${STEEL}, 0.06); }
      .hc-providers-footbar:focus-visible { outline: 1px solid rgba(${STEEL}, 0.7); outline-offset: -1px; }
      .hc-foot-label { opacity: 0.55; white-space: nowrap; }
      .hc-foot-value {
        margin-left: auto; display: flex; align-items: center; gap: 6px;
        min-width: 0; opacity: 0.95; font-weight: 600;
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }
      .hc-foot-value.is-dim { opacity: 0.5; font-weight: 400; font-style: italic; }
      .hc-foot-value .hc-provider-dot { width: 7px; height: 7px; }
      .hc-foot-caret { opacity: 0.5; font-size: 9px; }
      .hc-providers-policy {
        padding: 10px 12px 12px; max-height: 46vh; overflow-y: auto;
        border-bottom: 1px solid rgba(${STEEL}, 0.14);
      }
      .hc-policy-row {
        display: grid; grid-template-columns: 66px 1fr; align-items: center;
        column-gap: 10px; margin-bottom: 9px;
      }
      .hc-policy-tier { font-size: 11px; opacity: 0.6; letter-spacing: 0.04em; }
      .hc-policy-pickwrap { position: relative; display: block; min-width: 0; }
      .hc-policy-pickwrap::after {
        content: '▾'; position: absolute; right: 8px; top: 50%; transform: translateY(-50%);
        pointer-events: none; font-size: 10px; opacity: 0.65;
      }
      .hc-policy-pick {
        appearance: none; -webkit-appearance: none;
        width: 100%; padding: 5px 22px 5px 8px; background: rgba(${STEEL}, 0.08);
        border: 1px solid rgba(${STEEL}, 0.22); border-radius: var(--hc-radius-control, 2px);
        color: inherit; font: inherit; font-size: 12px; outline: none; cursor: pointer;
      }
      .hc-policy-pick:hover { border-color: rgba(${STEEL}, 0.4); }
      .hc-policy-pick:focus-visible { border-color: rgba(${STEEL}, 0.7); }
      .hc-policy-pick option { background: rgb(18, 25, 30); color: rgba(${STEEL}, 0.95); }
      .hc-policy-resolved {
        grid-column: 2; font-size: 10.5px; opacity: 0.5; margin-top: 3px;
      }
      .hc-policy-note { font-size: 10.5px; opacity: 0.45; margin-top: 10px; }
      .hc-providers-policy .hc-provider-toggle { font-size: 11.5px; margin-top: 7px; }
      .hc-providers-lend {
        padding: 12px 2px 4px; margin-top: 8px; border-top: 1px solid rgba(${STEEL}, 0.15);
      }
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
