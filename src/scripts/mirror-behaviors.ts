// Mirror the behavior census into the hive — the first pass of the PERMANENT
// mirror paradigm: every creation gets tiles + a collection + pheromones +
// notes, built alongside the code. The hive is the living specification.
//
// Structure: `behaviors` at the hive root → one collection tile per category
// (games, views, assistant, swarm, appearance, structure, input, guidance) →
// one tile per behavior. Every write goes through the committer, so the whole
// mirror is revisioned content (layers + history markers) by construction.
//
// Pheromones (kind:'tag' decorations — the SAME primitive /keyword writes):
//   - `behavior` on every behavior tile — the universal mark.
//   - the category keyword on each member AND on the collection tile itself
//     (keyword-the-collection-first doctrine: the pheromones ARE the
//     parameters of the collection; attaching one is what makes a member).
//   Keywords are deliberately declared here — never minted on the fly.
//
// Design rules (same as intel-build-revolucion.ts):
//   1. Cell names pre-normalized (lowercase-hyphen) so bridge `segments`
//      (signed raw) == `children` keys (normalized) — one clean tree.
//   2. Readable text lives in NOTES (free text, not normalized).
//   3. Merge mode: union into existing children, never replace membership.
//   4. Re-run sentinel: aborts if behaviors/guidance already exists —
//      note-add and decoration-add are NOT idempotent.
//   5. Tag decorations are appended WITHOUT replaceKind — replaceKind keeps
//      one-per-kind and would nuke the first tag when adding the second.

import WebSocket from 'ws'

const BRIDGE_PORT = 2401
const TIMEOUT = 60_000

let counter = 0
type BridgeRes = { id: string; ok: boolean; data?: any; error?: string }

function sendOnce(request: Record<string, unknown>): Promise<BridgeRes> {
  return new Promise((resolve, reject) => {
    const msg = { ...request, id: `cli-${Date.now()}-${++counter}` }
    const ws = new WebSocket(`ws://localhost:${BRIDGE_PORT}`)
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

// Mirror of @hypercomb/core normalizeCell so segments == children keys.
function norm(s: string): string {
  return s.trim().toLocaleLowerCase()
    .replace(/[._\s]+/g, '-')
    .replace(/[^\p{L}\p{N}\-]/gu, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64)
    .replace(/-$/, '')
}

// ── the census ──────────────────────────────────────────────────────
// name → [description, source file] — descriptions from the i18n catalog
// (hypercomb-shared/i18n/en.json slash.* keys), sources from essentials.

type Entry = [name: string, desc: string, source?: string]

const E = 'hypercomb-essentials/src/diamondcoreprocessor.com'

interface Category { name: string; keyword: string; color: string; note: string; members: Entry[] }

const CATEGORIES: Category[] = [
  {
    name: 'games', keyword: 'game', color: '#c05b4d',
    note: 'Playable creations. Each game is a behaviour toggled on a tile area, follows the 5-file overlay pattern, and ships a level designer where noted.',
    members: [
      ['arkanoid', 'Arkanoid — bounce the ball off the paddle to break every brick, catch power pills + level designer; on | off | design', `${E}/games/arkanoid/arkanoid.queen.ts`],
      ['bubble', 'Bubble Bobble — blow bubbles to trap foes, pop them for fruit + level designer; on | off | design', `${E}/games/bubble/bubble.queen.ts`],
      ['roper', 'Roper — turn-based Worms-style artillery with a ninja rope; on | off', `${E}/games/roper/roper.queen.ts`],
      ['solomon', "Solomon's Key — block-conjuring puzzle game + level designer; on | off | design", `${E}/games/solomon/solomon.queen.ts`],
    ],
  },
  {
    name: 'views', keyword: 'view', color: '#4d7fae',
    note: 'Ways of seeing the same tiles. A view behaviour re-renders an area — hexagons, website, tree, slides, study games — without changing the data.',
    members: [
      ['tree', 'Sideways tree — draw a branch as a mind map: trunk on the left, one column per ring, any signature as the root', `${E}/commands/tree.queen.ts`],
      ['present', "Present view — play this area's diagram tiles as slides; on | off | here | slide", `${E}/commands/present.queen.ts`],
      ['website', 'Toggle website view, export subtree, or build pages via Claude', `${E}/commands/website.queen.ts`],
      ['view', 'Toggle between hexagons and website rendering', `${E}/commands/view.queen.ts`],
      ['home', 'Home view — render this tile area as your home; on | off | here', `${E}/commands/home.queen.ts`],
      ['lightbox', "Lightbox — show this tile's pictures full screen", `${E}/commands/lightbox.queen.ts`],
      ['tutor', 'Study games — turn this hive into spaced-repetition games; on | off | here | build | list', `${E}/tutorial/tutor.queen.ts`],
      ['mobile', 'Mobile viewer: on, off, auto, or sweep to mark tiles', `${E}/commands/mobile.queen.ts`],
      ['screensaver', 'Idle screensaver on/off + style; on | off | now | hexagon | circle | thought', `${E}/presentation/screensaver/screensaver.queen.ts`],
      ['tags', 'Open the tag view', `${E}/commands/tags-view.queen.ts`],
      ['history', 'Toggle the history panel', `${E}/commands/history.queen.ts`],
      ['revise', 'Toggle revision mode (history clock)', `${E}/history/revise.queen.ts`],
    ],
  },
  {
    name: 'assistant', keyword: 'assistant', color: '#8a63c9',
    note: 'AI woven into the hive. Asks stream through the bridge or the host AI tier; answers land as notes and tiles, never loose text.',
    members: [
      ['opus', 'Send context to Claude Opus 5', `${E}/assistant/llm.queen.ts`],
      ['sonnet', 'Send context to Claude Sonnet 5', `${E}/assistant/llm.queen.ts`],
      ['haiku', 'Send context to Claude Haiku', `${E}/assistant/llm.queen.ts`],
      ['fable', 'Send context to Claude Fable 5', `${E}/assistant/llm.queen.ts`],
      ['ask', 'Ask the host AI — immediate streamed answer', `${E}/commands/ask.queen.ts`],
      ['chat', 'Multi-turn conversation with Claude — creates thread tiles with Q&A children', `${E}/assistant/conversation.queen.ts`],
      ['expand', 'Expand selected tiles into constituent parts via Claude Haiku', `${E}/commands/slash-behaviour.drone.ts`],
      ['record', 'Start AI-powered meeting recording with live hierarchy compilation', `${E}/recording/recording.queen.ts`],
      ['translate-sweep', 'Batch-translate all tiles (dry-run by default; add --go to execute)', `${E}/commands/translate-sweep.queen.ts`],
      ['workflow', 'Design a workflow out of tiles — one step per tile — and run it', `${E}/workflow/workflow.queen.ts`],
    ],
  },
  {
    name: 'swarm', keyword: 'swarm', color: '#4f9d6e',
    note: 'The breathing mesh — peers, relays, hosting, and meeting places. Sharing is always deliberate; nothing auto-publishes.',
    members: [
      ['observe', 'Observe the swarm — who is here and what they share', `${E}/commands/slash-behaviour.drone.ts`],
      ['domain', 'Add, remove, or list mesh relay domains', `${E}/commands/domain.queen.ts`],
      ['block-peer', 'Block a peer by pubkey prefix and drop their tiles locally', `${E}/sharing/mesh-block.queen.ts`],
      ['clear-mesh', 'Wipe the relay event store and drop peer caches', `${E}/sharing/mesh-clear.queen.ts`],
      ['repush', 'Re-push shared content to your host and report holes', `${E}/sharing/repush.queen.ts`],
      ['host', 'Host the current branch as a static hive and copy a shareable preview link', `${E}/sharing/host.queen.ts`],
      ['invite', 'Create a meeting-place invite and copy a shareable link', `${E}/sharing/invite.queen.ts`],
      ['meeting', 'Start or join a video meeting on the selected tile', `${E}/meeting/meeting.queen.ts`],
    ],
  },
  {
    name: 'appearance', keyword: 'appearance', color: '#b06a9e',
    note: 'How tiles and the canvas look — accents, borders, backdrops, substrates, themes. Cold, clean chrome; the content carries the color.',
    members: [
      ['accent', 'Set the hover accent color by name', `${E}/commands/accent.queen.ts`],
      ['canvas', 'Choose the screen backdrop (hex dots, honeycomb, depth, …)', `${E}/commands/canvas.queen.ts`],
      ['backgrounds', 'View or toggle which default background images are available', `${E}/substrate/backgrounds.queen.ts`],
      ['substrate', 'Toggle default background images for new tiles', `${E}/substrate/substrate.queen.ts`],
      ['reroll', 'Reroll substrate background images on tiles', `${E}/substrate/reroll.queen.ts`],
      ['theme', 'Switch the UI theme (light, dark, system)', `${E}/commands/theme.queen.ts`],
      ['header', 'Set the header size (1 = small, 2 = medium, 3 = large)'],
      ['format', 'Copy visual formatting from the active tile', `${E}/format/format.queen.ts`],
      ['text-only', 'Toggle text-only mode (hide images)', `${E}/commands/slash-behaviour.drone.ts`],
    ],
  },
  {
    name: 'structure', keyword: 'structure', color: '#8b909a',
    note: 'Shaping the tree itself — naming, moving, snapshotting, referencing, keywording. These behaviours write layers; every change is one revision.',
    members: [
      ['keyword', 'Add or remove keywords (tags) on selected tiles — the pheromone painter of the command line', `${E}/commands/keyword.queen.ts`],
      ['remove', 'Remove tiles from the current directory (a built-in selection variant exists as remove-builtin)', `${E}/commands/remove.queen.ts`],
      ['move', 'Toggle move mode for drag-reordering tiles', `${E}/commands/slash-behaviour.drone.ts`],
      ['arrange', 'Toggle icon arrangement mode on the tile overlay', `${E}/commands/arrange.queen.ts`],
      ['sequence', 'Set the drop-target order new tiles fill', `${E}/sequence/sequence.queen.ts`],
      ['layout', 'Save, apply, list, or remove layout templates', `${E}/move/layout.queen.ts`],
      ['title', "Set a tile's display name without moving it — the name IS the address; the title is a decoration", `${E}/commands/title.queen.ts`],
      ['reference', 'Drop a reference tile here — a live pointer to another location; /reference <path>', `${E}/commands/reference.queen.ts`],
      ['into', 'File the selection away — move the selected tiles INSIDE another tile, so they leave the page they were on; /into <cell> or /into <path>/<cell>. Custody, where /reference is only a doorway. The Organizer\'s Move button and Ctrl+drag onto a tile are the same act through other doors', `${E}/commands/into.queen.ts`],
      ['snapshot', 'Freeze the whole hive under a name you can come back to', `${E}/commands/snapshot.queen.ts`],
      ['restore', 'Go back to a named snapshot — its tiles and behaviours become the live hive again', `${E}/commands/restore.queen.ts`],
      ['dropbox', 'Make this location a typed file dropbox (cascades to its subtree)', `${E}/files/dropbox.queen.ts`],
      ['contact', "Enable contact cards for this location's children (cascades to the subtree)", `${E}/contact/contact.queen.ts`],
      ['files', 'Browse files attached to the selected tiles, or every tile in view', `${E}/files/files.queen.ts`],
      ['clear', 'Clear active filter', `${E}/commands/slash-behaviour.drone.ts`],
      ['hive', 'Name any location or signature as a hive — a complete, named branch', `${E}/commands/hive.queen.ts`],
    ],
  },
  {
    name: 'input', keyword: 'input', color: '#579fa5',
    note: 'How words get in — voice, push-to-talk, and the language the interface speaks.',
    members: [
      ['voice', 'Toggle voice input (speech-to-text)', `${E}/commands/slash-behaviour.drone.ts`],
      ['push-to-talk', 'Toggle push-to-talk mic button', `${E}/commands/slash-behaviour.drone.ts`],
      ['language', 'Switch the UI language', `${E}/commands/language.queen.ts`],
      ['i18n-override', 'Override any UI translation (savvy users)', `${E}/commands/i18n-override.queen.ts`],
    ],
  },
  {
    name: 'guidance', keyword: 'guidance', color: '#c98f2f',
    note: 'Learning the hive — help, docs, the guided tour, and the inspectors that show what the engine is doing.',
    members: [
      ['help', 'Show reference', `${E}/commands/slash-behaviour.drone.ts`],
      ['docs', 'Browse project documentation', `${E}/commands/slash-behaviour.drone.ts`],
      ['tutorial', 'Guided beginner tour with a beeing', `${E}/tutorial/tutorial.queen.ts`],
      ['debug', 'Toggle the Pixi display-tree inspector', `${E}/commands/debug.queen.ts`],
      ['atomize-ui', 'Toggle the atomizer toolbar', `${E}/commands/slash-behaviour.drone.ts`],
    ],
  },
]

const ROOT_KEY = norm('behaviors')
const BEHAVIOR_KEYWORD = 'behavior'
const BEHAVIOR_COLOR = '#d9a514'
const SENTINEL = 'guidance' // exists only once this build has run

const ROOT_NOTES = [
  'The mirror of every behaviour that ships in the code — one tile per creation, grouped into collections, marked with pheromones, explained in notes. Built alongside the code, permanently: the hive is the living specification.',
  'Every tile here carries the `behavior` keyword; each collection carries its own keyword (game, view, assistant, swarm, appearance, structure, input, guidance). The pheromones are the parameters of the collections — paint the same keyword anywhere to grow them.',
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
    console.log(`[mirror] preflight ${i}/${attempts} — bridge not ready (${inf.error}), retrying...`)
    await new Promise(r => setTimeout(r, 3000))
  }
  return undefined
}

async function main(): Promise<void> {
  const pre = await preflight(5)
  if (!pre) {
    console.error('[mirror] ABORT: no renderer. Open the app on localhost with ?claudeBridge=1, then re-run.')
    process.exit(1)
  }
  console.log(`[mirror] live root "${pre.rootName}" holds: ${pre.topNames.join(', ') || '(none)'}`)

  // Merge mode + re-run sentinel.
  const existingChildren = new Map<string, string[]>()
  if (pre.topNames.includes(ROOT_KEY)) {
    const ex = await send({ op: 'inflate', segments: [ROOT_KEY] })
    if (!ex.ok) {
      console.error(`[mirror] ABORT: cannot inflate existing "${ROOT_KEY}": ${ex.error}`)
      process.exit(1)
    }
    const walkEx = (node: any, path: string[]): void => {
      const kids = Array.isArray(node?.children) ? node.children : []
      existingChildren.set(path.join('/'), kids.map((k: any) => String(k?.name ?? '')).filter(Boolean))
      for (const k of kids) if (k?.name) walkEx(k, [...path, String(k.name)])
    }
    walkEx(ex.data, [ROOT_KEY])
    if ((existingChildren.get(ROOT_KEY) ?? []).includes(SENTINEL)) {
      console.warn(`[mirror] ABORT: mirror already built (${SENTINEL} present) — re-run would duplicate notes + tags.`)
      process.exit(1)
    }
    console.log(`[mirror] merging into existing tree: ${(existingChildren.get(ROOT_KEY) ?? []).join(', ')}`)
  }

  const totalMembers = CATEGORIES.reduce((n, c) => n + c.members.length, 0)
  console.log(`[mirror] plan: ${CATEGORIES.length} collections, ${totalMembers} behavior tiles under "${ROOT_KEY}"`)

  if (!pre.topNames.includes(ROOT_KEY)) {
    const nextRoot = [...pre.topNames, ROOT_KEY]
    process.stdout.write(`[mirror] root layer ← [${nextRoot.join(', ')}] ... `)
    const rootRes = await send({ op: 'update', segments: [], layer: { name: pre.rootName, children: nextRoot } })
    console.log(rootRes.ok ? 'ok' : `FAIL: ${rootRes.error}`)
    if (!rootRes.ok) process.exit(1)
  }

  // Phase 1: structure — behaviors cell, category collections, member tiles.
  let okStruct = 0, failStruct = 0
  const structure: { segments: string[]; name: string; children: string[] }[] = [
    { segments: [ROOT_KEY], name: ROOT_KEY, children: CATEGORIES.map(c => norm(c.name)) },
    ...CATEGORIES.map(c => ({
      segments: [ROOT_KEY, norm(c.name)], name: norm(c.name), children: c.members.map(m => norm(m[0])),
    })),
    ...CATEGORIES.flatMap(c => c.members.map(m => ({
      segments: [ROOT_KEY, norm(c.name), norm(m[0])], name: norm(m[0]), children: [] as string[],
    }))),
  ]
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
  console.log(`[mirror] phase 1 structure: ${okStruct} ok, ${failStruct} failed`)

  // Phase 2: notes — explanation + source pointer on every tile.
  const notes: { segments: string[]; text: string }[] = []
  for (const n of ROOT_NOTES) notes.push({ segments: [ROOT_KEY], text: n })
  for (const c of CATEGORIES) {
    notes.push({ segments: [ROOT_KEY, norm(c.name)], text: `${c.note}\n\nCollection keyword: ${c.keyword} — painting this keyword on any tile makes it a member.` })
    for (const [name, desc, source] of c.members) {
      const text = source ? `/${name} — ${desc}\n\nsource: ${source}` : `/${name} — ${desc}`
      notes.push({ segments: [ROOT_KEY, norm(c.name), norm(name)], text })
    }
  }
  let okNotes = 0, failNotes = 0
  for (let i = 0; i < notes.length; i++) {
    const n = notes[i]
    const parentSegments = n.segments.slice(0, -1)
    const cellLabel = n.segments[n.segments.length - 1]
    process.stdout.write(`[note ${i + 1}/${notes.length}] ${n.segments.join('/')} ... `)
    const res = await send({ op: 'note-add', segments: parentSegments, cell: cellLabel, text: n.text })
    if (res.ok) { okNotes++; console.log('ok') }
    else { failNotes++; console.log(`FAIL: ${res.error}`) }
  }
  console.log(`[mirror] phase 2 notes: ${okNotes} ok, ${failNotes} failed`)

  // Phase 3: pheromones — kind:'tag' decorations (same shape DecorationService
  // addTag writes: appliesTo [], payload { name }). NO replaceKind — tags
  // stack; replaceKind would drop the first tag when the second lands.
  const marks: { segments: string[]; tag: string }[] = []
  marks.push({ segments: [ROOT_KEY], tag: BEHAVIOR_KEYWORD })
  for (const c of CATEGORIES) {
    marks.push({ segments: [ROOT_KEY, norm(c.name)], tag: c.keyword })
    for (const [name] of c.members) {
      const seg = [ROOT_KEY, norm(c.name), norm(name)]
      marks.push({ segments: seg, tag: BEHAVIOR_KEYWORD })
      marks.push({ segments: seg, tag: c.keyword })
    }
  }
  let okMarks = 0, failMarks = 0
  for (let i = 0; i < marks.length; i++) {
    const m = marks[i]
    process.stdout.write(`[mark ${i + 1}/${marks.length}] ${m.segments.join('/')} ← ${m.tag} ... `)
    const res = await send({
      op: 'decoration-add', segments: m.segments, kind: 'tag',
      appliesTo: [], payload: { name: m.tag },
    })
    if (res.ok) { okMarks++; console.log('ok') }
    else { failMarks++; console.log(`FAIL: ${res.error}`) }
  }
  console.log(`[mirror] phase 3 pheromones: ${okMarks} ok, ${failMarks} failed`)

  // Phase 4: register the vocabulary (colors + intellisense) in the global
  // TagRegistry via /keyword with NO selection — registry-only, no tile writes.
  // Then neutralize the sticky submit replay so a reload doesn't re-run it.
  const vocab = [
    `${BEHAVIOR_KEYWORD}(${BEHAVIOR_COLOR})`,
    ...CATEGORIES.map(c => `${c.keyword}(${c.color})`),
  ]
  process.stdout.write(`[mirror] registering vocabulary: ${vocab.join(', ')} ... `)
  const reg = await send({ op: 'submit', text: `/keyword [${vocab.join(', ')}]` })
  console.log(reg.ok ? 'ok' : `FAIL: ${reg.error}`)
  await send({ op: 'submit', text: '' }) // neutralize replay

  console.log(`[mirror] DONE — ${okStruct} cells, ${okNotes} notes, ${okMarks} pheromone marks under "${ROOT_KEY}"`)
  const failed = failStruct + failNotes + failMarks
  if (failed > 0) console.warn(`[mirror] ${failed} operations failed — review the log above.`)
}

main().catch(err => { console.error(err); process.exit(1) })
