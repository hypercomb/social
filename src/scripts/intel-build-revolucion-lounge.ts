// Extend the revolucion JOURNAL hierarchy with the lounge gamification —
// the journal code (consistent identity → same journal address), the rewards
// engine (trophies / furniture / upgrades earned by posting entries), and
// my-lounge (the personal 3D room, three.js loaded passively AFTER Pixi).
//
// Same design rules as intel-build-revolucion.ts:
//   1. Cell names pre-normalized (lowercase-hyphen) — segments == children keys.
//   2. Readable text lives in NOTES (note-add, not normalized).
//   3. MERGE, never replace: union new children after the journal's live
//      membership (fresh path-addressed read); `update` sets only the slots
//      present in the payload so properties/imagery survive.
//   4. Re-run sentinel: `my-lounge` already under journal → abort (note-add
//      is not idempotent — a re-run would duplicate every note).
//
// Verification (readback trap: NEVER trust a deep inflate) — path-addressed
// `layer-at` per new cell + `note-list` per noted cell, printed at the end.

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

interface HiveTile { name: string; notes?: string[]; children?: HiveTile[] }

const BASE = ['revolucion', 'journal']
const SENTINEL = 'my-lounge'

const ADDITIONS: HiveTile[] = [
  {
    name: 'journal-code',
    notes: [
      'With your first entry we hand you a code. Leave it on any future entry and we know it is you — same person, same journal address, all your moments in one place. No account, no login: the code IS your key.',
      'Like a matchbook from a favorite lounge — present it at the door and the room remembers you.',
    ],
  },
  {
    name: 'rewards',
    notes: [
      'Post a moment, earn the room. Every journal entry moves you forward: trophies for milestones, furniture for showing up, upgrades for going deep. The lounge gets more beautiful the more you play.',
    ],
    children: [
      { name: 'milestones', notes: ['First entry. Fifth entry. A full flavor wheel explored. A streak kept alive. Each milestone unlocks something for your lounge.'] },
      { name: 'trophies', notes: ['Earned, never bought. Cups, plaques and curiosities that land in your trophy case — proof of moments recorded.'] },
      { name: 'furniture', notes: ['The unlockable catalog: leather chairs, side tables, lamps, rugs, humidors, wall art, record players. Nice furniture comes to those who journal.'] },
      { name: 'upgrades', notes: ['The room itself levels up — richer lighting, a bigger window, a better view, more shelves to fill.'] },
    ],
  },
  {
    name: 'my-lounge',
    notes: [
      'Your own 3D room — the journal made visible. Decorated with everything you have earned; it gets incredible the more you play.',
      'Rendered with three.js, loaded second and passively: the Pixi tile canvas always comes first and the lounge never interferes with tile rendering.',
    ],
    children: [
      {
        name: 'spaces',
        notes: ['The lounge is one room among many possible worlds — any 3D space can hold your things. Start classic, or take it to the beach.'],
        children: [
          { name: 'classic-lounge', notes: ['Espresso leather, low amber light, a window on the evening.'] },
          { name: 'beach', notes: ['A cabana at golden hour — sand, surf, and a cigar.'] },
        ],
      },
      { name: 'decorate', notes: ['Place what you have earned — drag furniture in, hang the art, set the trophy shelf. Your room, your arrangement.'] },
      { name: 'trophy-case', notes: ['Where the earned trophies stand. Every one is a story you already wrote in the journal.'] },
      { name: 'showcase', notes: ['Show the room off — let others walk your lounge and see the experience, not just read it.'] },
    ],
  },
]

interface TileSpec { segments: string[]; name: string; children: string[]; notes: string[] }

function collectTiles(node: HiveTile, segments: string[], out: TileSpec[]): void {
  out.push({
    segments: segments.slice(),
    name: norm(node.name),
    children: (node.children ?? []).map(c => norm(c.name)),
    notes: node.notes ?? [],
  })
  for (const child of node.children ?? []) {
    collectTiles(child, [...segments, norm(child.name)], out)
  }
}

async function main(): Promise<void> {
  // Preflight 1: fast path-addressed read proves renderer + journal cell.
  const at = await send({ op: 'layer-at', segments: BASE }).catch((e: Error) => ({
    ok: false as const, error: e.message, id: '', data: undefined,
  }))
  if (!at.ok) {
    console.error(`[lounge] ABORT: cannot read /${BASE.join('/')} (${at.error}). Renderer connected?`)
    process.exit(1)
  }

  // Preflight 2: live child NAMES of journal (fresh currentLayerAt resolve;
  // child names are immutable so depth-1 names are membership truth).
  const inf = await send({ op: 'inflate', segments: BASE })
  if (!inf.ok) {
    console.error(`[lounge] ABORT: cannot inflate /${BASE.join('/')}: ${inf.error}`)
    process.exit(1)
  }
  const journal = (inf.data ?? {}) as { name?: string; children?: { name?: string }[] }
  const have = (journal.children ?? []).map(c => String(c?.name ?? '')).filter(Boolean)
  console.log(`[lounge] live /${BASE.join('/')} holds: ${have.join(', ') || '(none)'}`)

  if (have.includes(SENTINEL)) {
    console.warn(`[lounge] ABORT: "${SENTINEL}" already under journal — re-run would duplicate notes.`)
    process.exit(1)
  }

  const tiles: TileSpec[] = []
  for (const node of ADDITIONS) collectTiles(node, [...BASE, norm(node.name)], tiles)
  const totalNotes = tiles.reduce((n, t) => n + t.notes.length, 0)
  console.log(`[lounge] plan: ${tiles.length} cells + ${totalNotes} notes under /${BASE.join('/')}`)

  // Phase 0: journal membership — existing order first, then the new keys.
  const newKeys = ADDITIONS.map(n => norm(n.name))
  const merged = [...have, ...newKeys.filter(k => !have.includes(k))]
  process.stdout.write(`[lounge] journal ← ${merged.length} children (${have.length} kept) ... `)
  const jr = await send({ op: 'update', segments: BASE, layer: { name: 'journal', children: merged } })
  console.log(jr.ok ? 'ok' : `FAIL: ${jr.error}`)
  if (!jr.ok) process.exit(1)

  // Phase 1: subtree structure.
  let okStruct = 0, failStruct = 0
  for (let i = 0; i < tiles.length; i++) {
    const t = tiles[i]
    process.stdout.write(`[struct ${i + 1}/${tiles.length}] ${t.segments.join('/')} ← ${t.children.length} children ... `)
    const layer: { name: string; children?: string[] } = { name: t.name }
    if (t.children.length) layer.children = t.children
    const res = await send({ op: 'update', segments: t.segments, layer })
    if (res.ok) { okStruct++; console.log('ok') }
    else { failStruct++; console.log(`FAIL: ${res.error}`) }
  }
  console.log(`[lounge] phase 1: ${okStruct} ok, ${failStruct} failed`)

  // Phase 2: notes.
  let okNotes = 0, failNotes = 0, noteIdx = 0
  for (const t of tiles) {
    if (!t.notes.length) continue
    const parentSegments = t.segments.slice(0, -1)
    const cellLabel = t.segments[t.segments.length - 1]
    for (const text of t.notes) {
      noteIdx++
      process.stdout.write(`[note ${noteIdx}/${totalNotes}] ${t.segments.join('/')} ... `)
      const res = await send({ op: 'note-add', segments: parentSegments, cell: cellLabel, text })
      if (res.ok) { okNotes++; console.log('ok') }
      else { failNotes++; console.log(`FAIL: ${res.error}`) }
    }
  }
  console.log(`[lounge] phase 2: ${okNotes} ok, ${failNotes} failed`)

  // Phase 3: verify — fresh path-addressed reads only.
  let okVerify = 0, failVerify = 0
  for (const t of tiles) {
    const res = await send({ op: 'layer-at', segments: t.segments })
    const kids = Array.isArray(res.data?.children) ? res.data.children.length : 0
    const wantKids = t.children.length
    const structOk = res.ok && kids >= wantKids
    let notesOk = true
    let gotNotes = 0
    if (t.notes.length) {
      const nl = await send({ op: 'note-list', segments: t.segments })
      gotNotes = Array.isArray(nl.data) ? nl.data.length : 0
      notesOk = nl.ok && gotNotes >= t.notes.length
    }
    if (structOk && notesOk) { okVerify++; console.log(`[verify] ${t.segments.join('/')} ok (${kids} children, ${gotNotes} notes)`) }
    else { failVerify++; console.log(`[verify] ${t.segments.join('/')} FAIL (ok=${res.ok} children=${kids}/${wantKids} notes=${gotNotes}/${t.notes.length})`) }
  }
  console.log(`[lounge] verify: ${okVerify}/${tiles.length} cells current`)
  console.log(`[lounge] DONE — ${okStruct} cells + ${okNotes} notes merged under /${BASE.join('/')}`)
}

main().catch(err => { console.error(err); process.exit(1) })
