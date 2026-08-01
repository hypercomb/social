// diamondcoreprocessor.com/presentation/avatars/agent-waggle.ts
//
// WAGGLE PATTERNS — how a bee dances tells you WHAT KIND of thing is running,
// before you read a word of it.
//
// The base is the tutorial's loved figure-8 (tutorial-overlay.view.ts):
// `sin(7.4t) * 30` across, `sin(14.8t) * 11` down — a 1:2 Lissajous, the flat
// ∞ a real honeybee traces. Every pattern here is a sibling of it, so the
// whole family reads as one gesture with four accents:
//
//   model        the loved figure-8, unchanged. An AI model is thinking.
//   script       a flat, even patrol — a triangle wave, no dance to it.
//                Deterministic work should not look like it is deliberating.
//   system       a slow circle. Housekeeping humming along in the background.
//   orchestrator the same figure-8 at the same size, a third of the speed —
//                the overseer walks the same dance, but it is watching the
//                room rather than working a tile. Sharing the model's reach
//                is deliberate: both infinity dances get ONE compact target
//                to aim a cursor at. Speed is what tells them apart.
//
// Pure math, no Pixi, no DOM: the renderer asks for an offset at time t, and
// the same functions give the path used to draw (and hit-test) the WAGGLE AREA
// — the patch of air the bee is dancing in, which is a much easier thing to
// aim a cursor at than a bee that will not hold still.
//
// Offsets are in CSS pixels on screen. The caller divides by the world scale,
// so the dance is the same size whatever the zoom.

import { isModelName } from './agent-model.js'

export type AgentKind = 'model' | 'script' | 'system' | 'orchestrator'

/** What sort of worker this is. An explicit `kind` always wins — a behaviour
 *  knows what it is better than a name check does. Model detection covers
 *  every vendor (see agent-model.ts), not just this hive's own commands, so a
 *  routine that runs GPT or Gemini still gets a model bee. */
export const kindFor = (agent: {
  kind?: string
  behavior?: string
  model?: string
  id?: string
}): AgentKind => {
  const declared = agent.kind
  if (declared === 'model' || declared === 'script' || declared === 'system' || declared === 'orchestrator') {
    return declared
  }
  const behavior = String(agent.behavior ?? '')
  if (behavior === 'orchestrator') return 'orchestrator'
  if (isModelName(behavior) || isModelName(String(agent.model ?? ''))) return 'model'
  if (behavior === 'sync' || behavior === 'install' || String(agent.id ?? '').startsWith('sync:')) return 'system'
  return 'script'
}

export interface WaggleShape {
  /** Half-extent of the dance in CSS px — also the hover/click area. */
  readonly reach: { readonly x: number; readonly y: number }
  /** Offset from the dance centre at `t` seconds, phase-shifted by `seed`. */
  at(t: number, seed: number): { x: number; y: number }
}

/** Triangle wave in [-1,1] with period 2π — a linear sweep, no easing. It is
 *  what makes the script patrol read as mechanical next to a sine. */
const triangle = (phase: number): number => {
  const wrapped = ((phase / (Math.PI * 2)) % 1 + 1) % 1
  return 4 * Math.abs(wrapped - 0.5) - 1
}

const PATTERNS: Record<AgentKind, WaggleShape> = {
  // The tutorial's figure-8, scaled down to stay close to its tile.
  model: {
    reach: { x: 14, y: 6 },
    at: (t, seed) => ({
      x: Math.sin(t * 7.4 + seed) * 14,
      y: Math.sin(t * 14.8 + seed * 2) * 5,
    }),
  },

  // Even, unhurried, no flourish: a machine going back and forth.
  script: {
    reach: { x: 12, y: 4 },
    at: (t, seed) => ({
      x: triangle(t * 3.4 + seed) * 12,
      y: Math.sin(t * 6.8 + seed) * 2,
    }),
  },

  // A slow orbit — present, not urgent.
  system: {
    reach: { x: 9, y: 9 },
    at: (t, seed) => ({
      x: Math.cos(t * 1.7 + seed) * 9,
      y: Math.sin(t * 1.7 + seed) * 9,
    }),
  },

  // The same figure-8, wide and slow: watching rather than working.
  orchestrator: {
    reach: { x: 14, y: 6 },
    at: (t, seed) => ({
      x: Math.sin(t * 2.4 + seed) * 14,
      y: Math.sin(t * 4.8 + seed * 2) * 5,
    }),
  },
}

export const waggleFor = (kind: AgentKind): WaggleShape => PATTERNS[kind] ?? PATTERNS.script

/** The offset to add to a bee's dance centre. `intensity` ∈ [0,1] scales the
 *  whole dance; the renderer uses one fixed compact scale for every status. */
export const waggleOffset = (
  kind: AgentKind,
  t: number,
  seed: number,
  intensity: number,
): { x: number; y: number } => {
  const shape = waggleFor(kind)
  const scale = Math.max(0, Math.min(1, intensity))
  const point = shape.at(t, seed)
  return { x: point.x * scale, y: point.y * scale }
}

/** One full loop of the dance as a closed polyline — what gets drawn as the
 *  waggle area. Sampled rather than derived analytically so a pattern can be
 *  any shape without the renderer knowing anything about it. */
export const wagglePath = (kind: AgentKind, samples = 72): Array<{ x: number; y: number }> => {
  const shape = waggleFor(kind)
  // One period of the SLOWEST term in each pattern, so the trace closes.
  const period = kind === 'model' ? (Math.PI * 2) / 7.4
    : kind === 'script' ? (Math.PI * 2) / 3.4
    : kind === 'system' ? (Math.PI * 2) / 1.7
    : (Math.PI * 2) / 2.4
  const points: Array<{ x: number; y: number }> = []
  for (let i = 0; i < samples; i++) points.push(shape.at((i / samples) * period, 0))
  return points
}

/** Is a point (relative to the dance centre, in CSS px) inside the waggle
 *  area? An ellipse over the pattern's reach plus a margin — aiming at a
 *  moving bee is hard, aiming at the air it dances in is not. */
export const inWaggleArea = (
  kind: AgentKind,
  dx: number,
  dy: number,
  margin = 14,
): boolean => {
  const { reach } = waggleFor(kind)
  const rx = reach.x + margin
  const ry = reach.y + margin
  return (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) <= 1
}
