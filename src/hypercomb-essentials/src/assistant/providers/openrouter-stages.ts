// assistant/providers/openrouter-stages.ts
//
// PRICE STAGES — like the stops of a gradient (Jaime, 2026-09-13: "choose
// different cap stages … have different models for different levels"). One
// scale of OUTPUT price per million tokens, three stops. A model priced up to
// the first stop does fast work, up to the second balanced work, up to the
// third deep work. Above the last stop it is left out: not offered in the
// search and never picked. Device-local.
//
// A model added through OpenRouter takes the ONE tier its price falls in
// (openrouter-instances.ts), so the mediator's exact-tier rule sends each
// level of work to the models of that stage, and its fit tiebreak chooses
// within the stage. A model with no published price keeps every tier.

import type { LlmTier } from './llm-provider.types.js'

export type PriceStages = { readonly fast: number; readonly balanced: number; readonly deep: number }

/** The ends of the scale, dollars per million output tokens. */
export const STAGE_MIN = 0.01
export const STAGE_MAX = 20

/** Near DeepSeek V4 Flash ($0.08): quick work at that price, up to about
 *  double and triple for heavier work. */
export const DEFAULT_STAGES: PriceStages = Object.freeze({ fast: 0.1, balanced: 0.2, deep: 0.3 })

const STORAGE_KEY = 'hc:llm:openrouter:stages'
const clampPrice = (n: number): number => Math.min(STAGE_MAX, Math.max(STAGE_MIN, n))
const tidy = (n: number): number => Number(clampPrice(n).toPrecision(3))

export class OpenRouterStagesStore extends EventTarget {
  get(): PriceStages {
    try {
      const raw = JSON.parse(globalThis.localStorage?.getItem(STORAGE_KEY) ?? 'null') as Partial<Record<keyof PriceStages, unknown>> | null
      const read = (value: unknown, fallback: number): number =>
        typeof value === 'number' && Number.isFinite(value) && value > 0 ? tidy(value) : fallback
      if (!raw || typeof raw !== 'object') return DEFAULT_STAGES
      const [fast, balanced, deep] = [
        read(raw.fast, DEFAULT_STAGES.fast), read(raw.balanced, DEFAULT_STAGES.balanced), read(raw.deep, DEFAULT_STAGES.deep),
      ].sort((a, b) => a - b)
      return { fast, balanced, deep }
    } catch { return DEFAULT_STAGES }
  }

  /** Stops never cross: the values are kept in order, inside the scale. */
  set(next: PriceStages): void {
    const [fast, balanced, deep] = [next.fast, next.balanced, next.deep].map(tidy).sort((a, b) => a - b)
    const current = this.get()
    if (current.fast === fast && current.balanced === balanced && current.deep === deep) return
    try { globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify({ fast, balanced, deep })) } catch { /* session-only */ }
    this.dispatchEvent(new CustomEvent('change'))
  }
}

export const openRouterStages = new OpenRouterStagesStore()

/** The stage a price falls in; `over` above the last stop; undefined when unpublished. */
export const stageFor = (
  outputPerMillion: number | undefined,
  stages: PriceStages = openRouterStages.get(),
): LlmTier | 'over' | undefined => {
  if (outputPerMillion === undefined || !Number.isFinite(outputPerMillion)) return undefined
  if (outputPerMillion <= stages.fast) return 'fast'
  if (outputPerMillion <= stages.balanced) return 'balanced'
  if (outputPerMillion <= stages.deep) return 'deep'
  return 'over'
}

/** Where a price sits on the track, 0…1. Logarithmic, so cents and dollars both have room. */
export const stagePosition = (price: number): number =>
  (Math.log(clampPrice(price)) - Math.log(STAGE_MIN)) / (Math.log(STAGE_MAX) - Math.log(STAGE_MIN))

/** The price at a point on the track, 0…1, to three significant figures. */
export const stagePrice = (position: number): number =>
  tidy(Math.exp(Math.log(STAGE_MIN) + Math.min(1, Math.max(0, position)) * (Math.log(STAGE_MAX) - Math.log(STAGE_MIN))))
