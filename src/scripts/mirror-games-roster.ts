// Mirror pass for A GAME IS A BEEHAVIOUR — the four arcade games took their
// place in the Beehaviors roster, with a row and a light each.
//
// Nothing is minted: the `games` collection and its four tiles already exist
// (mirror-behaviors.ts). This pass writes onto the COLLECTION TILE, which is
// exactly the cell whose meaning changed — a collection whose members were
// creations the one switch could not reach.
//
// MERGE MODE, EXTEND NEVER REPLACE. Every note goes through noteOnce, which
// looks for that exact text first, so a re-run adds only what is missing.
//
// Requires a renderer on the bridge: open the hive with `?claudeBridge=1`.
//
//   npx tsx scripts/mirror-games-roster.ts

import { createHash } from 'node:crypto'
import WebSocket from 'ws'

const BRIDGE_PORT = 2401
// A commit can legitimately take minutes in a background renderer mid-optimize.
const TIMEOUT = 180_000

let counter = 0
type BridgeRes = { id: string; ok: boolean; data?: any; error?: string }

function sendOnce(request: Record<string, unknown>): Promise<BridgeRes> {
  return new Promise((resolve, reject) => {
    const msg = { ...request, id: `mirror-${Date.now()}-${++counter}` }
    // Pin IPv4 loopback: a second listener on 2401 (0.0.0.0) swallows
    // `localhost` dials without answering — only 127.0.0.1 has the renderer.
    const ws = new WebSocket(`ws://127.0.0.1:${BRIDGE_PORT}`)
    const timer = setTimeout(() => { ws.close(); reject(new Error('bridge timeout')) }, TIMEOUT)
    ws.on('open', () => ws.send(JSON.stringify(msg)))
    ws.on('message', (raw: unknown) => {
      clearTimeout(timer)
      try { resolve(JSON.parse(String(raw)) as BridgeRes) } catch { reject(new Error('invalid response')) }
      ws.close()
    })
    ws.on('error', (err: Error) => { clearTimeout(timer); reject(new Error(`bridge connection failed: ${err.message}`)) })
  })
}

async function send(request: Record<string, unknown>): Promise<BridgeRes> {
  const res = await sendOnce(request)
  if (!res.ok && res.error === 'no renderer connected') {
    await new Promise(r => setTimeout(r, 4000))
    return sendOnce(request)
  }
  return res
}

/** Retry a lost response. Non-idempotent ops pass `landed` so a swallowed reply
 *  is never mistaken for a failed write and re-applied as a duplicate. */
async function sendRetry(
  request: Record<string, unknown>,
  landed?: () => Promise<boolean>,
): Promise<BridgeRes> {
  for (let attempt = 1; ; attempt++) {
    try { return await send(request) }
    catch (e) {
      if (landed && await landed().catch(() => false)) return { id: '', ok: true, data: 'landed after timeout' }
      if (attempt >= 3) throw e
      process.stdout.write(`(timeout — retry ${attempt}) `)
    }
  }
}

const decorationSig = (kind: string, payload: Record<string, unknown>): string =>
  createHash('sha256').update(JSON.stringify({ kind, appliesTo: [], payload })).digest('hex')

const tagSig = (name: string): string => decorationSig('tag', { name })

async function mark(segments: string[], name: string): Promise<boolean> {
  const before = await send({ op: 'layer-at', segments })
  if (before.ok && ((before.data?.decorations ?? []) as string[]).includes(tagSig(name))) return true
  const res = await sendRetry(
    { op: 'decoration-add', segments, kind: 'tag', appliesTo: [], payload: { name } },
    async () => {
      const check = await send({ op: 'layer-at', segments })
      const decs = (check.data?.decorations ?? []) as string[]
      return check.ok && decs.includes(tagSig(name))
    },
  )
  return res.ok
}

/** Add a note only if this exact text is not already on the cell. `note-add`
 *  is additive, so the text IS the idempotence key — every re-run of this pass
 *  must be safe, including on a cell an earlier creation already annotated. */
async function noteOnce(segments: string[], text: string): Promise<'written' | 'present' | 'failed'> {
  const list = await send({ op: 'note-list', segments })
  const has = (res: BridgeRes): boolean =>
    res.ok && Array.isArray(res.data) && res.data.some((x: any) => String(x?.text ?? '') === text)
  if (has(list)) return 'present'
  const res = await sendRetry(
    { op: 'note-add', segments: segments.slice(0, -1), cell: segments[segments.length - 1], text },
    async () => has(await send({ op: 'note-list', segments })),
  )
  return res.ok ? 'written' : 'failed'
}

// ── the creation ────────────────────────────────────────────────────
//
// The subject is the COLLECTION ITSELF. `behaviors/games` gathered four
// creations that the one switch could not reach — the roster listed what marks
// a tile, and a game marks nothing. That is what changed, so the collection
// tile is where it is written.

const GAMES = ['behaviors', 'games']

const NOTES: string[] = [
  'A GAME IS A BEEHAVIOUR. Every other behaviour reaches the roster by way of a DECORATION KIND — it is a mark a tile carries, so the roster has something to be about. A game carries nothing: it is a `genotype:\'game\'` bee that mounts a full-screen overlay above the hive and touches no layer, no hex, no Pixi. That is why the four games sat outside the one switch for so long. Their roster identity is minted instead from the one thing they already declare about themselves — the launch descriptor — as the kind `game:<gameId>`. It is not a `visual:*` kind and must never become one: nothing writes it onto a tile and nothing reads it off one. It exists to be SWITCHED, and the switch is the whole of it.',

  'THE POOL IS THE WHOLE OF A GAME\'S PRESENCE. Games appear in the pool lens only, never in a layer\'s list. The per-tile list answers "what does this layer carry", and a game is never an answer to that question — it belongs to the hive, not to a place in it. For the same reason a game has no wake exception and no binding: those are per-tile escapes from dormancy, and there is no tile to escape at. One light, hive-wide, which is exactly what the row shows.',

  'OFF MEANS GONE, IN THREE PLACES AT ONCE. A dormant game leaves the header icon (the drone emits `available:false`), leaves the launcher group (`gameDormant` on the bee, read shell-side, and when the last one goes out the games icon goes with it), and closes itself if it happens to be running — a game left on screen after being switched off is the contradiction "one switch, one meaning" exists to forbid. The census is not a roster either: the pool of games IS `window.ioc` filtered by genotype, so a community game module lands in the Beehaviors list for free, with its own label, icon and sentence.',

  'THE COMMAND ANSWERS — the one place a dormant behaviour speaks. Everywhere else, off is silent: the behaviour is simply not offered, and there is no gesture to reply to. A typed `/roper` IS a gesture, and swallowing it reads as a broken game — the same failure the post-it takeover taught, where a dormant mark handed back a plain hexagon and looked like a regression for weeks. So the queen refuses out loud, once, naming where the light lives.',

  'PUTTING A SWITCH ON SOMETHING MUST NOT TURN IT OFF. The roster is opt-in — a kind the on-list does not name arrives dark — and that is right for a new module\'s behaviour, which nobody has ever seen. It is wrong for behaviour that ALREADY WORKED hive-wide and is only now being put behind a switch: four games going quiet as the side effect of gaining a row is not a switch, it is a regression. So `seedCohortOn` lights a cohort ONCE on a hive that already has an on-list, records that it did, and never runs again — a deliberate switch-off survives every boot after. A hive that opened DARK is stamped `*` and refuses every cohort forever: nothing may light itself behind the participant, now or for any cohort that comes later.',

  'Proof: `node scripts/drive-games-roster.cjs --url http://localhost:4450` — 15 checks on a live shell walking the whole loop. The pool lists all four with their commands and all lit; switching one off makes the bee answer dormant, dims its row, leaves the other three alone, makes `open()` refuse and `toggle()` report the refusal instead of lying, and takes it out of the launcher; re-lighting brings it back; and a game left RUNNING closes itself the moment its light goes out.',
]

async function main(): Promise<void> {
  const at = await send({ op: 'layer-at', segments: GAMES })
  if (!at.ok) {
    console.error('ABORT — no /behaviors/games collection to extend. This pass EXTENDS the')
    console.error('behaviors mirror; it never mints a second copy. Run mirror-behaviors.ts first.')
    process.exitCode = 1
    return
  }
  console.log('extending /behaviors/games (the collection tile)\n')

  let written = 0, present = 0, failed = 0
  for (const text of NOTES) {
    process.stdout.write('  note: ' + text.slice(0, 52).replace(/\s+/g, ' ') + '… ')
    const r = await noteOnce(GAMES, text)
    console.log(r)
    if (r === 'written') written++
    else if (r === 'present') present++
    else failed++
  }

  // The declared vocabulary, re-asserted: the collection tile is itself a
  // beehaviour cell and carries its category keyword. Both are idempotent
  // no-ops when the earlier passes already painted them.
  for (const keyword of ['behavior', 'game']) {
    process.stdout.write('  mark: ' + keyword + ' ')
    console.log(await mark(GAMES, keyword) ? 'ok' : 'FAILED')
  }

  console.log('\n' + written + ' written, ' + present + ' already present, ' + failed + ' failed')
  if (failed) process.exitCode = 1
}

main().catch(e => { console.error(String(e)); process.exitCode = 1 })
