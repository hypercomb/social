// assistant/picture-describe.ts
//
// A PICTURE DESCRIBED FOR A MODEL THAT CANNOT SEE (jwize 2026-11-17: "Yes,
// describe them"). A picture read hands a model that sees a JPEG of the
// picture (picture-read.ts). A text-only model — the site door's DeepSeek V4
// Flash is one — got only its size and colours. Now a model that CAN see
// describes it, on the participant's own key, and the description is what the
// text-only model reads.
//
// Which model describes:
//   1. one of the participant's own lines that sees pictures (they chose it);
//   2. else a model built into the OpenRouter line itself, the lightest that
//      the catalogue says takes pictures (today google/gemini-2.5-flash-lite),
//      paid with the OpenRouter key the participant already gave.
// With neither, nothing is described and the words alone stand.
//
// Once per picture: a description is remembered by the picture's signature for
// the session, so reading the same picture again costs nothing. Nothing is stored.

import { cachedOpenRouterCatalog, fetchOpenRouterCatalog } from './providers/openrouter-catalog.js'
import { OPENROUTER_PROVIDER } from './providers/openrouter.provider.js'
import type { LlmCallResult, LlmImagePart, LlmProviderDescriptor } from './providers/llm-provider.types.js'

export const DESCRIBE_PROMPT = 'Describe this picture for someone who cannot see it and has to work with it: what it shows, '
  + 'every piece of text in it word for word, how it is laid out, and its main colours. Plain sentences, at most 150 words.'
/** A description longer than this is cut. */
export const DESCRIPTION_MAX = 1_500
const REMEMBERED_MAX = 200
const TIER_ORDER = ['fast', 'balanced', 'deep'] as const

export type PictureDescription = { readonly text: string; readonly model: string }

export interface DescribeDeps {
  /** Every provider that could answer now (keyed or local), the participant's lines among them. */
  ready(): readonly LlmProviderDescriptor[]
  /** Does the configurator's key exist? */
  hasOpenRouterKey(): boolean
  /** Catalogue: does this OpenRouter model take pictures? Undefined while unknown. */
  catalogueSees(model: string): Promise<boolean | undefined>
  call(providerId: string, model: string, image: LlmImagePart, signal?: AbortSignal): Promise<LlmCallResult>
}

const remembered = new Map<string, PictureDescription>()

/** Forget every description (a test starts clean). */
export const forgetDescriptions = (): void => { remembered.clear() }

/** The model that describes, or undefined when none can. */
export const describer = async (deps: DescribeDeps): Promise<{ providerId: string; model: string } | undefined> => {
  for (const provider of deps.ready()) {
    if (provider.configurator || provider.decisionOnly) continue
    const sees = provider.models.find(model => model.vision === true)
    if (sees) return { providerId: provider.id, model: sees.id }
  }
  if (!deps.hasOpenRouterKey()) return undefined
  const built = [...OPENROUTER_PROVIDER.models].sort((a, b) => TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier))
  for (const model of built) if (await deps.catalogueSees(model.id).catch(() => undefined) === true) return { providerId: OPENROUTER_PROVIDER.id, model: model.id }
  return undefined
}

/** A description of the picture whose bytes are `sig`, or undefined when no model can see or the call fails. Never throws. */
export const describePicture = async (
  sig: string,
  image: LlmImagePart,
  deps: DescribeDeps,
  signal?: AbortSignal,
): Promise<PictureDescription | undefined> => {
  const known = remembered.get(sig)
  if (known) return known
  try {
    const who = await describer(deps)
    if (!who || signal?.aborted) return undefined
    const answer = await deps.call(who.providerId, who.model, image, signal)
    const text = String(answer?.text ?? '').trim().slice(0, DESCRIPTION_MAX)
    if (!text) return undefined
    const said = { text, model: answer.model || who.model }
    remembered.set(sig, said)
    while (remembered.size > REMEMBERED_MAX) remembered.delete(remembered.keys().next().value as string)
    return said
  } catch { return undefined }
}

export const catalogueSees = async (model: string): Promise<boolean | undefined> => {
  const catalogue = cachedOpenRouterCatalog() ?? await fetchOpenRouterCatalog().catch(() => undefined)
  const entry = catalogue?.find(row => row.id === model)
  return entry ? entry.vision === true : undefined
}
