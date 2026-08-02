// Mirror pass for THE THEME IS A GROUP — the settling pass over
// `behaviors/appearance/background`, minted earlier the same day.
//
// What changed in the code, and therefore here:
//   1. A theme is a GROUP of pictures, and each tile draws its own from the
//      group — a wall of tiles is varied, not repeated. Naming one picture pins
//      it onto every tile instead.
//   2. force (this layer) and force-global (the whole hive) overwrite tiles
//      that are already dressed. Neither ever touches a picture the participant
//      attached. <picture> force-global is refused outright.
//   3. DOT SYNTAX. A theme is an object and its pictures are its members, so
//      the arguments are walked into with dots and the dropdown completes the
//      segment after the last one — the position says what a word is, which a
//      flat row of space-separated words could not.
//
// Notes stack: the newest note on a tile is the settled shape. Structure is
// union-only; this pass adds no cells.

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

const NOTES: { cell: string[]; text: string }[] = [
  {
    cell: SEG,
    text: [
      'A theme is a GROUP OF PICTURES, and the group is the point. Applying one dresses tiles that have no picture yet, and each tile draws its OWN picture from the group — a wall of them reads varied but coherent, never the same picture repeated. Name one picture and that one goes on every tile instead; the pin is session-only, so a reload returns the whole group.',
      '',
      'DOT SYNTAX: /background <theme>[.<picture>][.force|.force-global], and /background <theme>.items. A theme is an object and its pictures are its members, so you walk into it with dots and the dropdown completes the segment after the last one — exactly the way member completion works everywhere else. A flat row of space-separated words could not say whether "dots" was a theme, a picture or a flag; the position after a dot says it. Spaces still parse, so nothing that used to work stops working.',
      '',
      'SEEING THE GROUP: <theme>.items lists the pictures and opens the substrate organizer, where they are thumbnails and can be curated. A group is only listable while it is the active one — a pool is warmed when it is in use — so items makes the theme active before showing it.',
      '',
      'FORCE: by default a theme change leaves already-dressed tiles alone. force re-dresses the layer you are looking at; force-global re-dresses every tile in the hive. NEITHER EVER TOUCHES A PICTURE THE PARTICIPANT ATTACHED — that is what makes force safe to type. <picture>.force-global is refused: one picture stamped across an entire hive is not a look, and it is the one combination rerolling cannot undo.',
      '',
      `source: ${E}/commands/background.queen.ts`,
    ].join('\n'),
  },
  {
    cell: [...SEG, 'background-theme-service'],
    text: [
      'How an overwrite knows what is yours. The test is whether the tile is wearing something a substrate pool put there, and the trick is WHEN the question is asked: the outgoing group\'s signatures are captured BEFORE the source switch, because after it they are no longer in the pool and could not be told apart from a picture the participant attached. Those, unioned with the incoming group\'s, are the only signatures an overwrite may replace. Everything else is left exactly as it is, at any reach.',
      '',
      'The error leans safe in the one direction it can: a picture from a theme OLDER than the one currently active is not recognised as theme-owned, so it survives a force. Nothing custom is ever destroyed; at worst a stale theme picture stays and can be forced again.',
      '',
      `source: ${E}/presentation/background/background-theme.service.ts`,
    ].join('\n'),
  },
  {
    cell: [...SEG, 'substrate-service'],
    text: [
      'What force and pinning are built from. Pinning one picture is the SAME session-only enabled set that the retired /backgrounds queen drove one toggle at a time — pinning simply disables everything else, so every pick returns the one. That is why the per-picture switch did not need to survive the merge as its own behaviour: it became the picture argument.',
      '',
      'restyle() clears only the assignments whose signature the caller vouched for and then re-fills from the active pool. allLabels() walks the LAYER tree for force-global — tiles are layer state and many have no OPFS directory, so a directory walk misses them; it is the same walk the stamp pass uses, depth-capped, and returns nothing when history is not ready rather than guessing.',
      '',
      `source: ${E}/substrate/substrate.service.ts`,
    ].join('\n'),
  },
]

async function main(): Promise<void> {
  let ok = 0
  for (const n of NOTES) {
    process.stdout.write(`[note] ${n.cell.join('/')} ... `)
    const res = await send({ op: 'note-add', segments: n.cell.slice(0, -1), cell: n.cell[n.cell.length - 1], text: n.text })
    console.log(res.ok ? 'ok' : `FAIL: ${res.error}`)
    if (res.ok) ok++
  }
  console.log(`[background-force] DONE — ${ok}/${NOTES.length} notes`)
}

main().catch(err => { console.error(err); process.exit(1) })
