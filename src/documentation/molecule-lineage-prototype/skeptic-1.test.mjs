// skeptic-1.test.mjs — adversarial pass, lens: UNDO / TIME-TRAVEL.
// node --test

import test from 'node:test'
import assert from 'node:assert/strict'

import { MoleculeStore, moleculeOf } from './molecule.mjs'
import { Root } from './root.mjs'
import { signText, sha256, canonicalJSON } from './sig.mjs'

const names = (rows) => rows.map((r) => r.name)
const tenant = (author, root = new Root()) => new MoleculeStore({ root, author })

// ── A ───────────────────────────────────────────────────────────────────────
// remove() is TWO commits in TWO chains. One undo cannot undo it, and the
// second commit empties a molecule reached by a route the user never touched.

test('A — removing "people" from /business empties /club/people, and one undo does not restore it', () => {
  const a = tenant('alice-hive')
  a.save([], 'business')
  a.save([], 'club')
  a.save(['business'], 'people')
  a.save(['club'], 'people')
  a.save(['business', 'people'], 'Alice', { role: 'founder' })

  assert.deepEqual(names(a.children(['club', 'people'])), ['Alice'], 'one molecule, both routes (documented)')

  const clubHeadBefore = a.headSig(moleculeOf('club'))
  a.remove(['business'], 'people')

  // /club still lists people — the club chain was never touched…
  assert.equal(a.headSig(moleculeOf('club')), clubHeadBefore, 'club molecule byte-identical')
  assert.deepEqual(names(a.children(['club'])), ['people'])

  // …but its CONTENT was emptied by a removal performed in a different route.
  assert.deepEqual(
    names(a.children(['club', 'people'])),
    ['Alice'],
    'EXPECTED: removing people from /business must not empty /club/people',
  )

  // One undo where the user acted restores the envelope but NOT the content:
  // the second commit lives on a different chain with its own cursor.
  a.undo(['business'])
  assert.deepEqual(names(a.children(['business'])), ['people'], 'envelope restored')
  assert.deepEqual(
    names(a.children(['business', 'people'])),
    ['Alice'],
    'EXPECTED: one undo of one user action restores that action completely',
  )
})

// ── B ───────────────────────────────────────────────────────────────────────
// rewind-then-commit: the ONE operation the design promises ("promoteToHead").
// Saving the rewound value is deduped against the REWOUND base, not the head,
// so the promote silently no-ops and the head keeps the future value.

test('B — rewind, then re-save the rewound value: no commit, head unmoved, edit lost on reload', () => {
  const a = tenant('alice-hive')
  a.save([], 'business')
  a.save(['business'], 'people')
  const v1 = a.save(['business', 'people'], 'Alice', { title: 'founder' }).vertex
  const v2 = a.save(['business', 'people'], 'Alice', { title: 'chair' }).vertex
  assert.notEqual(v1, v2)

  const mol = moleculeOf('people')
  const headBefore = a.headSig(mol)

  a.undo(['business', 'people'])
  assert.equal(a.children(['business', 'people'])[0].vertex, v1, 'rewound view shows the old title')

  // The user, standing in the rewound view, saves — meaning "make this the head".
  const r = a.save(['business', 'people'], 'Alice', { title: 'founder' })
  assert.equal(r.committed, true, 'EXPECTED: saving from a rewound view promotes it to a new head')
  assert.notEqual(a.headSig(mol), headBefore, 'EXPECTED: a new head atom exists')

  // The cursor is session state. A reload (new store over the same root) shows
  // the value the user believed they had just overwritten.
  const reloaded = tenant('alice-hive', a.root)
  assert.equal(
    reloaded.children(['business', 'people'])[0].vertex,
    v1,
    'EXPECTED: after reload the promoted value is the one on disk',
  )
})

// ── C ───────────────────────────────────────────────────────────────────────
// HIDE FIRST is keyed by envelope sig, so it survives exactly until the hidden
// member's author edits it. Any foreign edit un-hides the member.

test('C — hide() is defeated by the hidden member\'s next edit (hidden is keyed by envelope sig)', () => {
  const root = new Root()
  const alice = tenant('alice-hive', root)
  const bob = tenant('bob-hive', root)

  alice.save([], 'business')
  alice.save(['business'], 'people')
  bob.save(['business', 'people'], 'Bob', { note: 'v1' })

  assert.ok(names(alice.children(['business', 'people'])).includes('Bob'))
  alice.hide(['business', 'people'], 'Bob')
  assert.ok(!names(alice.children(['business', 'people'])).includes('Bob'), 'hidden')

  // Bob edits himself: new vertex → new envelope → a sig Alice never hid.
  bob.save(['business', 'people'], 'Bob', { note: 'v2' })

  assert.ok(
    !names(alice.children(['business', 'people'])).includes('Bob'),
    "EXPECTED: hide-first must survive the hidden member's next edit",
  )
})

// ── D ───────────────────────────────────────────────────────────────────────
// Depth-is-a-route makes the live structure a GRAPH, so a cycle is one ordinary
// save away. Sealing (the design's ONLY way to name a subtree with one sig —
// required for publish, adopt, snapshot and any pinned time-travel) then either
// does not terminate, or is not a pure derivation of content.

const naiveSeal = (store, mol, depth = 0) => {
  if (depth > 64) throw new Error('seal did not terminate')
  const parts = store.viewOf(mol).map((r) => `${r.name}:${naiveSeal(store, signText(r.name), depth + 1)}`)
  return sha256(Buffer.from(canonicalJSON(parts), 'utf8'))
}

const cuttingSeal = (store, mol, visited = new Set()) => {
  if (visited.has(mol)) return 'CUT'
  visited.add(mol)
  const parts = store.viewOf(mol).map((r) => `${r.name}:${cuttingSeal(store, signText(r.name), visited)}`)
  return sha256(Buffer.from(canonicalJSON(parts), 'utf8'))
}

test('D — one legal save creates a cycle; seal either never terminates or depends on where you start', () => {
  const a = tenant('alice-hive')
  a.save([], 'projects')
  a.save(['projects'], 'tasks')
  a.save(['projects', 'tasks'], 'projects') // a tile named after its own ancestor

  // The route folds back onto itself: /projects/tasks/projects IS sign('projects').
  assert.equal(a.moleculeFor(['projects', 'tasks', 'projects']), moleculeOf('projects'))
  const deep = Array.from({ length: 12 }, (_, i) => (i % 2 ? 'tasks' : 'projects'))
  assert.equal(a.moleculeFor(deep), moleculeOf(deep.at(-1)), 'the route is infinite and every step is live')

  // 1. The design's seal (recursively pin child heads) does not terminate.
  assert.doesNotThrow(
    () => naiveSeal(a, moleculeOf('projects')),
    'EXPECTED: sealing a live subtree terminates',
  )

  // 2. Cutting the cycle makes the sig a function of the TRAVERSAL, not the
  //    content: the seal of 'projects' differs depending on the entry point,
  //    so two tenants publishing overlapping subtrees never converge.
  const projectsFromProjects = cuttingSeal(a, moleculeOf('projects'))
  const visited = new Set()
  cuttingSeal(a, moleculeOf('tasks'), visited) // seal 'tasks' first…
  const visited2 = new Set()
  const sealTasksThenProjects = (() => {
    // recompute 'projects' as it is pinned from inside a seal that started at 'tasks'
    visited2.add(moleculeOf('tasks'))
    return cuttingSeal(a, moleculeOf('projects'), visited2)
  })()
  assert.equal(
    projectsFromProjects,
    sealTasksThenProjects,
    'EXPECTED: a sealed molecule sig is a function of content, not of the walk',
  )
})

// ── E ───────────────────────────────────────────────────────────────────────
// The lens question, answered mechanically: undo at one route silently rewinds
// every other route ending in the same name, with no signal anywhere in the API.

test('E — undo in /business/people silently rewinds /club/people, and nothing reports it', () => {
  const a = tenant('alice-hive')
  a.save([], 'business')
  a.save([], 'club')
  a.save(['business'], 'people')
  a.save(['club'], 'people')
  a.save(['business', 'people'], 'Staff', { r: 1 })
  a.save(['club', 'people'], 'Members', { r: 1 })

  assert.deepEqual(names(a.children(['club', 'people'])).sort(), ['Members', 'Staff'])

  const ok = a.undo(['business', 'people'])
  assert.equal(ok, true)
  // undo() returns a bare boolean — no molecule, no affected-route report.
  assert.deepEqual(
    names(a.children(['club', 'people'])),
    ['Staff'],
    'the club member the user just added elsewhere disappeared from the club route',
  )
  assert.deepEqual(a.cursorPosition(['club', 'people']), a.cursorPosition(['business', 'people']))
})

// ── F ───────────────────────────────────────────────────────────────────────
// After a promote, undo walks into the ABANDONED future: pressing undo moves
// the content forward, which is the opposite of what the key means.

test('F — undo after rewind-then-commit moves the content FORWARD into the abandoned future', () => {
  const a = tenant('alice-hive')
  a.save([], 'business')
  a.save(['business'], 'people')
  a.save(['business', 'people'], 'Alice')
  a.save(['business', 'people'], 'Bob')
  a.save(['business', 'people'], 'Carol')

  a.undo(['business', 'people'])
  a.undo(['business', 'people'])
  assert.deepEqual(names(a.children(['business', 'people'])), ['Alice'])

  a.save(['business', 'people'], 'Dave') // promote: new head, prev = old head
  assert.deepEqual(names(a.children(['business', 'people'])), ['Alice', 'Dave'])

  a.undo(['business', 'people'])
  assert.deepEqual(
    names(a.children(['business', 'people'])),
    ['Alice'],
    'EXPECTED: undo after a promote returns to the state the promote was made from',
  )
})

// ── G ───────────────────────────────────────────────────────────────────────
// Time travel is single-author. "Position -1 = empty membership" is false as
// soon as anyone else has a head in the molecule, and an old position renders
// against other authors' CURRENT heads — a state that never existed.

test('G — childrenAt(-1) is not empty, and an old position mixes in other authors\' present', () => {
  const root = new Root()
  const alice = tenant('alice-hive', root)
  const bob = tenant('bob-hive', root)

  alice.save([], 'business')
  alice.save(['business'], 'people')
  alice.save(['business', 'people'], 'Alice')
  bob.save(['business', 'people'], 'Bob')

  assert.deepEqual(
    names(alice.childrenAt(['business', 'people'], -1)),
    [],
    'EXPECTED: position -1 is the empty membership',
  )

  bob.save(['business', 'people'], 'Later')
  const asOfFirst = names(alice.childrenAt(['business', 'people'], 0))
  assert.ok(
    !asOfFirst.includes('Later'),
    'EXPECTED: a historical read does not show a member minted after that point',
  )
})

// ── H (control) — things that HELD ─────────────────────────────────────────

test('H — held: undo never moves the directory head, and redo restores exactly', () => {
  const a = tenant('alice-hive')
  a.save([], 'business')
  a.save(['business'], 'people')
  a.save(['business', 'people'], 'Alice')
  const head = a.headSig(moleculeOf('people'))
  a.undo(['business', 'people'])
  assert.equal(a.headSig(moleculeOf('people')), head, 'the head is untouched by undo')
  a.redo(['business', 'people'])
  assert.deepEqual(names(a.children(['business', 'people'])), ['Alice'])
  assert.equal(a.cursorPosition(['business', 'people']).position, 0)
})

test('H — held: a rewound commit APPENDS (history never branches); the chain stays linear', () => {
  const a = tenant('alice-hive')
  a.save([], 'business')
  a.save(['business'], 'people')
  a.save(['business', 'people'], 'Alice')
  a.save(['business', 'people'], 'Bob')
  const oldHead = a.headSig(moleculeOf('people'))
  a.undo(['business', 'people'])
  a.save(['business', 'people'], 'Carol')
  const chain = a.chain(moleculeOf('people'))
  assert.equal(chain.at(-1).prev, oldHead, 'the new head names the old head as prev — no fork')
  assert.equal(new Set(chain.map((c) => c.prev)).size, chain.length, 'no two successions share a prev')
})

test('H — held: another author can never be undone, hidden-only, and my flatten cannot touch them', () => {
  const root = new Root()
  const alice = tenant('alice-hive', root)
  const bob = tenant('bob-hive', root)
  alice.save([], 'business')
  alice.save(['business'], 'people')
  bob.save(['business', 'people'], 'Bob')
  const bobHead = bob.headSig(moleculeOf('people'))
  alice.undo(['business', 'people'])
  alice.undo(['business', 'people'])
  assert.equal(bob.headSig(moleculeOf('people')), bobHead, "alice's undo cannot move bob's head")
  alice.flatten(moleculeOf('people'))
  assert.equal(bob.headSig(moleculeOf('people')), bobHead, "alice's flatten cannot touch bob's bucket")
})
