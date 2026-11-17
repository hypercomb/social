// assistant/composed-parts-reader.ts
//
// THE LIVE READER OF A TILE'S COMPOSED PARTS (composed-parts.ts). The rules
// of what a tile is made of are pure; this is the one place they meet the
// hive. Each answer is asked of the service that already owns it, so the
// tree can never say something other than what the hive draws:
//
//   • the tile's children and files: the hive tree reader, as the inspect
//     view reads a tile;
//   • its page: the website view's own resolver;
//   • its traits: the trait provider the website view fills a page from,
//     hive rung included;
//   • its card: the record the card page reads;
//   • text: the store, the same read the pane and the shell proof make;
//   • what is held: this device only, never a host.
//
// EVERY METHOD ANSWERS, NEVER THROWS. A service that is not here, or a read
// that fails, is null, an empty list or an empty map: the tree then shows
// less, and the rows it does show are still true.
//
// A dependency: it exports the reader and registers nothing.

import { SITE_VIEW_IOC_KEY, TRAITS_IOC_KEY, sameTraitWord, type TraitProvider } from '@hypercomb/core'
import { CARD_DATA_KIND } from '../commands/card-wear.js'
import { cardRecordAt } from '../files/card-commit.js'
import { seatFillers } from '../website/trait-seat.js'
import type { PartsReader, TileFile } from './composed-parts.js'
import { HIVE_TREE_READER_IOC_KEY } from './hive-tree-reader.js'
import { pictureMime } from './tile-holds.js'

const SIG = /^[0-9a-f]{64}$/
/** Registered when the website view's module loads; SITE_VIEW_IOC_KEY only on
 *  its first heartbeat. The write door asks the same one (page-parts-commit.ts). */
const SITE_VIEW_DRONE_KEY = '@diamondcoreprocessor.com/SiteViewDrone'
const STORE_KEY = '@hypercomb.social/Store'

type TreeReader = {
  readNode?(segments: readonly string[], options?: { withContent?: boolean }): Promise<{
    readonly ok: boolean
    readonly children?: readonly { readonly name: string; readonly sig?: string }[]
    readonly files?: readonly TileFile[]
  }>
}
type PageResolver = { resolvePageSig?(segments: readonly string[]): Promise<string | null> }
type StoreLike = {
  getResource?(sig: string): Promise<Blob | null>
  getResourceResolvedLocal?(sig: string): Promise<Blob | null>
}

const ioc = <T,>(key: string): T | undefined =>
  (globalThis as { ioc?: { get?: (k: string) => unknown } }).ioc?.get?.(key) as T | undefined

/** The reader the chat's code tree composes a tile's parts with. */
export const hiveParts = (): PartsReader => ({
  async tile(segments) {
    try {
      // With its content: a tile's files come with it, never without.
      const node = await ioc<TreeReader>(HIVE_TREE_READER_IOC_KEY)?.readNode?.(segments, { withContent: true })
      if (!node?.ok) return null
      return {
        children: (node.children ?? []).map(child => ({ name: child.name, ...(child.sig ? { sig: child.sig } : {}) })),
        files: node.files ?? [],
      }
    } catch { return null }
  },

  async pageSig(segments) {
    try {
      const view = ioc<PageResolver>(SITE_VIEW_DRONE_KEY) ?? ioc<PageResolver>(SITE_VIEW_IOC_KEY)
      const sig = await view?.resolvePageSig?.(segments)
      return typeof sig === 'string' && SIG.test(sig) ? sig : null
    } catch { return null }
  },

  async traits(segments) {
    try { return await ioc<TraitProvider>(TRAITS_IOC_KEY)?.resolveAt?.(segments) ?? [] } catch { return [] }
  },

  async card(segments) {
    try {
      // The payload alone: a card's rows are the fields its record names, not its refs.
      const record = await cardRecordAt(segments)
      return record ? { kind: CARD_DATA_KIND, payload: record.payload } : null
    } catch { return null }
  },

  async text(sig) {
    try {
      const blob = await ioc<StoreLike>(STORE_KEY)?.getResource?.(sig)
      return blob ? await blob.text() : null
    } catch { return null }
  },

  async held(sigs) {
    const out = new Map<string, { size: number; picture: boolean }>()
    const store = ioc<StoreLike>(STORE_KEY)
    if (!store?.getResourceResolvedLocal) return out
    for (const sig of sigs) {
      try {
        // Local only: listing what a page names must never fetch it from a host.
        const blob = await store.getResourceResolvedLocal(sig)
        if (!blob) continue
        const head = new Uint8Array(await blob.slice(0, 16).arrayBuffer())
        out.set(sig, { size: blob.size, picture: pictureMime(head) !== null })
      } catch { /* not held */ }
    }
    return out
  },

  stated(html, fills) {
    const seen: string[] = []
    try {
      // The website view's own walk of a page's traits. A word `fills` names
      // is given a stand-in filler, so the walk replaces its element as the
      // draw does and never asks for a trait stated inside it. What the walk
      // hands back is not used: only the words it asked for are.
      seatFillers(html, word => {
        if (!seen.some(have => sameTraitWord(have, word))) seen.push(word)
        return fills?.(word) ? '<i></i>' : undefined
      })
    } catch { /* what was seen so far */ }
    return seen
  },
})
