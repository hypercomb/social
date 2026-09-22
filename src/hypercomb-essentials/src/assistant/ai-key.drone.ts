// assistant/ai-key.drone.ts
//
// SPEND MUST NEVER BE INVISIBLE.
//
// If a key is on this device, something in this hive can spend the
// participant's money without asking again — translation, expand, break-apart,
// chat — so the fact that it CAN is always on the command line.
//
// ONE light, and it NAMES the vendors: each configured provider's label behind
// the same family dot the Providers window draws for it. A click opens that
// window, which is where a key is cleared. It used to be one sparkle per
// vendor, each with an ×: identical glyphs that said nothing until hovered,
// and an × that hid a light only until the next load. The light has no × —
// the way to put it out is to clear the key.
//
// The roster is the LlmKeyStore's `configured()` crossed with the provider
// registry for labels, so the day a descriptor registers and a key is pasted,
// its name appears with no code change here. A key for a provider the
// registry has never heard of still lights up under its id — an unknown vendor
// that can spend is exactly the case you most want shown.

import { Drone, EffectBus, I18N_IOC_KEY, llmKeyStore, type I18nProvider } from '@hypercomb/core'
import { modelPalette } from '../presentation/avatars/agent-model.js'
import { llmProviderRegistry } from './llm-provider-registry.js'
import './providers/builtin-providers.js'

const INDICATOR_KEY = 'ai-spend'
/** The retired one-light-per-vendor keys. Those lights did not say
 *  `dismissable: false`, so the command line persisted them and would bring
 *  them back beside this one on reload; clearing them once evicts them from
 *  its storage for good. */
const LEGACY_PREFIX = 'ai-active:'
/** Names shown before the rest fold into "+N". The tooltip names them all. */
const NAMED = 2

export class AiKeyIndicatorDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'assistant'
  override description = 'names every AI provider whose key can spend from this device'

  protected override listens = ['indicator:query', 'indicator:activate']
  protected override emits = ['indicator:set', 'indicator:clear', 'providers:open']

  #initialized = false

  protected override heartbeat = async (): Promise<void> => {
    if (this.#initialized) return
    this.#initialized = true

    // The store already folds in cross-tab `storage` events and re-reads
    // itself, so one listener on it covers both this tab and the others.
    llmKeyStore.addEventListener('change', () => this.#sync())
    // A provider registering late (a module loaded after boot) changes a
    // NAME on the light, and a wrong name is worse than none.
    llmProviderRegistry().addEventListener('change', () => this.#sync())
    // The command line asks producers to replay when it mounts after them —
    // after it has restored whatever it persisted, which is when the retired
    // lights can be evicted.
    this.onEffect('indicator:query', () => { this.#evictLegacy(); this.#sync() })
    this.onEffect<{ key: string }>('indicator:activate', ({ key }) => {
      if (key === INDICATOR_KEY) EffectBus.emit('providers:open', { tab: 'api' })
    })

    this.#evictLegacy()
    this.#sync()
  }

  #sync(): void {
    const registry = llmProviderRegistry()
    const vendors = llmKeyStore.configured().map(id => {
      const provider = registry.get(id)
      return { text: provider?.label ?? id, tint: modelPalette(provider?.defaultModel ?? id).body }
    })
    if (vendors.length === 0) {
      EffectBus.emit('indicator:clear', { key: INDICATOR_KEY })
      return
    }

    // Folding one name into "+1" saves nothing, so fold only past NAMED + 1.
    const shown = vendors.length > NAMED + 1 ? vendors.slice(0, NAMED) : vendors
    const words: { text: string; tint?: string }[] = [...shown]
    if (shown.length < vendors.length) words.push({ text: `+${vendors.length - shown.length}` })

    const names = new Intl.ListFormat(document.documentElement.lang || undefined, { type: 'conjunction' })
      .format(vendors.map(v => v.text))
    const label = window.ioc.get<I18nProvider>(I18N_IOC_KEY)?.t('providers.spend', { names })

    EffectBus.emit('indicator:set', {
      key: INDICATOR_KEY,
      label: label && label !== 'providers.spend'
        ? label
        : `Can spend without asking: ${names}. Click to manage keys.`,
      words,
      dismissable: false,
      actionable: true,
    })
  }

  #evictLegacy(): void {
    const ids = new Set([...llmProviderRegistry().all().map(p => p.id), ...llmKeyStore.configured()])
    for (const id of ids) EffectBus.emit('indicator:clear', { key: `${LEGACY_PREFIX}${id}` })
  }
}

const _aiKey = new AiKeyIndicatorDrone()
window.ioc.register('@diamondcoreprocessor.com/AiKeyIndicatorDrone', _aiKey)
console.log('[AiKeyIndicatorDrone] Loaded')
