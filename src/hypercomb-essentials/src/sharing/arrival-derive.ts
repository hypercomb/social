// sharing/arrival-derive.ts
//
// THE ARRIVAL, DERIVED AT PUBLISH (jwize 2026-10-18: "we can create many
// different apps that need to show soon" — baked in, never tuned by hand). A
// branch that opens as a view whose registration declares its `arrival`
// (VisualBeeDescriptor.arrival) is published with that arrival as its plan:
// the view arbiter, the queen that registers the view, and what the view
// declares. A reader's first view loads those and leaves the rest passive
// (hypercomb-runtime arrival-plan.ts), and a plan that misses something still
// wakes the rest (guardArrival). A plan the publisher made by hand (the
// `arrival` word, the Publish window's Optimize section) is never replaced:
// publishBranch derives one only where the index names none.

import { get } from '@hypercomb/core'
import { defaultViewWithinAt } from '../commands/view-default.js'

const VIEW_ARBITER = '@diamondcoreprocessor.com/ViewBee'
const REGISTRY_KEY = '@diamondcoreprocessor.com/VisualBeeRegistry'

type ViewDescriptor = { readonly queenKey?: string; readonly arrival?: readonly string[] }
type RegistryLike = { get(view: string): ViewDescriptor | undefined }

/** The IoC keys a branch's published arrival needs, from what it opens as —
 *  or null: it opens as hexagons (the hive itself is the arrival), or its
 *  view declares no arrival. */
export async function derivedArrival(segments: readonly string[]): Promise<string[] | null> {
  let view = ''
  try { view = String(await defaultViewWithinAt(segments) ?? '').trim() } catch { return null }
  if (!view) return null
  const descriptor = get<RegistryLike>(REGISTRY_KEY)?.get(view)
  const declared = (descriptor?.arrival ?? []).map(key => String(key ?? '').trim()).filter(Boolean)
  if (!declared.length || !descriptor?.queenKey) return null
  return [...new Set([VIEW_ARBITER, descriptor.queenKey, ...declared])].sort()
}

/** The plan record a derived arrival is signed as. `derived` says no hand
 *  made it — what the Publish window may show, and a later derivation may
 *  refresh. */
export const derivedArrivalRecord = (keys: readonly string[]): string =>
  JSON.stringify({ arrive: [...keys], derived: true })
