// Mirror pass for BEHAVIOR REACH — the Beehaviors panel learning to say how
// far out it is looking, and an adopted tile opening on what it actually
// carries rather than on your whole hive cascaded over it.
//
// Follows the established mirror shape exactly (mirror-behaviors.ts built the
// `behaviors` root and its collections; mirror-branch-scope.ts is the closest
// sibling). This creation shapes how the tree is READ and managed, so it lands
// as a behaviour under the EXISTING `structure` collection:
//
//   behaviors/structure/behavior-reach            ← the creation (keywords: behavior, structure)
//   behaviors/structure/behavior-reach/<part>     ← one tile per implementation file (part)
//
// Nothing new is minted: `behavior`, `structure` and `part` are the declared
// vocabulary from the earlier passes, and `structure` is an existing collection.
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
const COLLECTION = norm('structure')
const BEHAVIOR = norm('behavior-reach')

const BEHAVIOR_KEYWORD = 'behavior'
const STRUCTURE_KEYWORD = 'structure'
const PART_KEYWORD = 'part'

const BEHAVIOR_NOTES = [
  'How far the Beehaviors panel looks. Three rungs, narrowest first: THIS TILE (what the tile itself carries), ITS CONTEXT (that, plus what an ancestor of it declares — a website scope, a container capability), YOUR HIVE (everything, including the behaviours you turned on at the hive root, which reach every tile you hold). A superset ladder, not three filters: each rung contains the one before it.',
  'A LOOK, never a switch. Narrowing the reach hides rows from the list and turns nothing off — no record is written, no behaviour is disabled. This is the whole reason it can be the default on some tiles and not others without ever changing what a tile is.',
  'An ADOPTED tile opens on "this tile". You adopted a branch to get what the branch does; opening it with your own hive-wide behaviours cascaded over the top makes it impossible to see what actually came. So the panel asks whether this location is an adopted root (or beneath one) and, if it is, opens at direct reach — the branch exactly as it arrived — with an "adopted" mark saying why.',
  'The reach belongs to the SUBJECT, not to the panel. Clicking a different tile re-chooses it; re-clicking the same tile (or the panel following you back to it) keeps wherever you moved to. A reach that persisted across tiles would silently hide a global behaviour on a tile where you had no reason to expect it.',
  'A narrowed list never reads as the whole truth. Whatever the reach holds back is counted on a line you can press — "+N reaching in from wider than here" — which widens one rung. Absence is always accounted for; the panel never quietly shows you less than there is.',
  'None of this is new data. ShowFeaturesDrone already tagged every applied row with where it came from: `direct` on the tile, `cascade` from an ancestor named by `originCell`, and cascade with NO originCell meaning the hive root. The ladder was already in the payload — this only decides how much of it to show.',
]

type Part = [file: string, role: string]

const PARTS: Part[] = [
  ['hypercomb-shared/ui/features-viewer/features-viewer.component.ts',
   'the ladder — the `Reach` type, the rung each row sits on (direct / context / hive, read off origin + originCell), the reach signal chosen per subject tile, and the out-of-reach count that keeps a narrowed list honest'],
  ['hypercomb-shared/ui/features-viewer/features-viewer.component.html',
   'the selector — a quiet three-way control under the subject block, the "adopted" provenance mark, and the pressable line for what the reach is holding back'],
  ['hypercomb-shared/ui/features-viewer/features-viewer.component.scss',
   'the look — a segmented control that reads as a lens rather than a mode, hidden on the phone review screen where the panel is a decision and nothing else'],
  ['hypercomb-essentials/src/diamondcoreprocessor.com/presentation/tiles/show-features.drone.ts',
   'the answer to "is this adopted" — stamps `adopted` on the features:open payload from isWithinAdoptedRoot, because the shell may not import essentials and must be told'],
  ['hypercomb-essentials/src/diamondcoreprocessor.com/sharing/adopted-roots.ts',
   'the record that made it possible — the participant-local registry of adopted branch roots, prefix-matched so the top of an adopted branch and every page beneath it both answer yes'],
]

const behaviorSeg = [ROOT_KEY, COLLECTION, BEHAVIOR]

const decorationSig = (kind: string, payload: Record<string, unknown>): string =>
  createHash('sha256').update(JSON.stringify({ kind, appliesTo: [], payload })).digest('hex')

const tagSig = (name: string): string => decorationSig('tag', { name })

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
    console.error(`[behavior-reach] ABORT: cannot read "${ROOT_KEY}/${COLLECTION}" (${inf.error}). Open the hive with ?claudeBridge=1 and ensure the behaviors mirror is built.`)
    process.exit(1)
  }

  const siblings = ((inf.data?.children ?? []) as any[]).map(c => String(c?.name ?? '')).filter(Boolean)
  console.log(`[behavior-reach] "${COLLECTION}" holds: ${siblings.join(', ') || '(none)'}`)

  // The behaviour tile, gathered into the existing collection.
  const merged = siblings.includes(BEHAVIOR) ? siblings : [...siblings, BEHAVIOR]
  process.stdout.write(`[behavior-reach] ${ROOT_KEY}/${COLLECTION} ← ${merged.length} children ... `)
  const up = await sendRetry({ op: 'update', segments: [ROOT_KEY, COLLECTION], layer: { name: COLLECTION, children: merged } })
  console.log(up.ok ? 'ok' : `FAIL: ${up.error}`)
  if (!up.ok) process.exit(1)

  process.stdout.write(`[behavior-reach] ${behaviorSeg.join('/')} ... `)
  const mk = await sendRetry({ op: 'update', segments: behaviorSeg, layer: { name: BEHAVIOR } })
  console.log(mk.ok ? 'ok' : `FAIL: ${mk.error}`)
  if (!mk.ok) process.exit(1)

  const behaviorFresh = !(await noted(behaviorSeg))
  if (behaviorFresh) {
    for (const text of BEHAVIOR_NOTES) {
      process.stdout.write(`[note] ${behaviorSeg.join('/')} ... `)
      console.log(await note(behaviorSeg, text) ? 'ok' : 'FAIL')
    }
    for (const keyword of [BEHAVIOR_KEYWORD, STRUCTURE_KEYWORD]) {
      process.stdout.write(`[mark] ${behaviorSeg.join('/')} ← ${keyword} ... `)
      console.log(await mark(behaviorSeg, keyword) ? 'ok' : 'FAIL')
    }
  } else {
    console.log(`[behavior-reach] ${behaviorSeg.join('/')} already noted — skipping notes + marks`)
  }

  // The parts.
  const partKeys = PARTS.map(([file]) => norm(file.split('/').pop()!.replace(/\.(ts|html|scss)$/, '')))
  process.stdout.write(`[behavior-reach] ${behaviorSeg.join('/')} ← ${partKeys.length} parts ... `)
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

  console.log(`[behavior-reach] DONE — ${created} parts written, ${skipped} already present, ${failed} failed`)
  if (failed > 0) process.exitCode = 1
}

main().catch(err => { console.error(err); process.exit(1) })
