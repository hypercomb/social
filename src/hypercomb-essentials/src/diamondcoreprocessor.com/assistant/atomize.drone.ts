// diamondcoreprocessor.com/assistant/atomize.drone.ts
import { Drone, EffectBus, hypercomb, normalizeSeed } from '@hypercomb/core'
import type {
  AtomizerProvider,
  AtomDescriptor,
  DisplayStrategy,
  DisplayStrategyName,
  AtomizerContract,
} from '@hypercomb/core'
import type { OverlayActionDescriptor } from '../presentation/tiles/tile-overlay.drone.js'
import { MODELS, getApiKey, callAnthropic, API_KEY_STORAGE } from './llm-api.js'

// ---------------------------------------------------------------------------
// SVG icons
// ---------------------------------------------------------------------------

const EXPAND_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>'

const ACTION_DESCRIPTOR: OverlayActionDescriptor = {
  name: 'expand',
  svgMarkup: EXPAND_SVG,
  x: -25.25,
  y: 5,
  hoverTint: 0xd8c8ff,
  profile: 'private',
}

// ---------------------------------------------------------------------------
// Tile decomposition config (original behavior)
// ---------------------------------------------------------------------------

const SUBTOPIC_COUNT = 7

const SYSTEM_PROMPT = `You are a precise decomposition engine for a spatial knowledge graph called Hypercomb.

Your job: Given a single subject, break it down into its constituent parts — the smaller, more specific pieces that compose it. Each piece should be concrete enough to explore further on its own.

Produce a flat JSON array where each element is an object with:
- "name": a short 1–3 word label (will become a tile label, lowercase, no special characters)
- "detail": a concise descriptive phrase (5–12 words)

Rules:
1. Output exactly ${SUBTOPIC_COUNT} items.
2. Items must be unique and non-overlapping.
3. Items should be concrete constituents, not vague categories.
4. Output ONLY the JSON array. No markdown, no wrapping text.`

type TileActionPayload = { action: string; label: string; q: number; r: number; index: number }

// ---------------------------------------------------------------------------
// Atomizer contract runtime session
// ---------------------------------------------------------------------------

class AtomizerSession implements AtomizerContract {
  readonly target: string
  readonly provider: AtomizerProvider
  readonly atoms: AtomDescriptor[]
  activeStrategy: DisplayStrategyName

  #strategies: Map<DisplayStrategyName, DisplayStrategy>

  constructor(
    target: string,
    provider: AtomizerProvider,
    atoms: AtomDescriptor[],
    strategies: Map<DisplayStrategyName, DisplayStrategy>,
    initialStrategy: DisplayStrategyName,
  ) {
    this.target = target
    this.provider = provider
    this.atoms = atoms
    this.#strategies = strategies
    this.activeStrategy = initialStrategy
  }

  setStrategy(name: DisplayStrategyName): void {
    if (name === this.activeStrategy) return
    const current = this.#strategies.get(this.activeStrategy)
    const next = this.#strategies.get(name)
    if (!next) return
    current?.exit()
    this.activeStrategy = name
    next.switchTo(this.atoms)
  }

  enter(): void {
    const strategy = this.#strategies.get(this.activeStrategy)
    strategy?.enter(this.provider, this.atoms)
  }

  exit(): void {
    const strategy = this.#strategies.get(this.activeStrategy)
    strategy?.exit()
    this.provider.reassemble()
  }
}

// ---------------------------------------------------------------------------
// AtomizeDrone — orchestrates tile decomposition + UI atomization
// ---------------------------------------------------------------------------

export class AtomizeDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override description = 'atomizes tiles (Claude Haiku) and UI components (display strategies)'

  protected override deps = {
    lineage: '@hypercomb.social/Lineage',
    navigation: '@hypercomb.social/Navigation',
    store: '@hypercomb.social/Store',
  }

  protected override listens = [
    'render:host-ready',
    'tile:action',
    'atomize:trigger',
    'atomize:set-strategy',
    'atomize:close',
  ]
  protected override emits = [
    'overlay:register-action',
    'seed:added',
    'atomize:mode',
    'atomize:atoms',
    'atomize:strategy-changed',
  ]

  #registered = false
  #effectsRegistered = false
  #busy = false

  // --- strategy registry ---
  #strategies = new Map<DisplayStrategyName, DisplayStrategy>()
  #session: AtomizerSession | null = null

  /** Register a display strategy (called by strategy modules at load time) */
  registerStrategy(strategy: DisplayStrategy): void {
    this.#strategies.set(strategy.name, strategy)
  }

  /** Get the current atomizer session (for external queries) */
  get session(): AtomizerContract | null {
    return this.#session
  }

  /** Get all registered strategy names */
  get availableStrategies(): DisplayStrategyName[] {
    return [...this.#strategies.keys()]
  }

  // --- lifecycle ---

  protected override heartbeat = async (): Promise<void> => {
    if (this.#effectsRegistered) return
    this.#effectsRegistered = true

    this.onEffect('render:host-ready', () => {
      if (this.#registered) return
      this.#registered = true
      this.emitEffect('overlay:register-action', [ACTION_DESCRIPTOR])
    })

    // --- tile decomposition (original) ---
    this.onEffect<TileActionPayload>('tile:action', (payload) => {
      if (payload.action !== 'expand') return
      void this.#expand(payload.label)
    })

    // --- UI component atomization ---
    this.onEffect<{ target: string; strategy?: DisplayStrategyName }>(
      'atomize:trigger',
      (payload) => {
        void this.#atomizeComponent(payload.target, payload.strategy)
      },
    )

    this.onEffect<{ strategy: DisplayStrategyName }>(
      'atomize:set-strategy',
      (payload) => {
        if (!this.#session) return
        this.#session.setStrategy(payload.strategy)
        this.emitEffect('atomize:strategy-changed', {
          strategy: payload.strategy,
        })
      },
    )

    this.onEffect('atomize:close', () => {
      this.#closeSession()
    })
  }

  // ---------------------------------------------------------------------------
  // UI component atomization
  // ---------------------------------------------------------------------------

  async #atomizeComponent(
    target: string,
    strategyName?: DisplayStrategyName,
  ): Promise<void> {
    // Close any active session first
    this.#closeSession()

    // Resolve the provider from IoC
    const ioc = (globalThis as any).ioc
    const provider = ioc?.get(target) as AtomizerProvider | undefined
    if (!provider) {
      console.warn(`[atomize] No AtomizerProvider found for: ${target}`)
      return
    }

    // Discover atoms
    const atoms = provider.discover()
    if (atoms.length === 0) {
      console.warn(`[atomize] No atoms discovered for: ${target}`)
      return
    }

    // Pick strategy — requested, or first available
    const strategy = strategyName ?? this.#strategies.keys().next().value as DisplayStrategyName | undefined
    if (!strategy || !this.#strategies.has(strategy)) {
      console.warn(`[atomize] No display strategy available`)
      return
    }

    // Create session
    this.#session = new AtomizerSession(
      target,
      provider,
      atoms,
      this.#strategies,
      strategy,
    )

    // Enter atomize mode
    this.#session.enter()
    this.emitEffect('atomize:mode', { active: true, target, strategy })
    this.emitEffect('atomize:atoms', { atoms, target })

    console.log(
      `[atomize] ${target} → ${atoms.length} atoms (strategy: ${strategy})`,
    )
  }

  #closeSession(): void {
    if (!this.#session) return
    this.#session.exit()
    this.#session = null
    this.emitEffect('atomize:mode', { active: false, target: '', strategy: '' })
  }

  // ---------------------------------------------------------------------------
  // Tile decomposition (original behavior, unchanged)
  // ---------------------------------------------------------------------------

  async #expand(rawLabel: string): Promise<void> {
    if (this.#busy) return
    this.#busy = true

    try {
      const apiKey = getApiKey()
      if (!apiKey) {
        console.warn(`[expand] No API key. Set via: localStorage.setItem('${API_KEY_STORAGE}', 'sk-ant-...')`)
        EffectBus.emit('llm:api-key-required', {})
        return
      }

      const label = normalizeSeed(rawLabel) || rawLabel

      const userMessage = `Decompose this into ${SUBTOPIC_COUNT} constituent parts:\n\nTopic: ${label}`

      const responseText = await callAnthropic(
        MODELS['haiku'],
        SYSTEM_PROMPT,
        userMessage,
        apiKey,
        1024,
      )

      const parts = this.#extractArray(responseText)
      if (parts.length === 0) {
        console.warn('[expand] No parts extracted from response')
        return
      }

      for (const item of parts) {
        const name = normalizeSeed(item.name)
        if (!name) continue
        EffectBus.emit('seed:added', { seed: name })
      }

      console.log(`[expand] ${label} → ${parts.length} parts`)
      await new hypercomb().act()
    } catch (err) {
      console.warn('[expand] failed:', err)
    } finally {
      this.#busy = false
    }
  }

  #extractArray(text: string): { name: string; detail: string }[] {
    try {
      const p = JSON.parse(text)
      if (Array.isArray(p)) return p
    } catch {}

    const m = text.match(/\[[\s\S]*\]/g) || []
    for (const chunk of m.sort((a, b) => b.length - a.length)) {
      try {
        const arr = JSON.parse(chunk)
        if (Array.isArray(arr)) return arr
      } catch {}
    }

    return []
  }
}

const _atomize = new AtomizeDrone()
window.ioc.register('@diamondcoreprocessor.com/AtomizeDrone', _atomize)
console.log('[AtomizeDrone] Loaded')
