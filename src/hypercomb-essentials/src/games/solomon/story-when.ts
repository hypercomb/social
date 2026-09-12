/** The story's own conditions language: data, never code. A `StoryWhen` is a
 *  small tree of six forms a designer writes as a plain object literal —
 *  `has`/`knows`/`done` leaves and `all`/`any`/`not` combinators — checked
 *  against whatever the shell's `StoryFacts` says the traveller has done.
 *  Pure; the only import beyond its own types is a type-only read of
 *  `SigilRequirement` from `labyrinth.ts`. */

import type { SigilRequirement } from './labyrinth.js'

/** Something the story can ask of the traveller's saved facts. Data, never code. */
export type StoryWhen =
  | { readonly has: SigilRequirement }         // exactly journey.has
  | { readonly knows: string }                 // a knowledge id
  | { readonly done: string }                  // a fact ref, grammar in ADVENTURE.md / place-runtimes.ts
  | { readonly all: readonly StoryWhen[] }
  | { readonly any: readonly StoryWhen[] }
  | { readonly not: StoryWhen }

export interface StoryFacts {
  has(requirement: SigilRequirement): boolean
  knows(id: string): boolean
  done(ref: string): boolean
}

export const STORY_WHEN_DEPTH = 8

function holds(when: StoryWhen | undefined, facts: StoryFacts, depth: number): boolean {
  if (when === undefined) return true
  if (depth > STORY_WHEN_DEPTH) return false
  if (!when || typeof when !== 'object') return false
  const w = when as Record<string, unknown>
  if ('has' in w) return facts.has(w.has as SigilRequirement)
  if ('knows' in w) return typeof w.knows === 'string' && facts.knows(w.knows)
  if ('done' in w) return typeof w.done === 'string' && facts.done(w.done)
  if ('all' in w) return Array.isArray(w.all) && (w.all as StoryWhen[]).every(child => holds(child, facts, depth + 1))
  if ('any' in w) return Array.isArray(w.any) && (w.any as StoryWhen[]).some(child => holds(child, facts, depth + 1))
  if ('not' in w) return !holds(w.not as StoryWhen, facts, depth + 1)
  return false
}

/** undefined → true. A malformed node, an unknown key, or depth > 8 → false. Never throws.
 *  `all` of [] is true; `any` of [] is false. */
export function storyHolds(when: StoryWhen | undefined, facts: StoryFacts): boolean {
  try { return holds(when, facts, 0) } catch { return false }
}

/** Every `knows` id and `done` ref in a condition, for validation. */
export function storyRefs(when: StoryWhen | undefined): { readonly knows: readonly string[]; readonly done: readonly string[] } {
  const knows: string[] = []
  const done: string[] = []
  const walk = (node: StoryWhen | undefined): void => {
    if (!node || typeof node !== 'object') return
    const w = node as Record<string, unknown>
    if (typeof w.knows === 'string') knows.push(w.knows)
    else if (typeof w.done === 'string') done.push(w.done)
    else if (Array.isArray(w.all)) for (const child of w.all as StoryWhen[]) walk(child)
    else if (Array.isArray(w.any)) for (const child of w.any as StoryWhen[]) walk(child)
    else if (w.not) walk(w.not as StoryWhen)
  }
  walk(when)
  return { knows, done }
}
