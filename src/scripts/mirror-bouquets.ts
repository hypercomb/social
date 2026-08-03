// Mirror pass for BOUQUETS — a named group of pheromones (the painter's brush
// with an identity). The mirror paradigm says the hive is built as the code is
// built, so this runs in the same pass as the feature: the parts get tiles, the
// tiles get the declared `part` mark, and the behaviour tile gets the note that
// explains what a bouquet is.
//
//   behaviors/views/tags            ← the Pheromones window behaviour (exists)
//     bouquet-registry              ← truth: named sets, sig-addressed
//     tags-viewer.component         ← surface: the list, the naming field
//
// Merge + idempotent, like mirror-behavior-parts: children are merged into the
// parent rather than replacing them, and every non-idempotent op verifies
// whether it actually landed before retrying — a lost bridge response must
// never become a duplicate write.
//
// It goes one step further and RECONCILES its own notes. A note this pass wrote
// is recognised by its leading tag; if the wanted text has since changed, the
// old one is deleted and the new one written. Write-once was wrong here: the
// understanding of what a bouquet IS changed after the first run (a bouquet is
// not optional — see below), and a mirror that cannot restate itself drifts
// away from the code it is supposed to be the specification of.

import { createHash } from 'node:crypto'
import WebSocket from 'ws'

const BRIDGE_PORT = 2401
const TIMEOUT = 180_000
const ROOT_KEY = 'behaviors'
const BEHAVIOR_SEGMENTS = [ROOT_KEY, 'views', 'tags']
const PART_KEYWORD = 'part'
const PART_COLOR = '#8fb8a8'
const SHARED = 'hypercomb-shared'

/** One tile per source resource. Role is what the note leads with. */
const PARTS: { key: string; file: string; role: string }[] = [
  {
    key: 'bouquet-registry',
    file: `${SHARED}/core/bouquet-registry.ts`,
    role: 'the truth — signatureOf() DERIVES the identity of a gathered set without writing anything (the marks are SORTED first, so the signature is a property of the set: the same bouquet gathered twice is the same signature); mint()/save() commit those same bytes as a resource and attach a name, with the master pointer in the sign(\'registry\') pool. A bouquet exists before it is named; naming is what stores it. One #bytes() definition feeds both, or a named bouquet would resolve to nothing.',
  },
  {
    key: 'tags-viewer.component',
    file: `${SHARED}/ui/tags-viewer/tags-viewer.component.ts`,
    role: 'the surface — scenting: gather pheromones, then walk the tiles to leave the bouquet on them. What is in hand is always a bouquet (its signature shows from the first mark, named or not); saved ones list under the pheromones and clicking one takes it in hand. With tiles selected it lands on all of them in one transaction instead.',
  },
]

/** The note the behaviour tile carries about the new capability. */
const BEHAVIOR_NOTE =
  'BOUQUETS — a group of pheromones. Not an optional one.\n\n' +
  'A bee never emits one compound, it emits a blend; the word for that blend is a bouquet. ' +
  'So what you hold is ALWAYS a bouquet — one mark or six — and it has a signature from the ' +
  'first mark, before anyone names it. That signature is DERIVED, not stored: naming is the ' +
  'separate, later act that commits it and makes it easy to pick up again. Gathering costs ' +
  'nothing.\n\n' +
  'A bouquet is the set you PUT ON things together, and it is deliberately not the other thing ' +
  '"a group of pheromones" could mean — a set you are WATCHING for is a filter over marks, ' +
  'derived at read time, and keeps its own word (interest).\n\n' +
  'Gather a bouquet, then walk the tiles to SCENT them: each one you touch gets the whole blend. ' +
  'The act is scenting, the record it leaves is a deposit.\n\n' +
  'Its second role (pinned 2026-08-02): the LENS. The pheromone window groups the vocabulary by ' +
  'bouquet instead of listing every mark flat, and filtering by theme is selecting bouquets — the ' +
  'union of their members becomes the active filter. A bouquet is a TILE whose members happen to ' +
  'be pheromones, so making one is making a tile and attaching a mark to it is the same operation ' +
  'as marking anything. Bouquet = view, mark = fact: a pheromone may live in several bouquets, ' +
  'bouquets overlap, marks never move. A mark in no bouquet is unsorted — visible and nagging to ' +
  'be organized, same rule as tiles. Doctrine: documentation/piece-protocol.md'

let counter = 0
type BridgeRes = { id: string; ok: boolean; data?: any; error?: string }

function sendOnce(request: Record<string, unknown>): Promise<BridgeRes> {
  return new Promise((resolve, reject) => {
    const msg = { ...request, id: `bouquet-${Date.now()}-${++counter}` }
    // IPv4 loopback pinned: a second listener on 2401 (0.0.0.0) swallows
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

/** Retry through a stalled op queue. A timeout does NOT mean the op failed —
 *  its response may simply be lost — so anything non-idempotent proves whether
 *  it landed before going again. */
async function sendRetry(
  request: Record<string, unknown>,
  landed?: () => Promise<boolean>,
): Promise<BridgeRes> {
  for (let attempt = 1; ; attempt++) {
    try { return await send(request) }
    catch (e) {
      if (attempt >= 3) throw e
      if (landed && await landed().catch(() => false)) return { id: '', ok: true }
      await new Promise(r => setTimeout(r, 5000))
    }
  }
}

/** Decorations on a layer are SIGNATURE references — landed means the
 *  canonical decoration content's sig is in the list. */
function decorationSig(payload: Record<string, unknown>): string {
  return createHash('sha256')
    .update(JSON.stringify({ kind: 'tag', appliesTo: [], payload }))
    .digest('hex')
}

type Note = { id?: string; text?: string }

/** Write `text` as the note at `segments`, replacing any earlier note this
 *  pass wrote (recognised by `tag`). Returns what it did. */
async function reconcileNote(segments: string[], tag: string, text: string): Promise<string> {
  const parent = segments.slice(0, -1)
  const cell = segments[segments.length - 1]
  const list = await sendRetry({ op: 'note-list', segments })
  const notes: Note[] = Array.isArray(list.data) ? list.data : []
  if (notes.some(n => n?.text === text)) return 'already current'

  const stale = notes.filter(n => typeof n?.text === 'string' && n.text.startsWith(tag) && n.id)
  for (const s of stale) {
    await sendRetry(
      { op: 'note-delete', segments: parent, cell, sig: s.id },
      async () => {
        const check = await send({ op: 'note-list', segments })
        return check.ok && Array.isArray(check.data) && !check.data.some((x: Note) => x?.id === s.id)
      },
    )
  }

  const res = await sendRetry(
    { op: 'note-add', segments: parent, cell, text },
    async () => {
      const check = await send({ op: 'note-list', segments })
      return check.ok && Array.isArray(check.data) && check.data.some((x: Note) => x?.text === text)
    },
  )
  if (!res.ok) return `FAIL: ${res.error}`
  return stale.length ? `restated (${stale.length} replaced)` : 'written'
}

async function main(): Promise<void> {
  const behaviorPath = BEHAVIOR_SEGMENTS.join('/')
  const at = await send({ op: 'layer-at', segments: BEHAVIOR_SEGMENTS })
  if (!at.ok) { console.error(`[bouquets] no behaviour tile at /${behaviorPath} — run mirror-behaviors first`); process.exit(1) }

  // Parent: merge the part names in, never replace what is already there.
  const inflated = await send({ op: 'inflate', segments: BEHAVIOR_SEGMENTS })
  const have: string[] = (inflated.data?.children ?? []).map((c: any) => c.name).filter(Boolean)
  const merged = [...have, ...PARTS.map(p => p.key).filter(k => !have.includes(k))]
  process.stdout.write(`[bouquets] /${behaviorPath} ← ${merged.length} children ... `)
  const up = await sendRetry({ op: 'update', segments: BEHAVIOR_SEGMENTS, layer: { name: 'tags', children: merged } })
  console.log(up.ok ? 'ok' : `FAIL: ${up.error}`)
  if (!up.ok) process.exit(1)

  // Part tiles — create-or-update, then reconcile the note against the source
  // of truth in PARTS. `part of /tags (bouquets)` is the tag that identifies a
  // note as ours, so a restatement replaces rather than accumulates.
  const NOTE_TAG = (file: string) => `${file.split('/').pop()} — `
  const written: string[] = []
  for (const part of PARTS) {
    const seg = [...BEHAVIOR_SEGMENTS, part.key]
    process.stdout.write(`[bouquets]   ${part.key} ... `)
    const res = await sendRetry({ op: 'update', segments: seg, layer: { name: part.key } })
    if (!res.ok) { console.log(`FAIL: ${res.error}`); continue }
    const text = `${part.file.split('/').pop()} — ${part.role}\n\npart of /tags (bouquets)\nsource: ${part.file}`
    const outcome = await reconcileNote(seg, NOTE_TAG(part.file), text)
    console.log(outcome)
    written.push(part.key)

    // `part` mark — decoration-add is idempotent (same content, same sig), so
    // this runs every pass and heals a mark that never landed.
    process.stdout.write(`[bouquets]   ${part.key} ← ${PART_KEYWORD} ... `)
    const mark = await sendRetry(
      { op: 'decoration-add', segments: seg, kind: 'tag', appliesTo: [], payload: { name: PART_KEYWORD } },
      async () => {
        const check = await send({ op: 'layer-at', segments: seg })
        return check.ok && ((check.data?.decorations ?? []) as string[]).includes(decorationSig({ name: PART_KEYWORD }))
      },
    )
    console.log(mark.ok ? 'ok' : `FAIL: ${mark.error}`)
  }

  // The explanation lives on the tile, not only in a markdown file.
  process.stdout.write('[bouquets] behaviour note ... ')
  console.log(await reconcileNote(BEHAVIOR_SEGMENTS, 'BOUQUETS —', BEHAVIOR_NOTE))

  // Declare the vocabulary through the registry, then neutralize the replay.
  if (written.length) {
    process.stdout.write(`[bouquets] registering vocabulary: ${PART_KEYWORD}(${PART_COLOR}) ... `)
    const reg = await send({ op: 'submit', text: `/keyword [${PART_KEYWORD}(${PART_COLOR})]` })
    console.log(reg.ok ? 'ok' : `FAIL: ${reg.error}`)
    await send({ op: 'submit', text: '' })
  }

  console.log(`[bouquets] DONE — ${written.length} part tiles reconciled`)
}

void main()
