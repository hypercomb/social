// notes/swarm-notes.service.ts
//
// NOTES IN THE SWARM — notes are one thing, and the swarm is a property of
// them (jwize 2026-10-13: "we should always be able to do this in a swarm, so
// no reason to recreate the notes").
//
// No new wire. A tile's notes live in its layer's `notes` slot, and every tile
// a participant shares already crosses the room as a visual carrying its
// `layerSig`. So a peer's notes on a tile are simply the `notes` slot of THEIR
// layer for that tile — read by signature (the broker, mesh-first from their
// device while they are in the room), resolved by the notes service exactly as
// this hive resolves its own. Same acts as tiles:
//
//   * everyone's notes on a tile show in the one notes tree, each root in the
//     colour of the participant who brought it;
//   * TAKE appends the same signature to your tile — shared, never copied, so
//     a note thirty people hold is one file;
//   * leaving takes your untaken notes with you; taken ones stay.
//
// A service, not a surface: the notes desk reads it through IoC
// (`@diamondcoreprocessor.com/SwarmNotes`) and paints. It writes nothing of
// its own — a take goes through the notes service.

import { EffectBus, moleculeKey } from '@hypercomb/core'
import { isJoinedHere } from '../sharing/membership.js'
import { isCellPublic, setCellPublic } from '../presentation/tiles/tile-public.js'
import { foldPeerRoots, participantColor, type PeerNoteRoot, type SwarmNote, type SwarmNoteCounts } from './swarm-notes.js'

export const SWARM_NOTES_KEY = '@diamondcoreprocessor.com/SwarmNotes'

type PeerTile = { name: string; peerPubkey: string; layerSig?: unknown }
type SwarmShape = {
  peerTilesAtCurrentSig?: () => readonly PeerTile[]
  participantsInZone?: () => readonly string[]
  labelFor?: (pubkey: string) => string
}
type NotesShape = {
  notesOfEntries(entries: readonly unknown[]): Promise<SwarmNote[]>
  takeAtSegments(parent: readonly string[], label: string, sigs: readonly string[]): Promise<string[]>
}
type HistoryShape = { getLayerBySig(sig: string): Promise<Record<string, unknown> | null> }
type StoreShape = { getResource?: (sig: string) => Promise<Blob | null> }
type BrokerShape = { fetchBySig?: (sig: string, type: 'layer' | 'resource', timeoutMs?: number) => Promise<Uint8Array | null> }
type LineageShape = { explorerSegments?: () => readonly string[] }

const SIG = /^[0-9a-f]{64}$/
const FETCH_TIMEOUT_MS = 8_000
/** Bytes walked per note tree — a lecture's list, not a library. */
const WALK_MAX = 400

const get = <T>(key: string): T | undefined =>
  (window as { ioc?: { get?: <V>(k: string) => V | undefined } }).ioc?.get?.<T>(key)

export class SwarmNotes extends EventTarget {
  #pageKey = ''
  #roots = new Map<string, PeerNoteRoot[]>()
  #heldMine = new Map<string, Map<string, string[]>>()
  #firstHolder = new Map<string, string>()
  /** When this desk first saw each root on this page — yours and everyone's.
   *  A note carries no time; arrival order is what makes the room ONE list. */
  #firstSeen = new Map<string, number>()
  #reading = new Map<string, Promise<void>>()
  #again = new Set<string>()

  constructor() {
    super()
    // The room moved or a peer's word changed: every tile read so far is stale.
    for (const effect of ['swarm:peers-changed', 'swarm:roster-changed']) {
      EffectBus.on(effect, () => { for (const cell of this.#roots.keys()) void this.refresh(cell) })
    }
    EffectBus.on<{ segments?: readonly string[]; sigs?: readonly string[] }>('notes:changed', (p) => { void this.#shareFirstNote(p) })
  }

  /** WRITE AND SHARE BY DEFAULT. Your FIRST note on a tile the room shares,
   *  written (or taken) in the swarm, shares your tile — as a tile made in
   *  the swarm is shared — so your notes reach the room. Nothing private
   *  rides along: you had no notes there. A tile that already holds notes
   *  keeps whatever you chose for it. */
  async #shareFirstNote(p: { segments?: readonly string[]; sigs?: readonly string[] } | undefined): Promise<void> {
    const segments = (p?.segments ?? []).map(s => String(s ?? '').trim()).filter(Boolean)
    if (!isJoinedHere() || segments.length === 0 || (p?.sigs ?? []).length !== 1) return
    const here = this.#segments()
    const parent = segments.slice(0, -1)
    if (parent.length !== here.length || parent.some((s, i) => s !== here[i])) return
    const cell = segments[segments.length - 1]
    const location = '/' + parent.join('/')
    if (isCellPublic(location, cell)) return
    const key = moleculeKey(cell)
    const swarm = get<SwarmShape>('@diamondcoreprocessor.com/SwarmDrone')
    if (!(swarm?.peerTilesAtCurrentSig?.() ?? []).some(t => moleculeKey(t.name) === key)) return
    // Notes written on a name are not yet a tile ON your page — the room only
    // hears the tiles a page holds. Make it one through the create commit the
    // `create` word runs; a tile made in the swarm is shared by default.
    if (!(await this.#pageHolds(parent, key))) {
      EffectBus.emitTransient('command:create-cells', { name: cell, accept: () => {}, complete: () => {} })
      return
    }
    setCellPublic(location, cell, true)
    EffectBus.emit('tile:public-changed', { cell, location, public: true })
  }

  /** Does the page at `segments` hold a tile named (folded) `key`? */
  async #pageHolds(segments: readonly string[], key: string): Promise<boolean> {
    const history = get<HistoryShape & {
      sign(l: { explorerSegments: () => readonly string[] }): Promise<string>
      currentLayerAt(sig: string): Promise<{ children?: unknown } | null>
    }>('@diamondcoreprocessor.com/HistoryService')
    if (!history) return true
    try {
      const layer = await history.currentLayerAt(await history.sign({ explorerSegments: () => segments }))
      const children = Array.isArray(layer?.children) ? layer!.children as unknown[] : []
      for (const sig of children) {
        if (typeof sig !== 'string') continue
        const name = (await history.getLayerBySig(sig))?.['name']
        if (typeof name === 'string' && moleculeKey(name) === key) return true
      }
      return false
    } catch { return true }
  }

  /** Peer roots on `cell` (a tile of the page this tab stands on) as of the
   *  last read. Synchronous; `refresh` reads. Empty outside a swarm. */
  rootsFor(cell: string): readonly PeerNoteRoot[] {
    this.#syncPage()
    return isJoinedHere() ? (this.#roots.get(moleculeKey(cell)) ?? []) : []
  }

  /** Peers also holding one of YOUR roots on `cell` (id → pubkeys). */
  holdersOfMine(cell: string): ReadonlyMap<string, readonly string[]> {
    this.#syncPage()
    return this.#heldMine.get(moleculeKey(cell)) ?? new Map()
  }

  /** The room on `cell`, counted — `own` is how many roots you hold there. */
  counts(cell: string, own: number): SwarmNoteCounts {
    const swarm = get<SwarmShape>('@diamondcoreprocessor.com/SwarmDrone')
    const open = this.rootsFor(cell).length
    return {
      people: (swarm?.participantsInZone?.() ?? []).length + 1,
      notes: own + open,
      yours: own,
      open,
    }
  }

  /** Who a pubkey is, for a row's author label. */
  labelOf(pubkey: string): string {
    return get<SwarmShape>('@diamondcoreprocessor.com/SwarmDrone')?.labelFor?.(pubkey) || pubkey.slice(0, 8)
  }

  colorOf(pubkey: string): string { return participantColor(pubkey) }

  /** When this desk first saw the root `id`, or undefined (not seen yet —
   *  a line just written, still on its way). */
  seenAt(id: string): number | undefined { return this.#firstSeen.get(id) }

  /** Read every peer's notes on `cell`. Coalesced per tile: a read asked for
   *  while one runs runs once more after it. Dispatches 'change' with
   *  `{ detail: { cell } }` when it lands. */
  refresh(cell: string): Promise<void> {
    const key = moleculeKey(cell)
    const running = this.#reading.get(key)
    if (running) { this.#again.add(key); return running }
    const run = this.#read(cell, key).finally(() => {
      this.#reading.delete(key)
      if (this.#again.delete(key)) void this.refresh(cell)
    })
    this.#reading.set(key, run)
    return run
  }

  /** TAKE: the same signatures onto your `cell`, their bytes made local first
   *  (a note tree comes whole). Returns the ones that could not be taken. */
  async take(cell: string, ids: readonly string[]): Promise<string[]> {
    const segments = this.#segments()
    const notes = get<NotesShape>('@diamondcoreprocessor.com/NotesService')
    if (!notes) return [...ids]
    for (const id of ids) await this.#ensure(id, 'resource', new Set())
    return notes.takeAtSegments(segments, cell, ids)
  }

  // ── read ────────────────────────────────────────────────────

  async #read(cell: string, key: string): Promise<void> {
    this.#syncPage()
    const swarm = get<SwarmShape>('@diamondcoreprocessor.com/SwarmDrone')
    const notes = get<NotesShape>('@diamondcoreprocessor.com/NotesService')
    const history = get<HistoryShape>('@diamondcoreprocessor.com/HistoryService')
    if (!swarm || !notes || !history || !isJoinedHere()) { this.#set(cell, key, [], new Map()); return }
    const tiles = (swarm.peerTilesAtCurrentSig?.() ?? [])
      .filter(t => typeof t.layerSig === 'string' && SIG.test(t.layerSig) && moleculeKey(t.name) === key)
    const peers: { pubkey: string; notes: SwarmNote[] }[] = []
    await Promise.all(tiles.map(async (t) => {
      const layerSig = t.layerSig as string
      let layer = await history.getLayerBySig(layerSig).catch(() => null)
      if (!layer) {
        await this.#ensure(layerSig, 'layer', new Set())
        layer = await history.getLayerBySig(layerSig).catch(() => null)
      }
      const slot = Array.isArray(layer?.['notes']) ? layer!['notes'] as unknown[] : []
      if (slot.length === 0) return
      const seen = new Set<string>()
      for (const entry of slot) if (typeof entry === 'string') await this.#ensure(entry, 'resource', seen)
      const trees = await notes.notesOfEntries(slot).catch(() => [])
      if (trees.length > 0) peers.push({ pubkey: t.peerPubkey, notes: trees })
    }))
    const own = await this.#ownRootIds(cell)
    const { roots, heldMine } = foldPeerRoots(own, peers, this.#firstHolder)
    // Stamp what is new, yours in your order first: the room reads as one
    // list in the order its lines arrived here.
    let tick = 0
    const now = Date.now()
    for (const id of [...own, ...roots.map(r => r.note.id)]) {
      if (!this.#firstSeen.has(id)) this.#firstSeen.set(id, now + tick++ / 1000)
    }
    this.#set(cell, key, roots, heldMine)
  }

  #set(cell: string, key: string, roots: PeerNoteRoot[], heldMine: Map<string, string[]>): void {
    const before = JSON.stringify([this.#roots.get(key)?.map(r => [r.note.id, r.holders, r.note.children.length]) ?? [], [...(this.#heldMine.get(key) ?? new Map())]])
    this.#roots.set(key, roots)
    this.#heldMine.set(key, heldMine)
    const after = JSON.stringify([roots.map(r => [r.note.id, r.holders, r.note.children.length]), [...heldMine]])
    if (before !== after) this.dispatchEvent(new CustomEvent('change', { detail: { cell } }))
  }

  async #ownRootIds(cell: string): Promise<string[]> {
    const notes = get<{ getNotes?: (c: string) => Promise<{ id: string }[]> }>('@diamondcoreprocessor.com/NotesService')
    try { return (await notes?.getNotes?.(cell) ?? []).map(n => n.id) } catch { return [] }
  }

  /** Make `sig` and every signature its JSON names local — a note, its meta
   *  envelope, its children — fetched from whoever holds them. Bounded. */
  async #ensure(sig: string, type: 'layer' | 'resource', seen: Set<string>): Promise<void> {
    if (!SIG.test(sig) || seen.has(sig) || seen.size >= WALK_MAX) return
    seen.add(sig)
    const store = get<StoreShape>('@hypercomb.social/Store')
    let blob = await store?.getResource?.(sig).catch(() => null) ?? null
    if (!blob) {
      const broker = get<BrokerShape>('@diamondcoreprocessor.com/ContentBrokerDrone')
      const bytes = await broker?.fetchBySig?.(sig, type, FETCH_TIMEOUT_MS).catch(() => null)
      if (!bytes) return
      blob = new Blob([bytes as BlobPart])
    }
    if (type === 'layer' || blob.size > 64 * 1024) return
    let parsed: unknown
    try { parsed = JSON.parse(await blob.text()) } catch { return }
    for (const next of nestedSigs(parsed)) await this.#ensure(next, 'resource', seen)
  }

  #syncPage(): void {
    const key = this.#segments().join('/')
    if (key === this.#pageKey) return
    this.#pageKey = key
    this.#roots.clear()
    this.#heldMine.clear()
    this.#firstHolder.clear()
    this.#firstSeen.clear()
  }

  #segments(): string[] {
    const lineage = get<LineageShape>('@hypercomb.social/Lineage')
    return (lineage?.explorerSegments?.() ?? []).map(s => String(s ?? '').trim()).filter(Boolean)
  }
}

/** Every 64-hex string anywhere in a parsed JSON value. */
function nestedSigs(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') { const v = value.toLowerCase(); if (SIG.test(v)) out.push(v) }
  else if (Array.isArray(value)) for (const v of value) nestedSigs(v, out)
  else if (value && typeof value === 'object') for (const v of Object.values(value)) nestedSigs(v, out)
  return out
}

