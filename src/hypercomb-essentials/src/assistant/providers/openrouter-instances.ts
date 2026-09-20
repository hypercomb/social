// assistant/providers/openrouter-instances.ts
//
// EVERY MODEL ADDED THROUGH OPENROUTER IS ITS OWN PROVIDER (Jaime, 2026-09-13:
// "you should be able to add as many OpenRouter instances as you like, not
// just one"). OpenRouter is the configurator — its key, its search. Each model
// added there becomes a registered provider of its own, named by its exact
// catalogue name, offering every tier with that one model, and paying with
// OpenRouter's key, grant and budget (`credentialsFrom`). All of them are
// usable at once: the mediator ranks them, and a participant can pin one per
// tier. Remove the model line and its provider goes with it.
//
// The saved lines (`llm-model-choice.ts`) are the truth; this keeps the
// registry in step with them, and re-labels when the catalogue arrives.

import { llmModelChoice } from '../llm-model-choice.js'
import { llmProviderRegistry } from '../llm-provider-registry.js'
import type { LlmProviderDescriptor, LlmTier } from './llm-provider.types.js'
import { cachedOpenRouterCatalog, openRouterCatalogEvents } from './openrouter-catalog.js'
import { openRouterStages, stageFor } from './openrouter-stages.js'
import { OPENROUTER_PROVIDER } from './openrouter.provider.js'
import { JEV_ENDPOINT, JEV_MODEL } from '../jev-decision.js'

const PREFIX = `${OPENROUTER_PROVIDER.id}:`

export const instanceId = (modelId: string): string => `${PREFIX}${String(modelId ?? '').trim().toLowerCase()}`

export const isOpenRouterInstance = (providerId: string): boolean =>
  String(providerId ?? '').trim().toLowerCase().startsWith(PREFIX)

/** The exact catalogue name ("Claude Sonnet 4.5"), else the id's last part. */
const labelFor = (modelId: string): string => {
  const entry = cachedOpenRouterCatalog()?.find(e => e.id === modelId)
  if (entry) return entry.name.includes(': ') ? entry.name.slice(entry.name.indexOf(': ') + 2) : entry.name
  return modelId.replace(/^~/, '').split('/').pop() || modelId
}

/** Price and window from the catalogue, once it has been fetched — what the
 *  mediator's fit tiebreak reads. */
const metaFor = (modelId: string): { inputPerMillion?: number; outputPerMillion?: number; contextLength?: number } => {
  const entry = cachedOpenRouterCatalog()?.find(e => e.id === modelId)
  if (!entry) return {}
  const perMillion = (raw?: string): number | undefined => {
    const n = Number(raw)
    return raw !== undefined && Number.isFinite(n) && n >= 0 ? n * 1_000_000 : undefined
  }
  const input = perMillion(entry.promptPrice)
  const output = perMillion(entry.completionPrice)
  return {
    ...(input !== undefined ? { inputPerMillion: input } : {}),
    ...(output !== undefined ? { outputPerMillion: output } : {}),
    ...(entry.contextLength ? { contextLength: entry.contextLength } : {}),
  }
}

const tiersFor = (modelId: string): readonly LlmTier[] => {
  const stage = stageFor(metaFor(modelId).outputPerMillion)
  return stage && stage !== 'over' ? [stage] : ['fast', 'balanced', 'deep']
}

/** Priced above the last stop: left out, never registered, never picked. */
export const aboveStages = (modelId: string): boolean => stageFor(metaFor(modelId).outputPerMillion) === 'over'

export const openRouterInstance = (modelId: string): LlmProviderDescriptor => {
  const { configurator: _configurator, ...base } = OPENROUTER_PROVIDER
  return {
    ...base,
    ...(modelId === JEV_MODEL ? {
      decisionOnly: true,
      endpoint: JEV_ENDPOINT,
      description: 'Evaluates proposed directions against your request, Hypercomb values, and evidence.',
    } : {}),
    id: instanceId(modelId),
    label: labelFor(modelId),
    credentialsFrom: OPENROUTER_PROVIDER.id,
    // One model, every weight: whichever tier the work asks for, this
    // provider answers with the model the participant chose.
    // THE STAGE ITS PRICE FALLS IN (openrouter-stages.ts) is the one tier it
    // offers, so each level of work goes to the models of that stage. With no
    // published price it cannot be placed, and offers every tier.
    models: tiersFor(modelId).map(tier => ({ name: modelId, id: modelId, tier, ...metaFor(modelId) })),
    defaultModel: modelId,
  }
}

export const syncOpenRouterInstances = (): void => {
  const registry = llmProviderRegistry()
  const wanted = new Map(llmModelChoice.saved(OPENROUTER_PROVIDER.id)
    .filter(model => !aboveStages(model))
    .map(model => [instanceId(model), model] as const))
  for (const provider of registry.all()) {
    if (isOpenRouterInstance(provider.id) && !wanted.has(provider.id)) registry.unregister(provider.id)
  }
  for (const [id, model] of wanted) {
    const next = openRouterInstance(model)
    const existing = registry.get(id)
    if (existing && existing.label === next.label && existing.decisionOnly === next.decisionOnly && JSON.stringify(existing.models) === JSON.stringify(next.models)) continue
    if (existing) registry.unregister(id)
    registry.register(next)
  }
}

llmModelChoice.addEventListener('change', syncOpenRouterInstances)
openRouterCatalogEvents.addEventListener('loaded', syncOpenRouterInstances)
openRouterStages.addEventListener('change', syncOpenRouterInstances)
syncOpenRouterInstances()
