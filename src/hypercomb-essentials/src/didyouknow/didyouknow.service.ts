// didyouknow/didyouknow.service.ts
//
// DID YOU KNOW, THE EXERCISE (documentation/did-you-know.md).
//
// Played on the notes the swarm already shares, with the swarm's own acts:
//
//   START    `start did you know` mints the game's tile on the page you stand
//            on (or finds it) and opens the notes desk on it.
//   SHARE    `did-you-know <idea>` writes your idea as a note on that tile —
//            making the tile on your page first when it is not there, so the
//            room hears it. The desk shows everyone's ideas as plain words:
//            on this tile it hides who brought each one (the concealment
//            rule below) until the game is revealed.
//   REVEAL   `reveal` writes ONE note on the tile listing every idea with its
//            name. That note is the whole signal: the desk, finding it among
//            the tile's notes, shows names again — on every participant's
//            screen, with no second channel.
//   COLLECT  `collect` takes the room's ideas onto your own tile — the swarm's
//            take, the same signature (shared, never copied) — so each
//            participant keeps a list of ideas to go back to and learn from.
//
// WHO BROUGHT WHAT. The host's hive keeps a LEDGER of the ideas it has seen —
// per note, its words and the first participant seen holding it — because a
// participant who leaves takes their untaken notes with them. The reveal is
// written from the ledger plus the host's own notes: it names what this hive
// has seen, never more. In memory only, for the game being played.
//
// WHAT ANONYMOUS MEANS HERE. The ideas travel as each participant's own signed
// notes, so the room's keys ride the wire as they do for every note. The game
// hides the NAME from the screen; it is not a mix-net. It is an exercise
// among people in one room, and the doc says so.
//
// A dependency: the drone (didyouknow.drone.ts) registers it.

import { EffectBus, hypercomb } from '@hypercomb/core'
import { readChildrenStrict, type PlacementHistory } from '../history/layer-placement.js'
import { isJoinedHere } from '../sharing/membership.js'
import { GAME_NAME, IDEA_MAX, bringers, cleanIdea, isGame, isRevealNote, revealText, type Idea } from './didyouknow.js'

/** The room's ideas are read a moment after the room or the page changes. */
const SYNC_MS = 1_200

type LineageShape = { explorerSegments?: () => readonly string[]; domain?: unknown }
type CommitterShape = { settled?: () => Promise<void> }
type SwarmShape = {
  peerTilesAtCurrentSig?: () => readonly { name: string; peerPubkey: string }[]
  labelFor?: (pubkey: string) => string
  myLabel?: () => string
}
type NotesShape = {
  getNotesAtSegments: (segments: readonly string[]) => Promise<{ id: string; text: string }[]>
  addAtSegments: (parent: readonly string[], cell: string, text: string) => Promise<void>
}
type SwarmNotesShape = {
  refresh: (cell: string) => Promise<void>
  rootsFor: (cell: string) => readonly { note: { id: string; text: string }; by: string; holders: readonly string[] }[]
  take: (cell: string, ids: readonly string[]) => Promise<string[]>
  labelOf: (pubkey: string) => string
  seenAt: (id: string) => number | undefined
}
type SignerShape = { getPublicKeyHex?: () => Promise<string | null> }

const get = <T>(key: string): T | undefined =>
  (window as { ioc?: { get?: <V>(k: string) => V | undefined } }).ioc?.get?.<T>(key)

export type StartOutcome = { outcome: 'started' | 'resumed'; where: string }
export type ShareOutcome = 'shared' | 'empty' | 'long' | 'exists' | 'failed'
export type RevealOutcome = { ideas: number; people: number } | 'none' | 'already'
export type CollectOutcome = { taken: number; waiting: number } | 'none'

export class DidYouKnow extends EventTarget {
  /** The ledger: note id → its words and the first participant seen holding
   *  it. Insertion order is the order ideas were first seen. */
  #seen = new Map<string, { text: string; by: string }>()
  #syncTimer: ReturnType<typeof setTimeout> | null = null
  #syncing = false
  #me = ''

  constructor() {
    super()
    // The room moved, a page rendered, a note landed: read the ideas into the
    // ledger while they are here to be read.
    EffectBus.on('swarm:peers-changed', () => this.#scheduleSync())
    EffectBus.on('render:cell-count', () => this.#scheduleSync())
    EffectBus.on('notes:changed', () => this.#scheduleSync())
    window.ioc.whenReady<SwarmNotesShape & EventTarget>('@diamondcoreprocessor.com/SwarmNotes', (swarmNotes) => {
      swarmNotes.addEventListener('change', (e) => {
        const cell = String((e as CustomEvent<{ cell?: string }>).detail?.cell ?? '')
        if (cell && isGame(cell)) this.#record(swarmNotes, cell)
      })
    })
  }

  /** What the ledger has seen, in the order it was first seen. */
  seen(): ReadonlyMap<string, { text: string; by: string }> { return this.#seen }

  // ── start ──────────────────────────────────────────────────────────────

  /** Start the game on the page you stand on: the game's tile is made here
   *  unless it already is, and the notes desk opens on it. */
  async start(): Promise<StartOutcome> {
    const here = this.#segments()
    const held = await this.#tileHere(here)
    const name = held ?? await this.#mint(here)
    if (name) this.open(name)
    return { outcome: held ? 'resumed' : 'started', where: [...here, name ?? GAME_NAME].join('/') }
  }

  // ── share ──────────────────────────────────────────────────────────────

  /** Share an idea: a note on the game's tile. The tile is made on your page
   *  first when it is not there, so your notes reach the room. */
  async share(text: string): Promise<ShareOutcome> {
    const idea = cleanIdea(text)
    if (!idea) return 'empty'
    if (idea.length > IDEA_MAX) return 'long'
    const notes = get<NotesShape>('@diamondcoreprocessor.com/NotesService')
    if (!notes) return 'failed'
    const here = this.#segments()
    const name = (await this.#tileHere(here)) ?? (await this.#mint(here))
    if (!name) return 'failed'
    const own = await notes.getNotesAtSegments([...here, name])
    if (own.some(n => cleanIdea(n.text) === idea)) return 'exists'
    await notes.addAtSegments(here, name, idea)
    await this.#settled()
    // Sharing is the way in to reading: the desk opens on the tile.
    this.open(name)
    this.dispatchEvent(new CustomEvent('change'))
    return 'shared'
  }

  /** The notes desk on the game's tile, composer ready. */
  open(label: string): void {
    const cell = String(label ?? '').trim()
    if (!cell) return
    EffectBus.emit('notes:panel', { visible: true })
    EffectBus.emit('note:capture', { cellLabel: cell })
  }

  // ── reveal ─────────────────────────────────────────────────────────────

  /** Reveal who brought what: one note on the tile, every idea with its name.
   *  The desk shows names again wherever that note is among the tile's notes. */
  async reveal(): Promise<RevealOutcome> {
    const here = this.#segments()
    const name = await this.#tileHere(here) ?? this.#peerTile()
    const notes = get<NotesShape>('@diamondcoreprocessor.com/NotesService')
    if (!name || !notes) return 'none'
    const swarmNotes = get<SwarmNotesShape>('@diamondcoreprocessor.com/SwarmNotes')
    await this.#whoAmI()
    if (swarmNotes && isJoinedHere()) {
      try { await swarmNotes.refresh(name); this.#record(swarmNotes, name) } catch { /* what did not arrive is not named */ }
    }
    const own = await notes.getNotesAtSegments([...here, name])
    if (own.some(n => isRevealNote(n.text))) return 'already'
    if (swarmNotes?.rootsFor(name).some(r => isRevealNote(r.note.text))) return 'already'
    const ideas = this.#ideas(own, swarmNotes)
    if (!ideas.length) return 'none'
    const swarm = get<SwarmShape>('@diamondcoreprocessor.com/SwarmDrone')
    const labelOf = (pubkey: string): string =>
      (pubkey === this.#me ? swarm?.myLabel?.() : swarmNotes?.labelOf(pubkey) || swarm?.labelFor?.(pubkey)) || pubkey.slice(0, 8) || 'host'
    // The tile the reveal lands on is this hive's own: make it here first.
    const mine = await this.#tileHere(here) ?? await this.#mint(here)
    if (!mine) return 'none'
    await notes.addAtSegments(here, mine, revealText(ideas, labelOf))
    await this.#settled()
    this.dispatchEvent(new CustomEvent('change'))
    return { ideas: ideas.length, people: bringers(ideas) }
  }

  /** Every idea this hive knows, with who brought it: what the ledger saw,
   *  then the host's own notes (theirs unless the room showed them first as
   *  someone else's — then they were taken and stay that person's). Ordered
   *  as the desk first saw them. */
  #ideas(own: readonly { id: string; text: string }[], swarmNotes: SwarmNotesShape | undefined): Idea[] {
    const out: Idea[] = []
    const done = new Set<string>()
    for (const [id, entry] of this.#seen) {
      if (!entry.text || isRevealNote(entry.text)) continue
      out.push({ id, text: entry.text, by: entry.by })
      done.add(id)
    }
    for (const n of own) {
      if (done.has(n.id) || isRevealNote(n.text)) continue
      out.push({ id: n.id, text: n.text, by: this.#me })
    }
    const order = (id: string): number => swarmNotes?.seenAt(id) ?? Number.POSITIVE_INFINITY
    return out
      .map((idea, i) => ({ idea, i }))
      .sort((a, b) => (order(a.idea.id) - order(b.idea.id)) || (a.i - b.i))
      .map(x => x.idea)
  }

  // ── collect ────────────────────────────────────────────────────────────

  /** Collect the room's ideas onto your own tile — the swarm's take: the same
   *  signatures, shared and never copied. The reveal is not an idea and is
   *  left where it is. Ideas whose bytes have not arrived yet are counted as
   *  waiting; saying `collect` again brings them. */
  async collect(): Promise<CollectOutcome> {
    const swarmNotes = get<SwarmNotesShape>('@diamondcoreprocessor.com/SwarmNotes')
    if (!swarmNotes || !isJoinedHere()) return 'none'
    const here = this.#segments()
    if (!(await this.#tileHere(here)) && !this.#peerTile()) return 'none'
    // The ideas land on a tile of yours: make it before taking.
    const mine = await this.#tileHere(here) ?? await this.#mint(here)
    if (!mine) return 'none'
    await swarmNotes.refresh(mine)
    this.#record(swarmNotes, mine)
    const ids = swarmNotes.rootsFor(mine).filter(r => !isRevealNote(r.note.text)).map(r => r.note.id)
    if (!ids.length) return { taken: 0, waiting: 0 }
    const waiting = (await swarmNotes.take(mine, ids)).length
    this.dispatchEvent(new CustomEvent('change'))
    return { taken: ids.length - waiting, waiting }
  }

  // ── the ledger ─────────────────────────────────────────────────────────

  /** Record the ideas the room shows on `cell` right now. The first
   *  participant seen holding an idea is its bringer, and stays so after
   *  they leave or someone takes it. */
  #record(swarmNotes: SwarmNotesShape, cell: string): void {
    try {
      for (const r of swarmNotes.rootsFor(cell)) {
        if (isRevealNote(r.note.text) || this.#seen.has(r.note.id)) continue
        this.#seen.set(r.note.id, { text: r.note.text, by: r.by })
      }
    } catch { /* not in a room, or the cell is not on this page */ }
  }

  /** A moment after the room or the page changes: read the game's tile into
   *  the ledger, wherever it is held on the page you stand on. */
  #scheduleSync(): void {
    if (this.#syncTimer) clearTimeout(this.#syncTimer)
    this.#syncTimer = setTimeout(() => {
      this.#syncTimer = null
      if (this.#syncing || !isJoinedHere()) return
      this.#syncing = true
      void (async () => {
        const swarmNotes = get<SwarmNotesShape>('@diamondcoreprocessor.com/SwarmNotes')
        if (!swarmNotes) return
        const name = await this.#tileHere(this.#segments()) ?? this.#peerTile()
        if (!name) return
        await this.#whoAmI()
        try { await swarmNotes.refresh(name); this.#record(swarmNotes, name) } catch { /* next time */ }
      })().finally(() => { this.#syncing = false })
    }, SYNC_MS)
  }

  async #whoAmI(): Promise<string> {
    if (!this.#me) {
      try { this.#me = (await get<SignerShape>('@diamondcoreprocessor.com/NostrSigner')?.getPublicKeyHex?.()) ?? '' } catch { /* unsigned */ }
    }
    return this.#me
  }

  // ── the tile ───────────────────────────────────────────────────────────

  /** The name of the game's tile on this hive's page, or null. */
  async #tileHere(page: readonly string[]): Promise<string | null> {
    const history = get<PlacementHistory>('@diamondcoreprocessor.com/HistoryService')
    const lineage = get<LineageShape>('@hypercomb.social/Lineage')
    if (!history || !lineage) return null
    try {
      const rows = await readChildrenStrict(history, lineage.domain, page)
      return rows?.find(r => isGame(r.name))?.name ?? null
    } catch { return null }
  }

  /** The game's tile as a peer holds it on the page in front of you. */
  #peerTile(): string | null {
    const peers = get<SwarmShape>('@diamondcoreprocessor.com/SwarmDrone')?.peerTilesAtCurrentSig?.() ?? []
    return peers.find(t => isGame(t.name))?.name ?? null
  }

  /** Make the game's tile on this page through the same add the `create`
   *  word runs; a tile made in the swarm is shared. Returns its name. */
  async #mint(page: readonly string[]): Promise<string | null> {
    EffectBus.emit('cell:added', { cell: GAME_NAME, segments: [...page] })
    await new hypercomb().act()
    await this.#settled()
    return this.#tileHere(page)
  }

  async #settled(): Promise<void> {
    try { await get<CommitterShape>('@diamondcoreprocessor.com/LayerCommitter')?.settled?.() } catch { /* unacknowledged: proceed */ }
  }

  #segments(): string[] {
    const lineage = get<LineageShape>('@hypercomb.social/Lineage')
    return (lineage?.explorerSegments?.() ?? []).map(s => String(s ?? '').trim()).filter(Boolean)
  }
}
