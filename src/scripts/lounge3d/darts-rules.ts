// scripts/lounge3d/darts-rules.ts
//
// 501, STRAIGHT IN, DOUBLE OUT — the rules of the lounge board, on their own,
// with no three.js anywhere near them.
//
// They live apart from the room because they are the only part of a dart game
// that can be WRONG in a way you would not see. A misplaced ring is obvious
// the moment you look at the board; a checkout that leaves you on 1, or a bust
// that forgets to give the points back, is a bug you discover three legs later
// having believed a score that never happened. So: pure functions, no state,
// no DOM — and a spec beside them (`darts-rules.spec.ts`).
//
// Everything skilful about darts is downstream of the double-out rule. It is
// why 170 is the highest checkout, why nobody wants to be left on 169, and why
// leaving yourself 32 is worth more than four extra points on the way there.

/** The board, clockwise from the top. */
export const DART_NUMS = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5]

/** Standard board ratios as fractions of the painted face: the playing field
 *  (170mm) is 78.125% of the radius. The painter and the scorer share these —
 *  keep them in sync or the board lies about where you hit. */
export const DART_RINGS = {
  dblOut: 0.78125, dblIn: 0.7445, trOut: 0.4917, trIn: 0.455, bull: 0.073, dbull: 0.0292,
} as const

/** The radius of the painted face in room units. */
export const BOARD_R = 0.27

/** Where a dart landed, in the language a scoreboard uses. */
export type DartHit = {
  /** 'T20', 'D16', '5', 'BULL', 'D·BULL', 'WIRE'. */
  label: string
  points: number
  /** 1 single, 2 double, 3 treble, 0 off the scoring face. The outer bull is a
   *  SINGLE 25; the inner bull is a DOUBLE, which is why it finishes a leg. */
  mult: 0 | 1 | 2 | 3
}

/** Score one landing, in board-local units from the centre. Shared by the
 *  player and the house — one definition, so the Colonel cannot be cheating. */
export function scoreDart(x: number, y: number): DartHit {
  const r = Math.hypot(x, y) / BOARD_R
  const seg = (Math.PI * 2) / 20
  const idx = ((Math.round(Math.atan2(x, y) / seg) % 20) + 20) % 20
  const n = DART_NUMS[idx]
  if (r < DART_RINGS.dbull) return { label: 'D·BULL', points: 50, mult: 2 }
  if (r < DART_RINGS.bull) return { label: 'BULL', points: 25, mult: 1 }
  if (r < DART_RINGS.trIn) return { label: String(n), points: n, mult: 1 }
  if (r < DART_RINGS.trOut) return { label: 'T' + n, points: n * 3, mult: 3 }
  if (r < DART_RINGS.dblIn) return { label: String(n), points: n, mult: 1 }
  if (r < DART_RINGS.dblOut) return { label: 'D' + n, points: n * 2, mult: 2 }
  return { label: 'WIRE', points: 0, mult: 0 }
}

/** The centre of a named bed, in board-local units — where you AIM when you
 *  want that number. A single is the fat outer bed, which is why a nervous
 *  player still scores something. */
export function bedCentre(n: number, mult: 1 | 2 | 3): { x: number; y: number } {
  if (n === 25) return { x: 0, y: 0 }
  const idx = DART_NUMS.indexOf(n)
  const a = idx * ((Math.PI * 2) / 20)
  const r = mult === 3
    ? (DART_RINGS.trIn + DART_RINGS.trOut) / 2
    : mult === 2
      ? (DART_RINGS.dblIn + DART_RINGS.dblOut) / 2
      : (DART_RINGS.trOut + DART_RINGS.dblIn) / 2
  return { x: Math.sin(a) * r * BOARD_R, y: Math.cos(a) * r * BOARD_R }
}

/** Every dart you could throw, richest first — the search space for a
 *  checkout, and the house's shot list. */
export const DART_OPTIONS: ReadonlyArray<{ n: number; mult: 1 | 2 | 3; points: number; label: string }> =
  (() => {
    const out: Array<{ n: number; mult: 1 | 2 | 3; points: number; label: string }> = []
    for (const n of DART_NUMS) out.push({ n, mult: 3, points: n * 3, label: 'T' + n })
    out.push({ n: 25, mult: 2, points: 50, label: 'BULL' })
    for (const n of DART_NUMS) out.push({ n, mult: 2, points: n * 2, label: 'D' + n })
    for (const n of DART_NUMS) out.push({ n, mult: 1, points: n, label: String(n) })
    out.push({ n: 25, mult: 1, points: 25, label: '25' })
    return out.sort((a, b) => b.points - a.points)
  })()

/**
 * The finishes — SOLVED, not tabulated: the way from `score` to zero in at
 * most `darts`, ending on a double.
 *
 * Null when there isn't one: anything over 170, and the bogey numbers every
 * player knows by heart (169, 168, 166, 165, 163, 162, 159). Richest dart
 * first and it stops at the first solution, so the answer is the one a player
 * would actually call — 96 comes out T20, D18.
 *
 * Cheap enough to run on every throw: 61 options, depth 3, first hit wins.
 */
export function checkout(score: number, darts: number): string[] | null {
  if (score <= 0 || darts <= 0) return null
  // One dart left: it has to be the double itself.
  const finisher = DART_OPTIONS.find(o => o.mult === 2 && o.points === score)
  if (finisher) return [finisher.label]
  if (darts === 1) return null
  for (const first of DART_OPTIONS) {
    const rest = score - first.points
    // Leaving 1 is leaving nothing — there is no double one-and-a-half.
    if (rest < 2) continue
    const tail = checkout(rest, darts - 1)
    if (tail) return [first.label, ...tail]
  }
  return null
}

/** 'T20' / 'D16' / 'BULL' / '25' / '5' → the bed to aim at. */
export function parseShot(label: string): { n: number; mult: 1 | 2 | 3 } {
  if (label === 'BULL' || label === 'D·BULL') return { n: 25, mult: 2 }
  if (label === '25') return { n: 25, mult: 1 }
  if (label.startsWith('T')) return { n: Number(label.slice(1)), mult: 3 }
  if (label.startsWith('D')) return { n: Number(label.slice(1)), mult: 2 }
  return { n: Number(label), mult: 1 }
}

/**
 * What the house throws at. A checkout when there is one — that is what makes
 * the Colonel dangerous from 120 down — otherwise the treble twenty, dropping
 * to a single when the treble would bust him.
 */
export function pickShot(score: number, remaining: number): { n: number; mult: 1 | 2 | 3 } {
  const out = checkout(score, remaining)
  if (out) return parseShot(out[0])
  const prefs: Array<{ n: number; mult: 1 | 2 | 3 }> = [
    { n: 20, mult: 3 }, { n: 19, mult: 3 }, { n: 20, mult: 1 }, { n: 19, mult: 1 }, { n: 1, mult: 1 },
  ]
  for (const p of prefs) if (score - p.n * p.mult >= 2) return p
  return { n: 1, mult: 1 }
}

/**
 * ONE DART AGAINST A SCORE — the whole of 501 in one function.
 *
 *   BUST when it takes you past zero, when it leaves you on 1 (there is no
 *   double one-and-a-half), or when it lands you on zero WITHOUT a double.
 *   A bust gives the whole turn's points back, which is the rule that makes
 *   the last hundred the hard part.
 *
 *   LEG when it lands exactly on zero with a double — including the inner
 *   bull, which is a double 25.
 */
export function resolveThrow(score: number, hit: DartHit): {
  outcome: 'score' | 'bust' | 'leg'
  /** The score AFTER this dart. On a bust this is the caller's turn-start
   *  score, which the caller must supply back — see `revert`. */
  score: number
  /** Why it busted, for the chalkboard. */
  reason?: 'over' | 'left-one' | 'no-double'
} {
  const next = score - hit.points
  if (next < 0) return { outcome: 'bust', score, reason: 'over' }
  if (next === 1) return { outcome: 'bust', score, reason: 'left-one' }
  if (next === 0 && hit.mult !== 2) return { outcome: 'bust', score, reason: 'no-double' }
  if (next === 0) return { outcome: 'leg', score: 0 }
  return { outcome: 'score', score: next }
}
