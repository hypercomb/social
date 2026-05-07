// Add a `team` branch under root with a tile per person.
//
// Demonstrates the content-via-bridge workflow:
//   1. update(['team'], { name, children }) creates the parent layer
//   2. update(['team', '<name>'], { name }) creates each child layer
//   3. note-add appends the prose for each cell
//
// Idempotent shape: the team list is the source of truth here. To
// modify, edit `TEAM`, re-run — the layer-as-primitive `update` op
// replaces children atomically.
//
// Replace the placeholder names + roles with real team data.

import { send } from '../hypercomb-cli/src/bridge/client.js'

interface Member {
  name: string          // cell label (lowercase, hyphenated)
  notes: string[]       // prose attached to the cell
}

const TEAM: { rootNote: string; members: Member[] } = {
  rootNote:
    'The team building this. Each tile names a person; their cell holds role, contributions, contact, and any signature-addressed assets. Edit any tile to add more.',
  members: [
    {
      name: 'dolphin',
      notes: [
        'Founder. The originator of Relational Intelligence — the framework, the curriculum, the practice. Coaches, certifies, runs live events.',
        'Long arc: build RI into a transmissible field that outlives the founder.',
      ],
    },
    {
      name: 'placeholder-1',
      notes: [
        'Replace this tile with a real team member. Rename via the rename queen or the editor. Add notes describing role, focus, contributions.',
      ],
    },
    {
      name: 'placeholder-2',
      notes: [
        'Same — replace with the next team member. Keep adding tiles for collaborators, advisors, partners, anyone whose work shows up on the site.',
      ],
    },
  ],
}

async function main(): Promise<void> {
  console.log(`[intel-add-team] adding ${TEAM.members.length} team tiles under /team`)

  // Phase 1: structure
  const childNames = TEAM.members.map(m => m.name)
  console.log(`[struct] /team ← ${childNames.length} children ... `)
  let res = await send({
    op: 'update',
    segments: ['team'],
    layer: { name: 'team', children: childNames },
  })
  if (!res.ok) { console.error(`FAIL: ${res.error}`); process.exit(1) }

  for (const m of TEAM.members) {
    process.stdout.write(`[struct] /team/${m.name} ... `)
    res = await send({
      op: 'update',
      segments: ['team', m.name],
      layer: { name: m.name },
    })
    if (res.ok) console.log('ok')
    else console.log(`FAIL: ${res.error}`)
  }

  // Phase 2: notes
  let okNotes = 0, failNotes = 0

  for (const text of [TEAM.rootNote]) {
    const r = await send({ op: 'note-add', segments: [], cell: 'team', text })
    if (r.ok) okNotes++
    else failNotes++
  }

  for (const m of TEAM.members) {
    for (const text of m.notes) {
      process.stdout.write(`[note] team/${m.name} ... `)
      const r = await send({
        op: 'note-add',
        segments: ['team'],
        cell: m.name,
        text,
      })
      if (r.ok) { okNotes++; console.log('ok') }
      else { failNotes++; console.log(`FAIL: ${r.error}`) }
    }
  }

  console.log('')
  console.log(`[intel-add-team] DONE — ${TEAM.members.length} tiles + ${okNotes} notes (${failNotes} failed)`)
}

main().catch(err => { console.error(err); process.exit(1) })
