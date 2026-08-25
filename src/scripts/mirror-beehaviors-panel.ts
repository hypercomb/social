// Mirror pass for the Beehaviors panel's HEADER and its PRESS, and for what
// leaving a view owes the tiles underneath it.
//
// Three creations from one session, two subjects:
//   behaviors        ← the panel that lists them all: its header, its press
//   behaviors/views  ← leaving a view: the repaint, and declaring a takeover
//
// Nothing is minted — both cells exist (mirror-behaviors.ts), and this pass
// only writes notes onto them. No new cells, no new keywords.
//
// MERGE MODE, EXTEND NEVER REPLACE. Every note goes through noteOnce, which
// looks for that exact text first, so a re-run adds only what is missing.
//
// Requires a renderer on the bridge: open the hive with `?claudeBridge=1`.
//
//   npx tsx scripts/mirror-beehaviors-panel.ts

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
 *  is additive, so the text IS the idempotence key. */
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

// ── the creations ───────────────────────────────────────────────────

const ROOT = ['behaviors']
const VIEWS = ['behaviors', 'views']

const ROOT_NOTES: string[] = [
  'THE HEADER NAMES ITS SUBJECT. `Beehaviors / <tile>` — the layer\'s own name, in the casing its author gave it, because the list underneath is about that place. THE POOL is attached to no tile, so there it says `global` instead and the word is the whole answer. THE HIVE ROOT has no name to give and gets no second segment at all: a separator with nothing after it read as `Beehaviors //`. Two segments, never three — hanging the scope word off the app AND the name read `Beehaviors / local / behaviors` on a tile named for what it holds, which says the same word twice and looks like a path.',

  'ONE PRESS PER SETTLED STATE. A row\'s light is a two-state switch and always was — press, it flips; press, it flips back. But the LAYER\'s switch waits on the drone to write the record while the POOL\'s is a localStorage write that lands instantly, and on an empty hive that round trip measures 136ms. On a full one it is long enough to doubt. A participant who does not see the row move presses again, landing a SECOND flip that puts it back where it started — and the third press, the one that finally works, is what makes a two-state switch feel like a three-stage control.',

  'SO THE PRESS ANSWERS ITSELF, TWICE OVER. First, the row PAINTS WHAT THE PRESS ASKED FOR immediately: the wish rides in the pending map from the press until the fresh group lands, so a slow answer can never look like a press that did nothing. Only the PAINT is optimistic — every handler still branches on the truth the drone answered with, which is exactly why a second press has to be refused while the first is in flight. Second, a repeat press on the same row inside 400ms is read as THE SAME PRESS, not a change of mind: long enough to cover a double-click and an impatient re-press, far short of anyone deciding they wanted it the other way after all.',
]

const VIEW_NOTES: string[] = [
  'LEAVING A VIEW REPAINTS THE TILES. The arrival gate\'s bargain was that the hexagons painted under the covered canvas would be sitting there to reveal, so closing a view needed no repaint at all. That is one assumption too many: a pass abandoned mid-walk, a view that navigated before it closed, a takeover that mounted before the grid was ever painted at this address — each of them leaves the mesh holding SOMEWHERE ELSE, or holding nothing.',

  'AND NOTHING ARRIVES TO FIX IT. Closing a view rarely changes the location, so the pass that would repaint meets show-cell\'s unchanged-page fast path — same location, cells already keyed — and returns having done nothing. The screen stays blank until the participant navigates away and back. So the return is now TOLD, not assumed: on the change back to the hexagons, show-cell drops a mesh that belongs to another location and FORCES one paint for where the participant actually stands. One paint per view close, the same rule the screensaver\'s restore already used.',

  'A VIEW MUST DECLARE THAT IT TAKES THE SURFACE. The shell keeps a hand-written list of the modes that cover the canvas — it cannot read the module registry, because a shell may never import the modules — and that list has now drifted twice: lightbox and tutor in July 2026, and `document`, found 2026-08-24. A missing entry costs twice. The canvas is never suppressed under the view; and, far worse, the mode is PERSISTED, so the next reload boots into a surface with no page mounted and the participant lands on a blank screen with no way back.',

  'THE DANGEROUS TEST IS NOW INVERTED. Persistence no longer asks "is this a takeover?" — it asks "is this the GROUND?", and writes only the hexagons, the one surface that is a place rather than a view. An unknown mode is therefore assumed to be a takeover, and the cost of being wrong is that a surface is not restored across a reload — never a white screen. The list still decides what COVERS the canvas, and there the safe default runs the other way: an unknown mode shows its tiles rather than an empty field. Both defaults point away from the blank screen; that is the whole design.',

  'AND ITS EXIT MUST WORK FROM ANYWHERE. Declaring `document` a takeover exposed the other half of the same bug: its Escape hung off the EDITOR element, so it only answered while the caret was in the text. That was survivable only while the hexagons still showed through the view — with the canvas properly suppressed underneath, an Escape that does not answer is a participant with no way back, which is a worse screen than the one the takeover flag was added to fix. The listener moved to the window, gated on the mode, in BUBBLE phase so anything mounted on top of the view consumes its own Escape first and a consumed one is left alone. Escape and the × are the peels to the hexagons EVERYWHERE; a view that only peels under one condition has not got a peel.',

  'Proof: `node scripts/drive-view-close-repaint.cjs --url http://localhost:4253 --view <view>` — creates a hive with tiles, enters the view, closes it, and measures THE CANVAS ITSELF at each step, so "the tiles are back" is a fact about the frame and not about a class name. Companions: `drive-behaviors-title.cjs` (7 checks on the header) and `drive-behavior-press-latency.cjs` (samples one press every 80ms and drives the impatient double press).',
]

async function main(): Promise<void> {
  let written = 0, present = 0, failed = 0

  for (const [segments, notes, label] of [
    [ROOT, ROOT_NOTES, '/behaviors (the panel that lists them all)'],
    [VIEWS, VIEW_NOTES, '/behaviors/views (leaving a view)'],
  ] as [string[], string[], string][]) {
    const at = await send({ op: 'layer-at', segments })
    if (!at.ok) {
      console.error(`ABORT — no /${segments.join('/')} to extend. This pass EXTENDS the behaviors`)
      console.error('mirror; it never mints a second copy. Run mirror-behaviors.ts first.')
      process.exitCode = 1
      return
    }
    console.log(`\nextending ${label}`)
    for (const text of notes) {
      process.stdout.write('  note: ' + text.slice(0, 52).replace(/\s+/g, ' ') + '… ')
      const r = await noteOnce(segments, text)
      console.log(r)
      if (r === 'written') written++
      else if (r === 'present') present++
      else failed++
    }
  }

  // Declared vocabulary, re-asserted. Idempotent no-ops where the earlier
  // passes already painted them.
  for (const keyword of ['behavior']) {
    process.stdout.write(`\n  mark /behaviors: ${keyword} `)
    console.log(await mark(ROOT, keyword) ? 'ok' : 'FAILED')
  }

  console.log('\n' + written + ' written, ' + present + ' already present, ' + failed + ' failed')
  if (failed) process.exitCode = 1
}

main().catch(e => { console.error(String(e)); process.exitCode = 1 })
