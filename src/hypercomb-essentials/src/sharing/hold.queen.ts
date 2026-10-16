// sharing/hold.queen.ts
//
// `hold` — a domain link becomes a row in your Hyperdex (jwize, 2026-10-15:
// "we can have a bookmark feature"; documentation/business-card.md: the
// Hyperdex is a private collection of link tiles, each entry a link tile
// whose link is the card's address, the contact's name the tile's name, and
// never the head as its key — that would freeze the card).
//
//   hold business-card                   one of ours, by name
//   hold card.pointblanksolutions.ca     by address — read at its live head
//
// THE COLLECTION. Collections are the tiles under `/sets`, so the Hyperdex is
// `/sets/hyperdex`, minted on the first hold and listed in the collections
// entrance like any other. A held creation is `/sets/hyperdex/<name>`: an
// ordinary link tile, made the way a dropped link makes one (one link per
// tile, the same property writes), so everything that reads a link tile —
// the link action, the card page's held-address read, the update notice —
// reads it unchanged. Holding what is already held changes nothing and says
// so. Nothing is written for a door that cannot be read.
//
// THE ROW'S LINK IS ITS OWN. Tile properties are shared by name: a write at
// an outer appearance sinks to the root tile of that name unless it is *only
// here*. The row's link is written only here, so holding "business-card"
// never makes your own /business-card (or any other "business-card") a link.

import { EffectBus, get, isReservedPoolWord, QueenBee, type MachineGrammar } from '@hypercomb/core'
import { childNamesOfStrict, resolveLayerAt, type PlacementHistory, type PlacementLayer } from '../history/layer-placement.js'
import { persistDroppedTileLink } from '../link/link-drop-destination.js'
import {
  cellLocationSig,
  readOwnTilePropertiesAt,
  readTilePropsIndex,
  readTilePropsSigAt,
  TILE_PROPERTY_PINS,
  writeTilePropertiesAt,
  writeTilePropsIndex,
} from '../editor/tile-properties.js'
import { addressOf, readLinkHead, resolveLink } from './link-acts.js'

export const HYPERDEX_SEGMENTS: readonly string[] = ['sets', 'hyperdex']

type CommitterLike = {
  commitChildrenDeltas(segments: readonly string[], changes: { appends?: readonly string[] }): Promise<string>
  update(segments: readonly string[], layer: PlacementLayer): Promise<string>
}

/** Is a name among a page's children? `unknown` when a child could not be
 *  read — then nothing is appended, or a cold row would be listed twice. */
type Standing = 'listed' | 'absent' | 'unknown'

export class HoldQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'hold'
  override description = 'Hold a linked creation in your Hyperdex: a link tile named after it, inside the /sets/hyperdex collection, minted on first use'
  override descriptionKey = 'slash.hold'
  override options = ['<name>', '<address>']
  override examples = [
    { input: '/hold business-card', result: 'A link tile "business-card" is in /sets/hyperdex, linking to its address' },
  ]
  override rawArgs = true
  override machine: MachineGrammar = {
    forms: 'hold <name> | hold <address>',
    example: 'hold business-card',
    reach: 'additive',
    scope: 'hive',
  }

  protected async execute(args: string): Promise<void> {
    const what = args.trim()
    if (!what) { this.#say(this.#t('hold.usage', 'Hold: say which — a creation\'s name or its address, for example "hold business-card"')); return }

    const link = await resolveLink(what)
    if (link.kind === 'none') { this.#say(this.#t('hold.none', 'Hold: nothing published is called "{what}"', { what })); return }
    let name = ''
    let address = ''
    if (link.kind === 'own') {
      name = link.door.name
      address = link.door.address
    } else {
      const head = await readLinkHead(link.address)
      if ('error' in head) { this.#say(this.#t('hold.unread', 'Hold: {address} could not be read ({error})', { address: link.address, error: head.error })); return }
      const segments = head.lineage.split('/').map(s => s.trim()).filter(Boolean)
      name = (head.title || segments[segments.length - 1] || '').trim()
      address = link.address
    }
    if (!name) { this.#say(this.#t('hold.nameless', 'Hold: {address} names no creation', { address })); return }
    if (isReservedPoolWord(name)) { this.#say(this.#t('hold.reserved', 'Hold: "{name}" is a reserved word and cannot name a tile', { name })); return }

    const history = get<PlacementHistory>('@diamondcoreprocessor.com/HistoryService')
    const committer = get<CommitterLike>('@diamondcoreprocessor.com/LayerCommitter')
    if (!history || !committer) { this.#say(this.#t('hold.not-ready', 'Hold: the hive is not ready to write')); return }

    // MEMBERSHIP decides "held", never a surviving bag: a row taken off the
    // collection keeps its bag and its link, and is still not in the Hyperdex.
    const parent = HYPERDEX_SEGMENTS.slice(0, -1)
    const collection = HYPERDEX_SEGMENTS[HYPERDEX_SEGMENTS.length - 1] ?? ''
    const collectionStands = await this.#standing(history, parent, collection)
    // The row is asked of the collection's head even when the collection is
    // off /sets: its surviving bag comes back listing what it listed, and a
    // row appended again by its newer head sig would be listed twice.
    const rowStands = collectionStands === 'unknown' ? 'unknown' : await this.#standing(history, HYPERDEX_SEGMENTS, name)
    if (collectionStands === 'unknown' || rowStands === 'unknown') {
      this.#say(this.#t('hold.cold', 'Hold: your Hyperdex is not fully read yet — try again in a moment'))
      return
    }

    // The row's OWN properties — the inherited view would answer with the
    // link of whatever root tile shares the name.
    const existing = await readOwnTilePropertiesAt(HYPERDEX_SEGMENTS, name).catch(() => ({} as Record<string, unknown>))
    if (rowStands === 'listed') {
      // One link per tile, and the same link twice is a no-op.
      const prior = typeof existing['link'] === 'string' ? addressOf(existing['link'] as string) : ''
      // The same link is only already HELD while the collection is listed;
      // off /sets, the collection is listed again below.
      if (prior && prior === addressOf(address)) {
        if (collectionStands === 'listed') { this.#say(this.#t('hold.already', 'Hold: {name} is already in your Hyperdex', { name })); return }
      } else if (prior) { this.#say(this.#t('hold.other-link', 'Hold: "{name}" in your Hyperdex already links to {prior} — not replaced', { name, prior })); return }
    }

    // A root tile of that name that PINS its link locks every appearance to
    // it, so the row's own link would never show. Refuse rather than make a
    // row that opens somewhere else.
    const root = await readOwnTilePropertiesAt([], name).catch(() => ({} as Record<string, unknown>))
    const rootPins = Array.isArray(root[TILE_PROPERTY_PINS]) ? root[TILE_PROPERTY_PINS] as unknown[] : []
    const rootLink = typeof root['link'] === 'string' ? addressOf(root['link'] as string) : ''
    if (rootPins.includes('link') && rootLink !== addressOf(address)) {
      this.#say(this.#t('hold.pinned', 'Hold: your tile "{name}" locks its link, so a Hyperdex row of that name cannot link to {address}', { name, address }))
      return
    }

    // The collection, then the row — each listed when it is not.
    if (collectionStands === 'absent') await this.#list(committer, HYPERDEX_SEGMENTS)
    if (rowStands === 'absent') await this.#list(committer, [...HYPERDEX_SEGMENTS, name])
    await persistDroppedTileLink(HYPERDEX_SEGMENTS, name, address, {
      writeProperties: (p, c, u) => writeTilePropertiesAt(p, c, u, { onlyHere: true }),
      readPropertiesSig: readTilePropsSigAt,
      locationSig: cellLocationSig,
      readIndex: readTilePropsIndex,
      writeIndex: writeTilePropsIndex,
    }, null, existing)
    const route = `/${HYPERDEX_SEGMENTS.join('/')}/${name}`
    this.#say(this.#t('hold.held', 'Hold: {name} is in your Hyperdex — {route} links to {address}', { name, route, address }))
    EffectBus.emit('toast:show', { type: 'success', message: this.#t('hold.toast', '{name} held in your Hyperdex', { name }) })
  }

  /** Whether `name` is among the children of the page at `parent`. */
  async #standing(history: PlacementHistory, parent: readonly string[], name: string): Promise<Standing> {
    const page = await resolveLayerAt(history, undefined, parent).catch(() => null)
    if (!page) return 'absent'
    const { names, coldMiss } = await childNamesOfStrict(history, page).catch(() => ({ names: [] as string[], coldMiss: true }))
    if (names.includes(name)) return 'listed'
    return coldMiss ? 'unknown' : 'absent'
  }

  /** List the tile at `segments` under its parent: its surviving head when it
   *  has one (a removed row comes back as it was), else an empty layer minted
   *  through the commit queue. */
  async #list(committer: CommitterLike, segments: readonly string[]): Promise<void> {
    // update() with no slots keeps a surviving head as it is and returns it;
    // a raw commitLayer would write a bare {name} over that head.
    const marker = await committer.update(segments, { name: segments[segments.length - 1] ?? '' })
    if (marker) await committer.commitChildrenDeltas(segments.slice(0, -1), { appends: [marker] })
  }

  /** Localized text; `t()` hands the key back when it has none. */
  #t(key: string, fallback: string, params?: Record<string, unknown>): string {
    const i18n = get<{ t(k: string, p?: Record<string, unknown>): string }>('@hypercomb.social/I18n')
    const text = i18n?.t?.(key, params)
    if (text && text !== key) return text
    return fallback.replace(/\{(\w+)\}/g, (all, token: string) => params && token in params ? String(params[token]) : all)
  }

  #say(message: string): void {
    EffectBus.emit('activity:log', { message, icon: '⌖' })
  }
}

const _hold = new HoldQueenBee()
window.ioc.register('@diamondcoreprocessor.com/HoldQueenBee', _hold)
