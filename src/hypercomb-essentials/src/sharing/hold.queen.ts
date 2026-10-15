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

import { EffectBus, get, isReservedPoolWord, QueenBee, type MachineGrammar } from '@hypercomb/core'
import type { PlacementHistory, PlacementLayer } from '../history/layer-placement.js'
import { persistDroppedTileLink } from '../link/link-drop-destination.js'
import {
  cellLocationSig,
  readTilePropertiesAt,
  readTilePropsIndex,
  readTilePropsSigAt,
  writeTilePropertiesAt,
  writeTilePropsIndex,
} from '../editor/tile-properties.js'
import { addressOf, readLinkHead, resolveLink } from './link-acts.js'

export const HYPERDEX_SEGMENTS: readonly string[] = ['sets', 'hyperdex']

type CommitterLike = {
  commitChildrenDeltas(segments: readonly string[], changes: { appends?: readonly string[] }): Promise<string>
  update?(segments: readonly string[], layer: PlacementLayer): Promise<string>
}

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
    if (!what) { this.#say('Hold: say which — a creation\'s name or its address, for example "hold business-card"'); return }

    const link = await resolveLink(what)
    if (link.kind === 'none') { this.#say(`Hold: nothing published is called "${what}"`); return }
    let name = ''
    let address = ''
    if (link.kind === 'own') {
      name = link.door.name
      address = link.door.address
    } else {
      const head = await readLinkHead(link.address)
      if ('error' in head) { this.#say(`Hold: ${link.address} could not be read (${head.error})`); return }
      const segments = head.lineage.split('/').map(s => s.trim()).filter(Boolean)
      name = (head.title || segments[segments.length - 1] || '').trim()
      address = link.address
    }
    if (!name) { this.#say(`Hold: ${address} names no creation`); return }
    if (isReservedPoolWord(name)) { this.#say(`Hold: "${name}" is a reserved word and cannot name a tile`); return }

    const history = get<PlacementHistory>('@diamondcoreprocessor.com/HistoryService')
    const committer = get<CommitterLike>('@diamondcoreprocessor.com/LayerCommitter')
    if (!history || !committer) { this.#say('Hold: the hive is not ready to write'); return }

    // Already held: one link per tile, and the same link twice is a no-op.
    const existing = await readTilePropertiesAt(HYPERDEX_SEGMENTS, name).catch(() => ({} as Record<string, unknown>))
    const prior = typeof existing['link'] === 'string' ? addressOf(existing['link'] as string) : ''
    if (prior && prior === addressOf(address)) { this.#say(`Hold: ${name} is already in your Hyperdex`); return }
    if (prior) { this.#say(`Hold: "${name}" in your Hyperdex already links to ${prior} — not replaced`); return }

    // The collection, then the row — each minted only when absent.
    await this.#ensureTile(history, committer, HYPERDEX_SEGMENTS)
    await this.#ensureTile(history, committer, [...HYPERDEX_SEGMENTS, name])
    await persistDroppedTileLink(HYPERDEX_SEGMENTS, name, address, {
      writeProperties: writeTilePropertiesAt,
      readPropertiesSig: readTilePropsSigAt,
      locationSig: cellLocationSig,
      readIndex: readTilePropsIndex,
      writeIndex: writeTilePropsIndex,
    }, null, existing)
    this.#say(`Hold: ${name} is in your Hyperdex — /${HYPERDEX_SEGMENTS.join('/')}/${name} links to ${address}`)
    EffectBus.emit('toast:show', { type: 'success', message: `${name} held in your Hyperdex` })
  }

  /** A tile at `segments`, minted as an empty layer when there is none, through
   *  the commit queue (never around it) and appended to its parent's children. */
  async #ensureTile(history: PlacementHistory, committer: CommitterLike, segments: readonly string[]): Promise<void> {
    const location = await history.sign({ explorerSegments: () => segments })
    const head = await history.currentLayerAt(location).catch(() => null)
    if (head) return
    const name = segments[segments.length - 1] ?? ''
    const layer: PlacementLayer = { name }
    const marker = committer.update
      ? await committer.update(segments, layer)
      : await history.commitLayer(location, layer)
    await committer.commitChildrenDeltas(segments.slice(0, -1), { appends: [marker] })
  }

  #say(message: string): void {
    EffectBus.emit('activity:log', { message, icon: '⌖' })
  }
}

const _hold = new HoldQueenBee()
window.ioc.register('@diamondcoreprocessor.com/HoldQueenBee', _hold)
