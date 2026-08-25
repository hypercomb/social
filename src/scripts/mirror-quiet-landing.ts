// Mirror pass for QUIET LANDING — the bridge's answer lands in the hive
// without pulling the surface out from under the participant.
//
// A new creation under `behaviors/assistant`: the cell, its notes, and one
// child cell per implementation file (marked `part`). `behavior`,
// `assistant` and `part` are the declared vocabulary from the behaviors
// mirror — nothing is minted on the fly.
//
// EXTEND NEVER RE-CREATE. The collection is READ before anything is written
// and the pass ABORTS if it cannot be read (that is a missing behaviors
// mirror, not something for this pass to paper over). Children are UNIONED
// and every note goes through noteOnce, so a re-run adds only what is
// missing — this pass is safe to drain unattended.
//
// Requires a renderer on the bridge: open the hive with `?claudeBridge=1`.
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

function norm(s: string): string {
  return s.trim().toLocaleLowerCase()
    .replace(/[._\s/]+/g, '-')
    .replace(/[^\p{L}\p{N}\-]/gu, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64)
    .replace(/-$/, '')
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

/** Children of a cell, or [] when it does not exist yet. */
async function childrenOf(segments: string[]): Promise<string[]> {
  const res = await send({ op: 'inflate', segments }).catch(() => ({ ok: false } as BridgeRes))
  if (!res.ok) return []
  return ((res.data?.children ?? []) as any[]).map(c => String(c?.name ?? '')).filter(Boolean)
}

/** Ensure `segments` exists and holds AT LEAST `want` as children — a union,
 *  never a replacement, so an existing cell keeps everything it already had. */
async function ensure(segments: string[], want: string[] = []): Promise<boolean> {
  const name = segments[segments.length - 1]
  const have = await childrenOf(segments)
  const merged = [...have, ...want.filter(w => !have.includes(w))]
  const layer = merged.length ? { name, children: merged } : { name }
  const res = await sendRetry({ op: 'update', segments, layer })
  return res.ok
}

// ── the creation ────────────────────────────────────────────────────

const ROOT_KEY = norm('behaviors')
const COLLECTION = norm('assistant')
const CELL = norm('quiet-landing')

const BEHAVIOR_KEYWORD = 'behavior'
const ASSISTANT_KEYWORD = 'assistant'
const PART_KEYWORD = 'part'

const NOTES = [
  'THE WRITE LANDS, THE PAINT WAITS. Answering an ask raised from a tile used to cost the participant their place: the payload came back, the layer was minted, the lineage changed, and the canvas re-walked underneath whatever they were doing. One answer, one flicker — and a drained batch of twenty writes is twenty. So the two halves were separated. The write is never deferred: the layer is minted, the note is on the cell, the resource is in the pool, all at the moment the payload arrives. Only the REPAINT is held.',
  'A BURST IS ONE WINDOW, AND THE PRODUCER IS THE ONLY THING THAT KNOWS IT. The bridge brackets its mutating ops with `landing:quiet` — depth-counted, so twenty writes in flight are one window, and closed on a SETTLE delay (400ms) rather than at the last op’s return, because the commit machine flushes its markers just AFTER the handler resolves and closing on the dot would let that trailing lineage change through as exactly the flicker this exists to prevent. Read-only ops never open a window: a `list` arriving mid-burst must not extend somebody else’s.',
  'A WRITE’S CONSEQUENCES ARRIVE AS A CHAIN, NOT AN EVENT. This is the part every naive version gets wrong. The producer’s window covers the WRITE; what follows is the commit flushing its marker, then the readiness repaint as each new tile’s visual resolves, then the optimize tick — measured at 8, 36, 204, 353, 407, 659 and 929ms after one three-tile burst, from SEVEN different call sites. No settle delay on the producer covers that, and tagging the callers is a losing game: the chain reaches requestRender through paths that look exactly like a participant’s. So the renderer MEASURES the chain — while paints keep being held, the landing is still landing; once nothing has been held for 1.5s the chain is done and the next paint belongs to the participant.',
  'THE FORCE IS ARMED ON RELEASE, NEVER ON HOLD. The pass that spends the badge must actually RUN: the held change is at the SAME location, so the unchanged-page fast path would return having done nothing and the badge would clear over a surface that never moved. Arming it while HOLDING is worse than useless — `#scheduleReadinessRepaint` re-arms itself every 30ms while the force is set, so the first version built a repaint loop that fired the instant the quiet window closed. That was the whole bug.',
  'THE BADGE MEANS "YOU HAVE NOT SEEN THIS", NEVER "THIS IS NOT WRITTEN". The pill counts WRITES, as tallied by the producer — never held paints, which coalesce and would under-report. It outlives the burst, and a render that happens for any OTHER reason (they panned, they walked into a layer, they edited something) has already shown them what landed, so that pass clears the count on its way through.',
  'ONE RELEASE, AND IT IS THEIRS. Tapping the badge is the only thing that applies a held change — no idle timer, no auto-apply on navigation. A repaint the participant did not ask for is the whole complaint; a mechanism that eventually does it anyway has not fixed anything. The tap emits `landing:apply` and the renderer owns everything after that.',
  'THREE CHANNELS, NO NEW SERVICE. `landing:quiet` (producer brackets a burst), `landing:pending` (renderer publishes what is unseen), `landing:apply` (the tap). EffectBus is in core, so a module and the shell can both speak it without the module ever importing the shell — and last-value replay makes mount order irrelevant. Any future background writer becomes quiet by bracketing its own burst; nothing in the renderer or the badge knows what a bridge is.',
]

type Part = [file: string, role: string]

const PARTS: Part[] = [
  ['hypercomb-essentials/src/diamondcoreprocessor.com/presentation/tiles/show-cell.drone.ts',
   'the hold and the cascade measure — #quietLanding, #heldRenders, #landedWrites, #heldAtKey, #lastHeldAt. requestRender counts instead of painting while the window is open OR the write is still cascading at a location the participant has not left; the force is armed on release so the spending pass survives the unchanged-page fast path'],
  ['hypercomb-essentials/src/diamondcoreprocessor.com/assistant/claude-bridge.worker.ts',
   'the window — #MUTATING_OPS, the depth counter and the 400ms settle close. Wraps dispatch so a write opens a window and a read never does, and carries its own write tally so the badge shows a number that means what it says'],
  ['hypercomb-shared/ui/landing-badge/landing-badge.component.ts',
   'the badge — the pill on top and the one release. Reads `landing:pending` (count 0 hides it), emits `landing:apply` on tap, and self-registers as a shell surface at order 345. Its template and stylesheet sit beside it; the pill is a single button because the whole thing is the target'],
  ['scripts/drive-quiet-landing.cjs',
   'the proof — a Playwright profile of its own (a scratch hive, never the participant’s) judging the SCENE and not the picture: headless has no GPU, Pixi’s shaders never compile, so it reads render:cell-count through the bridge’s effect-last op. Needs a broker with EXACTLY ONE renderer, or writes and reads get answered by different ones'],
  ['hypercomb-shared/ui/shell-surfaces/shell-surfaces.barrel.ts',
   'the mount — the one list of registry-fed surfaces. The badge contributes itself by being imported here; no <hc-*> tag was added to either shell’s app.html, which a doctrine ratchet enforces'],
]

let created = 0, present = 0, failed = 0

function tally(result: 'written' | 'present' | 'failed'): void {
  if (result === 'written') created++
  else if (result === 'present') present++
  else failed++
}

async function main(): Promise<void> {
  const collectionSeg = [ROOT_KEY, COLLECTION]
  const siblings = await childrenOf(collectionSeg)
  if (!siblings.length) {
    console.error(`[mirror] ABORT: cannot read "${ROOT_KEY}/${COLLECTION}". Open the hive with ?claudeBridge=1 and ensure the behaviors mirror is built.`)
    process.exit(1)
  }
  console.log(`[mirror] "${COLLECTION}" holds: ${siblings.join(', ')}`)

  process.stdout.write(`[mirror] ${collectionSeg.join('/')} ← ${CELL} ... `)
  console.log(await ensure(collectionSeg, [CELL]) ? 'ok' : 'FAIL')

  const cellSeg = [...collectionSeg, CELL]
  process.stdout.write(`[mirror] ${cellSeg.join('/')} ... `)
  console.log(await ensure(cellSeg) ? 'ok' : 'FAIL')

  for (const text of NOTES) {
    process.stdout.write(`[note] ${CELL} ... `)
    const res = await noteOnce(cellSeg, text)
    tally(res)
    console.log(res)
  }
  for (const keyword of [BEHAVIOR_KEYWORD, ASSISTANT_KEYWORD]) {
    process.stdout.write(`[mark] ${CELL} ← ${keyword} ... `)
    console.log(await mark(cellSeg, keyword) ? 'ok' : 'FAIL')
  }

  const keys = PARTS.map(([file]) => norm(file.split('/').pop()!.replace(/\.(ts|cjs|html|scss)$/, '')))
  process.stdout.write(`[mirror] ${cellSeg.join('/')} ← ${keys.length} part(s) ... `)
  console.log(await ensure(cellSeg, keys) ? 'ok' : 'FAIL')

  for (let i = 0; i < PARTS.length; i++) {
    const [file, role] = PARTS[i]!
    const seg = [...cellSeg, keys[i]!]
    process.stdout.write(`[part] ${keys[i]} ... `)
    if (!(await ensure(seg))) { failed++; console.log('FAIL (cell)'); continue }
    const text = `${file.split('/').pop()} — ${role}\n\npart of /${CELL}\nsource: ${file}`
    const noted = await noteOnce(seg, text)
    const marked = await mark(seg, PART_KEYWORD)
    tally(noted === 'failed' || !marked ? 'failed' : noted)
    console.log(noted === 'failed' || !marked ? `FAIL (note:${noted} mark:${marked})` : `ok (${noted})`)
  }

  console.log(`[mirror] DONE — ${created} written, ${present} already present, ${failed} failed`)
  if (failed > 0) process.exitCode = 1
}

main().catch(err => { console.error(err); process.exit(1) })
