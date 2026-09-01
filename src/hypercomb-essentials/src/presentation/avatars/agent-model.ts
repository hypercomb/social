// presentation/avatars/agent-model.ts
//
// WHOSE MODEL IS THAT? — vendor and tier, read off a model name.
//
// A hive can have several models working at once, from several vendors, and
// "which one is that" is a question a glance should answer. So a model bee's
// look is built in three steps, each one narrowing the answer:
//
//   VENDOR  decides the colour family. Every Claude bee is clay, every GPT
//           bee is teal, every Gemini bee is sky. You learn six families once
//           and then you can read a swarm across the room.
//   TIER    shades within the family: `deep` models darkest, `fast` models
//           lightest. So opus and haiku are obviously siblings, and obviously
//           not each other.
//   MODEL   its own accent inside that shade — a few degrees of hue, its own
//           saturation, its own wing tint. This is what makes EVERY model its
//           own brand rather than one of three looks per vendor.
//
// The third step exists because the first two were not enough: a vendor with
// four models had only three appearances to give them, so `sonnet` and `fable`
// — both "balanced" — came out BYTE-IDENTICAL, and two different models flying
// over the same hive were indistinguishable. Tier alone can never separate
// same-weight siblings, and vendors keep shipping them.
//
// The accent is deliberately the SMALLEST of the three effects. It is derived
// from the model's own name (so it is stable forever and needs no catalog) and
// bounded so it can never carry a model out of its family or across a tier:
// hue moves less than the closest two vendors are apart, and the lightness
// nudge is a fraction of a tier step. A spec brute-forces both properties over
// the whole catalog — the bounds are the contract, not a hope.
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

// ── the name it wears ─────────────────────────────────────────────────

/** Words that say WHOSE a model is rather than WHICH one it is. A bee already
 *  wears its vendor as a colour family, so repeating it in the livery spends
 *  the belly's few letters on the thing you can already see. */
const VENDOR_WORDS = new Set([
  'claude', 'anthropic', 'openai', 'google', 'meta', 'mistralai',
  'ollama', 'lmstudio', 'llamacpp', 'local', 'xai', 'ai', 'models', 'chat',
])

/** Room for the name on a bee's abdomen, in characters. Past this a name stops
 *  being read and starts being a smudge; the hover still carries it in full. */
const TOKEN_MAX = 8

const isWord = (segment: string): boolean => /[a-z]/.test(segment)

/**
 * THE NAME A BEE WEARS — a model name reduced to what fits on a belly.
 *
 * `claude-opus-4-5` → `opus`, `gemini-2.5-flash` → `gemflash`, `grok-2` →
 * `grok2`. Three things in order: drop the vendor (the colour said it), drop
 * the version numbers only when they cost letters that matter, and when even
 * that is too long, keep the FIRST word's opening and the LAST word whole —
 * the last word is nearly always the one that separates siblings (`flash`,
 * `mini`, `pro`), so it is the last thing that may be cut.
 *
 * Deterministic and catalog-free: a model nobody has heard of still gets a
 * stable token, which is the whole point — the livery must never depend on
 * someone having added the model here first.
 */
export const brandToken = (name: string): string => {
  const segments = String(name ?? '').trim().toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
  if (!segments.length) return ''

  let kept = segments.length > 1 ? segments.filter(s => !VENDOR_WORDS.has(s)) : segments
  if (!kept.length) kept = segments
  // A version left stranded at the front by the dropped vendor (`claude-3-5-
  // sonnet`) names nothing on its own.
  while (kept.length > 1 && !isWord(kept[0])) kept.shift()

  if (kept.join('').length <= TOKEN_MAX) return kept.join('')

  const words = kept.filter(isWord)
  if (words.length && words.join('').length <= TOKEN_MAX) return words.join('')

  const parts = words.length ? words : kept
  if (parts.length < 2) return parts.join('').slice(0, TOKEN_MAX)
  const last = parts[parts.length - 1]
  const head = parts[0].slice(0, Math.max(3, TOKEN_MAX - last.length))
  return (head + last).slice(0, TOKEN_MAX)
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

/** The inverse of `hsl` — a family colour is authored as a hex, but a model's
 *  accent has to move within it, and hue/saturation/lightness is the only
 *  space where "a few degrees off, same family" is expressible. */
const toHsl = (value: string): [number, number, number] => {
  const [r, g, b] = hex(value).map(v => v / 255)
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return [((h * 60) % 360 + 360) % 360, s, l]
}

const clamp = (value: number, low: number, high: number): number => Math.min(high, Math.max(low, value))

/** Avalanche (murmur3's finalizer). DJB2 alone is not good enough HERE: it
 *  moves by the size of the edit, so `o1` and `o3` hash two apart and every
 *  accent derived from them rounds to the same byte — the two models come out
 *  identical, which is the exact failure the accent exists to prevent. Model
 *  names differ by a character all the time (`grok-2`/`grok-4`,
 *  `gemini-1.5`/`gemini-2.5`), so one bit of input has to change every bit of
 *  output. */
const mix32 = (value: number): number => {
  let h = value | 0
  h ^= h >>> 16
  h = Math.imul(h, 0x85ebca6b)
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35)
  h ^= h >>> 16
  return h >>> 0
}

/** A model's own signature, as four independent numbers in -1..1 derived from
 *  its name. Independent matters: slicing one hash into four fields ties hue to
 *  saturation, so most of the possible looks could never occur — each axis gets
 *  its own salted mix instead. */
const accentOf = (model: string): { hue: number; sat: number; light: number; wing: number } => {
  const seed = hash(model)
  const spread = (salt: number): number => (mix32(seed ^ salt) % 2048) / 2047 * 2 - 1
  return { hue: spread(0x9e3779b9), sat: spread(0x85ebca6b), light: spread(0xc2b2ae35), wing: spread(0x27d4eb2f) }
}

/** How far a model may wander from its family, per axis.
 *
 *  HUE is the tight one: the two closest vendor hues are ~23° apart, so a
 *  budget of ±4° leaves ~15° between the nearest two families in the worst
 *  case — still further apart than any two siblings can be from each other.
 *  LIGHT is bounded well inside one tier step (0.11 and 0.13) so an accent can
 *  never make a deep model read as balanced. WING is the loud one, because a
 *  wing carries no family meaning — it is the largest area on the bee and the
 *  cheapest place to spend distinctness. */
const ACCENT = { hue: 4, sat: 0.13, light: 0.028, wing: 42 } as const

/**
 * The palette for a model: its vendor's family, shaded by tier. Deep models
 * are darker and heavier, fast models lighter and airier — the same read you
 * get from the names.
 */
export const modelPalette = (name: string): ModelPalette => {
  const { vendor, tier, model } = identifyModel(name)
  const [familyHue, familySat, familyLight] = toHsl(vendorBody(vendor))
  const accent = accentOf(model)

  // Tier first and largest — it is the thing being READ, and an accent must
  // never be able to argue with it.
  const tierLight = tier === 'deep' ? -0.11 : tier === 'fast' ? 0.13 : 0

  const hue = (familyHue + accent.hue * ACCENT.hue + 360) % 360
  const sat = clamp(familySat + accent.sat * ACCENT.sat, 0.32, 0.95)
  const light = clamp(familyLight + tierLight + accent.light * ACCENT.light, 0.2, 0.78)
  const body = hsl(hue, sat, light)

  // The wing is the model's loudest signature: its own hue, and mixed far
  // enough toward white that it stays the lightest thing on the bee whatever
  // that hue costs in luminance. (Rotating a hue changes brightness a lot —
  // pure yellow and pure blue at one lightness are nowhere near each other —
  // so the white mix is what keeps "wings read as wings" true by construction
  // rather than by luck.)
  const wingHue = (hue + accent.wing * ACCENT.wing + 360) % 360
  return {
    body,
    stripe: mix(body, '#000000', 0.78),
    head: mix(body, '#000000', 0.24),
    wing: mix(hsl(wingHue, clamp(sat, 0.35, 0.7), clamp(light + 0.06, 0.4, 0.8)), '#ffffff', 0.78),
  }
}

/** Every vendor this file knows by name — for docs, settings, and tests. */
export const KNOWN_VENDORS: readonly string[] = Object.keys(VENDOR_BODY)
