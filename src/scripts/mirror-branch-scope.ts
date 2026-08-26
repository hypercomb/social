// Mirror pass for BRANCH SCOPE — a view's entrance reaching a whole branch,
// and the tree becoming the first view outside websites to use it.
//
// Follows the established mirror shape exactly (mirror-behaviors.ts built the
// `behaviors` root and its collections; mirror-site-versions.ts is the closest
// sibling). This creation is a view-side capability, so it lands as a
// behaviour under the EXISTING `views` collection:
//
//   behaviors/views/branch-scope            ← the creation (keywords: behavior, view)
//   behaviors/views/branch-scope/<part>     ← one tile per implementation file (part)
//
// Nothing new is minted: `behavior`, `view` and `part` are the declared
// vocabulary from the earlier passes, and `views` is an existing collection.
//
// It ALSO does the thing it describes: it marks the `behaviors` root with
// `visual:tree:branch`, which is what puts the tree's icon in the rail for
// every cell inside `behaviors`. That mark is the whole install — there is no
// behaviors-specific code anywhere, and any other branch becomes tree-readable
// by carrying the same mark (`name@tree` from the command line).
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
const BEHAVIOR = norm('branch-scope')

const BEHAVIOR_KEYWORD = 'behavior'
const VIEW_KEYWORD = 'view'
const PART_KEYWORD = 'part'

/** The mark that makes a branch tree-readable — and the reason the tree's
 *  icon shows up anywhere inside `behaviors`. */
const TREE_SCOPE_KIND = 'visual:tree:branch'

const BEHAVIOR_NOTES = [
  'How far a view\'s ENTRANCE reaches. A view used to be offered only on the cell that carried its content — stand one step deeper and the icon was gone. A view may now declare `scope: \'branch\'`, and its entrance is offered on the cell that carries it AND everywhere beneath it: the rail walks the lineage outermost-first, and the first ancestor carrying the feature is the scope root.',
  'The reach is declared on a TILE, never in code. Marking a cell is the whole install, so any branch becomes readable as a tree by carrying `visual:tree:branch` — `name@tree` from the command line writes it. There is no behaviors-specific code path; `behaviors` is simply the first branch to be marked. This is why the walk was generalised instead of a second special case being added: it used to run only for `view === \'website\'`, which put the classification in a source file rather than on a tile.',
  'Strict prefixes only. Standing on the PARENT of a scope root — where the marked tile merely sits as one child among many — does not match, so the icon appears when you go IN and drops when you step back out. That is what makes it read as "you are inside this thing" rather than "this thing exists nearby".',
  'The tree is the first view to use it. `/tree` had no icon at all: the only way in was to know the command. It is now a declared view like any other, so inside a marked branch the rail carries it — click to open the tree, click again to close.',
]

type Part = [file: string, role: string]

const PARTS: Part[] = [
  ['hypercomb-essentials/src/diamondcoreprocessor.com/commands/visual-bee-registry.ts',
   'the declaration — `scope: \'branch\' | \'node\'` on the view descriptor, the one field that says how far this view\'s entrance reaches from the cell that carries it'],
  ['hypercomb-essentials/src/diamondcoreprocessor.com/commands/view.bee.ts',
   'the walk — recomputes the rail on every navigation, and for a branch-scoped view probes the strict prefixes of the current path outermost-first until it finds the scope root; also widens the hidden-pool gate to hide by branch'],
  ['hypercomb-essentials/src/diamondcoreprocessor.com/commands/tree.queen.ts',
   'the tree declaring itself a view — icon, label, and `scope: \'branch\'`, so a marked branch gets an entrance instead of the slash command being the only way in'],
  ['hypercomb-essentials/src/diamondcoreprocessor.com/commands/website.queen.ts',
   'the site declaring the scope it always had — the reach that used to be hardcoded to the website view is now the site asking for it, on the same footing as everything else'],
  ['hypercomb-shared/ui/command-shell/command-shell.element.ts',
   'the rail — draws whatever the walk offers, one button per available view; it has never known what any of them are'],
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

/** Write the branch-scope mark itself — the thing this creation is about. */
async function markTreeScope(segments: string[]): Promise<'written' | 'present' | 'failed'> {
  const before = await send({ op: 'layer-at', segments })
  if (before.ok && ((before.data?.decorations ?? []) as string[]).includes(decorationSig(TREE_SCOPE_KIND, {}))) {
    return 'present'
  }
  const res = await sendRetry(
    { op: 'decoration-add', segments, kind: TREE_SCOPE_KIND, appliesTo: [], payload: {} },
    async () => {
      const check = await send({ op: 'layer-at', segments })
      const decs = (check.data?.decorations ?? []) as string[]
      return check.ok && decs.includes(decorationSig(TREE_SCOPE_KIND, {}))
    },
  )
  return res.ok ? 'written' : 'failed'
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
    console.error(`[branch-scope] ABORT: cannot read "${ROOT_KEY}/${COLLECTION}" (${inf.error}). Open the hive with ?claudeBridge=1 and ensure the behaviors mirror is built.`)
    process.exit(1)
  }

  const siblings = ((inf.data?.children ?? []) as any[]).map(c => String(c?.name ?? '')).filter(Boolean)
  console.log(`[branch-scope] "${COLLECTION}" holds: ${siblings.join(', ') || '(none)'}`)

  // The behaviour tile, gathered into the existing collection.
  const merged = siblings.includes(BEHAVIOR) ? siblings : [...siblings, BEHAVIOR]
  process.stdout.write(`[branch-scope] ${ROOT_KEY}/${COLLECTION} ← ${merged.length} children ... `)
  const up = await sendRetry({ op: 'update', segments: [ROOT_KEY, COLLECTION], layer: { name: COLLECTION, children: merged } })
  console.log(up.ok ? 'ok' : `FAIL: ${up.error}`)
  if (!up.ok) process.exit(1)

  process.stdout.write(`[branch-scope] ${behaviorSeg.join('/')} ... `)
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
    console.log(`[branch-scope] ${behaviorSeg.join('/')} already noted — skipping notes + marks`)
  }

  // The parts.
  const partKeys = PARTS.map(([file]) => norm(file.split('/').pop()!.replace(/\.(ts|html)$/, '')))
  process.stdout.write(`[branch-scope] ${behaviorSeg.join('/')} ← ${partKeys.length} parts ... `)
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

  // ── the mark this creation exists for ──────────────────────────────
  // `behaviors` becomes a tree-readable branch. Everything inside it now
  // carries the tree's entrance in the rail. No code knows the word
  // "behaviors" — this one decoration is the whole install.
  process.stdout.write(`[scope] /${ROOT_KEY} ← ${TREE_SCOPE_KIND} ... `)
  const scoped = await markTreeScope([ROOT_KEY])
  console.log(scoped === 'present' ? 'ok (already marked)' : scoped)
  if (scoped === 'failed') failed++

  console.log(`[branch-scope] DONE — ${created} parts written, ${skipped} already present, ${failed} failed`)
  if (failed > 0) process.exitCode = 1
}

main().catch(err => { console.error(err); process.exit(1) })
