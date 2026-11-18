// assistant/providers/openrouter-stages.ts
//
// PRICE STAGES — like the stops of a gradient (Jaime, 2026-09-13: "choose
// different cap stages … have different models for different levels"). One
// scale of price per million tokens, three stops. A model priced up to
// the first stop does fast work, up to the second balanced work, up to the
// third deep work. Above the last stop it is left out: not offered in the
// search and never picked. Device-local.
//
// THE PRICE RANGE (jwize, 2026-11-18: "we need to be able to set the range …
// for token cost, total or in and out … that way can check the hive with a
// higher tier model and compare the difference"). The last stop is the
// range's ceiling, and the range adds what the stops could not say:
//   • a FLOOR — a model priced below it is left out too;
//   • a BASIS — the scale measures OUTPUT price with its own INPUT range
//     beside it ("in and out"), or input + output as one number ("total");
//   • NO CEILING — the last stop dragged or typed to the end of the scale
//     lets every price through, so the strongest models can be asked.
// The ceiling stays the last stop (one value, two ways to set it), so a
// participant who never opens the range sees exactly what they saw before.
//
// A model added through OpenRouter takes the ONE tier its price falls in
// (openrouter-instances.ts), so the mediator's exact-tier rule sends each
// level of work to the models of that stage, and its fit tiebreak chooses
// within the stage. A model with no published price keeps every tier.

import type { LlmTier } from './llm-provider.types.js'

export type PriceStages = { readonly fast: number; readonly balanced: number; readonly deep: number }

/** What the scale measures: output price beside an input range, or both summed. */
export type PriceBasis = 'split' | 'total'

/** The rest of the range. The ceiling is the deep stop. `inputMax` Infinity = no limit. */
export type PriceRange = {
  readonly basis: PriceBasis
  /** Below this the measured price is left out; 0 = no floor. */
  readonly floor: number
  /** "In and out" only: the input price must sit inside [inputMin, inputMax]. */
  readonly inputMin: number
  readonly inputMax: number
}

/** A model's published prices, dollars per million tokens. */
export type ModelPrices = { readonly input?: number; readonly output?: number }

/** The ends of the scale, dollars per million tokens. The top is high enough
 *  for the strongest models' total price; a ceiling AT it means no ceiling. */
export const STAGE_MIN = 0.01
export const STAGE_MAX = 200

/** Near DeepSeek V4 Flash ($0.08): quick work at that price, up to about
 *  double and triple for heavier work. */
export const DEFAULT_STAGES: PriceStages = Object.freeze({ fast: 0.1, balanced: 0.2, deep: 0.3 })

export const DEFAULT_RANGE: PriceRange = Object.freeze({ basis: 'split', floor: 0, inputMin: 0, inputMax: Number.POSITIVE_INFINITY })

const STORAGE_KEY = 'hc:llm:openrouter:stages'
const RANGE_KEY = 'hc:llm:openrouter:range'
const clampPrice = (n: number): number => Math.min(STAGE_MAX, Math.max(STAGE_MIN, n))
const tidy = (n: number): number => Number(clampPrice(n).toPrecision(3))
const tidyLoose = (n: number): number => Number(n.toPrecision(3))
/** The one write both stores share: device-local, session-only where storage is refused. */
const save = (key: string, value: unknown): void => {
  try { globalThis.localStorage?.setItem(key, JSON.stringify(value)) } catch { /* session-only */ }
}

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
    save(STORAGE_KEY, { fast, balanced, deep })
    this.dispatchEvent(new CustomEvent('change'))
  }

  /** THE CEILING, typed: the deep stop moves, and a stop above it comes down
   *  with it, so typing a low ceiling never reorders the stages. Undefined or
   *  the end of the scale = no ceiling. */
  setCeiling(value: number | undefined): void {
    const ceiling = value === undefined || !Number.isFinite(value) ? STAGE_MAX : tidy(value)
    const current = this.get()
    this.set({ fast: Math.min(current.fast, ceiling), balanced: Math.min(current.balanced, ceiling), deep: ceiling })
  }
}

export const openRouterStages = new OpenRouterStagesStore()

export class OpenRouterRangeStore extends EventTarget {
  get(): PriceRange {
    try {
      const raw = JSON.parse(globalThis.localStorage?.getItem(RANGE_KEY) ?? 'null') as Record<string, unknown> | null
      if (!raw || typeof raw !== 'object') return DEFAULT_RANGE
      const price = (value: unknown, fallback: number): number =>
        typeof value === 'number' && Number.isFinite(value) && value >= 0 ? tidyLoose(value) : fallback
      const inputMin = price(raw.inputMin, 0)
      return {
        basis: raw.basis === 'total' ? 'total' : 'split',
        floor: price(raw.floor, 0),
        inputMin,
        inputMax: Math.max(inputMin, price(raw.inputMax, Number.POSITIVE_INFINITY)),
      }
    } catch { return DEFAULT_RANGE }
  }

  set(next: Partial<PriceRange>): void {
    const current = this.get()
    const merged = { ...current, ...next }
    const inputMin = Math.max(0, merged.inputMin)
    const value: PriceRange = {
      basis: merged.basis === 'total' ? 'total' : 'split',
      floor: Math.max(0, merged.floor),
      inputMin,
      inputMax: Math.max(inputMin, merged.inputMax),
    }
    if (value.basis === current.basis && value.floor === current.floor
      && value.inputMin === current.inputMin && value.inputMax === current.inputMax) return
    // JSON has no Infinity: no input limit is stored as null.
    const stored = { ...value, inputMax: Number.isFinite(value.inputMax) ? value.inputMax : null }
    save(RANGE_KEY, stored)
    this.dispatchEvent(new CustomEvent('change'))
  }
}

export const openRouterRange = new OpenRouterRangeStore()

/** True when the ceiling is the end of the scale: every price gets through. */
export const noCeiling = (stages: PriceStages = openRouterStages.get()): boolean => stages.deep >= STAGE_MAX

/** The stage a price falls in; `over` above the last stop; undefined when unpublished. */
export const stageFor = (
  price: number | undefined,
  stages: PriceStages = openRouterStages.get(),
): LlmTier | 'over' | undefined => {
  if (price === undefined || !Number.isFinite(price)) return undefined
  if (price <= stages.fast) return 'fast'
  if (price <= stages.balanced) return 'balanced'
  if (price <= stages.deep || noCeiling(stages)) return 'deep'
  return 'over'
}

/** The one number the scale measures for a model: output price, or input +
 *  output under the total basis. Undefined when the output is unpublished. */
export const measuredPrice = (prices: ModelPrices, range: PriceRange = openRouterRange.get()): number | undefined => {
  const { input, output } = prices
  if (output === undefined || !Number.isFinite(output)) return undefined
  return range.basis === 'total' ? output + (input !== undefined && Number.isFinite(input) ? input : 0) : output
}

/** Where a model sits: its stage, `under` below the floor (or the input
 *  range), `over` above the ceiling (or the input range), undefined when it
 *  has no published price and cannot be placed. */
export const placeModel = (
  prices: ModelPrices,
  stages: PriceStages = openRouterStages.get(),
  range: PriceRange = openRouterRange.get(),
): LlmTier | 'over' | 'under' | undefined => {
  const price = measuredPrice(prices, range)
  if (price === undefined) return undefined
  const input = prices.input
  if (range.basis === 'split' && input !== undefined && Number.isFinite(input)) {
    if (input < range.inputMin) return 'under'
    if (input > range.inputMax) return 'over'
  }
  if (price < range.floor) return 'under'
  return stageFor(price, stages)
}

/** Outside the range either way: left out of the search, never picked. */
export const outsideRange = (placed: ReturnType<typeof placeModel>): boolean => placed === 'over' || placed === 'under'

/** Where a price sits on the track, 0…1. Logarithmic, so cents and dollars both have room. */
export const stagePosition = (price: number): number =>
  (Math.log(clampPrice(price)) - Math.log(STAGE_MIN)) / (Math.log(STAGE_MAX) - Math.log(STAGE_MIN))

/** The price at a point on the track, 0…1, to three significant figures. */
export const stagePrice = (position: number): number =>
  tidy(Math.exp(Math.log(STAGE_MIN) + Math.min(1, Math.max(0, position)) * (Math.log(STAGE_MAX) - Math.log(STAGE_MIN))))
