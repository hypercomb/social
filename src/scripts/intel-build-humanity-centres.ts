// Build the "Humanity Centres" hive as a SIBLING of the existing top-level
// "dolphin" cell, from the Coggle mind-map.
//
// Design rules:
//   1. Cells carry the taxonomy. Cell NAMES are the system's identity and
//      MUST be normalized (lowercase-hyphen) — `normalizeCell` / isValidCell
//      enforce this, and the bridge normalizes children but signs segments
//      raw, so we pre-normalize EVERY name here to keep one consistent tree.
//   2. Longer descriptive leaves are NOTES (free text, not normalized) — the
//      program offerings (under me / us / all-of-us) and the practitioner
//      descriptors become notes on their owning category cell.
//
// Sibling-safe: one atomic root `update` declaring root's exact membership
// (existing children + the new sibling). Re-run is idempotent for STRUCTURE
// but NOT for NOTES (note-add appends). Run once.

import { send } from '../hypercomb-cli/src/bridge/client.js'

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

const ROOT_LABEL = 'Humanity Centres'
const ROOT_KEY = norm(ROOT_LABEL) // 'humanity-centres'

const TREE: HiveTile = {
  name: ROOT_LABEL,
  children: [
    {
      name: 'Programs',
      children: [
        { name: 'Me', notes: [
          'Song Circle: Singing Your Soul Alive',
          'Wheel of Consent Workshop',
          'Painting the Landscape of Your Soul',
          'Spirit Collage',
          'Wet Felting for Beginners',
          'Writing Your Memoir',
          'Unburdening Guilt: Transforming a Misunderstood Emotion',
        ] },
        { name: 'Us', notes: [
          'Family Constellation Workshop',
          'Aging in Community: A Listening Circle',
          'Dying to Live: A Sacred Conversation',
          'Integral at Home: Reflections on Sacred Spaces',
          'Spirituality: Can We Talk? **',
          "The Chrysalis Program: Transforming Women's Lives",
          'Weaving the Web: Creating Communities of Action',
        ] },
        { name: 'All of Us', notes: [
          'Humanity at the Crossroads',
          'One World Dialogues',
          'Healing our Broken World',
          'What Wants to Happen',
          'Living in a Time of Dying',
        ] },
      ],
    },
    {
      name: 'Purse',
      children: [
        { name: 'Donations Program Fees' },
        { name: 'Money from HC Network' },
        { name: 'Distribution to HCS' },
      ],
    },
    {
      name: 'Participants',
      children: [
        { name: 'Location' }, { name: 'Program' }, { name: 'Type' }, { name: 'Payment' },
      ],
    },
    {
      name: 'Places',
      children: [
        {
          name: 'Locations',
          children: [
            { name: 'Canada', children: [{ name: 'Quebec' }, { name: 'Ontario' }, { name: 'British Columbia' }] },
            { name: 'Switzerland' },
            { name: 'Bermuda' },
          ],
        },
        {
          name: 'Qualities',
          children: [
            { name: 'Other Facilities' }, { name: 'Room Specifications' }, { name: 'Numbers of Participants' },
          ],
        },
        {
          name: 'Types',
          children: [
            { name: 'Retreat Centres', children: [{ name: 'Bethlehem Centre' }] },
            { name: 'Neighbourhood Houses', children: [{ name: 'Surrey Neighbourhood House' }] },
            { name: 'Storefronts', children: [{ name: 'Circles in the Square' }] },
          ],
        },
      ],
    },
    {
      name: 'Practitioners',
      notes: ['Program Level (Me, Us, All of Us)', 'Bio Summary/Photo'],
      children: [
        { name: 'Location', children: [{ name: 'Surrey BC' }, { name: 'Nanaimo Bc' }, { name: 'South False Creek Vancouver BC' }] },
      ],
    },
  ],
}

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
  const inf = await send({ op: 'inflate', segments: [] }).catch((e: Error) => ({
    ok: false as const, error: e.message, id: '', data: undefined,
  }))
  if (!inf.ok) {
    console.error(`[humanity] bridge not ready: ${inf.error}`)
    console.error('[humanity] Open the app on localhost with ?claudeBridge=1 (renderer), then re-run.')
    process.exit(1)
  }
  const root = (inf.data ?? {}) as { name?: string; children?: { name?: string }[] }
  const rootName = root.name ?? '/'
  const topNames = (root.children ?? []).map(c => String(c.name ?? '')).filter(Boolean)
  console.log(`[humanity] live root "${rootName}" holds: ${topNames.join(', ') || '(none)'}`)
  if (!topNames.includes('dolphin')) {
    console.error('[humanity] ABORT: "dolphin" not at root — wrong hive / renderer. Nothing written.')
    process.exit(1)
  }
  if (topNames.includes(ROOT_KEY)) {
    console.warn(`[humanity] ABORT: "${ROOT_KEY}" already at root (re-run would duplicate notes). Reset root first.`)
    process.exit(1)
  }

  const tiles: TileSpec[] = []
  collectTiles(TREE, [ROOT_KEY], tiles)
  const totalNotes = tiles.reduce((n, t) => n + t.notes.length, 0)
  console.log(`[humanity] plan: ${tiles.length} cells + ${totalNotes} notes, sibling of dolphin (key="${ROOT_KEY}")`)

  // Atomic root layer: exact membership = existing top cells + new sibling.
  const nextRoot = [...topNames, ROOT_KEY]
  process.stdout.write(`[humanity] root layer ← [${nextRoot.join(', ')}] ... `)
  const rootRes = await send({ op: 'update', segments: [], layer: { name: rootName, children: nextRoot } })
  console.log(rootRes.ok ? 'ok' : `FAIL: ${rootRes.error}`)
  if (!rootRes.ok) process.exit(1)

  // Phase 1: structure (normalized names; segments == children keys).
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
  console.log(`[humanity] phase 1: ${okStruct} ok, ${failStruct} failed`)

  // Phase 2: notes (free text) on their owning cell.
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
  console.log(`[humanity] phase 2: ${okNotes} ok, ${failNotes} failed`)
  console.log(`[humanity] DONE — ${okStruct} cells + ${okNotes} notes under "${ROOT_KEY}"`)
}

main().catch(err => { console.error(err); process.exit(1) })
