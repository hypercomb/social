// Mirror pass for PROMOTE-TO-LIST — turning one note into a list of points
// and notes, in place, on demand.
//
// A note documents ONE thing, individually — never a relationship between
// things, which is what pheromones and references are for. That semantic is
// what gives the notes tree its two kinds: a CONSTRAINED row says its one
// thing in a line (a POINT, the structure of a document), and a PROSE row is
// the longer form hanging under a point (a NOTE, its body). Both are the same
// node; the mark's role decides which, so nothing is hardcoded per-kind.
//
// Promote is the gesture that gets you from one to the other. It is NOT a
// migration: nothing sweeps the hive, no existing note is rewritten behind
// the user's back. One note, chosen deliberately, becomes a list — and the
// promote is refused unless the head plus the parts still contain every word
// the note said, so the words are redistributed, never invented.
//
// Structure (mirror-paradigm.md — tiles + collection + pheromones + notes):
//
//   behaviors/structure/promote-to-list          marked `behavior` `structure`
//   ├── note-tree              part — the tree algebra; splitInTree
//   ├── note-tree-spec         part — the spec that caught the dead invariant
//   ├── notes-drone            part — splitAtSegments + the note:split handler
//   ├── note-marks-store       part — the prose role and the two kinds
//   ├── notes-strip-rail       part — the rail grouped by kind
//   └── bridge-note-ops        part — note-add mark passthrough + note-split
//
// Merge mode + idempotent, same as every other pass: a children slot is
// REPLACED wholesale, so the collection's members are UNIONED rather than
// written from this script's view of them; note and mark presence is checked
// before writing because note-add and decoration-add are not idempotent.
//
// Unlike mirror-notes-dock-drag.ts this pass CREATES the collection when it is
// missing instead of aborting, so it lands on a fresh hive as well as one that
// already carries the behaviors mirror. It says which it did.

import { createHash } from 'node:crypto'
import WebSocket from 'ws'

const BRIDGE_PORT = 2401
// Renderer ops can take minutes right after a commit burst (the optimize pass
// holds the queue) — a short timeout misreads that as a hang.
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

/** Idempotent ops just retry; non-idempotent ones verify whether they actually
 *  landed first, so a lost response never becomes a duplicate write. */
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

/** `update` normalizes `children` names but signs `segments` RAW — pre-normalize
 *  every name so segments === children keys and the tree cannot fork. */
function norm(s: string): string {
  return s.trim().toLocaleLowerCase()
    .replace(/[._\s/]+/g, '-')
    .replace(/[^\p{L}\p{N}\-]/gu, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64)
    .replace(/-$/, '')
}

const decorationSig = (name: string): string => createHash('sha256')
  .update(JSON.stringify({ kind: 'tag', appliesTo: [], payload: { name } }))
  .digest('hex')

// ── vocabulary ──────────────────────────────────────────────────────
// Declared, never minted on the fly. All three already exist: `behavior` and
// `structure` from mirror-behaviors.ts, `part` from mirror-behavior-parts.ts.
const BEHAVIOR_KEYWORD = 'behavior'
const STRUCTURE_KEYWORD = 'structure'
const PART_KEYWORD = 'part'

const ROOT = norm('behaviors')
const COLLECTION = norm('structure')
const MEMBER = norm('promote-to-list')

interface Cell { key: string; note: string; marks: string[]; parts?: Cell[] }

const CREATION: Cell = {
  key: MEMBER,
  marks: [BEHAVIOR_KEYWORD, STRUCTURE_KEYWORD],
  note: [
    'promote-to-list — one note becomes a list, in place, when you ask.',
    '',
    'A note says one thing about the tile it is on. When it turns out to be saying',
    'several, promoting it splits it: the first clause becomes the head, and what',
    'follows becomes sub-notes hanging under it. The note keeps its position in the',
    'list, its mark, and any children it already had — the new parts land ahead of',
    'them rather than replacing them.',
    '',
    'It is not a migration. Nothing sweeps the hive and nothing rewrites a note',
    'behind your back; you promote the one note you are looking at. The whole split',
    'is ONE layer no matter how many parts it produces, so undo takes it back in a',
    'single step and history stays readable.',
    '',
    'The invariant that makes it safe: promote REDISTRIBUTES the words, it never',
    'rewrites them. Every word in the original still appears in the head or in a',
    'part — a proposal that would lose any is refused. The model chooses where the',
    'cuts go, never what the text says.',
    '',
    'Refusals leave the tree untouched and mint no layer: a blank head (a head is',
    'extracted from the note, never invented), no usable parts (retitling is an',
    'edit, not a split), or a note that is not in this cell.',
  ].join('\n'),
  parts: [
    {
      key: 'note-tree',
      marks: [PART_KEYWORD],
      note: [
        'note-tree.ts — the tree algebra. Pure, storage-free, no ioc.',
        '',
        'Holds splitInTree alongside the walkers that already existed (remove, insert,',
        'set-mark, subtree-contains) and the value normalizers that decide what a shape',
        'and a mark are allowed to be.',
        '',
        'It lives apart from notes.drone.ts because that module instantiates NotesService',
        'and registers it into window.ioc at import time — importing it from a spec boots',
        'a service. These functions take a tree and return a new tree.',
        '',
        'Every walk is immutable AND returns its INPUT array when no descendant changed,',
        'so an untouched branch comes back as the same object. The caller re-materializes',
        'the whole tree from the leaves up; a branch it can recognise as untouched dedups',
        'back to its existing signature and writes no new bytes.',
      ].join('\n'),
    },
    {
      key: 'note-tree-spec',
      marks: [PART_KEYWORD],
      note: [
        'note-tree.spec.ts — twelve tests over the split, and the one that found a bug.',
        '',
        'Covers position/mark/shape survival, splitting at any depth, parts prepending to',
        'existing children, mark normalization on parts, trimming, and each of the three',
        'refusals returning the ORIGINAL tree by reference so the caller mints no layer.',
        '',
        'The reference-identity test failed first time. walk() built a fresh array on',
        'every call, so the `newChildren !== n.children` check in remove, insert and',
        'set-mark could never fire — every node was cloned on every nest, un-nest and',
        'mark. Harmless, because content-addressing dedups at write time, but the',
        'invariant was dead code. Fixed in all four walkers rather than weakening the',
        'test.',
      ].join('\n'),
    },
    {
      key: 'notes-drone',
      marks: [PART_KEYWORD],
      note: [
        'notes.drone.ts — splitAtSegments, and the note:split effect beside it.',
        '',
        'Reads the cell tree, transforms it purely, re-materializes from the leaves up,',
        'and commits ONCE — the same shape as the mark and move flows. One layer for the',
        'whole split.',
        '',
        'In place is the point. Expressed with the existing add / nest / delete calls a',
        'split would cost one layer per part plus one for the delete, lose the note its',
        'position, and drop its mark. That history is unreadable in bulk, which is what',
        'made a separate primitive worth having.',
      ].join('\n'),
    },
    {
      key: 'note-marks-store',
      marks: [PART_KEYWORD],
      note: [
        'note-marks.store.ts — the third role, and the two kinds.',
        '',
        'A mark was already { icon, name, role } with the role on the MARK, not the note,',
        'so re-roling an icon restyles every note carrying it. The roles were `heading`',
        'and `list` — and both of those are constrained, one-line roles. There was no',
        'role for prose.',
        '',
        'Adding `prose` is the whole schema change. heading + list make a POINT, prose',
        'makes a NOTE, and kindOfRole() maps the three onto the two. Views group and',
        'filter on the kind; nothing anywhere holds a list of which icons are points.',
        '',
        'The palette carries a `seeded` flag so a deleted mark never grows back. That',
        'would have left every existing hive with no prose mark at all — the note kind',
        'empty on exactly the hives that use notes most. A separate one-time `prosed`',
        'flag tops one up, and being separate means deleting it still keeps it deleted.',
      ].join('\n'),
    },
    {
      key: 'notes-strip-rail',
      marks: [PART_KEYWORD],
      note: [
        'notes-strip — the rail grouped by kind.',
        '',
        'The rail was a flat strip of the participant\'s icons. It is now two groups,',
        'points then notes, derived from each mark\'s role rather than any list of icon',
        'names here — re-role an icon and it moves groups immediately.',
        '',
        'Empty groups drop out and the kind labels only appear once both kinds exist, so',
        'a palette with one kind looks exactly as it did before the kind existed. Prose',
        'marks paint lighter, the inverse of the existing heavier heading weight, which',
        'puts structure at one end of the rail and body text at the other.',
        '',
        'The palette editor gains a third role button; its segmented control lost a pixel',
        'of padding to make room, taken from the buttons rather than the name input.',
      ].join('\n'),
    },
    {
      key: 'bridge-note-ops',
      marks: [PART_KEYWORD],
      note: [
        'claude-bridge.worker.ts — note-add carries a mark, and note-split promotes.',
        '',
        'note-add took only text, so nothing could author a point or a note headlessly.',
        'It now passes an optional icon straight through; NotesService normalizes it, so',
        'a malformed mark degrades to an unmarked note rather than failing the write.',
        'The op classifies nothing itself — the role is on the palette entry.',
        '',
        'note-split is promote over the wire: sig, head, parts (plain strings or',
        '{text, mark}). It returns the note\'s NEW signature, because the split rewrote',
        'its bytes and the caller\'s id is stale the moment the op resolves — without it',
        'a caller walking a list would have to re-read the whole cell to keep going.',
      ].join('\n'),
    },
  ],
}

let okCells = 0, okNotes = 0, okMarks = 0, skipped = 0, failed = 0

async function noted(segments: string[], text: string): Promise<boolean> {
  const check = await send({ op: 'note-list', segments })
  if (!check.ok) return false
  const first = String(text.split('\n')[0] ?? '')
  return ((check.data ?? []) as any[]).some(n => String(n?.text ?? '').startsWith(first))
}

async function marked(segments: string[], name: string): Promise<boolean> {
  const check = await send({ op: 'layer-at', segments })
  const decs = (check.data?.decorations ?? []) as string[]
  return check.ok && decs.includes(decorationSig(name))
}

async function writeNote(segments: string[], text: string): Promise<void> {
  if (await noted(segments, text)) { skipped++; console.log('    note: already present'); return }
  const res = await sendRetry(
    { op: 'note-add', segments: segments.slice(0, -1), cell: segments[segments.length - 1], text },
    () => noted(segments, text),
  )
  if (res.ok) { okNotes++; console.log('    note: ok') } else { failed++; console.log(`    note: FAIL ${res.error}`) }
}

async function writeMark(segments: string[], name: string): Promise<void> {
  if (await marked(segments, name)) { skipped++; console.log(`    mark ${name}: already present`); return }
  // NO replaceKind — it would nuke the sibling tags on the same tile.
  const res = await sendRetry(
    { op: 'decoration-add', segments, kind: 'tag', appliesTo: [], payload: { name } },
    () => marked(segments, name),
  )
  if (res.ok) { okMarks++; console.log(`    mark ${name}: ok`) } else { failed++; console.log(`    mark ${name}: FAIL ${res.error}`) }
}

async function writeCell(segments: string[], cell: Cell): Promise<void> {
  const children = (cell.parts ?? []).map(p => norm(p.key))
  console.log(`  ${segments.join('/')}${children.length ? ` ← ${children.length} parts` : ''}`)
  const layer: Record<string, unknown> = { name: norm(cell.key) }
  if (children.length) layer.children = children
  const res = await sendRetry({ op: 'update', segments, layer })
  if (!res.ok) { failed++; console.log(`    cell: FAIL ${res.error}`); return }
  okCells++
  await writeNote(segments, cell.note)
  for (const m of cell.marks) await writeMark(segments, m)
  for (const p of cell.parts ?? []) await writeCell([...segments, norm(p.key)], p)
}

/** Members of `segments`, or null when the tile does not exist yet. Used to
 *  tell "union into an existing collection" from "create the chain". */
async function membersOf(segments: string[]): Promise<string[] | null> {
  const res = await send({ op: 'inflate', segments }).catch(() => ({ ok: false as const, data: undefined }))
  if (!res.ok) return null
  return ((res.data?.children ?? []) as any[]).map(k => String(k?.name ?? '')).filter(Boolean)
}

async function main(): Promise<void> {
  const rootMembers = await membersOf([ROOT])
  const collMembers = await membersOf([ROOT, COLLECTION])

  if (collMembers === null) {
    console.log(`[note-lists] "${ROOT}/${COLLECTION}" absent — creating the chain (fresh hive).`)
  } else {
    console.log(`[note-lists] existing members of ${COLLECTION}: ${collMembers.join(', ') || '(none)'}`)
  }

  // Union, never replace — a children slot is REPLACED wholesale, so writing a
  // partial list would drop every sibling collection / member already there.
  const rootNext = (rootMembers ?? []).includes(COLLECTION)
    ? rootMembers!
    : [...(rootMembers ?? []), COLLECTION]
  process.stdout.write(`[note-lists] ${ROOT} ← ${rootNext.length} collections ... `)
  const rootUp = await sendRetry({ op: 'update', segments: [ROOT], layer: { name: ROOT, children: rootNext } })
  console.log(rootUp.ok ? 'ok' : `FAIL: ${rootUp.error}`)
  if (!rootUp.ok) process.exit(1)

  const collNext = (collMembers ?? []).includes(MEMBER)
    ? collMembers!
    : [...(collMembers ?? []), MEMBER]
  process.stdout.write(`[note-lists] ${ROOT}/${COLLECTION} ← ${collNext.length} members ... `)
  const collUp = await sendRetry({
    op: 'update', segments: [ROOT, COLLECTION], layer: { name: COLLECTION, children: collNext },
  })
  console.log(collUp.ok ? 'ok' : `FAIL: ${collUp.error}`)
  if (!collUp.ok) process.exit(1)

  // Keyword-the-collection-first doctrine: the pheromones ARE the parameters
  // of the collection, so the collection tile carries the keyword too.
  await writeMark([ROOT, COLLECTION], STRUCTURE_KEYWORD)

  await writeCell([ROOT, COLLECTION, MEMBER], CREATION)

  console.log(`[note-lists] DONE — ${okCells} cells, ${okNotes} notes, ${okMarks} marks (${skipped} already present)`)
  if (failed > 0) console.warn(`[note-lists] ${failed} operations failed — review the log above.`)
}

main().catch(err => { console.error(err); process.exit(1) })
