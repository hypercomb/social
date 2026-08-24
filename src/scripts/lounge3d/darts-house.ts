// scripts/lounge3d/darts-house.ts
//
// THE HOUSE — the crowd at the oche, what it is worth, and the names the room
// shouts. 501 lives in `darts-rules.ts`; this is everything the game pays you
// for that the rules of 501 do not care about.
//
// The two are deliberately kept apart. `darts-rules.ts` must never learn that
// a treble brings a man over from the bar, because the moment a bonus can move
// a score, a scoreboard stops being a scoreboard. Nothing in this file touches
// the 501 arithmetic: fans and multipliers are paid in EMBERS and in noise,
// never in points. You cannot buy your way out of needing the double.
//
// It is pure for the same reason the rules are: a multiplier that quietly pays
// four times what it says is a bug nobody reports and everybody feels. See
// `darts-house.spec.ts`.

import { DART_NUMS, type DartHit } from './darts-rules.js'

/** What the room does about something that happened at the board. */
export type CallSpec = {
  id: string
  /** Chalked across the board in caps. Empty means the crowd moves but says
   *  nothing — a turn nobody came over for still costs you the room. */
  shout: string
  /** Fans it brings to the oche. Negative takes them away. */
  fans: number
  /** Embers BEFORE the crowd multiplier. 0 pays in noise only. */
  embers: number
  /** 0 a murmur · 1 a nod · 2 glasses up · 3 the room stands up. Drives the
   *  shake, the sparks off the wire and how far the crowd comes out of its
   *  seat — one number, so a loud thing is loud in every register at once. */
  roar: 0 | 1 | 2 | 3
  /** Set on the calls that PAY: the earning table on the store page is built
   *  from these two fields, so the shelves can never quote a bonus this file
   *  does not actually hand out. */
  label?: string
  note?: string
}

/**
 * Every call the house makes, in one table.
 *
 * The numbers read as a ladder: noise is free, a ton is a tenner, and the
 * three shots a player remembers for life — the 170 finish, the madhouse, the
 * nine-darter — are worth a whole shelf of El Mercado. Multiplied by the
 * crowd, a full room turns a ton eighty into a piece of furniture.
 */
export const CALLS: Record<string, CallSpec> = {
  // ── the darts themselves ──────────────────────────────────────────────
  treble: { id: 'treble', shout: '', fans: 1, embers: 0, roar: 1 },
  dbull: { id: 'dbull', shout: 'BULLSEYE', fans: 1, embers: 0, roar: 2 },
  wire: { id: 'wire', shout: '', fans: -1, embers: 0, roar: 0 },

  // ── the turn ──────────────────────────────────────────────────────────
  bust: { id: 'bust', shout: 'BUST', fans: -2, embers: 0, roar: 0 },
  cold: { id: 'cold', shout: '', fans: -1, embers: 0, roar: 0 },
  ton: {
    id: 'ton', shout: 'A TON', fans: 2, embers: 10, roar: 1,
    label: 'A ton at the oche',
    note: '100 or more with three darts. The room looks up — and whatever the ' +
      'room is worth, it is worth it on top.',
  },
  ton40: {
    id: 'ton40', shout: 'TON FORTY', fans: 3, embers: 20, roar: 2,
    label: 'Ton forty',
    note: '140 or better. Two trebles and a good one, and the bar starts ' +
      'turning round.',
  },
  ton80: {
    id: 'ton80', shout: 'TON EIGHTY', fans: 5, embers: 40, roar: 3,
    label: 'Ton eighty',
    note: 'Three trebles in the twenty. The maximum. The room stands up and ' +
      'the fire jumps with it.',
  },
  bed: {
    id: 'bed', shout: 'THREE IN A BED', fans: 3, embers: 25, roar: 2,
    label: 'Three in a bed',
    note: 'All three darts in the same bed. Not the biggest score on the ' +
      'board — the hardest thing to do twice.',
  },
  shanghai: {
    id: 'shanghai', shout: 'SHANGHAI', fans: 4, embers: 30, roar: 3,
    label: 'Shanghai',
    note: 'The single, the double and the treble of one number, in one turn. ' +
      'Nobody does this on purpose. Everybody claims they did.',
  },

  // ── the leg ───────────────────────────────────────────────────────────
  leg: {
    id: 'leg', shout: 'THE LEG', fans: 2, embers: 75, roar: 2,
    label: 'A leg off the Colonel',
    note: '501, double out, at the board on the left wall. He is beatable — ' +
      'and the fuller the room, the better it pays.',
  },
  madhouse: {
    id: 'madhouse', shout: 'THE MADHOUSE', fans: 3, embers: 50, roar: 2,
    label: 'The madhouse',
    note: 'A leg finished on double one, the smallest bed on the board. ' +
      'Nobody chooses to be left there.',
  },
  bigfish: {
    id: 'bigfish', shout: 'BIG FISH', fans: 5, embers: 100, roar: 3,
    label: 'The big fish',
    note: 'A 170 checkout — treble twenty, treble twenty, bullseye. The ' +
      'highest finish there is.',
  },
  nine: {
    id: 'nine', shout: 'A NINE DARTER', fans: 12, embers: 500, roar: 3,
    label: 'The nine-darter',
    note: '501 in nine darts. The perfect leg. The house has been waiting ' +
      'thirty years to pay this one out.',
  },
  match: {
    id: 'match', shout: 'THE MATCH', fans: 4, embers: 200, roar: 3,
    label: 'The match',
    note: 'Three legs before the Colonel gets three. A whole evening, won.',
  },

  // ── the Colonel ───────────────────────────────────────────────────────
  // He is not the enemy, he is the draw: when he throws well the room turns to
  // watch HIM, and a crowd looking the other way is worth nothing to you.
  housed: { id: 'housed', shout: '', fans: -1, embers: 0, roar: 0 },
  houseleg: { id: 'houseleg', shout: 'THE COLONEL TAKES IT', fans: -3, embers: 0, roar: 0 },
  housematch: { id: 'housematch', shout: 'AND THE MATCH', fans: -4, embers: 0, roar: 0 },
}

/** Two regulars are always at that board. They were there before you. */
export const FANS_BASE = 2
/** A full house. Above the top rung of the ladder on purpose: it should take
 *  more than one bust to lose a multiplier you earned. */
export const FANS_MAX = 12
/** Three legs takes the match — long enough to lose the room and win it back. */
export const MATCH_LEGS = 3

/**
 * THE CROWD IS THE MULTIPLIER.
 *
 * Every third pair of eyes doubles, trebles, quadruples what the house pays,
 * and it stops at four: a room can only get so loud, and a bonus you cannot
 * exhaust is not a bonus, it is an exchange rate.
 */
export function crowdMultiplier(fans: number): 1 | 2 | 3 | 4 {
  if (fans >= 9) return 4
  if (fans >= 6) return 3
  if (fans >= 3) return 2
  return 1
}

/** Fans after a call, held between an empty oche and a full house. */
export function applyFans(fans: number, call: CallSpec): number {
  return Math.max(0, Math.min(FANS_MAX, fans + call.fans))
}

/** What a call is actually worth right now — the whole point of the crowd. */
export function payOf(call: CallSpec, fans: number): number {
  return call.embers * crowdMultiplier(fans)
}

/** One dart, as the room sees it: a treble brings someone over, the bull turns
 *  heads, and a dart off the board loses you one of them. */
export function dartCall(hit: DartHit): CallSpec | null {
  if (hit.mult === 0) return CALLS.wire
  if (hit.label === 'D·BULL') return CALLS.dbull
  if (hit.mult === 3) return CALLS.treble
  return null
}

/**
 * Three darts, as the room sees them. The richest name wins, which is why 180
 * is called a ton eighty and not three in a bed even though it is both.
 *
 * A bust outranks everything: a hundred and forty that goes past zero is a
 * hundred and forty nobody scored.
 */
export function turnCall(hits: DartHit[], busted: boolean): CallSpec | null {
  if (busted) return CALLS.bust
  if (hits.length === 0) return null
  const total = hits.reduce((n, h) => n + h.points, 0)
  if (hits.length === 3) {
    if (total >= 180) return CALLS.ton80
    if (sameBed(hits)) return CALLS.bed
    if (isShanghai(hits)) return CALLS.shanghai
  }
  if (total >= 140) return CALLS.ton40
  if (total >= 100) return CALLS.ton
  // A turn nobody would cross a room for. The crowd does not boo; it drifts.
  if (hits.length === 3 && total < 26) return CALLS.cold
  return null
}

/** All three in one bed — same number, same ring. */
function sameBed(hits: DartHit[]): boolean {
  return hits.length === 3 && hits[0].mult !== 0 && hits.every(h => h.label === hits[0].label)
}

/** The single, the double and the treble of ONE number. The bull has no
 *  treble, so it can never be a shanghai however it lands. */
function isShanghai(hits: DartHit[]): boolean {
  if (hits.length !== 3) return false
  const n = bedNumber(hits[0])
  if (n === 25 || !Number.isFinite(n)) return false
  if (!hits.every(h => bedNumber(h) === n)) return false
  const mults = new Set(hits.map(h => h.mult))
  return mults.has(1) && mults.has(2) && mults.has(3)
}

/** The number a hit belongs to, bull counted as 25 — NaN off the board. */
function bedNumber(hit: DartHit): number {
  if (hit.label === 'D·BULL' || hit.label === 'BULL' || hit.label === '25') return 25
  return Number(hit.label.replace(/^[TD]/, ''))
}

/**
 * The leg, as the room will remember it — one call, the best that fits: the
 * nine-darter, the big fish, the madhouse, or simply the leg.
 *
 * `darts` counts every dart YOU threw in the leg, busts included, because that
 * is how a nine-darter is counted at every board in the world.
 */
export function legCall(o: { darts: number; turnStart: number; finish: DartHit }): CallSpec {
  if (o.darts <= 9) return CALLS.nine
  if (o.turnStart === 170) return CALLS.bigfish
  if (o.finish.label === 'D1') return CALLS.madhouse
  return CALLS.leg
}

// ─── THE SIDE BETS ────────────────────────────────────────────────────────
//
// Small money for the SHAPE of a turn rather than the size of it. You are
// still trying to get five hundred and one down to nothing — none of this
// helps with that, which is exactly why it is fun: the arithmetic of the leg
// is untouched and the arithmetic of the evening is not.
//
// They pay in single figures on purpose. A side bet should be a laugh at the
// oche and a slow trickle into the purse, never a reason to stop aiming at
// what you actually need. The one exception is the Robin Hood, which is worth
// real money because nobody can do it twice.

/** The prime beds. 25 is not one of them, whatever the bull is worth. */
const PRIMES = new Set([2, 3, 5, 7, 11, 13, 17, 19])
/** Consecutive Fibonacci triples reachable on a board. */
const FIBS = [1, 2, 3, 5, 8, 13, 21]

/**
 * The house's standing side bets. Every one that fits a turn pays; usually
 * that is none of them, sometimes one, and now and then the room gets a
 * coincidence worth talking about.
 */
export const QUIRKS: Record<string, CallSpec> = {
  straight: { id: 'straight', shout: 'STRAIGHT TREBLES', fans: 2, embers: 25, roar: 2 },
  straightd: { id: 'straightd', shout: 'STRAIGHT DOUBLES', fans: 2, embers: 30, roar: 2 },
  evens: { id: 'evens', shout: 'ALL EVENS', fans: 0, embers: 5, roar: 1 },
  odds: { id: 'odds', shout: 'ALL ODDS', fans: 0, embers: 5, roar: 1 },
  primes: { id: 'primes', shout: 'THE PRIMES', fans: 1, embers: 8, roar: 1 },
  staircase: { id: 'staircase', shout: 'THE STAIRCASE', fans: 1, embers: 10, roar: 1 },
  neighbours: { id: 'neighbours', shout: 'NEIGHBOURS', fans: 1, embers: 10, roar: 1 },
  fib: { id: 'fib', shout: 'THE FIBONACCI', fans: 1, embers: 12, roar: 1 },
  square: { id: 'square', shout: 'A SQUARE NUMBER', fans: 0, embers: 8, roar: 1 },
  palindrome: { id: 'palindrome', shout: 'A PALINDROME', fans: 0, embers: 8, roar: 1 },
  breakfast: { id: 'breakfast', shout: 'BED AND BREAKFAST', fans: 0, embers: 6, roar: 0 },
  nuts: { id: 'nuts', shout: "BAG O' NUTS", fans: 0, embers: 6, roar: 0 },
  quack: { id: 'quack', shout: 'QUACK QUACK', fans: 0, embers: 6, roar: 0 },
  ring: { id: 'ring', shout: 'ALL THREE IN THE TREBLE RING', fans: 1, embers: 12, roar: 2 },
  robin: { id: 'robin', shout: 'A ROBIN HOOD', fans: 1, embers: 15, roar: 2 },
}

/** The side bet the house doubles tonight — drawn fresh each leg and chalked
 *  on the board, so a quirk nobody has ever hit gets its evening. */
export function drawSideBet(rnd: () => number = Math.random): string {
  const ids = Object.keys(QUIRKS)
  return ids[Math.min(ids.length - 1, Math.floor(rnd() * ids.length))]
}

/** Double for the drawn bet — the whole reason to read the chalk. */
export const SIDE_BET_FACTOR = 2

/**
 * Every side bet a finished turn wins. `landings` are the board-local points
 * in the same order as `hits`, and only the Robin Hood needs them: two darts
 * in one hole is a fact about the sisal, not about the score.
 */
export function quirkCalls(
  hits: DartHit[],
  landings?: ReadonlyArray<{ x: number; y: number }>,
): CallSpec[] {
  const out: CallSpec[] = []
  if (landings && robinHood(landings)) out.push(QUIRKS.robin)
  const scored = hits.filter(h => h.mult !== 0)
  if (scored.length === 3) {
    const beds = scored.map(bedNumber)
    const oneRing = scored.every(h => h.mult === scored[0].mult)
    const run = beds.every(n => Number.isFinite(n)) && isRun(beds)
    // THE STRAIGHT — 20, 19, 18 in one ring. Consecutive numbers are NOT
    // neighbouring beds (the board is deliberately shuffled), so a straight is
    // three separate corners of it, three times, and it outranks the plain
    // staircase and the treble-ring bet it would otherwise also win.
    const straight = run && oneRing
      ? scored[0].mult === 3 ? QUIRKS.straight : scored[0].mult === 2 ? QUIRKS.straightd : null
      : null
    if (straight) out.push(straight)
    if (beds.every(n => Number.isFinite(n))) {
      if (beds.every(n => n % 2 === 0)) out.push(QUIRKS.evens)
      if (beds.every(n => n % 2 === 1)) out.push(QUIRKS.odds)
      if (beds.every(n => PRIMES.has(n))) out.push(QUIRKS.primes)
      if (run && !straight) out.push(QUIRKS.staircase)
      if (isFibRun(beds)) out.push(QUIRKS.fib)
      if (areNeighbours(beds)) out.push(QUIRKS.neighbours)
    }
    if (!straight && scored.every(h => h.mult === 3)) out.push(QUIRKS.ring)
  }
  if (hits.length === 3) {
    const total = hits.reduce((n, h) => n + h.points, 0)
    if (total === 26) out.push(QUIRKS.breakfast)
    if (total === 45) out.push(QUIRKS.nuts)
    if (total === 22) out.push(QUIRKS.quack)
    if (total > 0 && Number.isInteger(Math.sqrt(total))) out.push(QUIRKS.square)
    if (total >= 10 && isPalindrome(total)) out.push(QUIRKS.palindrome)
  }
  return out
}

/** Three consecutive numbers, thrown in any order. */
function isRun(beds: number[]): boolean {
  const s = [...beds].sort((a, b) => a - b)
  return s[1] === s[0] + 1 && s[2] === s[1] + 1
}

/** Three consecutive Fibonacci numbers, thrown in any order. */
function isFibRun(beds: number[]): boolean {
  const s = [...beds].sort((a, b) => a - b)
  for (let i = 0; i + 2 < FIBS.length; i++)
    if (s[0] === FIBS[i] && s[1] === FIBS[i + 1] && s[2] === FIBS[i + 2]) return true
  return false
}

/** Three beds side by side ON THE BOARD — 20, 1, 18 are neighbours; 18, 19, 20
 *  are three quite separate places to stand. This one is a grouping, which
 *  means it is the only side bet that is actually a skill. */
function areNeighbours(beds: number[]): boolean {
  const idx = beds.map(n => DART_NUMS.indexOf(n))
  if (idx.some(i => i < 0)) return false
  const s = [...idx].sort((a, b) => a - b)
  const span = (a: number[]): boolean => a[1] === a[0] + 1 && a[2] === a[1] + 1
  // Cyclic: the board has no first bed, so 5, 20, 1 is a run too.
  return span(s) || span([s[1], s[2], s[0] + 20].sort((a, b) => a - b))
}

function isPalindrome(n: number): boolean {
  const s = String(n)
  return s === [...s].reverse().join('')
}

/** Two darts in the same hole. The threshold is a few millimetres of sisal
 *  scaled to board-local units — close enough that the second dart is in the
 *  first one's flight, which is the shot everybody has heard of and nobody
 *  has seen. */
const ROBIN_R = 0.006

function robinHood(landings: ReadonlyArray<{ x: number; y: number }>): boolean {
  for (let i = 0; i < landings.length; i++)
    for (let j = i + 1; j < landings.length; j++)
      if (Math.hypot(landings[i].x - landings[j].x, landings[i].y - landings[j].y) < ROBIN_R) return true
  return false
}

// ─── THE SMOKE RINGS ──────────────────────────────────────────────────────
//
// Somebody in a wingback blows a ring and it drifts across the board. It sits
// over a bed for a few seconds — by preference the bed you are going to need,
// because the room is watching your checkout too — and a dart put through it
// pays by how close to the middle of the ring it went.
//
// This is the only bonus in the house that is about ACCURACY rather than about
// arithmetic, which is why it is worth more than the side bets: the ring does
// not care what number is behind it, only whether you threaded it.

export const SMOKE_CALLS: Record<string, CallSpec> = {
  smokeeye: {
    id: 'smokeeye', shout: 'THROUGH THE EYE', fans: 2, embers: 30, roar: 3,
    label: 'Through the eye of a smoke ring',
    note: 'A ring of cigar smoke drifts across the board. Put a dart through ' +
      'the middle of it and the room cannot believe what it just watched.',
  },
  smoke: { id: 'smoke', shout: 'THROUGH THE SMOKE', fans: 1, embers: 18, roar: 2 },
  smokegraze: { id: 'smokegraze', shout: 'THROUGH THE RING', fans: 1, embers: 10, roar: 1 },
}

/** How the rings behave: how big, how long they hang about, and how long the
 *  room waits between them. Shared by the ring that is drawn and the ring that
 *  is scored — one definition, so what you can see is what you can hit. */
export const SMOKE = {
  /** Ring radius in board-local units — a shade wider than a treble bed. */
  r: 0.05,
  /** Seconds it hangs on the board, fade in and out included. */
  life: 5.4,
  /** Seconds of quiet between rings — somebody has to draw on a cigar first. */
  gapMin: 11,
  gapMax: 21,
  /** How far it drifts across the face over its life. */
  drift: 0.09,
} as const

/**
 * A dart put through a ring, scored by how near the middle it went. `dist` and
 * `ringR` are both in board-local units; anything outside the ring is simply a
 * dart, and gets no call at all.
 */
export function smokeCall(dist: number, ringR: number = SMOKE.r): CallSpec | null {
  if (!(ringR > 0) || dist > ringR) return null
  const near = dist / ringR
  if (near <= 0.28) return SMOKE_CALLS.smokeeye
  if (near <= 0.62) return SMOKE_CALLS.smoke
  return SMOKE_CALLS.smokegraze
}

// ─── THE TALLY — the alternate score ──────────────────────────────────────
//
// 501 counts DOWN, by numbers. The tally counts UP, by RINGS: a single is 1, a
// double 4, a treble 9 — the square of the multiplier — the bull 5 and the
// inner bull 16, and a dart off the board takes two back off you.
//
// It is deliberately a different game played on the same darts. The leg cares
// only about the number you needed; the tally cares only about how thin the
// ring was. That means the boring, correct, professional thing to do — chip at
// a double you keep missing — still moves SOMETHING, and a player who cannot
// close a leg all evening still watches a number go up.
//
// What the tally buys is the ROOM: every `TALLY_STEP` of it brings another
// regular over to the oche, and the crowd is the multiplier on everything
// else. Rings fill the room; the room pays for shapes.

export const TALLY = { single: 1, double: 4, treble: 9, bull: 5, dbull: 16, wire: -2 } as const
/** Tally per fan. Twelve fans is a long evening's throwing, on purpose. */
export const TALLY_STEP = 50

/** What one dart is worth on the alternate score. */
export function tallyOf(hit: DartHit): number {
  if (hit.mult === 0) return TALLY.wire
  if (hit.label === 'D·BULL') return TALLY.dbull
  if (hit.label === 'BULL' || hit.label === '25') return TALLY.bull
  if (hit.mult === 3) return TALLY.treble
  if (hit.mult === 2) return TALLY.double
  return TALLY.single
}

/** How many fans a tally has brought over — the alternate score's only
 *  purpose. It never goes down, which is why the count itself is kept and
 *  compared rather than decremented: an evening's work does not un-happen. */
export function tallyFans(tally: number): number {
  return Math.max(0, Math.floor(tally / TALLY_STEP))
}

/** Every call that hands out embers, cheapest first — the store page's earning
 *  table is rendered from this, so the shelves and the board agree by
 *  construction rather than by somebody remembering. */
export const EARNING_CALLS: CallSpec[] =
  [...Object.values(CALLS), ...Object.values(SMOKE_CALLS)]
    .filter(c => c.embers > 0 && !!c.note)
    .sort((a, b) => a.embers - b.embers)
