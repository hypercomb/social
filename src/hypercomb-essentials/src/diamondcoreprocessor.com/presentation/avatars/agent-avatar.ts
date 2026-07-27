// diamondcoreprocessor.com/presentation/avatars/agent-avatar.ts
//
// AGENT AVATARS — which bee you see for which behaviour.
//
// Every behaviour has its own avatar type. You can decorate it (pick the
// colours, or hand it a baked image of your own), but you never have to: an
// undeclared behaviour still gets a distinct-looking bee, derived from its
// name, so a hive with five things running shows five recognisably different
// bees without anyone authoring anything.
//
// Resolution order for a behaviour's avatar, most specific first:
//
//   1. PARTICIPANT OVERRIDE — `hc:behavior-avatars` in localStorage, keyed by
//      the behaviour's stable `view` name. This is the "decorate it yourself"
//      lane, and it always wins.
//   2. DECLARED — `avatar` on the behaviour's VisualBeeDescriptor. Declared,
//      never seeded (same doctrine as `pheromones`): re-asserted on every
//      module load, never written to storage, so a module update can't clobber
//      a participant's choice and there is no stale default to migrate.
//   3. DERIVED — a deterministic palette from the behaviour name. The default.
//
// The drawing itself is always AB (see bee-ab-atlas.ts) — one loved shape,
// recoloured. An avatar that wants to be a different creature entirely sets
// `imageSig`, and the bee renders that resource instead.

import { Rectangle, Texture } from 'pixi.js'
import { AB_PALETTE, bakeBeeAtlas, beeImageUrl, type BeeEmblem, type BeePalette } from './bee-ab-atlas.js'
import type { AgentKind } from './agent-waggle.js'
import { identifyModel, isModelName, modelPalette } from './agent-model.js'

/** What a behaviour's avatar IS. Every field optional — an empty spec is a
 *  legitimate "just derive it from my name". */
export interface AgentAvatarSpec {
  /** Striped abdomen base, `#rrggbb`. */
  readonly body?: string
  /** Stripes + outlines. */
  readonly stripe?: string
  /** Head + thorax fur. */
  readonly head?: string
  /** Wing tint. */
  readonly wing?: string
  /** A resource signature of an image to fly INSTEAD of the bee drawing.
   *  Signature doctrine: the bytes live once at the content root; the avatar
   *  holds the pointer. */
  readonly imageSig?: string
  /** The mark on the bee's back. Left unset, it comes from the agent's KIND —
   *  a model wears the burst, a script the gear — so a behaviour only sets
   *  this when it wants to be read as something other than what it is. */
  readonly emblem?: BeeEmblem
}

/** What each KIND of worker wears when nobody says otherwise. This is the
 *  "you can see what it is without reading anything" layer: colour tells you
 *  WHICH behaviour, the mark tells you WHAT SORT of thing it is. */
const KIND_EMBLEM: Record<AgentKind, BeeEmblem> = {
  model: 'burst',
  script: 'gear',
  system: 'ring',
  orchestrator: 'eye',
}

/**
 * MODEL BRANDS — a model gets its VENDOR's family look rather than a
 * name-derived one, because "whose model is that, and how heavy" is something
 * people read across a room: every Claude bee clay, every GPT bee teal, every
 * Gemini bee sky, and within a family the deep models darker than the fast
 * ones. See agent-model.ts for the catalog.
 *
 * A brand is still only a DEFAULT: a participant override outranks it, exactly
 * like every other avatar. It sits between a behaviour's own declaration and
 * the name-derived fallback.
 */
const brandFor = (behavior: string): AgentAvatarSpec | undefined =>
  isModelName(behavior) ? modelPalette(behavior) : undefined

/** localStorage key for participant overrides — mirrors BEHAVIOR_PHEROMONES_KEY. */
export const BEHAVIOR_AVATARS_KEY = 'hc:behavior-avatars'

/** Which name an agent's avatar is resolved under. For a model that is the
 *  MODEL, not the behaviour that invoked it: a routine calling GPT should fly
 *  a GPT bee, not a bee named after the routine. Everything else is its own
 *  behaviour. */
export const avatarKeyOf = (agent: { behavior: string; model?: string; kind?: string }): string =>
  (agent.kind === 'model' && agent.model) ? agent.model : agent.behavior

const FRAMES = 8
const CELL_PX = 96

type VisualBeeLike = { get?: (view: string) => { avatar?: AgentAvatarSpec } | undefined }
type StoreLike = { getResource?: (sig: string) => Promise<Blob | null> }

const ioc = <T,>(key: string): T | undefined =>
  (window as unknown as { ioc?: { get?: (k: string) => unknown } }).ioc?.get?.(key) as T | undefined

/** DJB2 — the same hash the peer-avatar colours use, so behaviour hues spread
 *  the way peer hues do. */
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
  return '#' + [r, g, b]
    .map(v => Math.round((v + m) * 255).toString(16).padStart(2, '0'))
    .join('')
}

/** The palette a behaviour gets when nobody has said anything about it: one
 *  hue per name, warm bodies, dark stripes, a complementary wing. */
const derivedPalette = (behavior: string): BeePalette => {
  if (!behavior) return AB_PALETTE
  // Golden-angle spread rather than a plain modulo: short similar names
  // (`haiku`, `sync`, `website`) land within a few degrees of each other under
  // `hash % 360`, and a hive full of near-identical green bees defeats the
  // whole point. Multiplying by 137.508° pushes neighbouring hashes apart.
  const hue = (hash(behavior) * 137.508) % 360
  return {
    body: hsl(hue, 0.74, 0.56),
    stripe: hsl(hue, 0.5, 0.12),
    head: hsl(hue, 0.44, 0.45),
    wing: hsl((hue + 165) % 360, 0.5, 0.8),
  }
}

export class AgentAvatarRegistry extends EventTarget {
  /** Baked flap frames per palette key — an atlas costs 8 SVG rasterizations,
   *  so behaviours that resolve to the same colours share one bake. */
  readonly #frames = new Map<string, Promise<Texture[] | null>>()
  /** Custom-image textures per resource sig. */
  readonly #images = new Map<string, Promise<Texture | null>>()

  /** The effective spec for a behaviour — override, then the behaviour's own
   *  declaration, then the model brand. An empty object means "derive it". */
  spec(behavior: string): AgentAvatarSpec {
    const override = this.#overrides()[behavior]
    if (override) return override
    const declared = ioc<VisualBeeLike>('@diamondcoreprocessor.com/VisualBeeRegistry')?.get?.(behavior)?.avatar
    return declared ?? brandFor(behavior) ?? {}
  }

  /** Whose model this is and how heavy — `null` when the behaviour is not a
   *  model at all. Surfaces in the panel and the hover, so "which vendor is
   *  running right now" is answerable without opening anything. */
  vendorOf(behavior: string): { vendor: string; tier: string } | null {
    if (!isModelName(behavior)) return null
    const { vendor, tier } = identifyModel(behavior)
    return { vendor, tier }
  }

  /** The mark this bee wears: what the behaviour asked for, else what its kind
   *  implies, else nothing. */
  emblem(behavior: string, kind?: AgentKind): BeeEmblem {
    return this.spec(behavior).emblem ?? (kind ? KIND_EMBLEM[kind] : 'none') ?? 'none'
  }

  /** The colours a behaviour's bee is drawn in. */
  palette(behavior: string): BeePalette {
    const spec = this.spec(behavior)
    const base = derivedPalette(behavior)
    return {
      body: spec.body ?? base.body,
      stripe: spec.stripe ?? base.stripe,
      head: spec.head ?? base.head,
      wing: spec.wing ?? base.wing,
    }
  }

  /** A still of this behaviour's bee as a data URL, for DOM chrome. */
  imageUrl(behavior: string, px = 64, kind?: AgentKind): string {
    return beeImageUrl(this.palette(behavior), px, this.emblem(behavior, kind))
  }

  /** The flap frames to render for a behaviour. A behaviour carrying an
   *  `imageSig` resolves to a single static frame of that image; anything
   *  else bakes (or reuses) an AB atlas in its own colours. Null when the
   *  bake is impossible (no 2D canvas) — the caller simply draws nothing. */
  frames(behavior: string, kind?: AgentKind): Promise<Texture[] | null> {
    const spec = this.spec(behavior)
    if (spec.imageSig) {
      return this.#imageFrame(spec.imageSig).then(texture => (texture ? [texture] : this.#beeFrames(behavior, kind)))
    }
    return this.#beeFrames(behavior, kind)
  }

  #beeFrames(behavior: string, kind?: AgentKind): Promise<Texture[] | null> {
    const palette = this.palette(behavior)
    const emblem = this.emblem(behavior, kind)
    const key = `${palette.body}|${palette.stripe}|${palette.head}|${palette.wing}|${emblem}`
    let baked = this.#frames.get(key)
    if (!baked) {
      baked = bakeBeeAtlas(FRAMES, CELL_PX, palette, emblem).then(atlas => {
        if (!atlas) return null
        const frames: Texture[] = []
        for (let i = 0; i < atlas.frames; i++) {
          frames.push(new Texture({
            source: atlas.texture.source,
            frame: new Rectangle(i * atlas.cellPx, 0, atlas.cellPx, atlas.cellPx),
          }))
        }
        return frames
      }).catch(() => null)
      this.#frames.set(key, baked)
    }
    return baked
  }

  #imageFrame(sig: string): Promise<Texture | null> {
    let loading = this.#images.get(sig)
    if (!loading) {
      loading = (async () => {
        const blob = await ioc<StoreLike>('@hypercomb.social/Store')?.getResource?.(sig)
        if (!blob) return null
        const url = URL.createObjectURL(blob)
        try {
          const img = new Image()
          img.src = url
          await img.decode()
          return Texture.from(img)
        } finally {
          // The texture holds the decoded bitmap; the object URL is spent.
          URL.revokeObjectURL(url)
        }
      })().catch(() => null)
      this.#images.set(sig, loading)
    }
    return loading
  }

  /** Decorate a behaviour: pin its avatar for this participant. Passing an
   *  empty spec is the same as clearing. */
  setOverride(behavior: string, spec: AgentAvatarSpec): void {
    if (!behavior) return
    const all = this.#overrides()
    if (!spec || Object.keys(spec).length === 0) delete all[behavior]
    else all[behavior] = spec
    try { localStorage.setItem(BEHAVIOR_AVATARS_KEY, JSON.stringify(all)) } catch { /* private mode */ }
    this.dispatchEvent(new CustomEvent('change', { detail: { behavior } }))
  }

  /** Drop a behaviour's override — it falls back to declared, then derived. */
  clearOverride(behavior: string): void {
    this.setOverride(behavior, {})
  }

  /** Read fresh each call — cheap, and keeps updates honest (no cached seed
   *  to go stale). Same reasoning as the behaviour-pheromone overrides. */
  #overrides(): Record<string, AgentAvatarSpec> {
    try {
      const raw = localStorage.getItem(BEHAVIOR_AVATARS_KEY)
      return raw ? JSON.parse(raw) as Record<string, AgentAvatarSpec> : {}
    } catch {
      return {}
    }
  }
}

const _agentAvatars = new AgentAvatarRegistry()
window.ioc.register('@diamondcoreprocessor.com/AgentAvatarRegistry', _agentAvatars)
