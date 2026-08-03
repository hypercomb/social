// Mirror pass for the BEHAVIORS-THEME TOOLCHAIN — the sweep that keeps the
// behaviors mirror's generated artwork in sync with the mirror itself.
//
// The toolchain shipped with the theme (70c132ac) but was never mirrored: it
// existed only as scripts + a note on the behaviors root. Wiring its push
// stage to `build-record` (so a theme sweep is ONE restorable step) is the
// change that surfaced the gap — a creation whose parts live only in script
// files is unfinished (documentation/mirror-paradigm.md rule 1).
//
// It lands under the EXISTING `appearance` collection — the shelf for how
// things LOOK, alongside /accent, /border, /canvas, /substrate:
//
//   behaviors/appearance/behaviors-theme          ← the toolchain (keyword: appearance)
//   behaviors/appearance/behaviors-theme/<part>   ← one tile per file (keyword: part)
//
// Nothing new is minted: `appearance` and `part` are declared vocabulary from
// the earlier passes, and `appearance` is an existing collection. The
// toolchain tile deliberately does NOT carry `behavior` — it is a build
// toolchain, not a slash command, and the behaviors census must stay honest.
//
// MERGE MODE + IDEMPOTENT. A cell that already carries a note was written by a
// previous run and is skipped, so re-running never duplicates notes or marks.
//
// Requires a renderer on the bridge: open the hive with `?claudeBridge=1`.
// After this pass, run `node scripts/behaviors-theme/sweep.cjs` to mint the
// cards for the six new cells (the theme applies to itself).

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
const COLLECTION = norm('appearance')
const TOOLCHAIN = norm('behaviors-theme')

const APPEARANCE_KEYWORD = 'appearance'
const PART_KEYWORD = 'part'

const TOOLCHAIN_NOTES = [
  'The behaviors-theme toolchain — the sweep that keeps this hive\'s own artwork in sync with itself. Every cell of the behaviors mirror wears a generated card: dark slate ground, faint hex lattice, one Material glyph in a hexagon ring, colored by the cell\'s collection pheromone. Tier is legible at a glance — root = double ring, collection = heavy ring and saturated glyph, behavior = lighter ring and per-behavior glyph, part = dim mono card. NO TEXT in the art: the platform labels tiles, the card carries the meaning.',
  'Sync is part of the mirror pass, not a chore afterwards. When a behavior ships, the same change that adds its tile + pheromones + note gives it a glyph in the generator and runs `sweep.cjs` — walk the live tree, render every card, push only the cells not already wearing their exact card. Idempotent by content: comparison is by image signature, so a re-run over an already-themed hive is a cheap no-op that writes nothing.',
  'The push pass ends with ONE `build-record` over /behaviors (documentation/build-revisions.md). Every card is a resource plus a `properties` anchor on its own cell — hundreds of anchors, one intent — so the sweep seals as a single restorable step instead of hundreds of loose commits. A pass that changed nothing mints no revision; a partial pass records what actually landed. See /builds under the structure collection.',
]

type Part = [file: string, role: string]

const T = 'scripts/behaviors-theme'

const PARTS: Part[] = [
  [`${T}/sweep.cjs`,
   'the one command — walk → gen → push in order, each stage a child process so a failure stops the sweep where it broke; the entry point a mirror pass calls after adding a behavior\'s tile'],
  [`${T}/walk.cjs`,
   'the census — a fresh path-addressed walk of the live behaviors tree over the bridge (`layer-at` per location, child names resolved from layer bytes: `inflate` cannot be trusted for a freshly-written subtree) → census.json'],
  [`${T}/gen-behavior-tiles.mjs`,
   'the generator — playwright renders one 512×512 card per censused cell from inline SVG, deriving tier from path depth and color from the collection pheromone (the palette mirrors TagRegistry). The Material font is loaded from the repo as a data-URI: Google Fonts is unreachable from the sandbox, and the silent serif fallback spells ligature names out as words'],
  [`${T}/push-tiles.cjs`,
   'the paint pipeline — per cell: put-resource(png) → read props → merge {small:{image}, substrate:false} keeping index/flat → put-resource → bag-set `properties` → stamp (the index-syncer: a content-identical merge dedups the commit but still syncs hc:tile-props-index and repaints). Checkpointed, idempotent by image sig, and ends the whole pass with one build-record over /behaviors'],
  [`${T}/README.md`,
   'the doctrine of the sync — the two ways to stay in sync (per-behavior in the shipping pass, or catch-up sweep), the palette, and the renderer prereqs: broker up, exactly ONE renderer tab in the real profile (the extension tab sees a different OPFS bucket and must never carry the bridge flag)'],
]

const toolchainSeg = [ROOT_KEY, COLLECTION, TOOLCHAIN]

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
    console.error(`[theme] ABORT: cannot read "${ROOT_KEY}/${COLLECTION}" (${inf.error}). Open the hive with ?claudeBridge=1 and ensure the behaviors mirror is built.`)
    process.exit(1)
  }

  const siblings = ((inf.data?.children ?? []) as any[]).map(c => String(c?.name ?? '')).filter(Boolean)
  console.log(`[theme] "${COLLECTION}" holds: ${siblings.join(', ') || '(none)'}`)

  // The toolchain tile, gathered into the existing collection.
  const merged = siblings.includes(TOOLCHAIN) ? siblings : [...siblings, TOOLCHAIN]
  process.stdout.write(`[theme] ${ROOT_KEY}/${COLLECTION} ← ${merged.length} children ... `)
  const up = await sendRetry({ op: 'update', segments: [ROOT_KEY, COLLECTION], layer: { name: COLLECTION, children: merged } })
  console.log(up.ok ? 'ok' : `FAIL: ${up.error}`)
  if (!up.ok) process.exit(1)

  process.stdout.write(`[theme] ${toolchainSeg.join('/')} ... `)
  const mk = await sendRetry({ op: 'update', segments: toolchainSeg, layer: { name: TOOLCHAIN } })
  console.log(mk.ok ? 'ok' : `FAIL: ${mk.error}`)
  if (!mk.ok) process.exit(1)

  if (!(await noted(toolchainSeg))) {
    for (const text of TOOLCHAIN_NOTES) {
      process.stdout.write(`[note] ${toolchainSeg.join('/')} ... `)
      console.log(await note(toolchainSeg, text) ? 'ok' : 'FAIL')
    }
    // `appearance` only — this is a build toolchain, not a slash behavior, so
    // it must not join the `behavior` keyword's census.
    process.stdout.write(`[mark] ${toolchainSeg.join('/')} ← ${APPEARANCE_KEYWORD} ... `)
    console.log(await mark(toolchainSeg, APPEARANCE_KEYWORD) ? 'ok' : 'FAIL')
  } else {
    console.log(`[theme] ${toolchainSeg.join('/')} already noted — skipping notes + marks`)
  }

  // The parts — one cell per file (mirror-paradigm.md rule 6).
  const partKeys = PARTS.map(([file]) => norm(file.split('/').pop()!.replace(/\.(cjs|mjs|ts|md)$/, '')))
  process.stdout.write(`[theme] ${toolchainSeg.join('/')} ← ${partKeys.length} parts ... `)
  const kids = await sendRetry({ op: 'update', segments: toolchainSeg, layer: { name: TOOLCHAIN, children: partKeys } })
  console.log(kids.ok ? 'ok' : `FAIL: ${kids.error}`)

  let created = 0, skipped = 0, failed = 0
  for (let i = 0; i < PARTS.length; i++) {
    const [file, role] = PARTS[i]
    const seg = [...toolchainSeg, partKeys[i]]
    process.stdout.write(`[part] ${partKeys[i]} ... `)
    const res = await sendRetry({ op: 'update', segments: seg, layer: { name: partKeys[i] } })
    if (!res.ok) { failed++; console.log(`FAIL: ${res.error}`); continue }
    if (await noted(seg)) { skipped++; console.log('ok (already noted — skip note+mark)'); continue }

    const text = `${file.split('/').pop()} — ${role}\n\npart of ${TOOLCHAIN}\nsource: ${file}`
    const okNote = await note(seg, text)
    const okMark = await mark(seg, PART_KEYWORD)
    if (okNote && okMark) { created++; console.log('ok') } else { failed++; console.log(`FAIL (note:${okNote} mark:${okMark})`) }
  }

  console.log(`[theme] DONE — ${created} parts written, ${skipped} already present, ${failed} failed`)
  console.log('[theme] NEXT: node scripts/behaviors-theme/sweep.cjs — mint the cards for the new cells')
  if (failed > 0) process.exitCode = 1
}

main().catch(err => { console.error(err); process.exit(1) })
