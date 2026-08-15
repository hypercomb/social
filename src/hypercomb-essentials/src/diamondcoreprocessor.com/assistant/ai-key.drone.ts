// diamondcoreprocessor.com/assistant/ai-key.drone.ts
//
// SPEND MUST NEVER BE INVISIBLE.
//
// One command-line indicator per CONFIGURED provider. If a key is on this
// device, something in this hive can spend the participant's money without
// asking again — translation, expand, atomize, chat — so the fact that it
// CAN is always on screen, one light per vendor, labelled with the vendor's
// own name.
//
// This used to be a single hardcoded "Claude API key active" light reading
// one localStorage key. It is now the LlmKeyStore's `configured()` roster
// crossed with the provider registry for labels, so the day a descriptor
// registers and a key is pasted, its light appears with no code change here.
// A key for a provider the registry has never heard of still lights up — an
// unknown vendor that can spend is exactly the case you most want shown.

import { Drone, EffectBus, llmKeyStore } from '@hypercomb/core'
import { llmProviderRegistry } from './llm-provider-registry.js'
import './providers/builtin-providers.js'

const INDICATOR_PREFIX = 'ai-active:'
const INDICATOR_ICON = 'auto_awesome'

export class AiKeyIndicatorDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'assistant'
  override description = 'shows one command-line indicator per configured AI provider'

  protected override listens = []
  protected override emits = ['indicator:set', 'indicator:clear']

  #initialized = false
  /** Provider ids currently lit — so a cleared key clears its own light. */
  #shown = new Set<string>()

  protected override heartbeat = async (): Promise<void> => {
    if (this.#initialized) return
    this.#initialized = true

    this.#sync()
    // The store already folds in cross-tab `storage` events and re-reads
    // itself, so one listener on it covers both this tab and the others.
    llmKeyStore.addEventListener('change', () => this.#sync())
    // A provider registering late (a module loaded after boot) changes only
    // the LABEL of a light, but a light with the wrong name is worse than
    // none — relabel when the roster moves.
    llmProviderRegistry().addEventListener('change', () => this.#sync())
  }

  #sync(): void {
    const registry = llmProviderRegistry()
    const configured = new Set(llmKeyStore.configured())

    for (const id of configured) {
      EffectBus.emit('indicator:set', {
        key: `${INDICATOR_PREFIX}${id}`,
        icon: INDICATOR_ICON,
        label: `${registry.get(id)?.label ?? id} API key active`,
      })
    }
    for (const id of this.#shown) {
      if (!configured.has(id)) EffectBus.emit('indicator:clear', { key: `${INDICATOR_PREFIX}${id}` })
    }
    this.#shown = configured
  }
}

const _aiKey = new AiKeyIndicatorDrone()
window.ioc.register('@diamondcoreprocessor.com/AiKeyIndicatorDrone', _aiKey)
console.log('[AiKeyIndicatorDrone] Loaded')
