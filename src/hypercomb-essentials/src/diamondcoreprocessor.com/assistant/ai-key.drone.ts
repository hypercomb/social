// diamondcoreprocessor.com/assistant/ai-key.drone.ts
//
// Surfaces a command-line indicator whenever the Anthropic API key is present
// in localStorage. Gives the user a visible signal that any feature which
// would call the Claude API (translation, expand, chat) is currently live —
// so unintended spend doesn't happen invisibly.

import { Drone, EffectBus } from '@hypercomb/core'
import { API_KEY_STORAGE } from './llm-api.js'

const INDICATOR_KEY = 'ai-active'
const INDICATOR_ICON = '\u2728'
const INDICATOR_LABEL = 'Claude API key active'

export class AiKeyIndicatorDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'assistant'
  override description = 'shows a command-line indicator when a Claude API key is set'

  protected override listens = []
  protected override emits = ['indicator:set', 'indicator:clear']

  #initialized = false
  #storageHandler: ((event: StorageEvent) => void) | null = null

  protected override heartbeat = async (): Promise<void> => {
    if (this.#initialized) return
    this.#initialized = true

    this.#sync()

    this.#storageHandler = (event: StorageEvent) => {
      if (event.key === API_KEY_STORAGE || event.key === null) this.#sync()
    }
    window.addEventListener('storage', this.#storageHandler)
  }

  #sync(): void {
    const hasKey = !!localStorage.getItem(API_KEY_STORAGE)
    if (hasKey) {
      EffectBus.emit('indicator:set', {
        key: INDICATOR_KEY,
        icon: INDICATOR_ICON,
        label: INDICATOR_LABEL,
      })
    } else {
      EffectBus.emit('indicator:clear', { key: INDICATOR_KEY })
    }
  }
}

const _aiKey = new AiKeyIndicatorDrone()
window.ioc.register('@diamondcoreprocessor.com/AiKeyIndicatorDrone', _aiKey)
console.log('[AiKeyIndicatorDrone] Loaded')
