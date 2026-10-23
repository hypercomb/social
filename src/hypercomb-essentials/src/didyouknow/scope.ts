// didyouknow/scope.ts
//
// WHERE THE GAME IS ON — the application record of the toggle.
//
// Did You Know is a behaviour a LAYER declares (the application-scope
// primitive: what, where, scope). The record is one payload-free decoration,
// `visual:didyouknow:enabled`, on a layer. It means "the game is on here and
// everywhere beneath". Nothing is stamped on descendants: a reader walks up
// from the layer it stands on, self first, root included, and the nearest
// declaration answers. A declaration on the root layer is therefore
// "everywhere"; one on a branch is that branch only.
//
// The record says WHERE the game may be played. It holds no ideas. Those live
// on the layer where they were shared — the notes on that layer's own
// `did you know` tile — so every layer keeps its own set, whatever reaches it.
//
// A dependency of the service; it registers nothing.

import { listDecorations, removeDecorationAndWait, writeDecoration } from '../commands/decoration-manifest.js'
import { ENABLED_KIND } from './didyouknow.js'

/** The declarations sitting on exactly this layer. */
export async function declarationsAt(segments: readonly string[]): Promise<{ sig: string }[]> {
  try {
    return (await listDecorations<Record<string, never>>({ kind: ENABLED_KIND, segments })).map(d => ({ sig: d.sig }))
  } catch { return [] }
}

/** The nearest layer that declares the game on — this one first, then each
 *  ancestor up to the root — or null when none does. */
export async function declaredAt(segments: readonly string[]): Promise<string[] | null> {
  for (let depth = segments.length; depth >= 0; depth--) {
    const layer = segments.slice(0, depth)
    if ((await declarationsAt(layer)).length > 0) return [...layer]
  }
  return null
}

/** Declare the game on at this layer (once — a second call finds it there). */
export async function enableAt(segments: readonly string[]): Promise<void> {
  if ((await declarationsAt(segments)).length > 0) return
  await writeDecoration<Record<string, never>>({
    kind: ENABLED_KIND,
    appliesTo: segments,
    payload: {},
    segments,
    mark: 'persistent',
  })
}

/** Take the declarations off this layer, awaiting the commit. Ideas already
 *  shared stay where they are; a declaration on an ancestor is not touched. */
export async function disableAt(segments: readonly string[]): Promise<number> {
  const found = await declarationsAt(segments)
  for (const { sig } of found) await removeDecorationAndWait({ sig, segments })
  return found.length
}
