// questions/questions.ts
//
// HYPERCOMB Q AND A — the pure half (questions.service.ts is the other).
//
// A swarm game played on the hive itself. A QUESTION is a tile; its ANSWERS
// are the notes on it, everyone's, through the notes desk — so answering,
// seeing others' answers, taking an answer and counting who holds it are the
// swarm notes acts, unchanged. The game adds three things:
//
//   - questions SETTLE into category layers as they arrive: a category that
//     gathers enough questions materializes as a tile and they move inside;
//     one left with too few retracts and they come back up (settlePlan);
//   - a question tile OPENS its answers instead of being walked into;
//   - the TALLY: per question, the answers ranked by how many participants
//     took them, and a scoreboard of who gave the most-taken answers.
//
// No store, no swarm, no DOM — the service and the spec share this.

import { moleculeKey } from '@hypercomb/core'

/** A game's name is the word that starts it: `start <hive> q and a`, named
 *  for the hive being shared as the swarm (`hypercomb` → `start hypercomb q
 *  and a`). It is also the game's place: every layer holds its own Q and A
 *  as a child of that name, and every page beneath that child is in the
 *  game — `sign('hypercomb q and a')` is the molecule, so one game is one
 *  word on every participant's hive. This is the example name. */
export const GAME_NAME = 'hypercomb q and a'
/** The mark a question tile wears in the hive that holds it. A take carries
 *  a tile's admitted projection (name, title, picture), not its marks, so a
 *  taken question is read by its TITLE and given the mark again. */
export const QUESTION_KIND = 'visual:question'
export const QUESTIONS_KEY = '@diamondcoreprocessor.com/Questions'

/** The words every game's name ends with: `<hive> q and a`. */
export const GAME_SUFFIX = 'q and a'

/** The game's name for a hive: `hypercomb` → `hypercomb q and a`. */
export function gameNameFor(hive: string): string {
  const clean = String(hive ?? '').replace(/\s+/g, ' ').trim()
  return clean ? `${clean} ${GAME_SUFFIX}` : ''
}

/** The hive a game's name names, or null when the name is not a game's.
 *  Spaces, hyphens and underscores fold alike (`hypercomb-q-and-a` is the
 *  same game), and a bare `q and a` is no game — it names no hive. */
export function hiveOfGame(name: string): string | null {
  const folded = String(name ?? '').toLowerCase().replace(/[-_\s]+/g, ' ').trim()
  const m = /^(.+) q and a$/.exec(folded)
  return m ? m[1].trim() : null
}

/** Where the game begins on a path: the index of the first segment that is a
 *  game's name, or -1. Everything below it is one layer's Q and A. */
export function gameDepth(segments: readonly string[]): number {
  return segments.findIndex(s => hiveOfGame(String(s ?? '')) !== null)
}

/** Is this page in the game — inside a layer's Q and A? */
export function inGame(segments: readonly string[]): boolean {
  return gameDepth(segments) >= 0
}

/** A question is a sentence that asks: the title ends with a question mark
 *  (either script). The name cannot carry it — names drop punctuation — so
 *  the title is where a taken question still says what it is. */
export function isQuestionTitle(text: string): boolean {
  return /[?？]\s*$/.test(String(text ?? ''))
}

/** A category label with this many questions becomes a layer; a category
 *  layer left with fewer retracts. */
export const MIN_TO_MATERIALIZE = 2
export const MAX_CATEGORY_NAME = 48
/** A tally note begins with this so a later tally never counts it as an answer. */
export const TALLY_MARK = 'Tally ·'
export const BOARD_MARK = 'Scoreboard ·'

/** A tile on the page as the settle sees it: is it a question, how many
 *  children it holds, and which of those children are questions. */
export interface PageTile {
  readonly name: string
  readonly question: boolean
  readonly children: number
  readonly inside: readonly string[]
}

/** The classifier's answer for one question: the category it belongs in,
 *  or null to leave it where it is. */
export interface Placement {
  readonly question: string
  readonly category: string | null
}

export interface SettleStep {
  readonly category: string
  readonly members: readonly string[]
  /** retract only: the category tile holds nothing but these, so it goes. */
  readonly remove?: boolean
}

export interface SettlePlan {
  /** New category tiles to mint, each with the questions moving inside. */
  readonly create: readonly SettleStep[]
  /** Tiles already on the page receiving questions — a category, or a tile
   *  the host laid out beforehand under that name. */
  readonly move: readonly SettleStep[]
  /** Categories dissolving: their questions come up, the empty tile goes. */
  readonly retract: readonly SettleStep[]
}

/** The settle for one page. Pure: the page's own tiles and the placements
 *  in, the moves out. A placement names a tile that is not on the page, or
 *  names a question as a category, or names the question itself, is ignored.
 *  A category is any non-question tile holding questions. Only a category
 *  the settle itself MINTED (`minted`, folded names) retracts when it thins:
 *  a tile the host laid out is their structure — it receives even one
 *  question and keeps it. A tile holding anything else is never retracted. */
export function settlePlan(tiles: readonly PageTile[], placements: readonly Placement[], minted: ReadonlySet<string> = new Set()): SettlePlan {
  const byKey = new Map<string, PageTile>()
  for (const t of tiles) byKey.set(moleculeKey(t.name), t)

  const groups = new Map<string, { category: string; members: string[] }>()
  for (const p of placements) {
    const category = String(p.category ?? '').trim()
    if (!category) continue
    const q = byKey.get(moleculeKey(p.question))
    if (!q?.question) continue
    const key = moleculeKey(category)
    if (!key || key === moleculeKey(q.name)) continue
    if (byKey.get(key)?.question) continue
    const g = groups.get(key) ?? { category: byKey.get(key)?.name ?? category.slice(0, MAX_CATEGORY_NAME), members: [] }
    if (!g.members.includes(q.name)) g.members.push(q.name)
    groups.set(key, g)
  }

  const create: SettleStep[] = []
  const move: SettleStep[] = []
  for (const [key, g] of groups) {
    const existing = byKey.get(key)
    if (existing) move.push({ category: existing.name, members: g.members })
    else if (g.members.length >= MIN_TO_MATERIALIZE) create.push({ category: g.category, members: g.members })
  }

  const retract: SettleStep[] = []
  for (const t of tiles) {
    if (t.question || t.inside.length === 0 || !minted.has(moleculeKey(t.name))) continue
    const gaining = groups.get(moleculeKey(t.name))?.members.length ?? 0
    if (t.inside.length + gaining >= MIN_TO_MATERIALIZE) continue
    retract.push({ category: t.name, members: [...t.inside], remove: t.children === t.inside.length })
  }

  return { create, move, retract }
}

/** Category names as an AI answered them: one per line, bullets and
 *  numbering stripped, folded duplicates dropped, capped in length. */
export function parseCategoryNames(text: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const name = raw.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').replace(/\s+/g, ' ').trim()
    if (!name || name.length > MAX_CATEGORY_NAME || /:$/.test(name)) continue
    const key = moleculeKey(name)
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(name)
  }
  return out
}

/** Indexes as an AI answered a sort: the first JSON array of integers in the
 *  text, one per item; anything else is "left where it is". */
export function parsePlacedIndexes(text: string, count: number): number[] {
  const s = String(text ?? '')
  const start = s.indexOf('[')
  const end = s.lastIndexOf(']')
  const none = Array.from({ length: count }, () => -1)
  if (start < 0 || end < start) return none
  try {
    const parsed = JSON.parse(s.slice(start, end + 1)) as unknown
    if (!Array.isArray(parsed)) return none
    return none.map((_, i) => (Number.isInteger(parsed[i]) ? (parsed[i] as number) : -1))
  } catch { return none }
}

// ── the tally ────────────────────────────────────────────────────────────────

/** One answer on a question: who brought it and how many OTHER participants
 *  took it (the author holding their own answer is not a take). */
export interface Answer {
  readonly id: string
  readonly text: string
  readonly by: string
  readonly takes: number
}

export interface QuestionAnswers {
  readonly question: string
  readonly answers: readonly Answer[]
}

/** A participant's standing: takes gathered, answers given, questions won
 *  (their answer ranked first with at least one take). */
export interface Standing {
  readonly by: string
  readonly takes: number
  readonly answers: number
  readonly best: number
}

/** Most taken first; ties keep the order they were given in. */
export function rankAnswers(answers: readonly Answer[]): Answer[] {
  return [...answers].sort((a, b) => b.takes - a.takes)
}

export function scoreboard(questions: readonly QuestionAnswers[]): Standing[] {
  const standing = new Map<string, { takes: number; answers: number; best: number }>()
  for (const q of questions) {
    const ranked = rankAnswers(q.answers)
    ranked.forEach((a, i) => {
      const s = standing.get(a.by) ?? { takes: 0, answers: 0, best: 0 }
      s.takes += a.takes
      s.answers += 1
      if (i === 0 && a.takes > 0) s.best += 1
      standing.set(a.by, s)
    })
  }
  return [...standing.entries()]
    .map(([by, s]) => ({ by, ...s }))
    .sort((a, b) => b.takes - a.takes || b.best - a.best || b.answers - a.answers)
}

const oneLine = (text: string, max = 140): string => {
  const flat = String(text ?? '').replace(/\s+/g, ' ').trim()
  return flat.length > max ? flat.slice(0, max - 1) + '…' : flat
}

/** The tally note written on a question — the answers ranked, who gave each. */
export function tallyText(q: QuestionAnswers, labelOf: (pubkey: string) => string): string {
  const ranked = rankAnswers(q.answers)
  const lines = ranked.map((a, i) => `${i + 1}. ${oneLine(a.text)} — ${a.takes} ${a.takes === 1 ? 'take' : 'takes'} · ${labelOf(a.by)}`)
  return `${TALLY_MARK} ${ranked.length} ${ranked.length === 1 ? 'answer' : 'answers'}\n${lines.join('\n')}`
}

/** The scoreboard note written on the game tile. */
export function boardText(standings: readonly Standing[], labelOf: (pubkey: string) => string): string {
  const lines = standings.map((s, i) =>
    `${i + 1}. ${labelOf(s.by)} — ${s.takes} ${s.takes === 1 ? 'take' : 'takes'}, ${s.best} best, ${s.answers} ${s.answers === 1 ? 'answer' : 'answers'}`)
  return `${BOARD_MARK} ${standings.length} ${standings.length === 1 ? 'participant' : 'participants'}\n${lines.join('\n')}`
}

/** Is this note one the tally wrote? Those never count as answers. */
export function isTallyNote(text: string): boolean {
  const t = String(text ?? '').trimStart()
  return t.startsWith(TALLY_MARK) || t.startsWith(BOARD_MARK)
}
