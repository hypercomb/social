// Repair the behaviors mirror — WRITE-IF-ABSENT.
//
// The mirror eroded: audited 2026-08-25, only 15 of 74 behaviour tiles still
// carried their `behavior` mark and their note. Marks and notes were lost tile
// for tile together, so one mechanism re-committed those tiles' layers without
// carrying decorations + notes forward. The art survived; the meaning did not.
//
// This pass re-mints ONLY what is missing:
//   - `behavior` + the collection keyword on tiles that carry neither
//   - the collection keyword on a collection tile that lost it
//   - the `/name — description` + `source:` note on tiles with NO note
//
// It NEVER rewrites a children array (that is what ate the parts), never
// replaces an existing note (note-add is additive — a re-add lands a second
// copy), and never touches a tile that is already intact. Safe to re-run.
//
// The census below is the one from mirror-behaviors.ts; tiles present in the
// hive but absent from it still get their marks (membership is told by the
// path) and are reported as owing a note.
//
// Foreign marks (a tile wearing keywords that belong to something else) are
// REPORTED, never stripped on a sweep — judging a mark foreign is the hive
// owner's call. Naming a tile with --strip does strip it, one tile at a time:
// `decoration-add` with replaceKind drops every tag on the cell, so the tile's
// own `behavior` + collection keyword are re-added straight after.
//
//   npx tsx scripts/mirror-behaviors-repair.ts          # plan only
//   npx tsx scripts/mirror-behaviors-repair.ts --go     # write
//   npx tsx scripts/mirror-behaviors-repair.ts --go --strip behaviors/games/solomon

import WebSocket from 'ws'

const BRIDGE = `ws://127.0.0.1:${process.env['HC_BRIDGE_PORT'] ?? 2401}`
const TIMEOUT = 180_000
const GO = process.argv.includes('--go')
const STRIP = new Set(
  process.argv.reduce<string[]>((acc, arg, i) => (
    arg === '--strip' && process.argv[i + 1] ? [...acc, process.argv[i + 1].replace(/^\/+|\/+$/g, '')] : acc
  ), []),
)

let counter = 0
type Res = { id: string; ok: boolean; data?: any; error?: string }

function once(request: Record<string, unknown>): Promise<Res> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(BRIDGE)
    const timer = setTimeout(() => { ws.close(); reject(new Error('bridge timeout')) }, TIMEOUT)
    ws.on('open', () => ws.send(JSON.stringify({ ...request, id: `repair-${Date.now()}-${++counter}` })))
    ws.on('message', (raw: unknown) => {
      clearTimeout(timer)
      try { resolve(JSON.parse(String(raw)) as Res) } catch { reject(new Error('invalid response')) }
      ws.close()
    })
    ws.on('error', (err: Error) => { clearTimeout(timer); reject(new Error(err.message)) })
  })
}

async function send(request: Record<string, unknown>, tries = 3): Promise<Res> {
  let last: Res | undefined
  for (let i = 0; i < tries; i++) {
    try {
      const res = await once(request)
      if (res.ok || res.error !== 'no renderer connected') return res
      last = res
    } catch (e) {
      last = { id: '', ok: false, error: (e as Error).message }
    }
    await new Promise(r => setTimeout(r, 4000))
  }
  return last ?? { id: '', ok: false, error: 'unreachable' }
}

const seal = (r: Res) => r?.data?.builds?.[0]?.seal ?? r?.data

// ── the census (verbatim from mirror-behaviors.ts) ──────────────────
const E = 'hypercomb-essentials/src/diamondcoreprocessor.com'
type Entry = [name: string, desc: string, source?: string]
interface Category { name: string; keyword: string; members: Entry[] }

const CATEGORIES: Category[] = [
  { name: 'games', keyword: 'game', members: [
    ['arkanoid', 'Arkanoid — bounce the ball off the paddle to break every brick, catch power pills + level designer; on | off | design', `${E}/games/arkanoid/arkanoid.queen.ts`],
    ['bubble', 'Bubble Bobble — blow bubbles to trap foes, pop them for fruit + level designer; on | off | design', `${E}/games/bubble/bubble.queen.ts`],
    ['roper', 'Roper — turn-based Worms-style artillery with a ninja rope; on | off', `${E}/games/roper/roper.queen.ts`],
    ['solomon', "Solomon's Key — block-conjuring puzzle game + level designer; on | off | design", `${E}/games/solomon/solomon.queen.ts`],
  ] },
  { name: 'views', keyword: 'view', members: [
    ['tree', 'Sideways tree — draw a branch as a mind map: trunk on the left, one column per ring, any signature as the root', `${E}/commands/tree.queen.ts`],
    ['present', "Present view — play this area's diagram tiles as slides; on | off | here | slide", `${E}/commands/present.queen.ts`],
    ['website', 'Toggle website view, export subtree, or build pages via Claude', `${E}/commands/website.queen.ts`],
    ['view', 'Toggle between hexagons and website rendering', `${E}/commands/view.queen.ts`],
    ['lightbox', "Lightbox — show this tile's pictures full screen", `${E}/commands/lightbox.queen.ts`],
    ['tutor', 'Study games — turn this hive into spaced-repetition games; on | off | here | build | list', `${E}/tutorial/tutor.queen.ts`],
    ['mobile', 'Mobile viewer: on, off, auto, or sweep to mark tiles', `${E}/commands/mobile.queen.ts`],
    ['screensaver', 'Idle screensaver on/off + style; on | off | now | hexagon | circle | thought', `${E}/presentation/screensaver/screensaver.queen.ts`],
    ['tags', 'Open the tag view', `${E}/commands/tags-view.queen.ts`],
    ['history', 'Toggle the history panel', `${E}/commands/history.queen.ts`],
    ['revise', 'Toggle revision mode (history clock)', `${E}/history/revise.queen.ts`],
  ] },
  { name: 'assistant', keyword: 'assistant', members: [
    ['opus', 'Send context to Claude Opus 5', `${E}/assistant/llm.queen.ts`],
    ['sonnet', 'Send context to Claude Sonnet 5', `${E}/assistant/llm.queen.ts`],
    ['haiku', 'Send context to Claude Haiku', `${E}/assistant/llm.queen.ts`],
    ['fable', 'Send context to Claude Fable 5', `${E}/assistant/llm.queen.ts`],
    ['ask', 'Ask the host AI — immediate streamed answer', `${E}/commands/ask.queen.ts`],
    ['chat', 'Multi-turn conversation with Claude — creates thread tiles with Q&A children', `${E}/assistant/conversation.queen.ts`],
    ['break-apart', 'Go deeper — break each LEAF tile into the pieces that compose it, asked of Claude Haiku over the bridge (foreach the selection, else every leaf on the layer; does nothing to a tile that already has children)', `${E}/assistant/break-apart.drone.ts`],
    ['organize', 'Insert a level — Haiku plans how to group a crowded layer over the bridge and the hive re-homes the tiles into the groups (the inverse of break-apart; mints no new meaning)', `${E}/assistant/organize.drone.ts`],
    ['record', 'Start AI-powered meeting recording with live hierarchy compilation', `${E}/recording/recording.queen.ts`],
    ['translate-sweep', 'Batch-translate all tiles (dry-run by default; add --go to execute)', `${E}/commands/translate-sweep.queen.ts`],
    ['workflow', 'Design a workflow out of tiles — one step per tile — and run it', `${E}/workflow/workflow.queen.ts`],
  ] },
  { name: 'swarm', keyword: 'swarm', members: [
    ['observe', 'Observe the swarm — who is here and what they share', `${E}/commands/slash-behaviour.drone.ts`],
    ['domain', 'Add, remove, or list mesh relay domains', `${E}/commands/domain.queen.ts`],
    ['block-peer', 'Block a peer by pubkey prefix and drop their tiles locally', `${E}/sharing/mesh-block.queen.ts`],
    ['clear-mesh', 'Wipe the relay event store and drop peer caches', `${E}/sharing/mesh-clear.queen.ts`],
    ['repush', 'Re-push shared content to your host and report holes', `${E}/sharing/repush.queen.ts`],
    ['host', 'Host the current branch as a static hive and copy a shareable preview link', `${E}/sharing/host.queen.ts`],
    ['invite', 'Create a meeting-place invite and copy a shareable link', `${E}/sharing/invite.queen.ts`],
    ['meeting', 'Start or join a video meeting on the selected tile', `${E}/meeting/meeting.queen.ts`],
  ] },
  { name: 'appearance', keyword: 'appearance', members: [
    ['accent', 'Set the hover accent color by name', `${E}/commands/accent.queen.ts`],
    ['canvas', 'Choose the screen backdrop (hex dots, honeycomb, depth, …)', `${E}/commands/canvas.queen.ts`],
    ['backgrounds', 'View or toggle which default background images are available', `${E}/substrate/backgrounds.queen.ts`],
    ['substrate', 'Toggle default background images for new tiles', `${E}/substrate/substrate.queen.ts`],
    ['reroll', 'Reroll substrate background images on tiles', `${E}/substrate/reroll.queen.ts`],
    ['theme', 'Switch the UI theme (light, dark, system)', `${E}/commands/theme.queen.ts`],
    ['header', 'Set the header size (1 = small, 2 = medium, 3 = large)'],
    ['format', 'Copy visual formatting from the active tile', `${E}/format/format.queen.ts`],
    ['text-only', 'Toggle text-only mode (hide images)', `${E}/commands/slash-behaviour.drone.ts`],
  ] },
  { name: 'structure', keyword: 'structure', members: [
    ['keyword', 'Add or remove keywords (tags) on selected tiles — the pheromone painter of the command line', `${E}/commands/keyword.queen.ts`],
    ['remove', 'Remove tiles from the current directory (a built-in selection variant exists as remove-builtin)', `${E}/commands/remove.queen.ts`],
    ['move', 'Toggle move mode for drag-reordering tiles', `${E}/commands/slash-behaviour.drone.ts`],
    ['arrange', 'Toggle icon arrangement mode on the tile overlay', `${E}/commands/arrange.queen.ts`],
    ['sequence', 'Set the drop-target order new tiles fill', `${E}/sequence/sequence.queen.ts`],
    ['layout', 'Save, apply, list, or remove layout templates', `${E}/move/layout.queen.ts`],
    ['title', "Set a tile's display name without moving it — the name IS the address; the title is a decoration", `${E}/commands/title.queen.ts`],
    ['reference', 'Drop a reference tile here — a live pointer to another location; /reference <path>', `${E}/commands/reference.queen.ts`],
    ['into', "File the selection away — move the selected tiles INSIDE another tile, so they leave the page they were on; /into <cell> or /into <path>/<cell>. Custody, where /reference is only a doorway", `${E}/commands/into.queen.ts`],
    ['snapshot', 'Freeze the whole hive under a name you can come back to', `${E}/commands/snapshot.queen.ts`],
    ['restore', 'Go back to a named snapshot — its tiles and behaviours become the live hive again', `${E}/commands/restore.queen.ts`],
    ['dropbox', 'Make this location a typed file dropbox (cascades to its subtree)', `${E}/files/dropbox.queen.ts`],
    ['contact', "Enable contact cards for this location's children (cascades to the subtree)", `${E}/contact/contact.queen.ts`],
    ['files', 'Browse files attached to the selected tiles, or every tile in view', `${E}/files/files.queen.ts`],
    ['clear', 'Clear active filter', `${E}/commands/slash-behaviour.drone.ts`],
    ['hive', 'Name any location or signature as a hive — a complete, named branch', `${E}/commands/hive.queen.ts`],
  ] },
  { name: 'input', keyword: 'input', members: [
    ['voice', 'Toggle voice input (speech-to-text)', `${E}/commands/slash-behaviour.drone.ts`],
    ['push-to-talk', 'Toggle push-to-talk mic button', `${E}/commands/slash-behaviour.drone.ts`],
    ['language', 'Switch the UI language', `${E}/commands/language.queen.ts`],
    ['i18n-override', 'Override any UI translation (savvy users)', `${E}/commands/i18n-override.queen.ts`],
  ] },
  { name: 'guidance', keyword: 'guidance', members: [
    ['help', 'Show reference', `${E}/commands/slash-behaviour.drone.ts`],
    ['docs', 'Browse project documentation', `${E}/commands/slash-behaviour.drone.ts`],
    ['tutorial', 'Guided beginner tour with a beeing', `${E}/tutorial/tutorial.queen.ts`],
    ['debug', 'Toggle the Pixi display-tree inspector', `${E}/commands/debug.queen.ts`],
    ['atomize-ui', 'Toggle the atomizer toolbar', `${E}/commands/slash-behaviour.drone.ts`],
  ] },
]

const ROOT = 'behaviors'
const BEHAVIOR = 'behavior'
const KEYWORD_OF = new Map(CATEGORIES.map(c => [c.name, c.keyword]))
const DESC_OF = new Map<string, Entry>()
for (const c of CATEGORIES) for (const m of c.members) DESC_OF.set(`${c.name}/${m[0]}`, m)

type Plan = { segments: string[]; marks: string[]; note?: string; strip?: string[] }

async function readTile(segments: string[]): Promise<{ tags: string[]; notes: number }> {
  const inf = seal(await send({ op: 'inflate', segments }))
  const tags = ((inf?.decorations ?? []) as any[])
    .filter(d => d?.kind === 'tag')
    .map(d => String(d?.payload?.name ?? ''))
    .filter(Boolean)
  const nl = await send({ op: 'note-list', segments })
  return { tags, notes: Array.isArray(nl.data) ? nl.data.length : 0 }
}

async function main(): Promise<void> {
  const root = seal(await send({ op: 'inflate', segments: [ROOT] }))
  if (!root) { console.error('[repair] ABORT: no renderer / no behaviors root'); process.exit(1) }
  const collections = (root.children ?? []).map((c: any) => String(c.name)).filter(Boolean)
  console.log(`[repair] ${collections.length} collections: ${collections.join(', ')}`)

  const plans: Plan[] = []
  const foreign: string[] = []
  const owesNote: string[] = []

  for (const col of collections) {
    const keyword = KEYWORD_OF.get(col)
    const colState = await readTile([ROOT, col])
    if (keyword && !colState.tags.includes(keyword)) plans.push({ segments: [ROOT, col], marks: [keyword] })

    const inf = seal(await send({ op: 'inflate', segments: [ROOT, col] }))
    const tiles = (inf?.children ?? []).map((c: any) => String(c.name)).filter(Boolean)
    for (const tile of tiles) {
      const segments = [ROOT, col, tile]
      const state = await readTile(segments)
      const want = [BEHAVIOR, ...(keyword ? [keyword] : [])]
      const marks = want.filter(w => !state.tags.includes(w))
      const path = segments.join('/')
      const extra = state.tags.filter(t => !want.includes(t))
      const stripping = extra.length > 0 && STRIP.has(path)
      if (extra.length && !stripping) foreign.push(`${path} [${extra.join(', ')}] (--strip ${path} to remove)`)
      const entry = DESC_OF.get(`${col}/${tile}`)
      let note: string | undefined
      if (state.notes === 0) {
        if (entry) note = entry[2] ? `/${entry[0]} — ${entry[1]}\n\nsource: ${entry[2]}` : `/${entry[0]} — ${entry[1]}`
        else owesNote.push(segments.join('/'))
      }
      // Stripping replaces the whole tag set, so the tile's own marks are
      // re-written even when they are already there.
      if (stripping) plans.push({ segments, marks: want, note, strip: extra })
      else if (marks.length || note) plans.push({ segments, marks, note })
      process.stdout.write(`\r[repair] read ${plans.length} planned …            `)
    }
  }
  console.log('')

  const markCount = plans.reduce((n, p) => n + p.marks.length, 0)
  const noteCount = plans.filter(p => p.note).length
  console.log(`[repair] PLAN: ${markCount} marks, ${noteCount} notes across ${plans.length} cells`)
  if (foreign.length) console.log(`[repair] FOREIGN marks (left alone, report only):\n  ${foreign.join('\n  ')}`)
  if (owesNote.length) console.log(`[repair] no census text — still owes a note (${owesNote.length}):\n  ${owesNote.join('\n  ')}`)

  if (!GO) { console.log('[repair] dry run — pass --go to write'); return }

  let ok = 0, fail = 0
  for (let i = 0; i < plans.length; i++) {
    const p = plans[i]
    const label = p.segments.join('/')
    if (p.note) {
      const res = await send({ op: 'note-add', segments: p.segments.slice(0, -1), cell: p.segments[p.segments.length - 1], text: p.note })
      if (res.ok) ok++; else { fail++; console.log(`\n[repair] note FAIL ${label}: ${res.error}`) }
    }
    for (let m = 0; m < p.marks.length; m++) {
      const tag = p.marks[m]
      // The FIRST write of a stripped tile carries replaceKind — it drops every
      // tag decoration on the cell (the foreign ones included). The rest stack
      // normally; replaceKind on those would nuke the sibling mark.
      const replaceKind = p.strip !== undefined && m === 0
      const res = await send({ op: 'decoration-add', segments: p.segments, kind: 'tag', appliesTo: [], payload: { name: tag }, ...(replaceKind ? { replaceKind: true } : {}) })
      if (res.ok) ok++; else { fail++; console.log(`\n[repair] mark FAIL ${label} ← ${tag}: ${res.error}`) }
    }
    if (p.strip) console.log(`\n[repair] stripped ${label} of [${p.strip.join(', ')}] — now wears [${p.marks.join(', ')}]`)
    process.stdout.write(`\r[repair] ${i + 1}/${plans.length} cells · ${ok} writes ok · ${fail} failed        `)
  }
  console.log('')

  process.stdout.write('[repair] build-record over behaviors … ')
  const rec = await send({ op: 'build-record', segments: [ROOT], label: 'behaviors mirror repair — marks + notes re-minted' })
  console.log(rec.ok ? 'ok' : `FAIL: ${rec.error}`)
  console.log(`[repair] DONE — ${ok} writes, ${fail} failed`)
}

main().catch(err => { console.error(err); process.exit(1) })
