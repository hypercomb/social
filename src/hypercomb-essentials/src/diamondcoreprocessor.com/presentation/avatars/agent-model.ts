// diamondcoreprocessor.com/presentation/avatars/agent-model.ts
//
// WHOSE MODEL IS THAT? — vendor and tier, read off a model name.
//
// A hive can have several models working at once, from several vendors, and
// "which one is that" is a question a glance should answer. So a model bee's
// look is built in two steps:
//
//   VENDOR  decides the colour family. Every Claude bee is clay, every GPT
//           bee is teal, every Gemini bee is sky. You learn six families once
//           and then you can read a swarm across the room.
//   TIER    shades within the family: `deep` models darkest, `fast` models
//           lightest. So opus and haiku are obviously siblings, and obviously
//           not each other.
//
// Pure data and string matching — no Pixi, no DOM, no IoC. The agent registry
// needs this to classify an agent, and the registry must never drag the
// renderer in behind it.
//
// A model this file has never heard of is NOT a failure: it gets vendor
// `unknown` and a hue derived from its own name, which is stable, distinct,
// and good enough until someone adds it here. Nothing breaks when a new model
// ships — it just does not get a family until it is named.

/** How heavy a model is, within its vendor's line-up. */
export type ModelTier = 'deep' | 'balanced' | 'fast'

export interface ModelIdentity {
  /** Lower-case vendor key — `anthropic`, `openai`, …, or `unknown`. */
  readonly vendor: string
  /** The name as given, lower-cased. */
  readonly model: string
  readonly tier: ModelTier
}

/** The four colours a bee is drawn in. Mirrors BeePalette in bee-ab-atlas,
 *  redeclared here so this module stays free of the renderer. */
export interface ModelPalette {
  readonly body: string
  readonly stripe: string
  readonly head: string
  readonly wing: string
}

/**
 * Vendor families. `body` is the balanced tier; deep and fast are derived from
 * it by shading, so adding a vendor is one line, not three palettes.
 *
 * These are recognisable colours, not official brand assets — the point is
 * that two vendors never look like each other on a hex grid.
 */
const VENDOR_BODY: Record<string, string> = {
  anthropic: '#d97757', // clay
  mistral:   '#e8a020', // amber
  local:     '#6a9b4f', // moss — something running on your own machine
  openai:    '#2f9e83', // teal
  google:    '#4a90d9', // sky
  meta:      '#5a5ad6', // indigo
  deepseek:  '#9a5ad6', // violet
  xai:       '#c451a8', // magenta
}
// Assigned so no two families share a hue, NOT an attempt at anyone's brand
// assets. The first version gave xAI a slate grey, which is closer to their
// actual look — and sat within 2° of Google's sky, so two vendors' bees were
// telling you the same thing. The whole point of a family colour is that it
// cannot be confused for another one; a spec enforces the separation.

/** Name patterns, most specific first. A model name is matched against these
 *  in order, so `claude-3-5-haiku` finds anthropic before anything else can
 *  claim it on a loose substring. */
const VENDOR_PATTERNS: ReadonlyArray<{ vendor: string; test: RegExp }> = [
  { vendor: 'anthropic', test: /(^|[^a-z])(claude|opus|sonnet|haiku|fable)([^a-z]|$)/ },
  { vendor: 'openai',    test: /(^|[^a-z])(gpt|chatgpt|codex|davinci|o[1-9])([^a-z0-9]|$|[0-9])/ },
  { vendor: 'google',    test: /(^|[^a-z])(gemini|gemma|palm|bard)([^a-z]|$)/ },
  { vendor: 'meta',      test: /(^|[^a-z])(llama|codellama)([^a-z]|$)/ },
  { vendor: 'mistral',   test: /(^|[^a-z])(mistral|mixtral|codestral|magistral)([^a-z]|$)/ },
  { vendor: 'xai',       test: /(^|[^a-z])grok([^a-z]|$)/ },
  { vendor: 'deepseek',  test: /(^|[^a-z])deepseek([^a-z]|$)/ },
  { vendor: 'local',     test: /^(ollama|local|lmstudio|llamacpp)[:/-]/ },
]

/** Tier by name. Vendors label weight differently, so this is a vocabulary of
 *  the words they actually use rather than a rule. */
const TIER_PATTERNS: ReadonlyArray<{ tier: ModelTier; test: RegExp }> = [
  { tier: 'deep', test: /(opus|ultra|max|pro\b|large|405b|70b|o[1-9]\b|reasoner|thinking)/ },
  { tier: 'fast', test: /(haiku|mini|nano|flash|lite|small|tiny|instant|8b|7b|turbo)/ },
  { tier: 'balanced', test: /(sonnet|fable|medium|flash-thinking|4o|standard)/ },
]

/** The bare slash-command names that ARE a model ask in this hive. Kept as a
 *  list because the command line offers exactly these. */
export const MODEL_BEHAVIORS: readonly string[] = ['opus', 'sonnet', 'haiku', 'fable']

/** Does this name look like a model rather than a behaviour? */
export const isModelName = (name: string): boolean => {
  const key = String(name ?? '').trim().toLowerCase()
  if (!key) return false
  if (MODEL_BEHAVIORS.includes(key)) return true
  return VENDOR_PATTERNS.some(p => p.test.test(key))
}

/** Vendor + tier for a model name. Never null: an unrecognised name is
 *  `unknown`/`balanced`, which still yields a stable distinct look. */
export const identifyModel = (name: string): ModelIdentity => {
  const model = String(name ?? '').trim().toLowerCase()
  const vendor = VENDOR_PATTERNS.find(p => p.test.test(model))?.vendor ?? 'unknown'
  const tier = TIER_PATTERNS.find(p => p.test.test(model))?.tier ?? 'balanced'
  return { vendor, model, tier }
}

// ── colour ────────────────────────────────────────────────────────────

const hex = (value: string): [number, number, number] => {
  const h = value.replace('#', '')
  const n = Number.parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

const rgb = (c: readonly number[]): string =>
  '#' + c.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')

const mix = (value: string, target: string, amount: number): string => {
  const a = hex(value)
  const b = hex(target)
  return rgb([0, 1, 2].map(i => a[i] + (b[i] - a[i]) * amount))
}

/** DJB2 — the same hash the derived behaviour palettes use. */
const hash = (value: string): number => {
  let h = 5381
  for (let i = 0; i < value.length; i++) h = ((h << 5) + h + value.charCodeAt(i)) | 0
  return h >>> 0
}

const hsl = (h: number, s: number, l: number): string => {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  const sector = Math.floor(h / 60) % 6
  const [r, g, b] =
    sector === 0 ? [c, x, 0] :
    sector === 1 ? [x, c, 0] :
    sector === 2 ? [0, c, x] :
    sector === 3 ? [0, x, c] :
    sector === 4 ? [x, 0, c] : [c, 0, x]
  return rgb([r + m, g + m, b + m].map(v => v * 255))
}

/** A vendor with no entry still gets a stable family, derived from its name on
 *  the golden angle so it lands clear of the named ones. */
const vendorBody = (vendor: string): string =>
  VENDOR_BODY[vendor] ?? hsl((hash(vendor) * 137.508) % 360, 0.6, 0.55)

/**
 * The palette for a model: its vendor's family, shaded by tier. Deep models
 * are darker and heavier, fast models lighter and airier — the same read you
 * get from the names.
 */
export const modelPalette = (name: string): ModelPalette => {
  const { vendor, tier } = identifyModel(name)
  const base = vendorBody(vendor)
  const body = tier === 'deep' ? mix(base, '#000000', 0.22)
    : tier === 'fast' ? mix(base, '#ffffff', 0.3)
    : base
  return {
    body,
    stripe: mix(body, '#000000', 0.78),
    head: mix(body, '#000000', 0.24),
    wing: mix(body, '#ffffff', 0.72),
  }
}

/** Every vendor this file knows by name — for docs, settings, and tests. */
export const KNOWN_VENDORS: readonly string[] = Object.keys(VENDOR_BODY)
