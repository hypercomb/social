// Mirror pass for A VIEW IS A BEEHAVIOUR — the Beehaviors panel's kind filter
// stopped being two switches over a set and its subset, and became a CHOICE.
//
// Nothing is minted: the `views` collection already exists (mirror-behaviors.ts),
// and this pass only writes onto the COLLECTION TILE, which is exactly the cell
// whose meaning changed — a collection that is a subset of the root it sits in.
// No new cells, no new keywords.
//
// MERGE MODE, EXTEND NEVER REPLACE. Every note goes through noteOnce, which
// looks for that exact text first, so a re-run adds only what is missing.
//
// Requires a renderer on the bridge: open the hive with `?claudeBridge=1`.
//
//   npx tsx scripts/mirror-behaviors-lens.ts

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
      // Decorations on a layer are SIGNATURE references — landed means the
      // canonical decoration content's sig appears in the list.
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
// The subject is the COLLECTION ITSELF. `behaviors/views` is not a sibling of
// the other collections in kind — it is a SUBSET of the root that holds it, and
// the panel now says so out loud. That fact belongs on the collection tile.

const VIEWS = ['behaviors', 'views']

const NOTES: string[] = [
  'A VIEW IS A BEEHAVIOUR. This collection is a SUBSET of the root that holds it, not a rival kind beside it — every cell gathered here is already a behaviour, and would stand under `behaviors` whether or not it were also gathered here. Views were once a window of their own, then a category, then a tab; each of those said "views OR beehaviours" and each was wrong. What a view actually is: a beehaviour that PRESENTS, which is why it is the one kind that can be a layer’s arrival face. That is a property, not a separate world, and the only place it shows in the panel is the GROUND the row stands on.',

  'THE STRIP IS A CHOICE, NOT TWO SWITCHES. The Beehaviors panel filters by kind with two buttons — Beehaviors and Views — and they are mutually exclusive: exactly one is ever lit, and clicking the lit one does nothing. BEEHAVIORS IS THE WHOLE LIST, views included, because a view is one of them; VIEWS is the same list narrowed to the surfaces. There is no third "all" position, because "all" is what Beehaviors already means.',

  'WHY THE SUPERSET CANNOT HAVE ITS OWN SWITCH. Two independent toggles over a set and its subset reach four combinations and only two of them say anything new: both lit was a second name for Beehaviors, and both dark was an EMPTY LIST — a state the panel had to be taught to climb back out of ("turning the last one off lights both again"). A rule that exists only to forbid a state is the sign the state should never have been reachable. A choice between two cannot express it: the list can never go empty, so nothing has to rescue it.',

  'WHERE YOU ARE READING IS A DIFFERENT QUESTION. The kind buttons narrow WHAT is listed; the scope toggle on the far gutter says WHERE the list is read — this layer, or the pool of every beehaviour the app knows with one global light each. They sit on opposite ends of the same strip because they are two questions, and they were once one icon cycling through both, which made the pool look like a filter and hid the narrowing behind it. Escape unwinds them in that order: the pool first, then the narrowing — resting on the beehaviours, which are all of them.',

  'Proof: `node scripts/drive-behaviors-lens.cjs --url http://localhost:4253` — 15 checks walking the strip on a live shell. It asserts the containment directly: the whole list holds views AMONG the rest, the narrow list is nothing but views, narrowing drops exactly the non-views and widening brings back exactly the same count, the lit button is inert, and the list can never go empty.',
]

async function main(): Promise<void> {
  const at = await send({ op: 'layer-at', segments: VIEWS })
  if (!at.ok) {
    console.error('ABORT — no /behaviors/views collection to extend. This pass EXTENDS the')
    console.error('behaviors mirror; it never mints a second copy. Run mirror-behaviors.ts first.')
    process.exitCode = 1
    return
  }
  console.log('extending /behaviors/views (the collection tile)\n')

  let written = 0, present = 0, failed = 0
  for (const text of NOTES) {
    process.stdout.write('  note: ' + text.slice(0, 52).replace(/\s+/g, ' ') + '… ')
    const r = await noteOnce(VIEWS, text)
    console.log(r)
    if (r === 'written') written++
    else if (r === 'present') present++
    else failed++
  }

  // The declared vocabulary, re-asserted: the collection tile is itself a
  // beehaviour cell and carries its category keyword. Both are idempotent
  // no-ops when the earlier passes already painted them.
  for (const keyword of ['behavior', 'view']) {
    process.stdout.write('  mark: ' + keyword + ' ')
    console.log(await mark(VIEWS, keyword) ? 'ok' : 'FAILED')
  }

  console.log('\n' + written + ' written, ' + present + ' already present, ' + failed + ' failed')
  if (failed) process.exitCode = 1
}

main().catch(e => { console.error(String(e)); process.exitCode = 1 })
