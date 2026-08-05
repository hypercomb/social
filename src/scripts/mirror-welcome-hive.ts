// Mirror the WELCOME-HIVE creation — the silhouetted behaviors deck behind
// the opening page — into `behaviors/appearance`.
//
// It lands beside /accent, /border, /canvas, /substrate and the theme
// toolchain: this is how something LOOKS. It adds no slash command, so the
// collection carries `appearance` only and never joins the `behavior` census.
//
// ── Membership is read the SAFE way ──────────────────────────────────
//
// `inflate` is the only op that hands back child NAMES, and it UNDER-REPORTS
// on locations whose child layers are cold — `behaviors/appearance` inflates
// as EMPTY while really holding ten children. An earlier mirror merged
// `[...inflate names, new]` into a parent's `children` and that is exactly how
// `behaviors/structure/upgrade` got orphaned: the collection kept resolving by
// path while vanishing from the deck.
//
// So membership here is resolved the way walk.cjs does it — `layer-at` for the
// authoritative child SIGS, then `get-resource` per sig to learn each name —
// and the write is REFUSED unless every sig resolved. A name we could not read
// is a name we must not drop.
//
// MERGE MODE + IDEMPOTENT. Safe to re-run. Needs a renderer (`?claudeBridge=1`).

import { createHash } from 'node:crypto'
import WebSocket from 'ws'

const BRIDGE_PORT = 2401
const TIMEOUT = 180_000

let counter = 0
type BridgeRes = { id: string; ok: boolean; data?: any; error?: string }

function sendOnce(request: Record<string, unknown>): Promise<BridgeRes> {
  return new Promise((resolve, reject) => {
    const msg = { ...request, id: `mirror-welcome-${Date.now()}-${++counter}` }
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

function norm(s: string): string {
  return s.trim().toLocaleLowerCase()
    .replace(/[._\s/]+/g, '-')
    .replace(/[^\p{L}\p{N}\-]/gu, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64)
    .replace(/-$/, '')
}

const tagSig = (name: string): string =>
  createHash('sha256').update(JSON.stringify({ kind: 'tag', appliesTo: [], payload: { name } })).digest('hex')

async function mark(segments: string[], name: string): Promise<boolean> {
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

async function notes(segments: string[]): Promise<string[]> {
  const res = await send({ op: 'note-list', segments })
  return res.ok && Array.isArray(res.data) ? res.data.map((x: any) => String(x?.text ?? '')) : []
}

async function note(segments: string[], text: string): Promise<boolean> {
  const res = await sendRetry(
    { op: 'note-add', segments: segments.slice(0, -1), cell: segments[segments.length - 1], text },
    async () => (await notes(segments)).includes(text),
  )
  return res.ok
}

/** Authoritative child names: fresh sigs from `layer-at`, each resolved to a
 *  name through its own layer bytes. Throws rather than return a short list —
 *  a partial read must never become a `children` write. */
async function safeChildNames(segments: string[]): Promise<string[]> {
  const at = await sendRetry({ op: 'layer-at', segments })
  if (!at.ok) throw new Error(`layer-at ${segments.join('/')} failed: ${at.error}`)
  const sigs: string[] = Array.isArray(at.data?.children) ? at.data.children.map(String) : []
  const names: string[] = []
  for (const sig of sigs) {
    if (!/^[a-f0-9]{64}$/.test(sig)) { names.push(sig); continue }   // already a name
    // `get-resource` answers `{ text }` — the layer's bytes, not the layer.
    const r = await sendRetry({ op: 'get-resource', sig })
    let name = ''
    try { name = String(JSON.parse(String(r.data?.text ?? '')).name ?? '') } catch { name = '' }
    if (!name) throw new Error(`child ${sig.slice(0, 8)} of ${segments.join('/')} would not resolve — refusing to rewrite children`)
    names.push(name)
  }
  return names
}

async function ensureMember(parent: string[], child: string): Promise<void> {
  const existing = await safeChildNames(parent)
  if (existing.includes(child)) { console.log(`[link] ${parent.join('/')} already holds "${child}" (${existing.length} children)`); return }
  const merged = [...existing, child]
  process.stdout.write(`[link] ${parent.join('/')} ${existing.length} → ${merged.length} (+${child}) ... `)
  const res = await sendRetry(
    { op: 'update', segments: parent, layer: { name: parent[parent.length - 1], children: merged } },
    async () => (await safeChildNames(parent)).includes(child),
  )
  console.log(res.ok ? 'ok' : `FAIL: ${res.error}`)
  if (!res.ok) process.exit(1)
}

// ── the creation ────────────────────────────────────────────────────

const ROOT = norm('behaviors')
const APPEARANCE = norm('appearance')
const COLLECTION = norm('welcome-hive')
const SEGMENTS = [ROOT, APPEARANCE, COLLECTION]
const PART_KEYWORD = 'part'

const SHARED = 'hypercomb-shared'

const COLLECTION_NOTES = [
  'The hive behind the opening page. A fresh install boots onto an EMPTY hive, so the first-boot welcome used to float over a void — the backdrop\'s wash was shading nothing out. Behind the card now sits the behaviors deck as a silhouette: the nine collections in the point-top honeycomb the first screen actually arranges them in, each drawn with a card\'s anatomy — the halo that makes neighbours touch, the body, and the inner ring that says "tile" rather than "hexagon" — in its own pheromone hue.',
  'Shapes only. No glyphs, no labels, nothing that moves: the platform draws tile labels and generated tile art carries no text. It is painted UNDER the existing backdrop rather than dimmed on its own, so the wash and blur already tuned there are what shade it out — one set of numbers, not two. The card above is 94% opaque over an 18px blur, so it hides the middle row and the deck resolves in the margins.',
  'The palette is CARRIED here, not read from TagRegistry. The registry holds the participant\'s own tag colours and is empty at the one moment this art is shown — first boot. It mirrors the card generator\'s CATEGORIES (scripts/behaviors-theme/gen-behavior-tiles.mjs); if the deck\'s collections or their colours change, both copies move.',
]

type Part = [file: string, role: string]

const PARTS: Part[] = [
  [`${SHARED}/ui/example-hives/behaviors-deck-silhouette.ts`,
   'the geometry — nine collections laid out on the platform\'s point-top pitch (column √3·s, row 1.5·s, odd rows half a column across), each returned as three polygons: halo, body, ring. Carries the deck palette and the padded viewBox that lets `slice` crop empty space before it crops a tile'],
  [`${SHARED}/ui/example-hives/example-hives-offer.component.scss`,
   'the shading — where the silhouette sits in the stack (under the wash, over the void) and how far it is taken back: fill and stroke opacities per layer, and a radial mask so the honeycomb fades out at the frame instead of ending on a cut edge'],
]

/** Append a note only if this exact text is not already on the cell — for
 *  parts that GAINED behaviour without gaining a file. */
async function noteOnce(segments: string[], text: string): Promise<'written' | 'present' | 'failed'> {
  if ((await notes(segments)).includes(text)) return 'present'
  return await note(segments, text) ? 'written' : 'failed'
}

/** Notes for changes that landed on parts already mirrored. */
const AMENDMENTS: [cell: string, text: string][] = [
  [norm('behaviors-deck-silhouette'),
   'REVISED — the comb is lit PER TRIAD. Three mutually-touching hexes meet at exactly one shared vertex, and that trio is the honeycomb\'s real unit, so a light is placed at every such vertex (found by geometry: the centroid of three mutually-adjacent centres IS the vertex they share — eight of them across this deck). Every tile belongs to several triads, so it brightens on the sides facing them and sinks along the runs between; that is where each direction gets its own falloff. Depth from where the tiles ARE, not from one global gradient pretending the comb is flat.'],
  [norm('example-hives-offer-component'),
   'REVISED — the triad lights are painted through a mask cut to the tile BODIES, so light lands on tiles and never on the ground between them: the void stays void. Their strength lives here beside the other silhouette values (`.light-core` / `.light-mid` / `.light-edge`). Faint on purpose — a first pass at full radius turned the deck into a milky slab and washed the pheromone hues out from under it, so the sources die about a tile and a half out.'],
]

async function main(): Promise<void> {
  await ensureMember([ROOT, APPEARANCE], COLLECTION)

  process.stdout.write(`[cell] ${SEGMENTS.join('/')} ... `)
  const mk = await sendRetry({ op: 'update', segments: SEGMENTS, layer: { name: COLLECTION } })
  console.log(mk.ok ? 'ok' : `FAIL: ${mk.error}`)
  if (!mk.ok) process.exit(1)

  if ((await notes(SEGMENTS)).length === 0) {
    for (const text of COLLECTION_NOTES) {
      process.stdout.write(`[note] ${SEGMENTS.join('/')} ... `)
      console.log(await note(SEGMENTS, text) ? 'ok' : 'FAIL')
    }
    process.stdout.write(`[mark] ${SEGMENTS.join('/')} ← ${APPEARANCE} ... `)
    console.log(await mark(SEGMENTS, APPEARANCE) ? 'ok' : 'FAIL')
  } else {
    console.log(`[cell] ${SEGMENTS.join('/')} already noted — skipping notes + mark`)
  }

  const partKeys = PARTS.map(([file]) => norm(file.split('/').pop()!.replace(/\.(cjs|mjs|ts|md|html|scss)$/, '')))
  const existingParts = await safeChildNames(SEGMENTS)
  const mergedParts = [...existingParts, ...partKeys.filter(k => !existingParts.includes(k))]
  process.stdout.write(`[cell] ${SEGMENTS.join('/')} ← ${mergedParts.length} parts ... `)
  const kids = await sendRetry({ op: 'update', segments: SEGMENTS, layer: { name: COLLECTION, children: mergedParts } })
  console.log(kids.ok ? 'ok' : `FAIL: ${kids.error}`)

  let created = 0, skipped = 0, failed = 0
  for (let i = 0; i < PARTS.length; i++) {
    const [file, role] = PARTS[i]
    const pseg = [...SEGMENTS, partKeys[i]]
    process.stdout.write(`[part] ${partKeys[i]} ... `)
    const res = await sendRetry({ op: 'update', segments: pseg, layer: { name: partKeys[i] } })
    if (!res.ok) { failed++; console.log(`FAIL: ${res.error}`); continue }
    if ((await notes(pseg)).length > 0) { skipped++; console.log('ok (already noted — skip note+mark)'); continue }
    const text = `${file.split('/').pop()} — ${role}\n\npart of ${COLLECTION}\nsource: ${file}`
    const okNote = await note(pseg, text)
    const okMark = await mark(pseg, PART_KEYWORD)
    if (okNote && okMark) { created++; console.log('ok') } else { failed++; console.log(`FAIL (note:${okNote} mark:${okMark})`) }
  }

  for (const [cell, text] of AMENDMENTS) {
    const seg = [...SEGMENTS, cell]
    process.stdout.write(`[amend] ${seg.join('/')} ... `)
    console.log(await noteOnce(seg, text))
  }

  console.log(`\n[mirror] DONE — ${created} parts written, ${skipped} already present, ${failed} failed`)
  console.log('[mirror] NEXT: node scripts/behaviors-theme/sweep.cjs — mint the cards for the new cells')
  if (failed > 0) process.exitCode = 1
}

main().catch(err => { console.error(err); process.exit(1) })
