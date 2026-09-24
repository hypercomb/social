// assistant/llm.drone.ts
//
// THE MODEL SEAM IS A BEHAVIOUR (atomic-modules-plan.md, step 6). The provider
// registry, the roster that ships, the stores every model call reads
// (activation, model choice, removal, hive access, policy), the router, the
// host's AI and the Providers console are its dependencies; this bee is the
// one that registers them — the console when it is first opened.
//
// publishService for the keys that used it: a bee can load before the dev
// shell installs its own `window.ioc` map, and publishService keeps offering
// until the map holds the key (llm-provider-registry.ts).

import { Drone, EffectBus } from '@hypercomb/core'
import { LLM_PROVIDER_REGISTRY_IOC_KEY, llmProviderRegistry, publishService } from './llm-provider-registry.js'
import { startBuiltinLlmProviders } from './providers/builtin-providers.js'
import { llmActivation } from './llm-activation.js'
import { LLM_MODEL_CHOICE_IOC_KEY, llmModelChoice } from './llm-model-choice.js'
import { LLM_PROVIDER_REMOVAL_IOC_KEY, llmProviderRemoval } from './llm-provider-removal.js'
import { LLM_HIVE_ACCESS_IOC_KEY, llmHiveAccess } from './llm-hive-access.js'
import { LLM_ROUTER_IOC_KEY, llmRouter } from './llm-dispatch.js'
import { llmPolicy } from './model-policy.js'
import { HOST_AI_IOC_KEY, HostAiService } from './host-ai.service.js'

export class LlmDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'

  public override description =
    'The model seam: registers the provider registry and roster, the model stores, the router and the Providers console.'

  protected override sense = (): boolean => false
}

publishService(LLM_PROVIDER_REGISTRY_IOC_KEY, llmProviderRegistry())
startBuiltinLlmProviders()
window.ioc.register('@diamondcoreprocessor.com/LlmActivationStore', llmActivation)
publishService(LLM_MODEL_CHOICE_IOC_KEY, llmModelChoice)
publishService(LLM_PROVIDER_REMOVAL_IOC_KEY, llmProviderRemoval)
publishService(LLM_HIVE_ACCESS_IOC_KEY, llmHiveAccess)
publishService(LLM_ROUTER_IOC_KEY, llmRouter)
publishService('@diamondcoreprocessor.com/LlmPolicyStore', llmPolicy)
window.ioc.register(HOST_AI_IOC_KEY, new HostAiService())

// ── the Providers console, and the words that open it ───────────────────────
type SlashRegistrar = { addProvider?: (provider: unknown) => void }

// THE CONSOLE ARRIVES WITH ITS FIRST OPEN, not at boot (atomic-modules-plan.md,
// "adopt the proper load"): nothing needs its code until `/providers` or the
// AI key light asks, so it loads then, once. The view subscribes to
// `providers:open` as it is made and the bus replays the press that loaded
// it, so the first press opens it like every later one. The key is spelled
// here: importing even a constant from the view would keep it on boot.
const PROVIDERS_WINDOW_KEY = '@diamondcoreprocessor.com/ProvidersWindowView'
let providersWindow: Promise<void> | null = null
let providersBuilt = false
/** Presses heard while the console loads. The replay plays only the last,
 *  and every press toggles — so an even count ends closed. */
let providersPresses = 0

EffectBus.on('providers:open', () => {
  if (providersBuilt) return
  providersPresses++
  providersWindow ??= import('./providers-window.view.js').then(({ ProvidersWindowView }) => {
    // BUILT ONCE, even when making it throws: it subscribes before its replay
    // opens it, so a second one would answer every later press twice.
    providersBuilt = true
    try {
      const view = new ProvidersWindowView()
      window.ioc.register(PROVIDERS_WINDOW_KEY, view)
      if (providersPresses % 2 === 0) view.close()
    } catch (error) {
      console.error('[llm] the Providers console could not be made', error)
    }
  }, (error: unknown) => {
    // A failed load says so, and the next press tries again.
    providersWindow = null
    providersPresses = 0
    EffectBus.emit('activity:log', { message: `Could not load the Providers console: ${error instanceof Error ? error.message : String(error)}` })
  })
})

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

window.ioc.register('@diamondcoreprocessor.com/LlmDrone', new LlmDrone())
