// Mirror pass for the SITE VERSIONS creation — choosing which version of a
// site you are looking at, from the websites window.
//
// Follows the established mirror shape exactly (mirror-behaviors.ts built the
// `behaviors` root and its collections; mirror-behavior-parts.ts spreads a
// creation's implementation files as child tiles). This creation is a view-side
// capability, so it lands as a behaviour under the EXISTING `views` collection:
//
//   behaviors/views/versions            ← the creation (keywords: behavior, view)
//   behaviors/views/versions/<part>     ← one tile per implementation file (part)
//
// Nothing new is minted: `behavior`, `view` and `part` are the declared
// vocabulary from the earlier passes, and `views` is an existing collection.
//
// MERGE MODE + IDEMPOTENT. A part that already carries a note was written by a
// previous run and is skipped, so re-running never duplicates notes or marks.
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

// ── the creation ────────────────────────────────────────────────────

const ROOT_KEY = norm('behaviors')
const COLLECTION = norm('views')
const BEHAVIOR = norm('versions')

const BEHAVIOR_KEYWORD = 'behavior'
const VIEW_KEYWORD = 'view'
const PART_KEYWORD = 'part'

const BEHAVIOR_NOTES = [
  'Choosing WHICH version of a site you are looking at, from the websites window. A site\'s versions are not a new bookkeeping structure — every commit at the site\'s location already records the page it was showing, so the chain of distinct pages down its lineage IS its version history, read rather than recorded.',
  'Two chains, never merged. THIS HIVE lists pages this hive has been showing; choosing one is an ordinary forward commit, undoable at the site like any other change — nothing is rewound and nothing is deleted. PUBLISHED lists deploy revisions the installer holds on its own origin; choosing one is a message across the sentinel port, re-validated there before it lands.',
]

type Part = [file: string, role: string]

const PARTS: Part[] = [
  ['hypercomb-shared/ui/aggregate-index/aggregate-source.ts',
   'the contract — an aggregate declares `versions` and `useVersion`, and the shared index panel draws the chain; a source without them is never offered the affordance'],
  ['hypercomb-shared/ui/aggregate-index/sources/websites.source.ts',
   'the websites source — reads the local chain out of the site\'s own lineage, asks the installer for the published one, and applies whichever is chosen'],
  ['hypercomb-shared/ui/aggregate-index/aggregate-index.component.ts',
   'the panel — one open chain at a time under the row it belongs to, the two groups headed rather than concatenated'],
  ['hypercomb-web/src/setup/sentinel-bridge.ts',
   'the hive side of the port — `revisions` reads the deploy chains, `useRevision` posts a pick; this origin holds none of what makes the pick safe'],
  ['diamond-core-processor/src/app/sentinel/sentinel-handler.ts',
   'the installer side of the port — assembles the chains from trusted domains, and re-validates every pick against that host\'s published roots before honouring it'],
]

const behaviorSeg = [ROOT_KEY, COLLECTION, BEHAVIOR]

const tagSig = (name: string): string =>
  createHash('sha256').update(JSON.stringify({ kind: 'tag', appliesTo: [], payload: { name } })).digest('hex')

async function mark(segments: string[], name: string): Promise<boolean> {
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

async function noted(segments: string[]): Promise<boolean> {
  const res = await send({ op: 'note-list', segments })
  return res.ok && Array.isArray(res.data) && res.data.length > 0
}

async function note(segments: string[], text: string): Promise<boolean> {
  const res = await sendRetry(
    { op: 'note-add', segments: segments.slice(0, -1), cell: segments[segments.length - 1], text },
    async () => {
      const check = await send({ op: 'note-list', segments })
      return check.ok && Array.isArray(check.data) && check.data.some((x: any) => x?.text === text)
    },
  )
  return res.ok
}

async function main(): Promise<void> {
  const inf = await send({ op: 'inflate', segments: [ROOT_KEY, COLLECTION] }).catch((e: Error) => ({
    ok: false as const, error: e.message, id: '', data: undefined,
  }))
  if (!inf.ok) {
    console.error(`[versions] ABORT: cannot read "${ROOT_KEY}/${COLLECTION}" (${inf.error}). Open the hive with ?claudeBridge=1 and ensure the behaviors mirror is built.`)
    process.exit(1)
  }

  const siblings = ((inf.data?.children ?? []) as any[]).map(c => String(c?.name ?? '')).filter(Boolean)
  console.log(`[versions] "${COLLECTION}" holds: ${siblings.join(', ') || '(none)'}`)

  // The behaviour tile, gathered into the existing collection.
  const merged = siblings.includes(BEHAVIOR) ? siblings : [...siblings, BEHAVIOR]
  process.stdout.write(`[versions] ${ROOT_KEY}/${COLLECTION} ← ${merged.length} children ... `)
  const up = await sendRetry({ op: 'update', segments: [ROOT_KEY, COLLECTION], layer: { name: COLLECTION, children: merged } })
  console.log(up.ok ? 'ok' : `FAIL: ${up.error}`)
  if (!up.ok) process.exit(1)

  process.stdout.write(`[versions] ${behaviorSeg.join('/')} ... `)
  const mk = await sendRetry({ op: 'update', segments: behaviorSeg, layer: { name: BEHAVIOR } })
  console.log(mk.ok ? 'ok' : `FAIL: ${mk.error}`)
  if (!mk.ok) process.exit(1)

  const behaviorFresh = !(await noted(behaviorSeg))
  if (behaviorFresh) {
    for (const text of BEHAVIOR_NOTES) {
      process.stdout.write(`[note] ${behaviorSeg.join('/')} ... `)
      console.log(await note(behaviorSeg, text) ? 'ok' : 'FAIL')
    }
    for (const keyword of [BEHAVIOR_KEYWORD, VIEW_KEYWORD]) {
      process.stdout.write(`[mark] ${behaviorSeg.join('/')} ← ${keyword} ... `)
      console.log(await mark(behaviorSeg, keyword) ? 'ok' : 'FAIL')
    }
  } else {
    console.log(`[versions] ${behaviorSeg.join('/')} already noted — skipping notes + marks`)
  }

  // The parts.
  const partKeys = PARTS.map(([file]) => norm(file.split('/').pop()!.replace(/\.ts$/, '')))
  process.stdout.write(`[versions] ${behaviorSeg.join('/')} ← ${partKeys.length} parts ... `)
  const kids = await sendRetry({ op: 'update', segments: behaviorSeg, layer: { name: BEHAVIOR, children: partKeys } })
  console.log(kids.ok ? 'ok' : `FAIL: ${kids.error}`)

  let created = 0, skipped = 0, failed = 0
  for (let i = 0; i < PARTS.length; i++) {
    const [file, role] = PARTS[i]
    const seg = [...behaviorSeg, partKeys[i]]
    process.stdout.write(`[part] ${partKeys[i]} ... `)
    const res = await sendRetry({ op: 'update', segments: seg, layer: { name: partKeys[i] } })
    if (!res.ok) { failed++; console.log(`FAIL: ${res.error}`); continue }
    if (await noted(seg)) { skipped++; console.log('ok (already noted — skip note+mark)'); continue }

    const text = `${file.split('/').pop()} — ${role}\n\npart of /${BEHAVIOR}\nsource: ${file}`
    const okNote = await note(seg, text)
    const okMark = await mark(seg, PART_KEYWORD)
    if (okNote && okMark) { created++; console.log('ok') } else { failed++; console.log(`FAIL (note:${okNote} mark:${okMark})`) }
  }

  console.log(`[versions] DONE — ${created} parts written, ${skipped} already present, ${failed} failed`)
  if (failed > 0) process.exitCode = 1
}

main().catch(err => { console.error(err); process.exit(1) })
