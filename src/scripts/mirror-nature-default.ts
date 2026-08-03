// Mirror pass for NATURE AS THE DEFAULT — an extension of the background
// themes mirror (mirror-background-themes.ts), not a re-run of it.
//
// What changed in the code, and therefore here:
//   1. Nature is the SHIP DEFAULT background theme. It leads the theme list,
//      an unchosen `active` reads as `nature`, and its picture set is the
//      substrate's default tile fill (first builtin, so the resolve fallback
//      lands on the same set the default names).
//   2. Nature grew from six pictures to TWENTY — the largest group by a
//      distance, which is what makes it fit to be the default: a wall of tiles
//      goes a long way before a picture repeats.
//   3. The substrate sets marker went to v4, which moves anyone still on an
//      earlier SHIP default (Steel from v2, Photos from v3) onto Nature once.
//      A deliberate choice is left alone — the marker only fires once.
//
// Notes only, on tiles that already exist. Nothing is created and nothing is
// deleted: this is the same behaviour, told what it now is.

import WebSocket from 'ws'

const BRIDGE_PORT = 2401
const TIMEOUT = 180_000

let counter = 0
type BridgeRes = { id: string; ok: boolean; data?: any; error?: string }

function sendOnce(request: Record<string, unknown>): Promise<BridgeRes> {
  return new Promise((resolve, reject) => {
    const msg = { ...request, id: `cli-${Date.now()}-${++counter}` }
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

const E = 'hypercomb-essentials/src/diamondcoreprocessor.com'
const SEG = ['behaviors', 'appearance', 'background']

const SCENES = [
  'rolling hills', 'ocean waves', 'sunset', 'mountains', 'desert dunes',
  'night sky', 'pine forest', 'birch woods', 'autumn maples', 'waterfall',
  'lake reflection', 'meadow flowers', 'aurora', 'tropical beach', 'canyon',
  'winter pines', 'bamboo grove', 'misty valley', 'wheat field', 'cherry blossom',
]

// Each note carries an id so a later addition can be sent on its own —
// note-add is additive, so re-running the whole list would duplicate what
// already landed. `npx tsx scripts/mirror-nature-default.ts redress` sends
// only that one; no arguments sends all of them.
const NOTES: { id: string; segments: string[]; text: string }[] = [
  {
    id: 'default',
    segments: SEG,
    text: [
      'NATURE IS THE DEFAULT. It leads the theme list, an unchosen active reads as `nature`, and its pictures are the substrate\'s default tile fill. It dresses tiles only — so the screen it arrives over is whatever was already there, which is exactly what a default should be: the tiles get a look without a decision being made about the backdrop on the participant\'s behalf.',
      '',
      `Nature is TWENTY pictures, where every other group is six: ${SCENES.join(', ')}. That size is the reason it can be the default — each tile draws its own picture, so a wall of them repeats only after twenty, and the group still reads as one look because every scene is the same flat vector language.`,
      '',
      'Anyone who had never chosen a set is moved onto it once. "Never chosen" means the active source still holds an earlier SHIP default — Steel from v2, Photos from v3 — or nothing at all; the `hc:substrate-sets-v` marker fires a single time, so a deliberate choice made at any point is never overwritten.',
      '',
      `source: ${E}/presentation/background/background-theme.service.ts`,
    ].join('\n'),
  },
  {
    id: 'substrate',
    segments: [...SEG, 'substrate-service'],
    text: [
      'The default tile source is Nature, and it is FIRST in the builtin list on purpose: resolve() falls back to the first builtin when nothing else answers, and that fallback should land on the same set the ship default names rather than on whatever happens to be at the top.',
      '',
      'The sets marker is at v4. The version governs one thing only — whether an UNCONFIGURED active source advances — and unconfigured now means either of the two earlier ship defaults (Steel, Photos) or nothing. Healing a dangling active source lands on Nature too, so every path that has to pick for the participant picks the same set.',
      '',
      `source: ${E}/substrate/substrate.service.ts`,
    ].join('\n'),
  },
  {
    id: 'redress',
    segments: [...SEG, 'substrate-service'],
    text: [
      'THE TILES MOVE TOO. Advancing the active source only decides what a BLANK tile will be given, and a hive that has been used is not blank — its tiles already wear pictures from the set it is being moved off. Leaving them there would make the new default a promise about tiles that don\'t exist yet. So the one-time advance onto Nature also re-dresses every tile wearing an OLD default, each getting its own picture from the new pool, so the wall stays varied instead of repeating.',
      '',
      'What moves is exactly what `force` moves: the provenance ledger — every signature the substrate has ever ASSIGNED — plus the live pool. A picture the participant attached, pasted or edited in is not in that set and is not touched. That is what the ledger is for, and it is why this can be done without asking.',
      '',
      'It runs on its own marker, `hc:substrate-redress-v`, separate from the sets marker. Advancing the source is one instant write; re-dressing needs history and the new pool, neither ready when the registry loads. So the sets marker moves immediately and the re-dress marker moves only once the pass has actually re-dressed something — an unready boot leaves it armed and it runs again next time. The armed value is what tells "was moved and still owes a re-dress" apart from "chose this set": someone who picked Nature themselves is never armed and never re-rolled.',
      '',
      'The pass waits for idle well past first paint. Nothing about it is urgent — every tile it moves is already showing a picture.',
      '',
      `source: ${E}/substrate/substrate.service.ts`,
    ].join('\n'),
  },
  {
    id: 'inplace',
    segments: [...SEG, 'substrate-service'],
    text: [
      'A RE-DRESS REPLACES IN PLACE. It does NOT clear the tile and hand it to the blank path — that was the bug that made every re-dress, on every path including force, a silent no-op: the blank path refuses a tile whose CANONICAL slot holds an image, and a default placed earlier is exactly such an image, so the cleared entry was never refilled. The reconciler then healed it straight back from canonical, so the picture returned and the pass looked like it had done its work. Proved on a real hive: four tiles, four entries cleared, four entries healed back to the same pictures, nothing visibly changed.',
      '',
      'So the swap is: pick from the new pool (excluding the current picture), write the entry, and RESTAMP CANONICAL when what canonical holds is a default of ours. Index and canonical must not drift — the renderer resolves through the index, the editor reads canonical, and the reconciler heals a missing entry FROM canonical, so a stale canonical default is a picture waiting to come back. A tile with no entry at all is still the blank path\'s job.',
      '',
      `source: ${E}/substrate/substrate.service.ts`,
    ].join('\n'),
  },
  {
    id: 'provenance',
    segments: [...SEG, 'substrate-service'],
    text: [
      'WHAT COUNTS AS OURS TO REPLACE — three tests, in cost order: the picture is in the LIVE POOL; or it is in the provenance LEDGER (recorded at the moment of assignment, so it survives its theme being gone); or its props record carries the mark `substrate: true`, which the service writes INTO every props record it mints.',
      '',
      'The third test is the one that makes any of this work on a hive that predates the ledger. The ledger is participant-local and only knows what THIS browser assigned since it started keeping the record; the mark is in the bytes, so a picture placed by any pool, on any device, at any time is still recognisable as ours. That matters most exactly when it is needed: once the source has switched, the pool that supplied the old pictures is gone, and a ledger written later never saw them. Without the mark, "move the defaults onto the new theme" silently moved nothing — the first hive it was tried on did not change one tile.',
      '',
      'An unreadable props record is NOT a default. The error leans, everywhere here, toward keeping a picture that might be the participant\'s.',
      '',
      'A WHOLE-HIVE re-dress walks PLACES, not names. Index entries are keyed by full lineage, so a flat list of labels re-dressed against the current location resolves only the tiles on the page you are standing on and silently misses the rest of the tree — the reason restyleEverywhere() exists and `restyle(allLabels())` is the wrong shape. allLabels() is the flat list and is now derived from allPlaces(), which keeps each name with the location it was found at.',
      '',
      `source: ${E}/substrate/substrate.service.ts`,
    ].join('\n'),
  },
]

async function main(): Promise<void> {
  const only = new Set(process.argv.slice(2))
  const send_ = only.size ? NOTES.filter(n => only.has(n.id)) : NOTES
  for (const n of send_) {
    process.stdout.write(`[note] ${n.segments.join('/')} ... `)
    const res = await send({ op: 'note-add', segments: n.segments.slice(0, -1), cell: n.segments[n.segments.length - 1], text: n.text })
    console.log(res.ok ? 'ok' : `FAIL: ${res.error}`)
    if (!res.ok) process.exitCode = 1
  }
  console.log(`[nature-default] DONE — ${send_.length} notes`)
}

main().catch(err => { console.error(err); process.exit(1) })
