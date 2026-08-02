// Mirror the TUTORIAL COURSES into the hive — tiles, collections, pheromones,
// notes, built alongside the code (the permanent mirror paradigm; see
// documentation/mirror-paradigm.md).
//
// Structure:
//
//   tutorials/                       ← the creation
//     starter/  beginner/  intermediate/  expert/     ← one collection per course
//       <lesson>                                       ← one tile per lesson, 1:1 with its code
//
// Pheromones (kind:'tag' decorations — the SAME primitive /keyword writes):
//   - `tutorial` on the root and on every tile — the universal mark.
//   - `course` on each collection, `lesson` on each member.
//   - the level keyword (starter/beginner/intermediate/expert) on the
//     collection AND its members — keyword-the-collection-first doctrine: the
//     pheromones ARE the parameters of the collection.
//   - each lesson's own topic marks, taken VERBATIM from its declaration in
//     tutorial-lesson.ts, so the tile and the code can never drift.
//
// GROUP SIGNATURES (kind:'group' decorations — the first-class group identity,
// core/group-signature.ts): every tile of a course carries
// `sign('group:tutorial:course:<level>')`, the same signature the running
// tutorial stamps into its provenance records. That is what makes a course a
// UNIT: everything wearing the signature was made together and can be added or
// removed together, by anyone holding it — no list in code required.
//
// Also spreads the tutorial's implementation files as `part` cells under
// `behaviors/guidance/tutorial` (the 1:1 rule — one resource, one tile).
//
// Re-run: SAFE. Structure merges into existing children; note-add and
// decoration-add are not idempotent by themselves, so every note write is
// gated on `note-list` for that cell and every mark/group write is gated on
// the tile's EXISTING decorations (fetched and compared by kind + payload).
// So an interrupted run resumes exactly where it stopped, and a completed run
// is a no-op. (The first cut used a sentinel abort instead; an interrupted run
// then could not be finished at all — the sentinel was already present.)

import { createHash } from 'node:crypto'
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

/** How many notes a cell already carries (0 when it has none / is unreadable).
 *  The gate that makes the note phase resumable. */
async function noteCount(segments: readonly string[]): Promise<number> {
  const res = await send({ op: 'note-list', segments: [...segments] }).catch(() => null)
  if (!res?.ok) return 0
  const data: any = res.data
  const list = Array.isArray(data) ? data : (Array.isArray(data?.notes) ? data.notes : [])
  return list.length
}

/** The `kind|payload` set a cell's decorations already carry — the gate that
 *  makes the mark and group phases resumable. Unreadable → empty (write). */
async function decorationKeys(segments: readonly string[]): Promise<Set<string>> {
  const out = new Set<string>()
  const layer = await send({ op: 'layer-at', segments: [...segments] }).catch(() => null)
  const sigs: string[] = Array.isArray(layer?.data?.decorations) ? layer!.data.decorations.map(String) : []
  for (const sig of sigs) {
    const res = await send({ op: 'get-resource', sig }).catch(() => null)
    const text = res?.ok && res.data?.encoding === 'text' ? String(res.data.text) : ''
    if (!text) continue
    try {
      const record = JSON.parse(text)
      out.add(`${record?.kind}|${JSON.stringify(record?.payload ?? {})}`)
    } catch { /* not a decoration record we wrote */ }
  }
  return out
}

/** Mirror of @hypercomb/core normalizeCell so segments == children keys. */
function norm(s: string): string {
  return s.trim().toLocaleLowerCase()
    .replace(/[._\s/]+/g, '-')
    .replace(/[^\p{L}\p{N}\-]/gu, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64)
    .replace(/-$/, '')
}

/** The SAME preimage core/group-signature.ts uses — a group minted here and a
 *  group minted at runtime must be the same signature, or the mark is a lie. */
const groupSignature = (meaning: string): string =>
  createHash('sha256').update(`group:${meaning.trim()}`, 'utf8').digest('hex')

// ── the lesson census ───────────────────────────────────────────────
// Mirrors the registrations in
// hypercomb-essentials/src/diamondcoreprocessor.com/tutorial/lessons/*.
// `marks` are the lesson's declared topic pheromones (beyond tutorial/lesson/
// level, which every tile gets).

const T = 'hypercomb-essentials/src/diamondcoreprocessor.com/tutorial'

type Lesson = [id: string, note: string, marks: string[]]
interface Course { level: string; color: string; note: string; lessons: Lesson[] }

const COURSES: Course[] = [
  {
    level: 'starter', color: '#c98f2f',
    note: 'The first flight: moving, making, and getting home. Everything happens on a practice page the bee opens and tidies away — nothing on your own pages is touched.',
    lessons: [
      ['create', 'Create a tile from the command line — type a name, press Enter, a tile is born.', ['creation']],
      ['go-in', 'Left-click a tile to go inside it; the address bar always says where you are.', ['navigation']],
      ['go-out', 'Three ways back out: right-click, Shift+click, or the Back button.', ['navigation']],
      ['children', 'Tiles hold tiles — seven children in one bracket line.', ['creation', 'structure']],
      ['travel', 'In, out and across: you can wander anywhere and never get lost.', ['navigation']],
      ['zoom', 'Wheel or pinch to zoom the honeycomb.', ['navigation']],
      ['pan', 'Space + drag (or two fingers) to glide across the field.', ['navigation']],
      ['home', 'The Home button returns you to your front door.', ['navigation']],
    ],
  },
  {
    level: 'beginner', color: '#4d7fae',
    note: 'The everyday verbs, once you can move and make: select, edit, note, copy, remove, undo, fit, arrange. Each runs through the participant\'s own binding, so the demonstration IS the keystroke.',
    lessons: [
      ['select', 'Ctrl+click picks tiles without entering them; selection is what commands act on.', ['editing']],
      ['edit', 'E (or the pencil) opens the tile editor — words, pictures, links.', ['editing']],
      ['note', 'Notes live on the tile and travel with it wherever it goes.', ['editing', 'meaning']],
      ['copy-paste', 'Ctrl+C carries a tile and its whole branch; Ctrl+V drops it where you stand.', ['editing']],
      ['remove', 'Delete removes selected tiles — a nested branch asks first.', ['editing']],
      ['undo-redo', 'Every change is one revision, so undo and redo always know what to take back.', ['history']],
      ['fit', 'Fit brings the whole page back into view in one move.', ['navigation']],
      ['arrange', 'Tiles fill the page in a sequence — cycle it and the page rearranges.', ['appearance', 'structure']],
    ],
  },
  {
    level: 'intermediate', color: '#4f9d6e',
    note: 'Giving the hive meaning: pheromones and the collections they build, live filtering, titles that rename without moving, references, filing things away, the palette, and history as a place you can travel.',
    lessons: [
      ['keyword', 'Paint a pheromone — anything wearing the same mark belongs together, wherever it lives.', ['meaning']],
      ['filter', '? filters the page live as you type, by name or by mark; /clear puts it back.', ['meaning']],
      ['title', 'The name is the address, so /title changes the words a tile draws under, not where it lives.', ['structure']],
      ['reference', 'A reference tile is a live doorway to the real thing, not a copy.', ['structure']],
      ['into', '/into files a tile away: it MOVES inside another tile and leaves the page it was on. The Organizer offers the same verb across the whole hive — Add lends a doorway, Move takes custody.', ['structure']],
      ['palette', 'Every action in one searchable list — you never have to remember a shortcut.', ['guidance']],
      ['history', 'The history panel walks every revision you have ever made.', ['history']],
      ['snapshot', 'Named checkpoints of the WHOLE hive — narrated, never fired: it reaches past the practice page.', ['history']],
    ],
  },
  {
    level: 'expert', color: '#8a63c9',
    note: 'THE WINDOWS: one lesson per primary window, each carrying every behaviour that lives in it. The interface is the curriculum — adding a window to the shell means adding a lesson here, in the same pass. Nothing outside the practice page is touched, and nothing is ever published.',
    lessons: [
      ['window-command-line', 'One box, three languages: a NAME makes, a ? filters, a / runs a behaviour. Brackets commit many tiles at once and a slash inside one builds depth.', ['input', 'creation', 'structure']],
      ['window-palette', 'Every action in one searchable list — type what you MEAN, not a shortcut you have to remember.', ['guidance', 'input']],
      ['window-help', '/help is the whole surface as a searchable reference; /docs opens the reader for the long form.', ['guidance']],
      ['window-editor', 'What a tile CARRIES — words, cover, links, files. Content only: never where it lives or what it means.', ['editing', 'appearance']],
      ['window-notes', 'The explanation, kept on the thing. Notes nest, take marks, reorder, and travel with the tile everywhere it goes.', ['editing', 'meaning']],
      ['window-files', 'The real documents underneath a tile — this tile, this page, or the whole branch below you.', ['editing', 'structure']],
      ['window-tags', 'Your whole vocabulary of marks: arm them, paint them onto a selection, drag one out as a collection, group them into a bouquet.', ['meaning']],
      ['window-collections', 'The index of everything gathered by meaning rather than by place — plus /hive, which names a branch so commands can take it by name.', ['meaning', 'structure', 'navigation']],
      ['window-filters', 'Where a filter stops being a keystroke and becomes something you keep, name, and reopen. Still a lens; still changes nothing.', ['meaning', 'view']],
      ['window-clipboard', 'Everything you are carrying, not one slot — placed where you choose, never leaving your machine.', ['editing']],
      ['window-sequence', 'The sequence a page fills along, and the target a dropped or pasted thing lands on.', ['appearance', 'structure']],
      ['window-history', 'The whole road of revisions, in order, markable. History never branches — taking something back is a new step forward.', ['history']],
      ['window-rewind', 'Undo you can SEE: recent moments drawn as they looked, so you pick the one you meant instead of counting.', ['history', 'view']],
      ['window-views', 'The library of ways to draw the same tiles — tree, website, slides, study games. Attached, never converted.', ['view', 'appearance']],
      ['window-features', 'What is actually acting on a tile, and where each behaviour came from — direct mark or inherited from an ancestor.', ['structure', 'appearance']],
      ['window-assistant', 'The ask screen and the bee that flies it: question first, tiles as context, answers landing as notes. /atomize and /organize hand back plans the hive checks before it moves anything.', ['assistant']],
      ['window-observe', 'The window onto the swarm — who is here and what they share. Watching is free; publishing is always your own deliberate act.', ['swarm']],
    ],
  },
]

// ── implementation parts (the 1:1 rule) ─────────────────────────────
// These hang off the EXISTING behaviour tile `behaviors/guidance/tutorial`,
// which stays 1:1 with tutorial.queen.ts.

type Part = [file: string, role: string]
const PARTS: Part[] = [
  [`${T}/bee-tutorial.drone.ts`, 'course runner — owns the stage (bee, practice page, geometry, the real action paths) and runs a course\'s lessons in order'],
  [`${T}/tutorial-lesson.ts`, 'lesson primitive + registry — levels, curriculum order, the declared pheromone vocabulary, and each course\'s GROUP SIGNATURE'],
  [`${T}/tutorial-stage.ts`, 'the stage contract — the only surface a lesson may touch'],
  [`${T}/tutorial-overlay.view.ts`, 'the overlay — the flying bee, speech bubble, ghost cursor, highlight ring'],
  [`${T}/tutorial-images.ts`, 'covers drawn at runtime on a canvas, so a tutorial tile never falls back to a substrate default'],
  [`${T}/tutorial-provenance.ts`, 'sign(\'tutorial:artifacts\') records — what a run minted, stamped with the course group signature, so a crashed run is reclaimed'],
  [`${T}/lessons/lesson-kit.ts`, 'the moves every lesson needs, so no lesson depends on another having run'],
  [`${T}/lessons/starter.lessons.ts`, 'the starter course — move, make, get home'],
  [`${T}/lessons/beginner.lessons.ts`, 'the beginner course — the everyday verbs'],
  [`${T}/lessons/intermediate.lessons.ts`, 'the intermediate course — meaning, marks, history'],
  [`${T}/lessons/expert.lessons.ts`, 'the expert course — THE WINDOWS: one lesson per primary window and every behaviour that lives in it'],
  ['hypercomb-core/src/core/group-signature.ts', 'group signatures — group identity as a first-class citizen: sign(\'group:<meaning>\'), carried by every member so a set adds and deletes as one unit'],
]

const ROOT_KEY = norm('tutorials')
const TUTORIAL_KEYWORD = 'tutorial'
const COURSE_KEYWORD = 'course'
const LESSON_KEYWORD = 'lesson'
const PART_KEYWORD = 'part'
const TUTORIAL_COLOR = '#e0a83c'
const COURSE_COLOR = '#d98f4a'
const LESSON_COLOR = '#c9b45a'

const ROOT_NOTES = [
  'The guided tours, mirrored. A beeing flies the screen and shows you how the hive works — one collection per course (starter, beginner, intermediate, expert), one tile per lesson, in the order they are taught.',
  'Each lesson is an INDEPENDENT piece: it runs alone (/tutorial <lesson>) or as part of its course, works on whatever the practice page already holds, and cleans up after itself. What joins them is not a script — it is the marks they carry.',
  'Every tile of a course also carries a GROUP decoration holding that course\'s signature, sign(\'group:tutorial:course:<level>\'). That signature is the course\'s identity: everything wearing it was made together and can be added or removed together.',
]

async function preflight(attempts: number): Promise<{ rootName: string; topNames: string[] } | undefined> {
  for (let i = 1; i <= attempts; i++) {
    const inf = await send({ op: 'inflate', segments: [] }).catch((e: Error) => ({
      ok: false as const, error: e.message, id: '', data: undefined,
    }))
    if (inf.ok) {
      const root = (inf.data ?? {}) as { name?: string; children?: { name?: string }[] }
      return {
        rootName: root.name ?? '/',
        topNames: (root.children ?? []).map(c => String(c.name ?? '')).filter(Boolean),
      }
    }
    console.log(`[tutorials] preflight ${i}/${attempts} — bridge not ready (${inf.error}), retrying...`)
    await new Promise(r => setTimeout(r, 3000))
  }
  return undefined
}

async function main(): Promise<void> {
  const pre = await preflight(5)
  if (!pre) {
    console.error('[tutorials] ABORT: no renderer. Open the app on localhost with ?claudeBridge=1, then re-run.')
    process.exit(1)
  }
  console.log(`[tutorials] live root "${pre.rootName}" holds: ${pre.topNames.join(', ') || '(none)'}`)

  // Merge mode + re-run sentinel.
  const existingChildren = new Map<string, string[]>()
  if (pre.topNames.includes(ROOT_KEY)) {
    const ex = await send({ op: 'inflate', segments: [ROOT_KEY] })
    if (!ex.ok) {
      console.error(`[tutorials] ABORT: cannot inflate existing "${ROOT_KEY}": ${ex.error}`)
      process.exit(1)
    }
    const walkEx = (node: any, path: string[]): void => {
      const kids = Array.isArray(node?.children) ? node.children : []
      existingChildren.set(path.join('/'), kids.map((k: any) => String(k?.name ?? '')).filter(Boolean))
      for (const k of kids) if (k?.name) walkEx(k, [...path, String(k.name)])
    }
    walkEx(ex.data, [ROOT_KEY])
    console.log(`[tutorials] merging into existing tree: ${(existingChildren.get(ROOT_KEY) ?? []).join(', ') || '(empty)'}`)
  }

  const totalLessons = COURSES.reduce((n, c) => n + c.lessons.length, 0)
  console.log(`[tutorials] plan: ${COURSES.length} courses, ${totalLessons} lesson tiles, ${PARTS.length} part tiles`)
  for (const c of COURSES) console.log(`  group ${c.level.padEnd(13)} ${groupSignature(`tutorial:course:${c.level}`)}`)

  if (!pre.topNames.includes(ROOT_KEY)) {
    const nextRoot = [...pre.topNames, ROOT_KEY]
    process.stdout.write(`[tutorials] root layer ← [${nextRoot.join(', ')}] ... `)
    const rootRes = await send({ op: 'update', segments: [], layer: { name: pre.rootName, children: nextRoot } })
    console.log(rootRes.ok ? 'ok' : `FAIL: ${rootRes.error}`)
    if (!rootRes.ok) process.exit(1)
  }

  // Phase 1: structure.
  const structure: { segments: string[]; name: string; children: string[] }[] = [
    { segments: [ROOT_KEY], name: ROOT_KEY, children: COURSES.map(c => norm(c.level)) },
    ...COURSES.map(c => ({
      segments: [ROOT_KEY, norm(c.level)], name: norm(c.level), children: c.lessons.map(l => norm(l[0])),
    })),
    ...COURSES.flatMap(c => c.lessons.map(l => ({
      segments: [ROOT_KEY, norm(c.level), norm(l[0])], name: norm(l[0]), children: [] as string[],
    }))),
  ]
  let okStruct = 0, failStruct = 0
  for (let i = 0; i < structure.length; i++) {
    const t = structure[i]
    const have = existingChildren.get(t.segments.join('/')) ?? []
    const merged = [...have, ...t.children.filter(c => !have.includes(c))]
    process.stdout.write(`[struct ${i + 1}/${structure.length}] ${t.segments.join('/')} ← ${merged.length} children ... `)
    const layer: { name: string; children?: string[] } = { name: t.name }
    if (merged.length) layer.children = merged
    const res = await send({ op: 'update', segments: t.segments, layer })
    if (res.ok) { okStruct++; console.log('ok') }
    else { failStruct++; console.log(`FAIL: ${res.error}`) }
  }
  console.log(`[tutorials] phase 1 structure: ${okStruct} ok, ${failStruct} failed`)

  // Phase 2: notes.
  const notes: { segments: string[]; text: string }[] = []
  for (const n of ROOT_NOTES) notes.push({ segments: [ROOT_KEY], text: n })
  for (const c of COURSES) {
    const sig = groupSignature(`tutorial:course:${c.level}`)
    notes.push({
      segments: [ROOT_KEY, norm(c.level)],
      text: `${c.note}\n\nRun it with /tutorial ${c.level}.\nCollection keyword: ${c.level} — painting it on any tile makes it a member.\nGroup signature: ${sig}\n  = sign('group:tutorial:course:${c.level}')`,
    })
    for (const [id, note] of c.lessons) {
      notes.push({
        segments: [ROOT_KEY, norm(c.level), norm(id)],
        text: `${note}\n\nRun this lesson alone: /tutorial ${id}\nsource: ${T}/lessons/${c.level}.lessons.ts`,
      })
    }
  }
  // Gate per CELL: a cell that already carries its share of notes is skipped,
  // so an interrupted run resumes rather than duplicating.
  const wantedPerCell = new Map<string, number>()
  for (const n of notes) {
    const key = n.segments.join('/')
    wantedPerCell.set(key, (wantedPerCell.get(key) ?? 0) + 1)
  }
  const writtenPerCell = new Map<string, number>()
  let okNotes = 0, failNotes = 0, skipNotes = 0
  for (let i = 0; i < notes.length; i++) {
    const n = notes[i]
    const key = n.segments.join('/')
    process.stdout.write(`[note ${i + 1}/${notes.length}] ${key} ... `)
    const have = writtenPerCell.has(key) ? writtenPerCell.get(key)! : await noteCount(n.segments)
    if (have >= (wantedPerCell.get(key) ?? 1)) { skipNotes++; console.log('already noted'); continue }
    const res = await send({
      op: 'note-add', segments: n.segments.slice(0, -1),
      cell: n.segments[n.segments.length - 1], text: n.text,
    })
    if (res.ok) { okNotes++; writtenPerCell.set(key, have + 1); console.log('ok') }
    else { failNotes++; console.log(`FAIL: ${res.error}`) }
  }
  console.log(`[tutorials] phase 2 notes: ${okNotes} ok, ${skipNotes} already present, ${failNotes} failed`)

  // Phase 3: pheromones (kind:'tag' — NO replaceKind, tags stack).
  const marks: { segments: string[]; tag: string }[] = []
  marks.push({ segments: [ROOT_KEY], tag: TUTORIAL_KEYWORD })
  for (const c of COURSES) {
    const courseSegs = [ROOT_KEY, norm(c.level)]
    marks.push({ segments: courseSegs, tag: TUTORIAL_KEYWORD })
    marks.push({ segments: courseSegs, tag: COURSE_KEYWORD })
    marks.push({ segments: courseSegs, tag: c.level })
    for (const [id, , topics] of c.lessons) {
      const segs = [ROOT_KEY, norm(c.level), norm(id)]
      marks.push({ segments: segs, tag: TUTORIAL_KEYWORD })
      marks.push({ segments: segs, tag: LESSON_KEYWORD })
      marks.push({ segments: segs, tag: c.level })
      for (const topic of topics) marks.push({ segments: segs, tag: topic })
    }
  }
  // One decoration read per CELL (cached), then a set check per mark — a
  // re-run adds only what is missing instead of stacking duplicates.
  const decoCache = new Map<string, Set<string>>()
  const decoKeys = async (segments: readonly string[]): Promise<Set<string>> => {
    const key = segments.join('/')
    let set = decoCache.get(key)
    if (!set) { set = await decorationKeys(segments); decoCache.set(key, set) }
    return set
  }
  let okMarks = 0, failMarks = 0, skipMarks = 0
  for (let i = 0; i < marks.length; i++) {
    const m = marks[i]
    process.stdout.write(`[mark ${i + 1}/${marks.length}] ${m.segments.join('/')} ← ${m.tag} ... `)
    const payload = { name: m.tag }
    const key = `tag|${JSON.stringify(payload)}`
    const have = await decoKeys(m.segments)
    if (have.has(key)) { skipMarks++; console.log('already marked'); continue }
    const res = await send({ op: 'decoration-add', segments: m.segments, kind: 'tag', appliesTo: [], payload })
    if (res.ok) { okMarks++; have.add(key); console.log('ok') }
    else { failMarks++; console.log(`FAIL: ${res.error}`) }
  }
  console.log(`[tutorials] phase 3 pheromones: ${okMarks} ok, ${skipMarks} already present, ${failMarks} failed`)

  // Phase 4: GROUP SIGNATURES — the course's identity on every one of its tiles.
  const groups: { segments: string[]; meaning: string }[] = []
  for (const c of COURSES) {
    const meaning = `tutorial:course:${c.level}`
    groups.push({ segments: [ROOT_KEY, norm(c.level)], meaning })
    for (const [id] of c.lessons) groups.push({ segments: [ROOT_KEY, norm(c.level), norm(id)], meaning })
  }
  let okGroups = 0, failGroups = 0, skipGroups = 0
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i]
    const sig = groupSignature(g.meaning)
    process.stdout.write(`[group ${i + 1}/${groups.length}] ${g.segments.join('/')} ← ${sig.slice(0, 12)}… ... `)
    const payload = { sig, meaning: g.meaning }
    const key = `group|${JSON.stringify(payload)}`
    const have = await decoKeys(g.segments)
    if (have.has(key)) { skipGroups++; console.log('already grouped'); continue }
    const res = await send({ op: 'decoration-add', segments: g.segments, kind: 'group', appliesTo: [], payload })
    if (res.ok) { okGroups++; have.add(key); console.log('ok') }
    else { failGroups++; console.log(`FAIL: ${res.error}`) }
  }
  console.log(`[tutorials] phase 4 group signatures: ${okGroups} ok, ${skipGroups} already present, ${failGroups} failed`)

  // Phase 5: the 1:1 part spread under the existing behaviour tile.
  const behaviourSegs = ['behaviors', 'guidance', 'tutorial']
  const beh = await send({ op: 'inflate', segments: behaviourSegs })
  if (!beh.ok) {
    console.warn(`[tutorials] phase 5 skipped — ${behaviourSegs.join('/')} not present (${beh.error}). Run scripts/mirror-behaviors.ts first.`)
  } else {
    const have = (Array.isArray(beh.data?.children) ? beh.data.children : [])
      .map((k: any) => String(k?.name ?? '')).filter(Boolean)
    const fresh = PARTS.filter(([file]) => !have.includes(norm(leaf(file))))
    console.log(`[tutorials] phase 5 parts: ${fresh.length} new of ${PARTS.length}`)

    if (fresh.length > 0) {
      const merged = [...have, ...fresh.map(([file]) => norm(leaf(file)))]
      const res = await send({ op: 'update', segments: behaviourSegs, layer: { name: 'tutorial', children: merged } })
      console.log(`[tutorials] behaviour layer ← ${merged.length} children ... ${res.ok ? 'ok' : `FAIL: ${res.error}`}`)

      for (const [file, role] of fresh) {
        const name = norm(leaf(file))
        const segs = [...behaviourSegs, name]
        process.stdout.write(`[part] ${name} ... `)
        const made = await send({ op: 'update', segments: segs, layer: { name } })
        if (!made.ok) { console.log(`FAIL: ${made.error}`); continue }
        if (await noteCount(segs) === 0) {
          await send({ op: 'note-add', segments: behaviourSegs, cell: name, text: `${role}\n\nsource: ${file}` })
        }
        const partPayload = { name: PART_KEYWORD }
        const partKeys = await decorationKeys(segs)
        if (!partKeys.has(`tag|${JSON.stringify(partPayload)}`)) {
          await send({ op: 'decoration-add', segments: segs, kind: 'tag', appliesTo: [], payload: partPayload })
        }
        console.log('ok')
      }
    }
  }

  // Phase 6: register the vocabulary (colors + intellisense) in the global
  // TagRegistry via /keyword with NO selection — registry-only, no tile writes.
  const vocab = [
    `${TUTORIAL_KEYWORD}(${TUTORIAL_COLOR})`,
    `${COURSE_KEYWORD}(${COURSE_COLOR})`,
    `${LESSON_KEYWORD}(${LESSON_COLOR})`,
    ...COURSES.map(c => `${c.level}(${c.color})`),
  ]
  process.stdout.write(`[tutorials] registering vocabulary: ${vocab.join(', ')} ... `)
  const reg = await send({ op: 'submit', text: `/keyword [${vocab.join(', ')}]` })
  console.log(reg.ok ? 'ok' : `FAIL: ${reg.error}`)
  await send({ op: 'submit', text: '' }) // neutralize replay

  const failed = failStruct + failNotes + failMarks + failGroups
  console.log(`[tutorials] DONE — ${okStruct} cells, ${okNotes} notes, ${okMarks} marks, ${okGroups} group signatures under "${ROOT_KEY}"`)
  if (failed > 0) console.warn(`[tutorials] ${failed} operations failed — review the log above.`)
}

/** `a/b/c.lessons.ts` → `c.lessons` — the tile name for a source file. */
function leaf(file: string): string {
  const base = file.split('/').pop() ?? file
  return base.replace(/\.ts$/, '')
}

main().catch(err => { console.error(err); process.exit(1) })
