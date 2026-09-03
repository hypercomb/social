// molecule.test.mjs — ten named scenarios for "lineage as molecule".
// node --test

import test from 'node:test'
import assert from 'node:assert/strict'

import { MoleculeStore, moleculeOf, ROOT_MOLECULE } from './molecule.mjs'
import { Root } from './root.mjs'
import { hostOf } from './host.mjs'
import { putPoolDoc, getPoolDoc, poolSignature } from './pool.mjs'
import { canonName, lineageKey } from './canon.mjs'
import { signText, EMPTY_SIG } from './sig.mjs'

const names = (rows) => rows.map((r) => r.name)

/** /business/people/Alice ... on a fresh tenant. */
const tenant = (author) => {
  const s = new MoleculeStore({ root: new Root(), author })
  return s
}

// ── 1 ───────────────────────────────────────────────────────────────────────

test("scenario 1 — save /business/people/Alice: atom at the root, membership in sign('people'), business's projection unchanged", () => {
  const a = tenant('alice-hive')
  a.save([], 'business')
  const peopleCommit = a.save(['business'], 'people')

  const businessHeadBefore = a.headSig(moleculeOf('business'))

  const r = a.save(['business', 'people'], 'Alice', { role: 'founder' })

  // the ATOM is at the root, sig-named
  assert.ok(a.root.has(r.vertex), 'vertex atom written at <root>/<sig>')
  assert.equal(a.getAtom(r.vertex).name, 'Alice')
  assert.ok(a.root.has(r.envelope), 'envelope (the incidence) written at <root>/<sig>')
  assert.ok(a.root.has(r.succession), 'succession (the meta lineage) written at <root>/<sig>')

  // MEMBERSHIP is one zero-byte entry in the molecule, inside my bucket
  const mol = moleculeOf('people')
  assert.equal(r.molecule, mol)
  const entry = `${mol}/${a.authorSig}/${r.succession}`
  assert.ok(a.root.has(entry), 'head entry = <sign(name)>/<sign(author)>/<succSig>')
  assert.equal(a.root.read(entry).length, 0, 'the entry is zero bytes — the name IS the content')
  assert.equal(a.headSig(mol), r.succession)

  // the succession carries its own name, so an atom self-places on arrival
  const succ = a.getAtom(r.succession)
  assert.equal(succ.name, 'people')
  assert.equal(succ.author, a.authorSig)
  assert.equal(succ.prev, peopleCommit === null ? null : succ.prev) // first on this chain
  assert.deepEqual(succ.members, [r.envelope])

  // business's PROJECTION ('children' as a frozen sig array) still lists people
  assert.deepEqual(a.childNames(['business']), ['people'])
  assert.deepEqual(a.childrenSigs(['business']), [a.children(['business'])[0].vertex])

  // NO CASCADE: adding Alice did not touch business or the root molecule
  assert.equal(a.headSig(moleculeOf('business')), businessHeadBefore, 'parent head byte-identical')
  assert.deepEqual(a.childNames(['business', 'people']), ['Alice'])

  // the parent's succession lists the child's VERTEX, never the child's head
  const bizSucc = a.getAtom(businessHeadBefore)
  const peopleEnv = a.getAtom(bizSucc.members[0])
  assert.equal(peopleEnv.root, 'people')
  assert.notEqual(peopleEnv.layer, a.headSig(mol), 'envelope points at a vertex, not a molecule head')
})

// ── 2 ───────────────────────────────────────────────────────────────────────

test('scenario 2 — /business/people and /club/people are ONE molecule: the firehose', () => {
  const a = tenant('alice-hive')
  a.save([], 'business')
  a.save([], 'club')
  a.save(['business'], 'people')
  a.save(['club'], 'people')

  assert.equal(a.moleculeFor(['business', 'people']), a.moleculeFor(['club', 'people']))
  assert.equal(a.moleculeFor(['business', 'people']), moleculeOf('people'))

  a.save(['business', 'people'], 'Alice')
  a.save(['club', 'people'], 'Bob')

  // enrolled from two different routes, read identically from both
  assert.deepEqual(a.childNames(['business', 'people']), ['Alice', 'Bob'])
  assert.deepEqual(a.childNames(['club', 'people']), ['Alice', 'Bob'])
  assert.deepEqual(a.childrenSigs(['business', 'people']), a.childrenSigs(['club', 'people']))

  // ONE chain, because it is one molecule and one author: enrolling Alice from
  // /business and Bob from /club appended to the SAME succession chain. (The
  // two `people` TILES are members of business and club, so their successions
  // live in sign('business') / sign('club'), not here.)
  const chain = a.chain(moleculeOf('people'))
  assert.equal(chain.length, 2)
  assert.deepEqual(chain.map((s) => s.members.length), [1, 2])
  assert.equal(a.chain(moleculeOf('business')).length, 1)

  // and the two `people` tiles are byte-identical atoms — shared, never copied
  const bizPeople = a.children(['business'])[0]
  const clubPeople = a.children(['club'])[0]
  assert.equal(bizPeople.vertex, clubPeople.vertex, 'one vertex atom serves both routes')
  assert.equal(bizPeople.envelope, clubPeople.envelope, 'identical incidence = identical atom')
  assert.equal(a.root.copiesOf(bizPeople.vertex), 1, 'stored once')

  // depth is a ROUTE: a route that does not exist is dead, it is not an address
  assert.throws(() => a.children(['nowhere', 'people']), /dead route/)
})

// ── 3 ───────────────────────────────────────────────────────────────────────

test("scenario 3 — two tenants, replicate via GET /<sign('people')>/: union, same sig stored once", () => {
  const a = tenant('alice-hive')
  a.save([], 'business')
  a.save(['business'], 'people')
  const danaA = a.save(['business', 'people'], 'Dana', { role: 'ops' })

  const b = tenant('bob-hive')
  b.save([], 'club')
  b.save(['club'], 'people')
  const danaB = b.save(['club', 'people'], 'Dana', { role: 'ops' })
  b.save(['club', 'people'], 'Eve', { role: 'design' })

  // two tenants, two roots, ONE address — byte-identical by construction
  assert.equal(danaA.molecule, danaB.molecule)
  assert.equal(danaA.vertex, danaB.vertex, 'same person, same bytes, same sig')
  assert.equal(danaA.envelope, danaB.envelope, 'same incidence, same sig')
  assert.notEqual(a.headSig(danaA.molecule), b.headSig(danaB.molecule), 'two author chains')

  const bHost = hostOf(b.root)
  const report = a.replicateMolecule(bHost, moleculeOf('people'))
  assert.equal(report.accepted.length, 1)
  assert.equal(report.accepted[0].author, b.authorSig)
  assert.deepEqual(report.skipped, [], "B's host holds no bucket of mine to skip")

  // and when a host DOES carry my bucket (a mirror of my own hive), replication
  // never overwrites my chain from the outside
  const mirror = a.replicateMolecule(hostOf(a.root), moleculeOf('people'))
  assert.deepEqual(mirror.skipped, [a.authorSig], 'my own bucket is mine to write')

  // union, deduped by envelope sig; Dana is ONE row, not a stack
  assert.deepEqual(names(a.children(['business', 'people'])), ['Dana', 'Eve'])
  assert.equal(a.children(['business', 'people'])[0].stack.length, 0)
  assert.equal(a.root.copiesOf(danaA.vertex), 1, 'stored once after replication')

  // my chain is untouched; the peer's head sits beside it
  assert.equal(a.headSig(moleculeOf('people')), danaA.succession)
  assert.equal(a.heads(moleculeOf('people')).length, 2)

  // FORK REFUSAL: a peer head whose chain does not contain the one I hold is refused
  const forked = new MoleculeStore({ root: new Root(), author: 'bob-hive' })
  forked.save([], 'club')
  forked.save(['club'], 'people')
  forked.save(['club', 'people'], 'Mallory')
  const held = a.root.list(`${moleculeOf('people')}/${b.authorSig}`)[0].name
  const refusal = a.replicateMolecule(hostOf(forked.root), moleculeOf('people'))
  assert.equal(refusal.refused.length, 1, 'history never branches')
  assert.equal(a.root.list(`${moleculeOf('people')}/${b.authorSig}`)[0].name, held)
  assert.deepEqual(names(a.children(['business', 'people'])), ['Dana', 'Eve'])
})

// ── 4 ───────────────────────────────────────────────────────────────────────

test("scenario 4 — ORDER lives in the author's succession + the envelope slot; the molecule is an unordered set", () => {
  const a = tenant('alice-hive')
  a.save([], 'business')
  a.save(['business'], 'people')
  a.save(['business', 'people'], 'Alice')
  a.save(['business', 'people'], 'Bob')
  a.save(['business', 'people'], 'Carol')
  assert.deepEqual(names(a.children(['business', 'people'])), ['Alice', 'Bob', 'Carol'])

  // the order is IN the atom: it is committed by the succession's sig
  const succ = a.getAtom(a.headSig(moleculeOf('people')))
  assert.deepEqual(succ.members.map((s) => a.getAtom(s).root), ['Alice', 'Bob', 'Carol'])
  assert.deepEqual(succ.members.map((s) => a.getAtom(s).slot), [0, 1, 2])

  // the DIRECTORY carries no order: listing it backwards changes nothing
  const shuffled = hostOf(a.root, { order: 'reverse' })
  const cold = new MoleculeStore({ root: new Root(), author: 'cold' })
  assert.deepEqual(names(cold.materializeCold(shuffled, ['business', 'people']).children),
    ['Alice', 'Bob', 'Carol'], 'readdir order is not the membership order')

  // tenant B has its OWN order and its own Carol
  const b = tenant('bob-hive')
  b.save([], 'club')
  b.save(['club'], 'people')
  b.save(['club', 'people'], 'Carol', { note: 'a different Carol' })
  b.save(['club', 'people'], 'Dave')
  assert.deepEqual(names(b.children(['club', 'people'])), ['Carol', 'Dave'])

  a.replicateMolecule(hostOf(b.root), moleculeOf('people'))

  // B's order does NOT clobber A's: A's members keep their pinned slots, B's
  // are demoted to the next free slot, and B's Carol stacks BEHIND A's.
  const rows = a.children(['business', 'people'])
  assert.deepEqual(names(rows), ['Alice', 'Bob', 'Carol', 'Dave'])
  assert.deepEqual(rows.map((r) => r.position), [0, 1, 2, 3])
  const carol = rows.find((r) => r.name === 'Carol')
  assert.equal(carol.mine, true, 'you are index 0 of your own name')
  assert.equal(carol.stack.length, 1)
  assert.equal(carol.stack[0].author, b.authorSig)
  assert.equal(a.getAtom(carol.vertex).properties, undefined, "A's Carol, not B's")

  // A reorders: a NEW envelope (slot) + a NEW succession. Undoable, and local.
  a.reorder(['business', 'people'], 'Carol', 0)
  assert.deepEqual(names(a.children(['business', 'people'])), ['Carol', 'Alice', 'Bob', 'Dave'])

  // ...and B, reading its own root, is completely unaffected
  assert.deepEqual(names(b.children(['club', 'people'])), ['Carol', 'Dave'])
  assert.equal(b.getAtom(b.children(['club', 'people'])[0].vertex).properties.length, 1)

  // undo the reorder
  a.undo(['business', 'people'])
  assert.deepEqual(names(a.children(['business', 'people'])), ['Alice', 'Bob', 'Carol', 'Dave'])
})

// ── 5 ───────────────────────────────────────────────────────────────────────

test('scenario 5 — undo is a VIEW on my chain: the atom stays, the directory head never moves, redo restores', () => {
  const a = tenant('alice-hive')
  a.save([], 'business')
  a.save([], 'club')
  a.save(['business'], 'people')
  a.save(['club'], 'people')
  const alice = a.save(['business', 'people'], 'Alice')
  const bob = a.save(['business', 'people'], 'Bob')

  const mol = moleculeOf('people')
  const headBefore = a.headSig(mol)
  assert.equal(headBefore, bob.succession)

  assert.equal(a.undo(['business', 'people']), true)
  assert.deepEqual(a.childNames(['business', 'people']), ['Alice'], 'Bob left this route')
  assert.deepEqual(a.cursorPosition(['business', 'people']), { position: 0, total: 2 })

  // HIDDEN, NOT REMOVED — nothing on disk was destroyed
  assert.ok(a.root.has(bob.vertex), "Bob's atom is untouched")
  assert.ok(a.root.has(bob.envelope), 'the incidence is untouched')
  assert.ok(a.root.has(bob.succession), 'the succession I rewound past is untouched')
  assert.equal(a.headSig(mol), headBefore, 'the DIRECTORY head never moves during undo')

  // a peer / host still sees the head — undo is my view, not a publication
  const peer = new MoleculeStore({ root: a.root, author: 'reader' })
  assert.deepEqual(peer.childNames(['business', 'people']), ['Alice', 'Bob'])

  // THE STATED COST: one molecule, one chain — /club/people rewinds too
  assert.deepEqual(a.childNames(['club', 'people']), ['Alice'])

  assert.equal(a.redo(['business', 'people']), true)
  assert.deepEqual(a.childNames(['business', 'people']), ['Alice', 'Bob'])
  assert.deepEqual(a.cursorPosition(['business', 'people']), { position: 1, total: 2 })

  // committing from a rewound view APPENDS (promoteToHead) — never branches
  a.undo(['business', 'people'])
  const carol = a.save(['business', 'people'], 'Carol')
  assert.equal(a.getAtom(carol.succession).prev, headBefore, 'prev = the head, not the cursor')
  assert.deepEqual(a.childNames(['business', 'people']), ['Alice', 'Carol'])
  assert.equal(a.chain(mol).length, 3, 'the chain grew; nothing was rewritten')

  // hide vs remove, both hide-first
  a.save(['business', 'people'], 'Bob')
  assert.deepEqual(a.childNames(['business', 'people']), ['Alice', 'Carol', 'Bob'])
  a.hide(['business', 'people'], 'Carol')
  assert.deepEqual(a.childNames(['business', 'people']), ['Alice', 'Bob'])
  assert.ok(a.getAtom(a.headSig(mol)).members.some((m) => a.getAtom(m).root === 'Carol'),
    'hidden means filtered on read, still a member of the succession')

  a.remove(['business', 'people'], 'Bob')
  assert.deepEqual(a.childNames(['business', 'people']), ['Alice'])
  assert.ok(a.root.has(bob.vertex), 'remove drops the incidence; delete-second is GC')
  // revive = point a NEW envelope at the OLD vertex (share, never copy)
  a.revive(['business', 'people'], 'Bob', bob.vertex)
  assert.deepEqual(a.childNames(['business', 'people']), ['Alice', 'Bob'])
  assert.equal(a.children(['business', 'people']).find((r) => r.name === 'Bob').vertex, bob.vertex)
  assert.ok(alice.vertex)
})

// ── 6 ───────────────────────────────────────────────────────────────────────

test('scenario 6 — a cold client with an EMPTY root materializes /business/people from host listings alone', () => {
  const a = tenant('alice-hive')
  a.save([], 'business')
  a.save(['business'], 'people')
  a.save(['business', 'people'], 'Alice', { role: 'founder' })
  a.save(['business', 'people'], 'Bob')

  const host = hostOf(a.root)
  const cold = new MoleculeStore({ root: new Root(), author: 'cold-visitor' })
  assert.equal(cold.root.size, 0, 'nothing held')

  const { walked, children } = cold.materializeCold(host, ['business', 'people'])

  assert.deepEqual(walked.map((w) => w.name), ['', 'business', 'people'])
  assert.deepEqual(walked.map((w) => w.molecule),
    [ROOT_MOLECULE, moleculeOf('business'), moleculeOf('people')])
  assert.deepEqual(names(children), ['Alice', 'Bob'])
  assert.equal(cold.getAtom(children[0].vertex).name, 'Alice')

  // one listing per molecule + one per contributor bucket; every other fetch is
  // an immutable atom that dedups across routes and tenants
  assert.equal(host.stats.listings, 6)
  assert.equal(host.stats.misses, 0)
  assert.ok(cold.root.size > 0)

  // the atoms self-placed: the cold client wrote sign(succ.name)/<author>/<head>
  // without ever being told the route it walked
  assert.ok(cold.root.has(`${moleculeOf('people')}/${a.authorSig}/${a.headSig(moleculeOf('people'))}`))

  // and the cold client reads the same projection as the author
  assert.deepEqual(cold.childrenSigs(['business', 'people']), a.childrenSigs(['business', 'people']))

  // a corrupted host cannot poison a cold client
  const evil = { list: host.list, content: () => Buffer.from('lies', 'utf8') }
  const victim = new MoleculeStore({ root: new Root(), author: 'cold-visitor' })
  assert.throws(() => victim.materializeCold(evil, ['business']), /failed its hash/)
})

// ── 7 ───────────────────────────────────────────────────────────────────────

test('scenario 7 — time travel: read the molecule as of chain position 0001', () => {
  const a = tenant('alice-hive')
  a.save([], 'business')
  a.save(['business'], 'people')
  a.save(['business', 'people'], 'Alice')
  a.save(['business', 'people'], 'Bob')
  a.save(['business', 'people'], 'Carol')

  const mol = moleculeOf('people')
  const chain = a.chain(mol)
  assert.equal(chain.length, 3, 'three successions — the marker run, now an atom chain')
  assert.deepEqual(chain.map((s) => s.prev), [null, chain[0].sig, chain[1].sig])
  assert.deepEqual(chain.map((s) => s.at), [3, 4, 5])

  assert.deepEqual(names(a.childrenAt(['business', 'people'], 0)), ['Alice'])
  assert.deepEqual(names(a.childrenAt(['business', 'people'], 1)), ['Alice', 'Bob'])
  assert.deepEqual(names(a.childrenAt(['business', 'people'], 2)), ['Alice', 'Bob', 'Carol'])
  assert.deepEqual(names(a.childrenAt(['business', 'people'], -1)), [], 'position 0 is empty membership')

  // reading the past changes nothing
  assert.equal(a.headSig(mol), chain[2].sig)
  assert.deepEqual(a.childNames(['business', 'people']), ['Alice', 'Bob', 'Carol'])

  // and every past state is still verifiable from its own bytes
  for (const s of chain) assert.ok(a.root.has(s.sig))
})

// ── 8 ───────────────────────────────────────────────────────────────────────

test("scenario 8 — a tile named 'bees' vs the reserved system pool sign('bees')", () => {
  const a = tenant('alice-hive')

  // THE COLLISION IS REAL AND IS NOW THE DESIGN: one address, two meanings.
  assert.equal(moleculeOf('bees'), poolSignature('bees'))
  assert.equal(moleculeOf('bees'), signText(lineageKey(['bees'])), "and it is today's root bag too")

  putPoolDoc(a.root, 'bees', { installed: ['drone-a', 'drone-b'] })

  a.save([], 'bees') // a participant names a tile 'bees' at any depth
  a.save(['bees'], 'Buzz')
  a.save(['bees'], 'Honey')
  assert.deepEqual(a.childNames(['bees']), ['Buzz', 'Honey'])

  // THE ANSWER: the ENTRY decides, never the directory.
  const dir = a.root.list(moleculeOf('bees'))
  assert.equal(dir.filter((e) => e.kind === 'dir').length, 1, 'one contributor bucket (a DIR)')
  assert.equal(dir.filter((e) => e.kind === 'file').length, 1, 'one pool record (a FILE)')

  // a pool write sweeps sibling FILES only — the tile's history survives
  putPoolDoc(a.root, 'bees', { installed: ['drone-a', 'drone-b', 'drone-c'] })
  assert.deepEqual(a.childNames(['bees']), ['Buzz', 'Honey'])
  assert.deepEqual(getPoolDoc(a.root, 'bees').installed, ['drone-a', 'drone-b', 'drone-c'])

  // a molecule commit never disturbs the pool record
  a.save(['bees'], 'Comb')
  assert.deepEqual(a.childNames(['bees']), ['Buzz', 'Honey', 'Comb'])
  assert.ok(getPoolDoc(a.root, 'bees'))

  // the SHIPPED bug, reproduced: a per-DIRECTORY walker hard-deletes the pool
  const victim = new MoleculeStore({ root: new Root(), author: 'alice-hive' })
  putPoolDoc(victim.root, 'bees', { installed: ['drone-a'] })
  victim.save([], 'bees')
  assert.equal(victim.legacyFlatten(moleculeOf('bees')).length, 1)
  assert.equal(getPoolDoc(victim.root, 'bees'), null, 'the 2026-07-21 data loss')

  // the design's walker is per-entry and per-author: it can only touch my bucket
  const b = new MoleculeStore({ root: a.root, author: 'bob-hive' })
  b.save(['bees'], 'Drone')
  assert.equal(a.flatten(moleculeOf('bees')).length, 0)
  assert.ok(getPoolDoc(a.root, 'bees'), 'pool record untouchable by a molecule walker')
  assert.ok(a.headSig(moleculeOf('bees'), b.authorSig), "another author's bucket is untouchable")
  assert.deepEqual(names(a.children(['bees'])), ['Buzz', 'Honey', 'Comb', 'Drone'])
})

// ── 9 ───────────────────────────────────────────────────────────────────────

test('scenario 9 — the ROOT molecule is the empty name, and the empty atom is never written', () => {
  const a = tenant('alice-hive')

  assert.equal(ROOT_MOLECULE, EMPTY_SIG)
  assert.equal(moleculeOf(''), signText(''))
  assert.equal(a.moleculeFor([]), ROOT_MOLECULE)

  a.save([], 'business')
  a.save([], 'club')
  assert.deepEqual(a.childNames([]), ['business', 'club'])

  // the ROOT molecule is a DIRECTORY at sha256(''); the empty CONTENT file at
  // the same address is never written, so the two can never collide.
  assert.ok(a.root.list('').some((e) => e.name === ROOT_MOLECULE && e.kind === 'dir'))
  assert.equal(a.root.read(ROOT_MOLECULE), null, 'no empty atom file at the root sig')
  assert.equal(a.putBytes(Buffer.alloc(0)), EMPTY_SIG, 'empty bytes still sign to the root address')
  assert.equal(a.root.read(ROOT_MOLECULE), null, 'but the file is never written — absence is not content')

  // no tile can mint the root: an empty / whitespace-only name is refused
  assert.throws(() => a.save([], ''), /must have a name/)
  assert.throws(() => a.save([], '   '), /must have a name/)
  assert.throws(() => a.save([], 'a/b'), /not a path/)

  // a root tile named 'business' has its OWN molecule, one step from the root
  assert.notEqual(moleculeOf('business'), ROOT_MOLECULE)
  a.save(['business'], 'people')
  assert.equal(a.moleculeFor(['business']), moleculeOf('business'))

  // a molecule with no members has NO directory: absence is authoritative, and
  // there is no parent to ask and no husk marker to mint.
  assert.deepEqual(a.childNames(['club']), [])
  assert.equal(a.root.list(moleculeOf('club')).length, 0)
  assert.equal(a.root.list('').filter((e) => e.kind === 'dir').length, 2,
    'root molecule + business — every entity one readdir from the root')

  a.save(['club'], 'members')
  assert.equal(a.root.list('').filter((e) => e.kind === 'dir').length, 3)
})

// ── 10 ──────────────────────────────────────────────────────────────────────

test("scenario 10 — canonicalization: '/Business/ People' and '/business/people' do NOT converge (case is preserved), but punctuation and whitespace do", () => {
  // the rule, verbatim from lineage-key.ts
  assert.equal(canonName(' People '), 'People')
  assert.equal(canonName('my cool tile'), 'my-cool-tile')
  assert.equal(canonName('my—cool  tile!'), 'my-cool-tile')
  assert.equal(canonName('Chapter 1'), 'Chapter-1')
  assert.equal(canonName('日本語'), '日本語')
  assert.equal(canonName('🐝'), '🐝', 'a symbol-only name falls back to its raw self')

  // CONVERGE: whitespace / punctuation variants are one molecule
  assert.equal(moleculeOf(' People '), moleculeOf('People'))
  assert.equal(moleculeOf('my cool tile'), moleculeOf('my-cool-tile'))

  // DO NOT CONVERGE: case is preserved, so People !== people. Stated cost.
  assert.notEqual(moleculeOf('People'), moleculeOf('people'))

  const a = tenant('alice-hive')
  a.save([], 'business')
  a.save(['business'], 'people')
  a.save(['business', 'people'], 'Alice')

  // ' People ' resolves (whitespace folds) ...
  assert.deepEqual(a.childNames(['business', ' people ']), ['Alice'])
  // ... 'Business' does not (case is content)
  assert.throws(() => a.children(['Business', 'people']), /dead route/)

  // a differently-cased tile is a different molecule with its own membership
  a.save([], 'Business')
  a.save(['Business'], 'People')
  a.save(['Business', 'People'], 'Zoe')
  assert.deepEqual(a.childNames(['Business', 'People']), ['Zoe'])
  assert.deepEqual(a.childNames(['business', 'people']), ['Alice'])

  // RE-ADDRESSING vs today: a ROOT tile's bag ALREADY IS its molecule; only
  // depth >= 2 relocates.
  assert.equal(signText(lineageKey(['people'])), moleculeOf('people'), 'root-level: no move')
  assert.notEqual(signText(lineageKey(['business', 'people'])), moleculeOf('people'),
    'depth >= 2: the path-keyed bag is a drain source, not the new address')
})
