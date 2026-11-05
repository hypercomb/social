// sharing/picture-pools.ts
//
// PICTURES TRAVEL ONLY THROUGH HOSTS (documentation/pools-across-hosts.md,
// "What a host adds"). A tile's name pool is never listed by a host, so a
// publisher who wants a picture found under a name says so in their OWN
// signed index: `pictures:<sign(name)>` → the tile's own published layer.
// The host lists the keys whose index names that entry, at
// sign('pictures:<sign(name)>'), exactly as it lists attesters; a reader
// reads each key's index, follows the layer to its properties, and offers
// the picture with that publisher named.
//
// The entry is written by the Publish act and nothing else (publish-branch.ts),
// so a picture is public only because its publisher published the tile. Keyed
// by the name's molecule address, never the name: the index carries no free
// text, and the pool is the molecule address with a colon in front.
//
// Pure: no store, no network. Both halves — the publisher's walk and the
// reader's address — pass in what they read, and the walk is told what counts
// as a picture (peer-images.ts `imagePropsOf`), so this file never imports the
// reader that imports it.

import { moleculeAddress, registerPoolMeaning } from '@hypercomb/core'

export const PICTURES_PREFIX = 'pictures:'
/** Picture entries one publish may add. The index is read by every reader of
 *  the publisher, so a branch of thousands of tiles offers its first ones. */
export const MAX_PICTURE_ROOTS = 64
/** Layers one publish walks looking for pictures. */
const MAX_WALK = 512

const SIG_RE = /^[0-9a-f]{64}$/
const KEY_RE = /^pictures:([0-9a-f]{64})$/

/** `pictures:<sign(name)>`, or null for a name with no molecule (the empty name). */
export const picturesKey = async (name: string): Promise<string | null> => {
  try { return `${PICTURES_PREFIX}${await moleculeAddress(name)}` } catch { return null }
}

/** The address a host lists a name's picture publishers at. */
export const picturesPoolAddress = async (name: string): Promise<string | null> => {
  const key = await picturesKey(name)
  return key ? await registerPoolMeaning(key) : null
}

/** Is this an index key the picture rule reads? */
export const isPicturesKey = (key: string): boolean => KEY_RE.test(key)

type ReadJson = (sig: string) => Promise<Record<string, unknown> | null>
/** Does this properties document wear a picture? */
type WearsPicture = (props: Record<string, unknown>) => boolean

const sigAt = (value: unknown): string => {
  const raw = typeof value === 'string' ? value : String((value as { sig?: unknown } | null)?.sig ?? '')
  const bare = raw.trim().toLowerCase()
  return SIG_RE.test(bare) ? bare : ''
}

/** A published layer's properties document, read THROUGH the Life Primitive
 *  hop: a hive writes `{ meta: 1, resource: <sig>, relation: 'properties' }`
 *  and the properties live at that resource. A bare document is its own
 *  answer. Followed a few hops at most; null when nothing can be read. */
export const layerProps = async (layer: Record<string, unknown>, read: ReadJson): Promise<Record<string, unknown> | null> => {
  let doc = Array.isArray(layer['properties']) ? await readAt(sigAt(layer['properties'][0]), read) : null
  for (let hop = 0; doc && doc['meta'] === 1 && hop < 4; hop++) {
    doc = await readAt(sigAt(doc['resource']), read)
  }
  return doc
}

const readAt = async (sig: string, read: ReadJson): Promise<Record<string, unknown> | null> =>
  sig ? await read(sig) : null

/** The picture a published layer wears, read the way the reader reads it:
 *  layer → its properties document (through the hop) → the image pointers. */
export const layerPicture = async (layerSig: string, read: ReadJson, wears: WearsPicture): Promise<{ name: string; layer: Record<string, unknown> } | null> => {
  const layer = await read(layerSig)
  if (!layer) return null
  const props = await layerProps(layer, read)
  if (!props || !wears(props)) return null
  return { name: String(layer['name'] ?? '').trim(), layer }
}

/**
 * The picture entries a publish of `sealed` adds: one per pictured tile name in
 * the published branch, nearest the branch's root first, each naming that
 * tile's own layer. The first tile to wear a name keeps it; a name with no
 * molecule is skipped. Bounded by MAX_PICTURE_ROOTS and MAX_WALK.
 */
export const pictureRootsOf = async (sealed: string, read: ReadJson, wears: WearsPicture): Promise<Record<string, string>> => {
  const roots: Record<string, string> = {}
  if (!SIG_RE.test(sealed)) return roots
  const queue = [sealed]
  const seen = new Set<string>()
  while (queue.length && seen.size < MAX_WALK && Object.keys(roots).length < MAX_PICTURE_ROOTS) {
    const sig = queue.shift()!
    if (seen.has(sig)) continue
    seen.add(sig)
    let layer: Record<string, unknown> | null = null
    try {
      const pictured = await layerPicture(sig, read, wears)
      if (pictured) {
        layer = pictured.layer
        const key = pictured.name ? await picturesKey(pictured.name) : null
        if (key && !(key in roots)) roots[key] = sig
      } else {
        layer = await read(sig)
      }
    } catch { continue }
    for (const child of Array.isArray(layer?.['children']) ? layer['children'] as unknown[] : []) {
      const next = sigAt(child)
      if (next && !seen.has(next)) queue.push(next)
    }
  }
  return roots
}
