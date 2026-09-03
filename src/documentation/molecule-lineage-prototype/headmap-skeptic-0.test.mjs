// headmap-skeptic-0.test.mjs — AN ADVERSARIAL PASS OVER STEP 4, ONE LENS ONLY:
// TERMINATION AND CYCLES IN THE DEPLOY AND VERIFICATION PATHS.
//
// Step 4's claim is that the recursive seal is replaced by "a flat enumeration
// of what THIS publisher publishes, never a walk". The canonical-form half of
// that claim HELD from the first cut and is re-proved here from new angles
// (H-1, H-2, H-3).
//
// The enumeration half did NOT, and six attacks landed. All six are FIXED now;
// every fixture below is kept VERBATIM and the assertions are inverted to the
// behaviour that closed it, so the day one regresses this file says which.
//
//   T-1  `mintHeadMap(store, {route})` was `molecularScope`, a reachability
//        walk over MY OWN heads whose stop condition was "I hold no claim
//        here". One tile somebody else made in the middle of a route amputated
//        every page of mine underneath it, silently. FIXED: the whole-hive
//        scope is the mint LEDGER (a list, no graph at all), and a branch scope
//        walks the UNION of every author's heads as its FILTER while still
//        asserting only my own claims as its CONTENT.
//   T-2  the root scope was not a superset of a branch scope inside it. FIXED
//        by the same change: the ledger contains every molecule I head.
//   T-3  a contributor who never made a top-level tile minted a ZERO-ROW
//        deploy. FIXED.
//   T-4  evicting ONE succession atom silently shrank the deploy and moved its
//        signature, because the walk read members out of the missing atom and
//        `?? []` swallowed the difference between "missing" and "childless".
//        FIXED: the ledger and the bucket claim decide, and a molecule the walk
//        could not descend is REPORTED as `opaque`.
//   T-5  step 5 of the documented verification recipe was `pullClosure`, which
//        recursed once per edge with NO depth bound, so ~20k tiny atoms from
//        one host blew the verifier's stack. FIXED: iterative, with an explicit
//        worklist and a distinct-atom budget.
//   T-6  `encodeHeadMap` had no size gate and `parseHeadMap` capped at 4 MiB —
//        the exact writer/reader asymmetry the module's own comment forbids.
//        FIXED in core AND mirrored here, plus `splitHeadMap` so the cap is not
//        a cliff.
//
// CONVENTION IN THIS FILE, stated because the other skeptic files do not share
// one: EVERY TEST NOW ASSERTS THE REQUIREMENT. A test that FAILS here means a
// closed defect came back. (It was written the other way round — a PASS
// reproduced the defect — which is why every assertion message that used to
// begin "THE DEFECT:" now begins "FIXED:".)

import test from 'node:test'
import assert from 'node:assert/strict'

import { MoleculeStore, moleculeOf, ROOT_MOLECULE } from './molecule.mjs'
import { Root } from './root.mjs'
import { sha256, bytesOf, signText } from './sig.mjs'
import {
  HEAD_MAP_MAX_BYTES,
  canonicalHeadMap,
  encodeHeadMap,
  headMapRefusal,
  mintHeadMap,
  mintedScope,
  molecularScope,
  parseHeadMap,
  splitHeadMap,
  verifyHeadMapRows,
} from './head-map.mjs'

const short = (s) => String(s).slice(0, 8)

// ═══════════════════════════════════════════════════════════════════════════
// HOLDS — the termination argument itself. These are pins, not attacks.
// ═══════════════════════════════════════════════════════════════════════════

test('H-1 HOLDS — every cycle shape I can build terminates, and mints deterministically', () => {
  const s = new MoleculeStore({ author: 'me' })
  // (a) a tile that is a member of itself
  s.save([], 'ouroboros')
  s.save(['ouroboros'], 'ouroboros')
  // (b) a 2-cycle
  s.save([], 'ping')
  s.save(['ping'], 'pong')
  s.save(['ping', 'pong'], 'ping')
  // (c) a tile named after a distant ancestor
  s.save([], 'a')
  s.save(['a'], 'b')
  s.save(['a', 'b'], 'c')
  s.save(['a', 'b', 'c'], 'd')
  s.save(['a', 'b', 'c', 'd'], 'a')
  // (d) two cycles sharing a molecule
  s.save(['ping'], 'a')

  const first = mintHeadMap(s, { route: [] })
  const again = mintHeadMap(s, { route: [] })
  assert.ok(first, 'the map mints on a name graph with four independent cycles')
  assert.equal(first.sig, again.sig, 'and mints the same signature twice')
  const molecules = first.record.rows.map((r) => r[0])
  assert.equal(new Set(molecules).size, molecules.length, 'no molecule appears twice')
  assert.deepEqual(molecules, [...molecules].sort(), 'rows are in total hex order')

  // and the BRANCH scope, which is the only thing that still walks anything,
  // terminates on all four cycles too.
  for (const route of [['ping'], ['a'], ['ouroboros'], ['a', 'b', 'c', 'd']]) {
    const branch = mintHeadMap(s, { route })
    assert.ok(branch, `a branch scope at /${route.join('/')} mints`)
    const mols = branch.record.rows.map((r) => r[0])
    assert.equal(new Set(mols).size, mols.length)
  }
})

test('H-1b HOLDS — a 400-deep name chain mints without recursing (no stack in the enumeration)', () => {
  const s = new MoleculeStore({ author: 'me' })
  const route = []
  for (let i = 0; i < 400; i++) {
    s.save(route.slice(), `n${i}`)
    route.push(`n${i}`)
  }
  const minted = mintHeadMap(s, { route: [] })
  assert.ok(minted, 'a 400-deep chain enumerates')
  // the root plus n0..n398; the leaf n399 has no members, so I head nothing there.
  assert.equal(minted.record.rows.length, 400)
})

test('H-2 HOLDS — ROUTE independence: two routes to one molecule are byte-identical maps', () => {
  const s = new MoleculeStore({ author: 'me' })
  s.save([], 'alpha')
  s.save(['alpha'], 'beta')
  s.save(['alpha', 'beta'], 'gamma')
  s.save(['alpha', 'beta', 'gamma'], 'alpha') // the 3-cycle

  // The SAME molecule, reached by walking once round the cycle. `moleculeFor`
  // collapses the route to a name, so there is no path for the map to remember.
  const shortRoute = mintHeadMap(s, { route: ['alpha', 'beta'] })
  const longRoute = mintHeadMap(s, { route: ['alpha', 'beta', 'gamma', 'alpha', 'beta'] })
  assert.equal(shortRoute.sig, longRoute.sig)
  assert.equal(shortRoute.bytes.toString('utf8'), longRoute.bytes.toString('utf8'))
})

test('H-3 HOLDS — the rows door is a FLAT LOOP: 5,000 rows, no recursion, no stack growth', () => {
  const pairs = []
  for (let i = 0; i < 5000; i++) {
    pairs.push({ molecule: sha256(Buffer.from(`m${i}`)), claim: sha256(Buffer.from(`c${i}`)) })
  }
  const key = sha256(Buffer.from('k'))
  const record = canonicalHeadMap(key, pairs)
  const verdict = verifyHeadMapRows(record, key, () => null)
  assert.equal(verdict.rowsAuthentic, false)
  assert.equal(verdict.holes.length, 5000, 'every row is its own hole; nothing collapses')
  assert.equal(verdict.reason, 'incomplete')
})

// ═══════════════════════════════════════════════════════════════════════════
// T-1 — THE ENUMERATION IS FLAT AT THE ROOT, AND A BRANCH WALKS THE UNION.
// ═══════════════════════════════════════════════════════════════════════════

test('T-1 A TILE SOMEBODY ELSE MADE NO LONGER AMPUTATES MY SUBTREE FROM THE DEPLOY', () => {
  // The design's headline case (scenario 2, and skeptic-4 B's own resolution):
  // one name is one page and many authors commit to it. Here the middle tile of
  // a four-deep route was created by a stranger — which used to be all it took.
  const shared = new Root()
  const me = new MoleculeStore({ root: shared, author: 'me' })
  const them = new MoleculeStore({ root: shared, author: 'stranger' })

  me.save([], 'shop')                      // I head the ROOT molecule
  them.save(['shop'], 'aisle')             // THEY head sign('shop'); I never commit there
  me.save(['shop', 'aisle'], 'jam')        // I head sign('aisle')
  me.save(['shop', 'aisle', 'jam'], 'lid') // I head sign('jam')

  // I genuinely head three molecules, and the flat scope — the mint ledger,
  // which the doc calls the whole-hive scope — is what a root publish uses.
  const expected = [ROOT_MOLECULE, moleculeOf('aisle'), moleculeOf('jam')].sort()
  assert.deepEqual(mintedScope(me).pairs.map((p) => p.molecule).sort(), expected,
    'the LEDGER knows I head root, aisle and jam')

  // The walk now descends THEIR head at sign('shop') instead of stopping at it,
  // so reachability finds the same three.
  const walked = molecularScope(me, []).pairs.map((p) => p.molecule).sort()
  assert.deepEqual(walked, expected,
    'FIXED: reachability is over the UNION of authors, so a stranger\'s page is walked THROUGH')

  const deploy = mintHeadMap(me, { route: [] })
  assert.equal(deploy.record.rows.length, 3)
  assert.equal(
    deploy.record.rows.some((r) => r[0] === moleculeOf('jam')), true,
    'FIXED: /shop/aisle/jam is a page I own, is on disk, and is NAMED in my deploy',
  )
  assert.ok(parseHeadMap(deploy.bytes.toString('utf8')), 'and it is a valid deploy')
  // Nothing was lost, and the report says so rather than staying silent.
  assert.deepEqual(deploy.unresolved, [])
  assert.deepEqual(deploy.outOfScope, [])
})

test('T-2 THE ROOT SCOPE IS A SUPERSET OF EVERY BRANCH SCOPE INSIDE IT', () => {
  const shared = new Root()
  const me = new MoleculeStore({ root: shared, author: 'me' })
  const them = new MoleculeStore({ root: shared, author: 'stranger' })
  me.save([], 'shop')
  them.save(['shop'], 'aisle')
  me.save(['shop', 'aisle'], 'jam')
  me.save(['shop', 'aisle', 'jam'], 'lid')

  const wide = mintHeadMap(me, { route: [] })                  // "publish everything"
  const deep = mintHeadMap(me, { route: ['shop', 'aisle'] })   // "publish this branch"

  const wideSet = new Set(wide.record.rows.map((r) => r[0]))
  assert.equal(
    deep.record.rows.every((r) => wideSet.has(r[0])),
    true,
    'FIXED: publishing from the ROOT publishes at least everything a branch inside it does',
  )
  assert.deepEqual(deep.record.rows.map((r) => r[0]).sort(),
    [moleculeOf('aisle'), moleculeOf('jam')].sort())
  assert.deepEqual(wide.record.rows.map((r) => r[0]).sort(),
    [ROOT_MOLECULE, moleculeOf('aisle'), moleculeOf('jam')].sort())
  // The two are still different signatures — a branch publish IS a smaller
  // statement — but the difference is now NAMED instead of silent.
  assert.notEqual(wide.sig, deep.sig)
  assert.deepEqual(deep.outOfScope, [ROOT_MOLECULE],
    'FIXED: a branch publish reports the molecules it leaves behind')
})

test('T-3 A CONTRIBUTOR WHO ONLY WORKS INSIDE OTHER PEOPLE\'S PAGES PUBLISHES THEIR PAGES', () => {
  // The most common shape a federated hive can have: I never made a top-level
  // tile; everything I own hangs under a page somebody else started.
  const shared = new Root()
  const them = new MoleculeStore({ root: shared, author: 'stranger' })
  them.save([], 'alpha')
  them.save(['alpha'], 'beta')

  const me = new MoleculeStore({ root: shared, author: 'me' })
  me.save(['alpha', 'beta'], 'gamma')
  me.save(['alpha', 'beta', 'gamma'], 'delta')

  assert.equal(me.minted.size, 2, 'I hold two signed heads')
  const deploy = mintHeadMap(me, { route: [] })
  assert.deepEqual(
    deploy.record.rows.map((r) => r[0]).sort(),
    [moleculeOf('beta'), moleculeOf('gamma')].sort(),
    'FIXED: both of my pages are in my deploy',
  )
  // It is no longer byte-identical to the deploy of someone who has published
  // nothing — which nothing anywhere could have told apart, since an EMPTY map
  // is a legitimate deploy for a publisher who really does own nothing.
  assert.notEqual(
    deploy.bytes.toString('utf8'),
    encodeHeadMap(canonicalHeadMap(me.pubkey, [])),
  )
  assert.equal(mintHeadMap(me, {}).sig, deploy.sig, 'and the ledger scope IS the root scope now')
})

// ═══════════════════════════════════════════════════════════════════════════
// T-4 — THE MAP IS A FUNCTION OF (pubkey, my claims).
// ═══════════════════════════════════════════════════════════════════════════

test('T-4 EVICTING ONE SUCCESSION ATOM LEAVES THE DEPLOY ALONE, AND IS REPORTED', () => {
  // skeptic-4 F is live: a derived-cache wipe (doctrine says pools are
  // wipe-safe) destroys atoms. The mint ledger and every bucket claim survive
  // that; the succession BYTES do not. My AUTHORITY did not change, so my
  // deploy must not either.
  const root = new Root()
  const s = new MoleculeStore({ root, author: 'me' })
  s.save([], 'business')
  s.save(['business'], 'people')
  s.save(['business', 'people'], 'Alice')

  const before = mintHeadMap(s, { route: [] })
  assert.equal(before.record.rows.length, 3)

  const businessHead = s.heldClaim(moleculeOf('business')).head
  root.remove(businessHead) // one atom, gone

  const after = mintHeadMap(s, { route: [] })
  assert.ok(
    s.heldClaim(moleculeOf('people')),
    'I still hold a signed claim at sign("people") — nothing about my authority changed',
  )
  assert.equal(
    after.record.rows.some((r) => r[0] === moleculeOf('people')), true,
    'FIXED: and it is still in the map. The root scope reads the LEDGER, not the atoms.',
  )
  assert.equal(after.sig, before.sig, 'FIXED: the deploy signature did not move')
  assert.equal(after.record.rows.length, 3)

  // AND A BRANCH SCOPE, WHICH DOES STILL WALK, SAYS SO INSTEAD OF SWALLOWING
  // IT. The old code treated a missing atom exactly like a childless one:
  // `store.getAtom(claim.head)` was undefined and `?? []` ate the difference.
  const branch = mintHeadMap(s, { route: ['business'] })
  assert.ok(
    branch.opaque.some((o) => o.head === businessHead),
    'FIXED: the molecule the walk could not descend is REPORTED as opaque',
  )
  void short
})

// ═══════════════════════════════════════════════════════════════════════════
// T-5 — THE VERIFICATION RECIPE'S STEP 5 NO LONGER RECURSES.
// ═══════════════════════════════════════════════════════════════════════════

test('T-5 STEP 5 OF THE DOCUMENTED VERIFICATION IS ITERATIVE: 20k CHAINED ATOMS DO NOT BLOW THE STACK', () => {
  // `documentation/hypergraph-molecule-lineage.md` step 5: "per verified row:
  // GET /<head>, assert the hash, WALK ITS MEMBERS BY SIGNATURE AS TODAY."
  // As today WAS `pullClosure`, which recursed per edge with a visited set and
  // NO DEPTH BOUND. Hash-checking cannot save it: the bytes are the publisher's
  // own, so the publisher picks the depth, and the threshold sat between 4k and
  // 8k atoms of a few dozen bytes each — the whole weapon under a megabyte.
  const wire = new Root()
  let head = null
  for (let i = 0; i < 20000; i++) {
    const atom = head ? { kind: 'succession', members: [head] } : { kind: 'succession', members: [] }
    const bytes = bytesOf(atom)
    head = sha256(bytes)
    wire.write(head, bytes)
  }
  const host = { list: (d, o) => wire.list(d, o), content: (p) => wire.read(p) }

  const visitor = new MoleculeStore({ root: new Root(), author: 'visitor' })
  const report = visitor.pullClosure(host, head)
  assert.equal(report.capped, false, 'FIXED: the walk completes — depth costs a queue entry, not a frame')
  assert.equal(report.fetched, 20000, 'and every atom arrived exactly once')
  assert.ok(visitor.getAtom(head))

  // The second belt: a hostile host can still serve an unbounded number of
  // DISTINCT atoms, so a reader must be able to STOP without pretending it
  // finished. The budget is explicit and the report says it was hit.
  const bounded = new MoleculeStore({ root: new Root(), author: 'bounded' })
  const capped = bounded.pullClosure(host, head, new Set(), { budget: 100 })
  assert.equal(capped.capped, true, 'FIXED: a bounded pull reports that it stopped')
  assert.ok(capped.visited <= 101)
  void signText
})

// ═══════════════════════════════════════════════════════════════════════════
// T-6 — THE WRITER AND THE READER NOW HAVE THE SAME GATE.
// ═══════════════════════════════════════════════════════════════════════════

test('T-6 THE ENCODER REFUSES WHAT THE READER WOULD REFUSE, AND splitHeadMap IS THE WAY OVER', () => {
  // `core/head-map.ts` used to cap `parseHeadMap` at 1<<22 and `encodeHeadMap`
  // at nothing — the precise asymmetry its own doc comment forbids ("a writer
  // that can emit bytes no reader will parse ... publishes a deploy nobody can
  // verify"). A row costs 203 bytes, so the wall is ~20,660 molecules, and ONE
  // more tile name lost not one molecule but every molecule.
  const pairs = []
  for (let i = 0; i < 20800; i++) {
    pairs.push({ molecule: sha256(Buffer.from(`m${i}`)), claim: sha256(Buffer.from(`c${i}`)) })
  }
  const record = canonicalHeadMap(sha256(Buffer.from('k')), pairs)
  assert.throws(
    () => encodeHeadMap(record),
    RangeError,
    'FIXED: the mint fails LOUDLY at the writer instead of publishing unreadable bytes',
  )

  // THE MIRROR IS FAITHFUL NOW TOO. This file's `parseHeadMap` opened with a
  // type check and never looked at the length, so the prototype round-tripped
  // bytes core returned null for — a twin that diverges on the one guard
  // capable of rejecting a real deploy cannot be where the behaviour is proved.
  const under = encodeHeadMap(canonicalHeadMap(sha256(Buffer.from('k')), pairs.slice(0, 20660)))
  assert.ok(under.length <= HEAD_MAP_MAX_BYTES)
  assert.ok(parseHeadMap(under), 'FIXED: 20,660 rows is exactly at the wall and parses')
  assert.equal(headMapRefusal(under), null)
  assert.equal(headMapRefusal(`${'x'.repeat(HEAD_MAP_MAX_BYTES + 1)}`), 'oversize',
    'FIXED: and the refusal says WHICH gate failed — "too big" is not "tampered with"')

  // AND THE CAP IS NOT A CLIFF. A map is a SET, and a set splits: a large
  // publisher names several map atoms and a reader unions them.
  const shards = splitHeadMap(record)
  assert.equal(shards.length, 2)
  assert.equal(shards.reduce((n, s) => n + s.rows.length, 0), 20800, 'every molecule survives the split')
  for (const shard of shards) assert.ok(parseHeadMap(encodeHeadMap(shard)))
  const seen = new Set(shards.flatMap((s) => s.rows.map((r) => r[0])))
  assert.equal(seen.size, 20800, 'and no molecule is duplicated or dropped across shards')
  // deterministic: the split is cut in canonical row order
  assert.deepEqual(splitHeadMap(record).map((s) => s.rows.length), shards.map((s) => s.rows.length))
})
