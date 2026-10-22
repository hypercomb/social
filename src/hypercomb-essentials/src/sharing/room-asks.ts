// sharing/room-asks.ts
//
// WHAT A ROOM ASKS OF WHOEVER JOINS (documentation/swarm-pools.md, step six).
//
// jwize, 2026-10-14: "an entry behavioral requirement that the notes behaviour
// is active. That way the people joining the swarm must activate and connect."
// Decided 2026-10-21: a requirement is a BEHAVIOUR — a word of the dialect
// (`notes`, `keep-alive`, …) — named by the host on the room's tile.
//
// THE SHAPE. The room tile's layer carries an `asks` slot: the behaviour words,
// folded, in the host's order. Words, not signatures: a behaviour's word IS
// its identity in the dialect — the thing a participant types to turn it on.
// The slot rides the tile's layer like `notes` and `categories`, so the room
// carries it to everyone with no new wire: the host's template tile first,
// else whoever shares the tile live.
//
// ON ARRIVAL each asked word is checked against this shell: a word it knows is
// offered to be turned on (one tap runs the word, as typing it would); a word
// it does not know is said plainly — on the host's swarm door the package is
// pinned, so that only happens when the host asks for something its own
// package lacks. Nothing is turned on by itself.

import { moleculeKey } from '@hypercomb/core'

export const ROOM_ASKS_SLOT = 'asks'
/** A room asks a handful of things, not a manifest. */
export const ROOM_ASKS_MAX = 12
const WORD_RE = /^[a-z][a-z0-9-]{0,47}$/

/** The asked words a layer carries, cleaned: folded, de-duplicated, valid
 *  behaviour-word shapes only, in order. */
export function readAsks(layer: unknown): string[] {
  const raw = layer && typeof layer === 'object' ? (layer as Record<string, unknown>)[ROOM_ASKS_SLOT] : null
  return cleanAsks(Array.isArray(raw) ? raw : [])
}

/** Fold and de-duplicate a list of asked words. */
export function cleanAsks(words: readonly unknown[]): string[] {
  const out: string[] = []
  for (const w of words) {
    const word = String(w ?? '').trim().replace(/^\/+/, '').toLowerCase()
    if (!WORD_RE.test(word) || out.includes(word)) continue
    out.push(word)
    if (out.length >= ROOM_ASKS_MAX) break
  }
  return out
}

/** The words of an `asks` edit applied to what a tile asks now: `asks a b`
 *  adds, `asks ~ a` drops, `asks =` (nothing after it) clears. */
export function applyAsks(current: readonly string[], args: string): string[] {
  const text = String(args ?? '').trim()
  if (text === '=') return []
  if (text.startsWith('~')) {
    const drop = new Set(cleanAsks(text.slice(1).split(/[\s,]+/)))
    return current.filter(w => !drop.has(w))
  }
  return cleanAsks([...current, ...text.replace(/^=/, '').split(/[\s,]+/)])
}

/** What a room asks, read from the tiles the room shares on this page: the
 *  host's template tiles when the room has any, else every tile shared live.
 *  `layerOf` reads a layer by its signature (fetching it when it is not here). */
export async function roomAsks(
  tiles: readonly { name: string; layerSig?: unknown; template?: boolean }[],
  layerOf: (sig: string) => Promise<unknown>,
): Promise<string[]> {
  const sig = (t: { layerSig?: unknown }): string => String(t.layerSig ?? '')
  const usable = tiles.filter(t => /^[0-9a-f]{64}$/.test(sig(t)))
  const template = usable.filter(t => t.template)
  const from = template.length ? template : usable
  const seen = new Set<string>()
  const out: string[] = []
  for (const t of from) {
    const key = moleculeKey(t.name) + ':' + sig(t)
    if (seen.has(key)) continue
    seen.add(key)
    let layer: unknown = null
    try { layer = await layerOf(sig(t)) } catch { layer = null }
    for (const word of readAsks(layer)) if (!out.includes(word)) out.push(word)
  }
  return out.slice(0, ROOM_ASKS_MAX)
}

/** Split asked words into what this shell can turn on and what it lacks. */
export function sortAsks(asked: readonly string[], known: (word: string) => boolean): { have: string[]; lack: string[] } {
  const have: string[] = []
  const lack: string[] = []
  for (const word of asked) (known(word) ? have : lack).push(word)
  return { have, lack }
}

type PeerTilesShape = { peerTilesAtCurrentSig?: () => readonly { name: string; layerSig?: unknown; template?: boolean }[] }
type LayerReadShape = { getLayerBySig(sig: string): Promise<Record<string, unknown> | null> }
type FetchShape = { fetchBySig?(sig: string, type: 'layer' | 'resource', timeoutMs?: number): Promise<unknown> }

const iocGet = <T>(key: string): T | undefined =>
  (globalThis as { ioc?: { get?: <V>(k: string) => V | undefined } }).ioc?.get?.<T>(key)

/** What the room on this page asks, read from the swarm's tiles here — a
 *  layer that is not held yet is fetched from whoever shares it. */
export async function currentRoomAsks(): Promise<string[]> {
  const swarm = iocGet<PeerTilesShape>('@diamondcoreprocessor.com/SwarmDrone')
  const history = iocGet<LayerReadShape>('@diamondcoreprocessor.com/HistoryService')
  if (!swarm?.peerTilesAtCurrentSig || !history) return []
  const broker = iocGet<FetchShape>('@diamondcoreprocessor.com/ContentBrokerDrone')
  return roomAsks(swarm.peerTilesAtCurrentSig(), async (sig) => {
    const held = await history.getLayerBySig(sig).catch(() => null)
    if (held) return held
    await Promise.resolve(broker?.fetchBySig?.(sig, 'layer', 8_000)).catch(() => null)
    return history.getLayerBySig(sig).catch(() => null)
  })
}
