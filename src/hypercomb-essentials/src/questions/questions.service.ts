// questions/questions.service.ts
//
// HYPERCOMB Q AND A, THE GAME (documentation/hypercomb-q-and-a.md).
//
// Played on the hive in a swarm room, with the swarm's own acts:
//
//   START   `start hypercomb q and a` mints the game's tile on the page you
//           stand on (or finds it), walks you in, and makes you the
//           ORGANIZER of the game's tree: as questions arrive, your hive
//           takes them and settles them into categories.
//   ASK     `question <text>` makes a tile named with the question (the
//           hive's spelling), titled with the question as asked, and marked.
//           In a swarm a tile made here is shared, so the room sees it.
//   ANSWER  a question tile OPENS the notes desk on itself instead of being
//           walked into; an answer is a note on the question, everyone's
//           answers show through the swarm notes, colour per participant,
//           Take collects one — so the count of who holds an answer is its
//           score. No new wire, no new store.
//   SETTLE  the organizer's pass over the game's WHOLE TREE: take the room's
//           questions on the page they stand on, then on every page of the
//           tree have Jev (or the participant's own AI) file each question
//           into a category — new names from the namer when none fits —
//           and let the pure settlePlan say what materializes and what
//           retracts, applied with the one move primitive drag-into uses.
//   TALLY   `tally` writes, on each question of the tree, its answers ranked
//           by takes, and one scoreboard on the game's tile — notes, so the
//           room reads them and the host's copy stays with the room.
//
// WHAT A TAKE CARRIES. Taking a peer's tile folds its admitted projection —
// name, titles, picture, properties — never its decoration records. So a
// question taken from the room arrives without its mark, and the game reads
// questions by their TITLE inside the game (a sentence ending in a question
// mark) and gives each one the mark again in the hive that took it. The game
// itself is read by NAME: a tile called `hypercomb q and a` is the game.
//
// THE LEDGER. The swarm is read for the page you stand on: peers' answers
// to a question reach this hive only while it stands where that question
// is. So the organizer's hive keeps a LEDGER of the answers it has seen —
// per question, each answer's words, who gave it, and everyone ever seen
// holding it — fed by every swarm-notes read while standing on a page and
// by the reads this service asks for as the room changes. The tally over the
// tree counts what this hive holds plus what the ledger saw; it never counts
// what nobody here has seen. In memory only, for the game being played.
//
// A dependency: the drone (questions.drone.ts) registers it.

import { EffectBus, hypercomb, moleculeKey, normalizeCell } from '@hypercomb/core'
import { callModel, configuredProviders } from '../assistant/llm-dispatch.js'
import { llmHiveAccess } from '../assistant/llm-hive-access.js'
import { ensureDecorationsIndexed, hasDecorationKindAt, titlesForSegments } from '../commands/decoration-kind-index.js'
import { replaceDecoration } from '../commands/decoration-manifest.js'
import { removeTilesAt } from '../commands/remove-tiles.js'
import { readChildrenStrict, type PlacementHistory } from '../history/layer-placement.js'
import { isJoinedHere } from '../sharing/membership.js'
import {
  BOARD_MARK, GAME_NAME, MIN_TO_MATERIALIZE, QUESTION_KIND, TALLY_MARK,
  boardText, inGame, isQuestionTitle, isTallyNote, parseCategoryNames, parsePlacedIndexes, scoreboard, settlePlan, tallyText,
  type Answer, type PageTile, type Placement, type QuestionAnswers, type SettlePlan,
} from './questions.js'

/** New questions settle a moment after they arrive, as one pass. */
const SETTLE_MS = 4_000
/** A page's taken questions are marked and its answers read a moment after
 *  it renders or the room changes. */
const SYNC_MS = 1_200
/** A create that never says it completed stops waiting here. */
const CREATE_MS = 8_000
/** A click on a peer's question opens it only if the take lands this soon. */
const WAND_MS = 15_000
const SORT_BATCH = 24
/** How deep the game's tree is walked: the game, categories, categories
 *  inside those. */
const TREE_DEPTH = 3
const TREE_PAGES = 64

const SUGGEST_SYSTEM = 'People in a room asked these questions. Name categories that group them. Answer with category names only, one per line, two to four words each, no numbering, no explanation. Prefer few broad categories; every category must fit at least two of the questions. Reuse an existing category name when it fits.'
const SORT_SYSTEM = 'You file questions into categories. Answer with one JSON array of integers, one per question in the order given: the index of the category that clearly fits, or -1 when none does. No other text.'

type LineageShape = { explorerSegments?: () => readonly string[]; domain?: unknown }
type NavigationShape = { goRaw?: (segments: readonly string[]) => void }
type CommitterShape = { settled?: () => Promise<void> }
type MoveShape = { commitMoveInto?: (labels: readonly string[], source: readonly string[], target: readonly string[]) => Promise<readonly string[]> }
type SwarmShape = {
  peerTilesAtCurrentSig?: () => readonly { name: string; peerPubkey: string }[]
  labelFor?: (pubkey: string) => string
}
type AdoptShape = { wandEligible?: (label: string) => boolean }
type NotesShape = {
  getNotesAtSegments: (segments: readonly string[]) => Promise<{ id: string; text: string }[]>
  addAtSegments: (parent: readonly string[], cell: string, text: string) => Promise<void>
}
type SwarmNotesShape = {
  refresh: (cell: string) => Promise<void>
  rootsFor: (cell: string) => readonly { note: { id: string; text: string }; by: string; holders: readonly string[] }[]
  holdersOfMine: (cell: string) => ReadonlyMap<string, readonly string[]>
  labelOf: (pubkey: string) => string
}
type JevShape = {
  readyForHive?: () => boolean
  sort?: (raw: { notes: readonly string[]; categories: readonly string[] }) => Promise<{ placed: readonly number[] }>
}
type SignerShape = { getPublicKeyHex?: () => Promise<string | null> }
type DecorationsShape = { setTitle?: (segments: readonly string[], text: string, locale?: string) => Promise<unknown> }

/** One answer as the ledger remembers it. */
export interface SeenAnswer { readonly text: string; readonly by: string; readonly holders: ReadonlySet<string> }

const get = <T>(key: string): T | undefined =>
  (window as { ioc?: { get?: <V>(k: string) => V | undefined } }).ioc?.get?.<T>(key)

export type StartOutcome = { outcome: 'started' | 'resumed'; where: string }
export type AskOutcome = 'asked' | 'empty' | 'exists' | 'failed'
export type TallyOutcome = { pages: number; questions: number; answers: number; leader: string; takes: number }
export type SettleOutcome = { pages: number; moved: number; categories: number; sorter: 'jev' | 'ai' | 'none' }

export class Questions extends EventTarget {
  /** The game this hive organizes, while it does — the game tile's path. */
  #organizing: readonly string[] | null = null
  #timer: ReturnType<typeof setTimeout> | null = null
  #syncTimer: ReturnType<typeof setTimeout> | null = null
  #settling: Promise<SettleOutcome> | null = null
  #syncing = false
  #again = false
  #saidNoAi = false
  /** The ledger: question (folded name) → answer id → what was seen. */
  #seen = new Map<string, Map<string, { text: string; by: string; holders: Set<string> }>>()
  /** Categories this settle minted (page key → folded names). Only these
   *  retract when they thin; a tile the host laid out is theirs to keep. */
  #minted = new Map<string, Set<string>>()
  /** Peer tiles the participant clicked in the game (folded name → when),
   *  waiting for the take to land so the question can open. */
  #wanded = new Map<string, number>()
  #me = ''

  constructor() {
    super()
    EffectBus.on('swarm:peers-changed', () => { this.#schedule(); this.#scheduleSync() })
    EffectBus.on('swarm:roster-changed', () => this.#schedule())
    EffectBus.on<{ segments?: readonly string[] }>('cell:added', () => this.#schedule())
    // Everyone in the game, organizer or not: a question taken from the room
    // gets its mark back once the page shows it (so clicking it opens), and
    // the answers on the page are read into the ledger.
    EffectBus.on('render:cell-count', () => this.#scheduleSync())
    EffectBus.on('notes:changed', () => this.#scheduleSync())
    // ONE CLICK ON SOMEONE ELSE'S QUESTION. In a swarm a click on a peer's
    // tile is the wand — it takes the tile. Inside the game the participant
    // clicked a question to answer it, so once the take lands and the tile
    // reads as a question, its answers open; a take the organizer asked for
    // itself (`tile:action`, not the wand) opens nothing.
    EffectBus.on<{ label?: string }>('swarm:wand', (p) => {
      const label = String(p?.label ?? '').trim()
      if (label && inGame(this.#segments())) this.#wanded.set(moleculeKey(label), Date.now())
    })
    EffectBus.on<{ parentSegments?: readonly string[]; name?: string }>('swarm:visit-folded', (p) => { void this.#openIfWanted(p) })
    window.ioc.whenReady<SwarmNotesShape & EventTarget>('@diamondcoreprocessor.com/SwarmNotes', (swarmNotes) => {
      swarmNotes.addEventListener('change', (e) => {
        const cell = String((e as CustomEvent<{ cell?: string }>).detail?.cell ?? '')
        if (cell) this.#record(swarmNotes, cell)
      })
    })
  }

  /** The game this hive is organizing, or null. */
  organizing(): readonly string[] | null { return this.#organizing }

  /** The last settle pass, page by page — what the page held, what the plan
   *  said, how many moved — for anyone checking the game's state. */
  lastSettle: { page: readonly string[]; tiles: readonly PageTile[]; plan: SettlePlan; moved: number }[] = []

  /** What the ledger has seen on a question (by its name), for the tally and
   *  for anyone checking the game's state. */
  seen(cell: string): ReadonlyMap<string, SeenAnswer> {
    return this.#seen.get(moleculeKey(cell)) ?? new Map()
  }

  // ── start ──────────────────────────────────────────────────────────────

  /** Start the game on the page you stand on: the game tile is minted here
   *  unless it already is, or you already stand inside the game. You become
   *  the organizer of the game's tree and walk in. */
  async start(): Promise<StartOutcome> {
    const here = this.#segments()
    const game = moleculeKey(GAME_NAME)
    const depth = here.findIndex(s => moleculeKey(s) === game)
    if (depth >= 0) {
      this.#organizing = here.slice(0, depth + 1)
      this.#schedule(0)
      return { outcome: 'resumed', where: here.join('/') }
    }
    const at = [...here, GAME_NAME]
    const tiles = await this.#children(here)
    const held = tiles?.find(t => moleculeKey(t.name) === game)
    if (!held) {
      EffectBus.emit('cell:added', { cell: GAME_NAME, segments: [...here] })
      await new hypercomb().act()
      await this.#settled()
    } else {
      at[at.length - 1] = held.name
    }
    this.#organizing = at
    get<NavigationShape>('@hypercomb.social/Navigation')?.goRaw?.(at)
    this.#schedule()
    return { outcome: held ? 'resumed' : 'started', where: at.join('/') }
  }

  // ── ask ────────────────────────────────────────────────────────────────

  /** Ask here: a tile named with the question, through the same create
   *  commit the `create` word runs (so reserved words and bad names are
   *  refused there), titled with the question as asked, and marked. */
  async ask(text: string): Promise<AskOutcome> {
    const question = String(text ?? '').replace(/\s+/g, ' ').trim()
    // The create commit names the tile the way every tile is named
    // (normalizeCell: lower, hyphens, no punctuation); the question's own
    // words, question mark and all, are its title.
    const name = normalizeCell(question)
    if (!question || !name) return 'empty'
    const here = this.#segments()
    const tiles = await this.#children(here)
    if (tiles?.some(t => moleculeKey(t.name) === moleculeKey(name))) return 'exists'
    const created = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), CREATE_MS)
      EffectBus.emitTransient('command:create-cells', {
        name: question,
        accept: () => {},
        complete: (error?: unknown) => { clearTimeout(timer); resolve(error === undefined) },
      })
    })
    if (!created) return 'failed'
    await this.#settled()
    const at = [...here, name]
    await replaceDecoration({ kind: QUESTION_KIND, appliesTo: at, segments: at, payload: { version: 1, question }, mark: 'persistent' })
    if (name !== question) {
      try { await get<DecorationsShape>('@diamondcoreprocessor.com/DecorationService')?.setTitle?.(at, question) } catch { /* a plainer tile, never a failed ask */ }
    }
    this.dispatchEvent(new CustomEvent('change'))
    this.#schedule()
    return 'asked'
  }

  // ── the door ───────────────────────────────────────────────────────────

  /** A question opens its answers: the notes desk on that tile, composer
   *  ready. Everyone's answers show there through the swarm notes. */
  open(label: string): void {
    const cell = String(label ?? '').trim()
    if (!cell) return
    EffectBus.emit('notes:panel', { visible: true })
    EffectBus.emit('note:capture', { cellLabel: cell })
  }

  /** A taken tile just landed: if the participant clicked it in the game a
   *  moment ago and it reads as a question, open its answers. */
  async #openIfWanted(p: { parentSegments?: readonly string[]; name?: string } | undefined): Promise<void> {
    const name = String(p?.name ?? '').trim()
    const key = moleculeKey(name)
    const at = this.#wanded.get(key)
    if (!at) return
    this.#wanded.delete(key)
    if (Date.now() - at > WAND_MS) return
    const page = (p?.parentSegments ?? this.#segments()).map(s => String(s ?? '').trim()).filter(Boolean)
    if (!inGame(page)) return
    await this.#settled()
    await this.#markQuestions(page, [name])
    if (hasDecorationKindAt([...page, name], QUESTION_KIND)) this.open(name)
  }

  // ── settle ─────────────────────────────────────────────────────────────

  /** One organizer pass over the game's tree. Coalesced: a pass asked for
   *  while one runs runs once more after it. */
  settle(): Promise<SettleOutcome> {
    if (this.#settling) { this.#again = true; return this.#settling }
    const run = this.#settle().finally(() => {
      this.#settling = null
      if (this.#again) { this.#again = false; this.#schedule() }
    })
    this.#settling = run
    return run
  }

  async #settle(): Promise<SettleOutcome> {
    const none: SettleOutcome = { pages: 0, moved: 0, categories: 0, sorter: 'none' }
    const root = this.#organizing
    if (!root) return none
    // Peers' tiles are read for the page in front of the organizer, and
    // taking one lands it there — so the room is taken where they stand,
    // when that is in the game; the tree is then settled page by page.
    const here = this.#segments()
    if (here.length >= root.length && root.every((s, i) => here[i] === s)) await this.#takeRoomTiles(here)

    const pages = await this.#tree(root)
    let moved = 0, categories = 0
    let sorter: SettleOutcome['sorter'] = 'none'
    const passes: Questions['lastSettle'] = []
    for (const page of pages) {
      const tiles = await this.#pageTiles(page)
      if (!tiles) continue
      const questions = tiles.filter(t => t.question)
      const others = tiles.filter(t => !t.question)
      const titles = new Map(questions.map(q => [this.#titleOf([...page, q.name]), q.name]))
      // Questions on the page are placed; a page with none may still hold a
      // minted category that thinned, so the plan is made either way.
      const placed = questions.length ? await this.#place([...titles.keys()], others.map(c => c.name)) : { placements: [], sorter: 'none' as const }
      if (placed.sorter !== 'none') sorter = placed.sorter
      const plan = settlePlan(tiles, placed.placements.map(p => ({ question: titles.get(p.question) ?? p.question, category: p.category })), this.#minted.get(page.join('/')) ?? new Set())
      const landed = await this.#apply(page, plan)
      passes.push({ page, tiles, plan, moved: landed })
      moved += landed
      categories += plan.create.length + plan.move.length
    }
    this.lastSettle = passes
    if (moved > 0) this.dispatchEvent(new CustomEvent('change'))
    return { pages: pages.length, moved, categories, sorter }
  }

  /** The game's tree from `root`: the game's page, then every category
   *  (a non-question tile with tiles inside) beneath it, to TREE_DEPTH. */
  async #tree(root: readonly string[]): Promise<string[][]> {
    const pages: string[][] = [[...root]]
    for (let i = 0; i < pages.length && pages.length < TREE_PAGES; i++) {
      const page = pages[i]
      if (page.length - root.length >= TREE_DEPTH - 1) continue
      const rows = await this.#children(page)
      if (!rows) continue
      await this.#markQuestions(page, rows.map(r => r.name))
      for (const r of rows) {
        if (r.childCount > 0 && !hasDecorationKindAt([...page, r.name], QUESTION_KIND)) pages.push([...page, r.name])
      }
    }
    return pages
  }

  /** Take every peer tile on the page not already held: the questions the
   *  room asked become this hive's to file. A placeholder (no bytes yet) is
   *  not takeable and waits for the next pass. */
  async #takeRoomTiles(page: readonly string[]): Promise<void> {
    if (!isJoinedHere()) return
    const swarm = get<SwarmShape>('@diamondcoreprocessor.com/SwarmDrone')
    const adopt = get<AdoptShape>('@diamondcoreprocessor.com/SwarmAdoptDrone')
    const peers = swarm?.peerTilesAtCurrentSig?.() ?? []
    if (!peers.length) return
    const held = new Set((await this.#children(page) ?? []).map(t => moleculeKey(t.name)))
    let took = 0
    for (const tile of peers) {
      if (held.has(moleculeKey(tile.name))) continue
      if (!adopt?.wandEligible?.(tile.name)) continue
      held.add(moleculeKey(tile.name))
      EffectBus.emit('tile:action', { action: 'adopt', label: tile.name, q: 0, r: 0, index: 0 })
      took++
    }
    if (took) await this.#settled()
  }

  /** Which category each question belongs in — Jev when switched on, else
   *  the participant's own AI. Questions no category fits are offered to the
   *  namer for new names, then filed among those. With neither, none move. */
  async #place(questions: readonly string[], categories: readonly string[]): Promise<{ placements: Placement[]; sorter: 'jev' | 'ai' | 'none' }> {
    const jev = get<JevShape>('@hypercomb.social/JevDecision')
    const useJev = !!jev?.readyForHive?.() && !!jev.sort
    const provider = this.#aiProvider()
    if (!useJev && !provider) {
      if (!this.#saidNoAi) {
        this.#saidNoAi = true
        EffectBus.emit('activity:log', { message: this.#t('questions.settle.no-ai', 'questions stay unsorted here — switch on Jev or an AI that may read the hive to sort them into categories'), icon: '✦' })
      }
      return { placements: [], sorter: 'none' }
    }
    const sort = async (items: readonly string[], labels: readonly string[]): Promise<number[]> => {
      const out: number[] = []
      for (let i = 0; i < items.length; i += SORT_BATCH) {
        const batch = items.slice(i, i + SORT_BATCH)
        try {
          out.push(...(useJev
            ? [...(await jev!.sort!({ notes: batch, categories: labels })).placed]
            : await this.#aiSort(provider, batch, labels)))
        } catch { out.push(...batch.map(() => -1)) }
      }
      return out
    }

    const placements: Placement[] = []
    let open = [...questions]
    if (categories.length) {
      const picks = await sort(open, categories)
      const left: string[] = []
      open.forEach((q, i) => {
        const pick = picks[i]
        if (typeof pick === 'number' && pick >= 0 && pick < categories.length) placements.push({ question: q, category: categories[pick] })
        else left.push(q)
      })
      open = left
    }
    if (open.length >= MIN_TO_MATERIALIZE) {
      const names = await this.suggestNames(open, categories)
      if (names.length) {
        const picks = await sort(open, names)
        open.forEach((q, i) => {
          const pick = picks[i]
          if (typeof pick === 'number' && pick >= 0 && pick < names.length) placements.push({ question: q, category: names[pick] })
        })
      }
    }
    return { placements, sorter: useJev ? 'jev' : 'ai' }
  }

  /** THE NAMER. New category names for questions no category fits, from the
   *  participant's own AI; none without one. A method, not a closure, so a
   *  harness (or a participant's module) can stand another namer in. */
  async suggestNames(questions: readonly string[], existing: readonly string[]): Promise<string[]> {
    const provider = this.#aiProvider()
    if (!provider) return []
    const content = (existing.length ? `Existing categories:\n${existing.map(c => '- ' + c).join('\n')}\n\n` : '')
      + `Questions:\n${questions.map(q => '- ' + q).join('\n')}`
    try {
      const result = await callModel({ providerId: provider, need: { tier: 'fast' }, system: SUGGEST_SYSTEM, messages: [{ role: 'user', content }], maxTokens: 400 })
      return parseCategoryNames(String(result.text ?? ''))
    } catch { return [] }
  }

  async #aiSort(provider: string, questions: readonly string[], labels: readonly string[]): Promise<number[]> {
    const content = 'Categories:\n' + labels.map((l, k) => `${k}. ${l}`).join('\n')
      + '\n\nQuestions:\n' + questions.map((q, k) => `${k}. ${q.slice(0, 400)}`).join('\n')
    const result = await callModel({ providerId: provider, need: { tier: 'fast' }, system: SORT_SYSTEM, messages: [{ role: 'user', content }], maxTokens: 400 })
    return parsePlacedIndexes(String(result.text ?? ''), questions.length)
  }

  /** The participant's AI that may read their hive: a local model, or one
   *  they allowed. '' when there is none. */
  #aiProvider(): string {
    try {
      const ready = configuredProviders().filter(p => !p.decisionOnly && (p.id === 'local' || llmHiveAccess.mayRead(p.id)))
      return ready[0]?.id ?? ''
    } catch { return '' }
  }

  /** Apply a plan with the one move primitive. Returns how many questions moved. */
  async #apply(page: readonly string[], plan: SettlePlan): Promise<number> {
    const move = get<MoveShape>('@diamondcoreprocessor.com/MoveDrone')
    if (!move?.commitMoveInto) return 0
    let moved = 0
    if (plan.create.length) {
      const key = page.join('/')
      const minted = this.#minted.get(key) ?? new Set<string>()
      for (const step of plan.create) {
        EffectBus.emit('cell:added', { cell: step.category, segments: [...page] })
        minted.add(moleculeKey(step.category))
      }
      this.#minted.set(key, minted)
      await new hypercomb().act()
      await this.#settled()
    }
    for (const step of [...plan.create, ...plan.move]) {
      const landed = await move.commitMoveInto(step.members, page, [...page, step.category])
      moved += landed.length
    }
    for (const step of plan.retract) {
      const landed = await move.commitMoveInto(step.members, [...page, step.category], page)
      moved += landed.length
      if (step.remove && landed.length === step.members.length) await removeTilesAt(page, [step.category])
    }
    if (moved) await this.#settled()
    return moved
  }

  // ── tally ──────────────────────────────────────────────────────────────

  /** Tally the game: standing in it, every question of the whole tree gets
   *  a note ranking its answers by takes and the game's tile gets one
   *  scoreboard; standing elsewhere, the page you stand on and its tile. */
  async tally(): Promise<TallyOutcome | null> {
    const here = this.#segments()
    const game = moleculeKey(GAME_NAME)
    const depth = here.findIndex(s => moleculeKey(s) === game)
    const root = depth >= 0 ? here.slice(0, depth + 1) : here
    const pages = depth >= 0 ? await this.#tree(root) : [here]
    const notes = get<NotesShape>('@diamondcoreprocessor.com/NotesService')
    if (!notes) return null
    const swarmNotes = get<SwarmNotesShape>('@diamondcoreprocessor.com/SwarmNotes')
    const me = await this.#whoAmI()
    const labelOf = (pubkey: string): string =>
      (pubkey && swarmNotes?.labelOf(pubkey)) || get<SwarmShape>('@diamondcoreprocessor.com/SwarmDrone')?.labelFor?.(pubkey) || (pubkey ? pubkey.slice(0, 8) : 'you')

    // The page in front of us is read live first, so the ledger is current
    // there; every other page is counted from what this hive holds and what
    // the ledger saw while standing there.
    const gathered: { page: readonly string[]; q: QuestionAnswers }[] = []
    for (const page of pages) {
      const tiles = await this.#pageTiles(page)
      const questions = (tiles ?? []).filter(t => t.question)
      const standing = page.join('/') === here.join('/')
      for (const q of questions) {
        if (standing && swarmNotes) {
          try { await swarmNotes.refresh(q.name); this.#record(swarmNotes, q.name) } catch { /* what did not arrive is not counted */ }
        }
        const ledger = this.seen(q.name)
        const own = await notes.getNotesAtSegments([...page, q.name])
        // An answer's takes are the participants holding it other than the
        // one who gave it. A note of mine was given by me unless the room
        // showed it first as someone else's — then I took it, and it stays
        // theirs; the ledger remembers who else was ever seen holding it.
        const answers: Answer[] = own
          .filter(n => !isTallyNote(n.text))
          .map(n => {
            const seen = ledger.get(n.id)
            const by = seen?.by ?? me
            const holders = new Set([me, ...(seen?.holders ?? [])])
            return { id: n.id, text: n.text, by, takes: [...holders].filter(h => h !== by).length }
          })
        for (const [id, seen] of ledger) {
          if (answers.some(a => a.id === id) || isTallyNote(seen.text)) continue
          answers.push({ id, text: seen.text, by: seen.by, takes: [...seen.holders].filter(h => h !== seen.by).length })
        }
        gathered.push({ page, q: { question: q.name, answers } })
      }
    }
    if (!gathered.length) return null

    let answered = 0
    for (const { page, q } of gathered) {
      if (!q.answers.length) continue
      answered += q.answers.length
      await notes.addAtSegments(page, q.question, tallyText(q, labelOf))
    }
    const board = scoreboard(gathered.map(g => g.q))
    if (root.length && board.length) await notes.addAtSegments(root.slice(0, -1), root[root.length - 1], boardText(board, labelOf))
    this.dispatchEvent(new CustomEvent('change'))
    const top = board[0]
    return { pages: pages.length, questions: gathered.length, answers: answered, leader: top ? labelOf(top.by) : '', takes: top?.takes ?? 0 }
  }

  // ── the ledger ─────────────────────────────────────────────────────────

  /** Record what the swarm notes show on `cell` right now: peers' roots
   *  (who gave each, everyone holding it) and who else holds mine. Holders
   *  accumulate — a take is not undone by leaving the room. */
  #record(swarmNotes: SwarmNotesShape, cell: string): void {
    const key = moleculeKey(cell)
    if (!key) return
    let book = this.#seen.get(key)
    try {
      for (const r of swarmNotes.rootsFor(cell)) {
        if (!book) { book = new Map(); this.#seen.set(key, book) }
        const entry = book.get(r.note.id) ?? { text: r.note.text, by: r.by, holders: new Set<string>() }
        for (const h of r.holders) entry.holders.add(h)
        book.set(r.note.id, entry)
      }
      for (const [id, holders] of swarmNotes.holdersOfMine(cell)) {
        if (!book) { book = new Map(); this.#seen.set(key, book) }
        const entry = book.get(id) ?? { text: '', by: this.#me, holders: new Set<string>() }
        for (const h of holders) entry.holders.add(h)
        book.set(id, entry)
      }
    } catch { /* not in a room, or the cell is not on this page */ }
  }

  /** A moment after the page renders or the room changes, inside the game:
   *  give taken questions their mark back and read the answers on this page
   *  into the ledger. */
  #scheduleSync(): void {
    if (!inGame(this.#segments())) return
    if (this.#syncTimer) clearTimeout(this.#syncTimer)
    this.#syncTimer = setTimeout(() => {
      this.#syncTimer = null
      if (this.#syncing) return
      this.#syncing = true
      void (async () => {
        const page = this.#segments()
        if (!inGame(page)) return
        const rows = await this.#children(page)
        if (!rows) return
        await this.#markQuestions(page, rows.map(r => r.name))
        const swarmNotes = get<SwarmNotesShape>('@diamondcoreprocessor.com/SwarmNotes')
        if (!swarmNotes || !isJoinedHere()) return
        await this.#whoAmI()
        for (const r of rows) {
          if (!hasDecorationKindAt([...page, r.name], QUESTION_KIND)) continue
          try { await swarmNotes.refresh(r.name); this.#record(swarmNotes, r.name) } catch { /* next time */ }
        }
      })().finally(() => { this.#syncing = false })
    }, SYNC_MS)
  }

  async #whoAmI(): Promise<string> {
    if (!this.#me) {
      try { this.#me = (await get<SignerShape>('@diamondcoreprocessor.com/NostrSigner')?.getPublicKeyHex?.()) ?? '' } catch { /* unsigned */ }
    }
    return this.#me
  }

  // ── reading the page ───────────────────────────────────────────────────

  /** The page's own tiles, each saying whether it is a question, how many
   *  children it holds and which of them are questions. null = unreadable. */
  async #pageTiles(page: readonly string[]): Promise<PageTile[] | null> {
    const rows = await this.#children(page)
    if (!rows) return null
    await this.#markQuestions(page, rows.map(r => r.name))
    const out: PageTile[] = []
    for (const r of rows) {
      // By full path: the index keys a location exactly, and a bare label
      // would resolve against the page being RENDERED, not this one.
      const question = hasDecorationKindAt([...page, r.name], QUESTION_KIND)
      let inside: string[] = []
      if (!question && r.childCount > 0) {
        const kids = await this.#children([...page, r.name])
        if (kids?.length) {
          await this.#markQuestions([...page, r.name], kids.map(k => k.name))
          inside = kids.filter(k => hasDecorationKindAt([...page, r.name, k.name], QUESTION_KIND)).map(k => k.name)
        }
      }
      out.push({ name: r.name, question, children: r.childCount, inside })
    }
    return out
  }

  /** A QUESTION IS READ BY ITS TITLE INSIDE THE GAME. Taking a peer's tile
   *  brings its name and titles, not its marks — so on a page in the game, a
   *  tile whose title asks (ends in a question mark) and wears no mark yet
   *  is given the mark in this hive. Then the index, the door and the settle
   *  all read one thing. Outside the game nothing is inferred. */
  async #markQuestions(page: readonly string[], names: readonly string[]): Promise<void> {
    await ensureDecorationsIndexed(names, page)
    if (!inGame(page)) return
    for (const name of names) {
      const at = [...page, name]
      if (hasDecorationKindAt(at, QUESTION_KIND)) continue
      const question = this.#titleOf(at)
      if (!isQuestionTitle(question)) continue
      try {
        await replaceDecoration({ kind: QUESTION_KIND, appliesTo: at, segments: at, payload: { version: 1, question }, mark: 'persistent' })
      } catch { /* unmarked this pass; the next render asks again */ }
    }
  }

  /** The tile's title (any locale, the active one first), or its name. */
  #titleOf(at: readonly string[]): string {
    const titles = titlesForSegments(at)
    const locale = typeof document !== 'undefined' ? document.documentElement.lang : ''
    const text = (locale && titles[locale]) || Object.values(titles).find(Boolean) || ''
    return text || at[at.length - 1] || ''
  }

  async #children(segments: readonly string[]): Promise<{ name: string; childCount: number }[] | null> {
    const history = get<PlacementHistory>('@diamondcoreprocessor.com/HistoryService')
    const lineage = get<LineageShape>('@hypercomb.social/Lineage')
    if (!history || !lineage) return null
    try { return await readChildrenStrict(history, lineage.domain, segments) } catch { return null }
  }

  #schedule(ms = SETTLE_MS): void {
    if (!this.#organizing) return
    if (this.#timer) clearTimeout(this.#timer)
    this.#timer = setTimeout(() => { this.#timer = null; void this.settle() }, ms)
  }

  async #settled(): Promise<void> {
    try { await get<CommitterShape>('@diamondcoreprocessor.com/LayerCommitter')?.settled?.() } catch { /* unacknowledged: proceed */ }
  }

  #segments(): string[] {
    const lineage = get<LineageShape>('@hypercomb.social/Lineage')
    return (lineage?.explorerSegments?.() ?? []).map(s => String(s ?? '').trim()).filter(Boolean)
  }

  #t(key: string, fallback: string, params?: Record<string, unknown>): string {
    const i18n = get<{ t?: (k: string, p?: Record<string, unknown>) => string }>('@hypercomb.social/I18n')
    return i18n?.t?.(key, params) ?? fallback
  }
}

export { TALLY_MARK, BOARD_MARK }
