// Mirror pass for the BUILD REVISIONS creation — every multi-file build pass
// becomes ONE restorable step: a scoped snapshot in the build root's `builds`
// slot, minted by producers (bridge `build-record`) or by hand (`/builds`).
//
// Follows the established mirror shape exactly (mirror-behaviors.ts built the
// `behaviors` root; mirror-site-versions.ts added a behaviour to an existing
// collection). This creation writes layers and revisions the tree, so it lands
// as a behaviour under the EXISTING `structure` collection — the same shelf as
// `snapshot` and `restore`, whose whole-hive gesture it generalizes:
//
//   behaviors/structure/builds            ← the creation (keywords: behavior, structure)
//   behaviors/structure/builds/<part>     ← one tile per implementation file (part)
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
const BEHAVIOR = norm('builds')

const BEHAVIOR_KEYWORD = 'behavior'
const STRUCTURE_KEYWORD = 'structure'
const PART_KEYWORD = 'part'

const BEHAVIOR_NOTES = [
  'Build revisions — a build pass that writes MANY files (a site regen, a game stamp, a deck sweep) ends as ONE restorable step. The revision code is not a code at all: it is the signature of a scoped snapshot, `{ seal, label, at }`, where the seal is the subtree\'s merkle root taken right after the pass. The seal transitively names every page (slots live inside the layer signatures it folds) and every shared asset (pages reference chrome, styles and art sig-only), so one 64-hex value pins the whole consistent closure.',
  'The record\'s sig is appended to the `builds` slot on the build root\'s layer — the same shape as `website` and `snapshots`: a flat sig array whose chain down the lineage IS the build history, read rather than recorded. An identical rebuild produces the identical seal and declines to mint, so "did anything change" is one compare. Restore is forward-only through the same walk /restore uses — nothing rewinds, nothing is deleted, and the builds index is carried forward so going back never erases the way forward. Producers end every pass with the bridge op `build-record`; participants use /builds to list, record by hand, and restore. Doctrine: documentation/build-revisions.md.',
]

type Part = [file: string, role: string]

const E = 'hypercomb-essentials/src/diamondcoreprocessor.com'

const PARTS: Part[] = [
  [`${E}/history/builds-slot.ts`,
   'the slot and the record — `builds` on the build root\'s layer, `BuildRecord { seal, label, at }`, and `mintBuildRecord`: seal the subtree, no-op when the head record already names that seal, else write the record and append its sig — one commit, one marker'],
  [`${E}/history/seal-restore.ts`,
   'the one restore walk — bring every location under a root to the sealed tree by appending head markers, shared by /restore and /builds restore so the two gestures cannot drift; carries the index slots forward so history never eats the map'],
  [`${E}/commands/builds.queen.ts`,
   'the participant\'s gesture — /builds lists this subtree\'s revisions, /builds record seals by hand, /builds restore brings one back after auto-recording the current state first (free when nothing changed)'],
  [`${E}/assistant/claude-bridge.worker.ts`,
   'the producer\'s gesture — the `build-record` bridge op: the LAST call of every multi-file build pass, behind which mintBuildRecord seals, compares, and appends'],
  ['documentation/build-revisions.md',
   'the doctrine — R1 standalone sig resources, R2a sig-only content refs, R2b name links made safe by whole-build restore, R3 one build record per pass; the audit table and the rejected revision-code shape'],
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
    console.error(`[builds] ABORT: cannot read "${ROOT_KEY}/${COLLECTION}" (${inf.error}). Open the hive with ?claudeBridge=1 and ensure the behaviors mirror is built.`)
    process.exit(1)
  }

  const siblings = ((inf.data?.children ?? []) as any[]).map(c => String(c?.name ?? '')).filter(Boolean)
  console.log(`[builds] "${COLLECTION}" holds: ${siblings.join(', ') || '(none)'}`)

  // The behaviour tile, gathered into the existing collection.
  const merged = siblings.includes(BEHAVIOR) ? siblings : [...siblings, BEHAVIOR]
  process.stdout.write(`[builds] ${ROOT_KEY}/${COLLECTION} ← ${merged.length} children ... `)
  const up = await sendRetry({ op: 'update', segments: [ROOT_KEY, COLLECTION], layer: { name: COLLECTION, children: merged } })
  console.log(up.ok ? 'ok' : `FAIL: ${up.error}`)
  if (!up.ok) process.exit(1)

  process.stdout.write(`[builds] ${behaviorSeg.join('/')} ... `)
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
    console.log(`[builds] ${behaviorSeg.join('/')} already noted — skipping notes + marks`)
  }

  // The parts.
  const partKeys = PARTS.map(([file]) => norm(file.split('/').pop()!.replace(/\.(ts|md)$/, '')))
  process.stdout.write(`[builds] ${behaviorSeg.join('/')} ← ${partKeys.length} parts ... `)
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

  console.log(`[builds] DONE — ${created} parts written, ${skipped} already present, ${failed} failed`)
  if (failed > 0) process.exitCode = 1
}

main().catch(err => { console.error(err); process.exit(1) })
