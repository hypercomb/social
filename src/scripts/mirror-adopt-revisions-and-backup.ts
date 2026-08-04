// Mirror the ADOPT-REVISIONS + BACKUP-CHOICE creations into the hive, and
// repair the `upgrade` collection's membership on the way through.
//
// Three things land here:
//
//   1. REPAIR — `behaviors/structure/upgrade` resolves as a location but is
//      NOT in structure's `children`, so the deck never shows it. Re-link it
//      (merge-only: the 17 existing names are read first and kept).
//   2. EXTEND `upgrade` — this pass changed EXISTING parts rather than adding
//      files, so the pill and the naming service get an appended note instead
//      of duplicate tiles (mirror-paradigm rule 6: tiles are 1:1 with source
//      resources, so one file never grows a second tile).
//   3. NEW collections — `behaviors/swarm/adopt-revisions` (every adopt earns
//      a named line in revision history) and `behaviors/structure/backup-choice`
//      (the installer decides what a backup carries).
//
// Collections carry their SHELF keyword only. Neither creation adds a slash
// command, so neither joins the `behavior` census — the same honesty rule the
// behaviors-theme toolchain tile follows.
//
// MERGE MODE + IDEMPOTENT: a cell that already carries a note was written by a
// previous run and is skipped; appended notes are guarded by exact text. Safe
// to re-run. Requires a renderer on the bridge (`?claudeBridge=1`).

import { createHash } from 'node:crypto'
import WebSocket from 'ws'

const BRIDGE_PORT = 2401
const TIMEOUT = 180_000

let counter = 0
type BridgeRes = { id: string; ok: boolean; data?: any; error?: string }

function sendOnce(request: Record<string, unknown>): Promise<BridgeRes> {
  return new Promise((resolve, reject) => {
    const msg = { ...request, id: `mirror-adopt-${Date.now()}-${++counter}` }
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

/** Append a note only if this exact text is not already on the cell. */
async function noteOnce(segments: string[], text: string): Promise<'written' | 'present' | 'failed'> {
  if ((await notes(segments)).includes(text)) return 'present'
  return await note(segments, text) ? 'written' : 'failed'
}

/** Children a location actually LISTS. `inflate` is the only op that returns
 *  names (layer-at returns sigs), so it is the read — but it is merge-only
 *  input: never write a children array that drops a name we just read. */
async function childNames(segments: string[]): Promise<string[]> {
  const inf = await send({ op: 'inflate', segments })
  if (!inf.ok) throw new Error(`cannot read ${segments.join('/')}: ${inf.error}`)
  return ((inf.data?.children ?? []) as any[]).map(c => String(c?.name ?? '')).filter(Boolean)
}

async function ensureMember(parent: string[], child: string): Promise<void> {
  const existing = await childNames(parent)
  if (existing.includes(child)) { console.log(`[link] ${parent.join('/')} already holds "${child}"`); return }
  const merged = [...existing, child]
  process.stdout.write(`[link] ${parent.join('/')} ← ${merged.length} children (+${child}) ... `)
  const res = await sendRetry({
    op: 'update', segments: parent,
    layer: { name: parent[parent.length - 1], children: merged },
  }, async () => (await childNames(parent)).includes(child))
  console.log(res.ok ? 'ok' : `FAIL: ${res.error}`)
  if (!res.ok) process.exit(1)
}

// ── the creations ───────────────────────────────────────────────────

const ROOT = norm('behaviors')
const STRUCTURE = norm('structure')
const SWARM = norm('swarm')
const PART_KEYWORD = 'part'

const CORE = 'hypercomb-core/src'
const SHARED = 'hypercomb-shared'
const ESSENTIALS = 'hypercomb-essentials/src/diamondcoreprocessor.com'
const DCP = 'diamond-core-processor/src/app'

type Part = [file: string, role: string]

interface Creation {
  parent: string[]
  name: string
  keyword: string
  notes: string[]
  parts: Part[]
}

const ADOPT_REVISIONS: Creation = {
  parent: [ROOT, SWARM],
  name: norm('adopt-revisions'),
  keyword: SWARM,
  notes: [
    'Every adopt earns a NAME in the revision history. A fold used to leave an opaque diff row — a marker at the parent location with nothing to read. Now the commit each landed adopt mints is labelled: two words minted from the BRANCH signature by the same word-pair service the breadcrumb uses for its secret words, then what happened — "Amber Meadow · adopted \\"susan\\"". Deterministic, so one adoption reads as one name on every device, and renameable afterwards like any revision: the label is marker metadata, never identity.',
    'The pre-install checkpoint is named the same way. A DCP config fold changes the hive at many locations at once, so undo (per-location) is a poor way back — a restore point is taken FIRST, named over the sorted set of branch sigs in the accept-burst, so the same install reads as the same name everywhere. Best-effort throughout: a label that cannot be written never un-adopts anything, and a seal that cannot complete never blocks the fold the participant already accepted.',
  ],
  parts: [
    [`${ESSENTIALS}/sharing/swarm-adopt.drone.ts`,
     'the drone — labels the marker each landed fold or sync mints at the parent location (`sign` → `listMarkerFilenames` → `setMarkerMeta`, wrapped so a failure only warns), and names the pre-fold checkpoint over the burst\'s branch sigs'],
    [`${ESSENTIALS}/sharing/swarm-adopt-checkpoint.spec.ts`,
     'proof the restore point is taken BEFORE the fold mutates and exactly once per accept-burst, that an empty diff checkpoints nothing, and that a snapshot failure never blocks the fold — mutation-tested: moving the checkpoint after the loop fails two cases'],
  ],
}

const BACKUP_CHOICE: Creation = {
  parent: [ROOT, STRUCTURE],
  name: norm('backup-choice'),
  keyword: STRUCTURE,
  notes: [
    'Decide what a backup carries. Backup used to be all-or-nothing — the whole store, byte for byte, with no way to say "not that branch". Now every adopted branch wears a choice in the installer: an archive-box toggle, participant-local, stored as `backup.<sig>` in the settings sigbag beside the `feature.<sig>` switch it mirrors. The polarity is DELIBERATELY opposite: absent means INCLUDED, so nothing ever silently stops being backed up — you have to say no.',
    'Exclusion is by REACHABILITY, not by name. A ref survives (stays backed up) if ANY included silo references it, and your own base data is always included — the same union semantics the logical install uses, so leaving one branch out can never strip content another branch still needs. Only refs reachable ONLY through excluded branches stay home. Fail-open at every step: an unreadable choice backs up everything.',
  ],
  parts: [
    [`${DCP}/core/dcp-domain-storage.service.ts`,
     'the choice — `isBackupEnabled` / `setBackupEnabled` (settings sigbag, absent = included) and `backupExcludedRefs`, the union walk that decides which refs are reachable only through excluded branches'],
    [`${DCP}/sentinel/sentinel-handler.ts`,
     'the enforcement — the backup export walk skips a file whose name is an excluded ref; wrapped so a choice that cannot be read backs up everything rather than nothing'],
    [`${DCP}/home/home.component.html`,
     'the surface — the archive-box toggle on each branch row. An EXCLUDED branch stays plainly visible (struck icon, danger ink) instead of fading with the other secondary actions: leaving something out of your backups must never be a surprise'],
    [`${SHARED}/core/registry-snapshot.ts`,
     'the projection — `backup` rides the registry snapshot to the hive beside `enabled`, optional so an older installer that never posted it reads as "backed up"'],
  ],
}

const CREATIONS = [ADOPT_REVISIONS, BACKUP_CHOICE]

/** Notes appended to EXISTING upgrade tiles — this pass changed how those
 *  parts behave without adding files, so they get a note, not a new tile. */
const UPGRADE_AMENDMENTS: [cell: string, text: string][] = [
  [norm('revision-name'),
   'REVISED — `buildRevisionName` joins the service for INCOMING BUILDS: the AUTHOR\'S name for the build leads and the date + TIME trail ("alpha 0.9.4 · Aug 4, 2026, 6:03 PM"). The word pair stands in only when the build calls itself nothing. Time is what tells revisions apart — each new build mints a later one, so every update this hive takes reads as its own line in the installer\'s list. `revisionName` (words first) stays the name for adopt line items and restore points.'],
  [norm('upgrade-pill'),
   'REVISED — Adopt no longer moves on the first click: it opens the DECISION. Allow lands the package changes directly here (snapshot, install, reload — the path Adopt always took); Installer routes the portal\'s `upgrade:` handoff so the changed items are reviewed in DCP first and nothing installs until you act there; Back retreats to Adopt / Save / Discard. The participant decides WHERE an update lands, not just whether.'],
]

async function writeCreation(c: Creation): Promise<{ created: number; skipped: number; failed: number }> {
  const seg = [...c.parent, c.name]
  let created = 0, skipped = 0, failed = 0

  await ensureMember(c.parent, c.name)

  process.stdout.write(`[cell] ${seg.join('/')} ... `)
  const mk = await sendRetry({ op: 'update', segments: seg, layer: { name: c.name } })
  console.log(mk.ok ? 'ok' : `FAIL: ${mk.error}`)
  if (!mk.ok) { return { created, skipped, failed: failed + 1 } }

  const existingNotes = await notes(seg)
  if (existingNotes.length === 0) {
    for (const text of c.notes) {
      process.stdout.write(`[note] ${seg.join('/')} ... `)
      console.log(await note(seg, text) ? 'ok' : 'FAIL')
    }
    process.stdout.write(`[mark] ${seg.join('/')} ← ${c.keyword} ... `)
    console.log(await mark(seg, c.keyword) ? 'ok' : 'FAIL')
  } else {
    console.log(`[cell] ${seg.join('/')} already noted — skipping notes + mark`)
  }

  const partKeys = c.parts.map(([file]) => norm(file.split('/').pop()!.replace(/\.(cjs|mjs|ts|md|html|scss)$/, '')))
  const existingParts = await childNames(seg)
  const mergedParts = [...existingParts, ...partKeys.filter(k => !existingParts.includes(k))]
  process.stdout.write(`[cell] ${seg.join('/')} ← ${mergedParts.length} parts ... `)
  const kids = await sendRetry({ op: 'update', segments: seg, layer: { name: c.name, children: mergedParts } })
  console.log(kids.ok ? 'ok' : `FAIL: ${kids.error}`)

  for (let i = 0; i < c.parts.length; i++) {
    const [file, role] = c.parts[i]
    const pseg = [...seg, partKeys[i]]
    process.stdout.write(`[part] ${partKeys[i]} ... `)
    const res = await sendRetry({ op: 'update', segments: pseg, layer: { name: partKeys[i] } })
    if (!res.ok) { failed++; console.log(`FAIL: ${res.error}`); continue }
    if ((await notes(pseg)).length > 0) { skipped++; console.log('ok (already noted — skip note+mark)'); continue }
    const text = `${file.split('/').pop()} — ${role}\n\npart of ${c.name}\nsource: ${file}`
    const okNote = await note(pseg, text)
    const okMark = await mark(pseg, PART_KEYWORD)
    if (okNote && okMark) { created++; console.log('ok') } else { failed++; console.log(`FAIL (note:${okNote} mark:${okMark})`) }
  }
  return { created, skipped, failed }
}

async function main(): Promise<void> {
  // 1. REPAIR — the upgrade collection is unreachable from the deck until
  //    structure lists it. Merge-only; the 17 existing names are kept.
  const UPGRADE = [ROOT, STRUCTURE, norm('upgrade')]
  const upgradeExists = await send({ op: 'inflate', segments: UPGRADE })
  if (upgradeExists.ok) {
    await ensureMember([ROOT, STRUCTURE], norm('upgrade'))
  } else {
    console.log('[link] upgrade collection not found — skipping repair')
  }

  // 2. EXTEND — notes on the parts whose behaviour this pass changed.
  for (const [cell, text] of UPGRADE_AMENDMENTS) {
    const seg = [...UPGRADE, cell]
    process.stdout.write(`[amend] ${seg.join('/')} ... `)
    console.log(await noteOnce(seg, text))
  }

  // 3. NEW — the two creations.
  let created = 0, skipped = 0, failed = 0
  for (const c of CREATIONS) {
    console.log(`\n[creation] ${[...c.parent, c.name].join('/')}`)
    const r = await writeCreation(c)
    created += r.created; skipped += r.skipped; failed += r.failed
  }

  console.log(`\n[mirror] DONE — ${created} parts written, ${skipped} already present, ${failed} failed`)
  console.log('[mirror] NEXT: node scripts/behaviors-theme/sweep.cjs — mint the cards for the new cells')
  if (failed > 0) process.exitCode = 1
}

main().catch(err => { console.error(err); process.exit(1) })
