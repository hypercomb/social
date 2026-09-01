// hypercomb-essentials/src/commands/publish-lights.ts
//
// THE LIGHTS A PUBLICATION CARRIES — one record, one meaning: "these are the
// behaviours this creation was dressed in when it was published."
//
// It is a DECORATION on the branch root, exactly like `view:default`, and for
// the same reason: the lights are a fact about the PLACE, not a preference of
// whoever is looking. So they are undoable, they ride the layer commit to the
// root, they are sealed into the published closure, and they arrive verified
// with the tree rather than as a side-channel the worker would have to be
// taught about. Nothing in the signed index changes; nothing new is fetched.
//
// WHY IT EXISTS. A visitor's browser is a brand-new install with no roster
// and no history, so the opt-in model has nothing to opt in FROM. Left to
// itself it either sees nothing (the dark seed — every published site
// rendered as shaded hexagons with default art) or sees everything the module
// graph happened to bring, which is not what the publisher arranged either.
// The honest answer is the third one: show what the publisher lit.
//
// MUTUAL EXCLUSIVITY IS STRUCTURAL: the writer is `replaceDecoration`, which
// drops every prior record of the kind before appending. A branch carries one
// set of lights or none.
//
// The kind is `publish:lights`, deliberately NOT `visual:*`: show-features
// mints a "foreign behaviour" row for any unrecognized `visual:` kind, and
// this mark is not a behaviour — it is a note about which ones were on.

import {
  listDecorations,
  removeDecorationAndWait,
  replaceDecoration,
} from './decoration-manifest.js'

/** The decoration kind. Read asynchronously on arrival only, so it does not
 *  need a synchronous index the way `view:default` does. */
export const PUBLISH_LIGHTS_DECORATION_KIND = 'publish:lights'

interface PublishLightsPayload {
  /** The decoration kinds whose global light was ON at publish time. */
  kinds?: string[]
}

const clean = (kinds: readonly string[]): string[] =>
  [...new Set(kinds.map(k => String(k ?? '').trim()).filter(Boolean))].sort()

/** The lights this branch was published with, or `null` when it carries no
 *  mark at all. An EMPTY array is a real answer — "the publisher lit nothing"
 *  — and must not be confused with "this publication predates the mark",
 *  which is what `null` says. */
export async function publishLightsAt(
  segments: readonly string[],
): Promise<string[] | null> {
  try {
    const records = await listDecorations<PublishLightsPayload>({
      kind: PUBLISH_LIGHTS_DECORATION_KIND,
      segments: [...segments],
    })
    for (const record of records) {
      const kinds = record.record?.payload?.kinds
      if (Array.isArray(kinds)) return clean(kinds)
    }
  } catch { /* cold read — the caller treats a miss as "no mark" */ }
  return null
}

/** THE CASCADE, cold side: the lights covering this location — its own mark,
 *  else the nearest ancestor's, walked one prefix at a time down to the root.
 *  A visitor lands on a nested lineage whose mark sits at the published
 *  branch root, so the walk is what makes a nested publication work. */
export async function publishLightsWithinAt(
  segments: readonly string[],
): Promise<string[] | null> {
  for (let d = segments.length; d >= 0; d--) {
    const lights = await publishLightsAt(segments.slice(0, d))
    if (lights) return lights
  }
  return null
}

/** Stamp this branch with the lights it is being published under. Replaces
 *  any prior stamp here.
 *
 *  This CHANGES THE HEAD, which is why the publish routine writes it before
 *  it seals rather than after: the mark has to be inside the closure it
 *  describes, or the visitor would be handed a tree that does not contain its
 *  own dressing. */
export function writePublishLights(
  segments: readonly string[],
  kinds: readonly string[],
): Promise<string> {
  return replaceDecoration<PublishLightsPayload>({
    kind: PUBLISH_LIGHTS_DECORATION_KIND,
    appliesTo: [...segments],
    segments: [...segments],
    payload: { kinds: clean(kinds) },
    mark: 'persistent',
  })
}

/** Drop this branch's stamp — it publishes without carrying its lights.
 *  Awaited to the root so a re-read sees it gone. */
export async function clearPublishLights(segments: readonly string[]): Promise<boolean> {
  const records = await listDecorations<PublishLightsPayload>({
    kind: PUBLISH_LIGHTS_DECORATION_KIND,
    segments: [...segments],
  })
  if (records.length === 0) return false
  for (const record of records) {
    await removeDecorationAndWait({ sig: record.sig, segments: [...segments] })
  }
  return true
}
