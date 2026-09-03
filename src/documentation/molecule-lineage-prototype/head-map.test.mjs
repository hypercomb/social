// head-map.test.mjs — THE REPLACEMENT FOR THE RECURSIVE SEAL.
//
// skeptic-4 attacks the seal and every attack still lands ON THE SEAL; the
// answer is not to repair the fold but to stop folding. These are the same
// fixtures, re-run against `mintHeadMap`:
//
//   A   the cyclic name graph that makes seal() non-terminating
//   A2  the 3-cycle that gives one molecule two merkle identities
//   B   the stranger whose commit re-mints my deploy signature
//   H   the content-only host with no readdir at all
//
// plus one entry-point dependence none of the four names: the seal folds
// `viewOf`, which reads the LOCAL UNDO CURSOR, so pressing undo re-minted the
// deploy root with nothing committed and nothing on disk changed.

import test from 'node:test'
import assert from 'node:assert/strict'

import { MoleculeStore, moleculeOf, ROOT_MOLECULE } from './molecule.mjs'
import { Root } from './root.mjs'
import { hostOf } from './host.mjs'
import { mintKeys, verifyEd25519 } from './keys.mjs'
import { headClaimPreimage } from './head-claim.mjs'
import { sha256, signText, bytesOf } from './sig.mjs'
import {
  canonicalHeadMap,
  claimReaderOf,
  encodeHeadMap,
  headMapClaimFor,
  headMapDiff,
  headMapRegressions,
  mintHeadMap,
  molecularScope,
  parseHeadMap,
  verifyHeadMap,
} from './head-map.mjs'

/** A host that serves bytes and NOTHING else — the shape every static host has. */
const contentOnlyHostOf = (root) => ({
  stats: { listings: 0, gets: 0, misses: 0 },
  list() {
    throw new Error('no directory branch')
  },
  content(sig) {
    this.stats.gets++
    return root.read(sig)
  },
})

// ───────────────────────────────────────────────────────────────────────────
test('A — THE MAP TERMINATES ON THE CYCLIC NAME GRAPH THAT KILLS seal()', () => {
  const s = new MoleculeStore({ author: 'me' })
  s.save([], 'business')
  s.save(['business'], 'people')
  // The exact save from skeptic-4 A: a tile named after its own ancestor.
  s.save(['business', 'people'], 'business')

  // The route is genuinely infinite and every step is live.
  assert.equal(
    s.moleculeFor(['business', 'people', 'business', 'people', 'business']),
    moleculeOf('business'),
  )

  // The fold has no fixpoint here. The ENUMERATION does not need one: it is set
  // MEMBERSHIP, and revisiting a molecule can only re-add what is already in
  // the set — which is precisely why the global visited set that was tried and
  // REVERTED for sealSubtree is sound for a map and was not for a fold.
  const minted = mintHeadMap(s, { route: [] })
  assert.ok(minted, 'the map mints')

  const molecules = minted.record.rows.map((r) => r[0])
  assert.deepEqual(
    [...new Set(molecules)].length,
    molecules.length,
    'every molecule appears EXACTLY ONCE — a cycle is a non-event, not a refusal',
  )
  assert.deepEqual(
    molecules.slice().sort(),
    [ROOT_MOLECULE, moleculeOf('business'), moleculeOf('people')].sort(),
    'the reachable set is the three molecules I head, and no more',
  )
})

// ───────────────────────────────────────────────────────────────────────────
test('A2 — ONE MOLECULE, ONE DEPLOY IDENTITY: the map is entry-point independent', () => {
  const s = new MoleculeStore({ author: 'me' })
  s.save([], 'alpha')
  s.save(['alpha'], 'beta')
  s.save(['alpha', 'beta'], 'gamma')
  s.save(['alpha', 'beta', 'gamma'], 'alpha') // the 3-cycle from skeptic-4 A2

  // `sealCut` cuts on the RECURSION PATH, so beta sealed from the root and beta
  // sealed on its own give two different sigs. There is no path here to cut.
  const fromBeta = mintHeadMap(s, { route: ['alpha', 'beta'] })
  const fromGamma = mintHeadMap(s, { route: ['alpha', 'beta', 'gamma'] })

  assert.equal(
    fromBeta.sig,
    fromGamma.sig,
    'the same set entered by two different doors is ONE signature',
  )
  assert.equal(fromBeta.bytes.toString('utf8'), fromGamma.bytes.toString('utf8'))

  // and a shuffled enumeration of the same set is byte-identical
  const shuffled = canonicalHeadMap(s.pubkey, [...fromBeta.pairs].reverse())
  assert.equal(encodeHeadMap(shuffled), fromBeta.bytes.toString('utf8'))

  // ordering is TOTAL: both tokens are fixed-width lowercase hex, so codepoint
  // order IS byte order and there is no locale or tie-break left to specify.
  const molecules = fromBeta.record.rows.map((r) => r[0])
  assert.deepEqual(molecules, [...molecules].sort())
})

// ───────────────────────────────────────────────────────────────────────────
test('B — A STRANGER CANNOT MOVE MY DEPLOY SIGNATURE (and the map stays honest about it)', () => {
  const shared = new Root()
  const me = new MoleculeStore({ root: shared, author: 'me' })
  me.save([], 'business')
  me.save(['business'], 'people')
  me.save(['business', 'people'], 'Alice')

  const before = mintHeadMap(me, { route: [] })

  // A different tenant, a different key, a different host — filing a person
  // under THEIR 'people' tile. Same word ⇒ same global molecule ⇒ their head
  // lands in my directory the moment I replicate (or merely visit: the cold
  // path replicates every molecule along a route).
  const theirRoot = new Root()
  const them = new MoleculeStore({ root: theirRoot, author: 'stranger' })
  them.save([], 'people')
  them.save(['people'], 'Bob')
  me.replicateMolecule(hostOf(theirRoot), moleculeOf('people'))

  const after = mintHeadMap(me, { route: [] })

  assert.equal(
    after.sig,
    before.sig,
    'the map enumerates MY buckets only, so a foreign commit cannot re-mint it',
  )

  // AND THE MAP IS STILL HONEST. It does not pretend the stranger is not there;
  // it names the molecule and asserts exactly one thing about it — "this is MY
  // head there" — and says nothing about anyone else's bucket. A reader who
  // wants the whole molecule goes to the address.
  assert.ok(
    headMapClaimFor(after.record, moleculeOf('people')),
    'the map still NAMES sign("people") — it is a floor, never a ceiling',
  )
  assert.deepEqual(
    me.childNames(['business', 'people']).sort(),
    ['Alice', 'Bob'],
    'and the PAGE still unions both authors: the firehose is unaffected',
  )
  assert.equal(
    me.heads(moleculeOf('people')).length, 2,
    'two buckets in the molecule, one of them mine — and only mine is enumerated',
  )
})

// ───────────────────────────────────────────────────────────────────────────
test('B2 — NOR CAN MY OWN UNDO CURSOR: the map is built from HEADS, never from a view', () => {
  // Not one of the four named attacks, and arguably the worst of them: the seal
  // folds `viewOf`, which reads `this.cursors`, so pressing UNDO re-minted the
  // deploy root with nothing committed anywhere and nothing on disk changed.
  // A deploy signature must not be a function of session state.
  const s = new MoleculeStore({ author: 'me' })
  s.save([], 'notes')
  s.save(['notes'], 'draft', { text: 'v1' })
  s.save(['notes'], 'draft', { text: 'v2' })

  const before = mintHeadMap(s, { route: [] })
  assert.equal(s.undo(['notes']), true)
  assert.deepEqual(s.children(['notes']).map((r) => r.name), ['draft'])
  const after = mintHeadMap(s, { route: [] })

  assert.equal(after.sig, before.sig, 'undo moves the RENDERED page and never the deploy')
  assert.equal(after.bytes.toString('utf8'), before.bytes.toString('utf8'))
})

// ───────────────────────────────────────────────────────────────────────────
test('H — A DEPLOY VERIFIES FROM IMMUTABLE ATOMS ALONE, WITH NO DIRECTORY LISTING', () => {
  const srcRoot = new Root()
  const src = new MoleculeStore({ root: srcRoot, author: 'me' })
  src.save([], 'business')
  src.save(['business'], 'people')
  src.save(['business', 'people'], 'Alice')
  const deploy = mintHeadMap(src, { route: [] })

  // The visitor holds ONE signature and the publisher's key, and a host with no
  // readdir branch at all — the shape skeptic-4 H says a sealed pin cannot
  // survive.
  const host = contentOnlyHostOf(srcRoot)
  assert.throws(() => host.list(''), /no directory branch/)

  // 1. GET /<deploySig>, assert the hash, refuse-or-parse.
  const bytes = host.content(deploy.sig)
  assert.equal(sha256(bytes), deploy.sig, 'the bytes are the ones named')
  const record = parseHeadMap(bytes.toString('utf8'))
  assert.ok(record, 'the canonical form parses')

  // 2. Each row: GET /<claimSig>, assert the hash, rebuild the preimage from
  //    the row KEY and the key I asked for, check the signature.
  const verdict = verifyHeadMap(record, src.pubkey, claimReaderOf(host, verifyEd25519))
  assert.equal(verdict.ok, true)
  assert.equal(verdict.holes.length, 0)
  assert.deepEqual(
    verdict.verified.map((v) => v.molecule).sort(),
    [ROOT_MOLECULE, moleculeOf('business'), moleculeOf('people')].sort(),
  )

  // 3. Each verified head is reachable BY SIGNATURE, and its closure with it.
  const visitor = new MoleculeStore({ root: new Root(), author: 'visitor' })
  for (const row of verdict.verified) visitor.pullClosure(host, row.head)
  for (const row of verdict.verified) assert.ok(visitor.getAtom(row.head), 'the head atom arrives')

  assert.equal(host.stats.listings, 0, 'ZERO listings — the host has no listing verb to call')
})

// ───────────────────────────────────────────────────────────────────────────
test('H2 — the two substitution doors are shut: a wrong key, and a row moved between molecules', () => {
  const root = new Root()
  const me = new MoleculeStore({ root, author: 'me' })
  me.save([], 'alpha')
  me.save(['alpha'], 'beta')
  const deploy = mintHeadMap(me, { route: [] })
  const host = contentOnlyHostOf(root)
  const read = claimReaderOf(host, verifyEd25519)

  // (a) verified against a key that is not the publisher's: FORGED, before any
  //     byte is trusted. `record.pubkey` is self-declared and is COMPARED.
  const stranger = mintKeys()
  const forged = verifyHeadMap(deploy.record, stranger.pubkey, read)
  assert.equal(forged.ok, false)
  assert.equal(forged.reason, 'forged')

  // (b) two of MY OWN rows swapped. Both claims are genuinely mine and
  //     genuinely signed — and both refuse, because the molecule the reader
  //     walked to is line two of the preimage it rebuilds.
  const [a, b] = deploy.record.rows
  const swapped = canonicalHeadMap(me.pubkey, [
    { molecule: a[0], claim: b[1] },
    { molecule: b[0], claim: a[1] },
    ...deploy.record.rows.slice(2).map(([molecule, claim]) => ({ molecule, claim })),
  ])
  const moved = verifyHeadMap(swapped, me.pubkey, read)
  assert.equal(moved.ok, false)
  assert.ok(
    moved.holes.some((h) => h.molecule === a[0] && h.reason === 'unsigned'),
    'a claim lifted to another row does not verify at its new address',
  )

  // (c) a claim minted by another key for one of my molecules is a HOLE, never
  //     a verified head — the map cannot speak for a bucket it does not own.
  const lie = { head: sha256(Buffer.from('nothing')), prev: null, seq: 0 }
  lie.sig = stranger.sign(headClaimPreimage(a[0], stranger.pubkey, lie.head, null, 0))
  const lieBytes = bytesOf(lie)
  root.write(sha256(lieBytes), lieBytes)
  const overreach = canonicalHeadMap(me.pubkey, [{ molecule: a[0], claim: sha256(lieBytes) }])
  const verdict = verifyHeadMap(overreach, me.pubkey, read)
  assert.deepEqual(verdict.holes.map((h) => h.reason), ['unsigned'])
})

// ───────────────────────────────────────────────────────────────────────────
test('a molecule that is a MEMBER OF ITSELF is one row, and a duplicate with two claims REFUSES', () => {
  const s = new MoleculeStore({ author: 'me' })
  s.save([], 'people')
  s.save(['people'], 'people') // the tightest possible cycle

  const minted = mintHeadMap(s, { route: [] })
  const rows = minted.record.rows.filter((r) => r[0] === moleculeOf('people'))
  assert.equal(rows.length, 1, 'one molecule, one row')

  // and the map is a FUNCTION, not a bag: two answers for one molecule refuse
  // the whole record rather than quietly picking one.
  assert.equal(
    canonicalHeadMap(s.pubkey, [
      { molecule: moleculeOf('people'), claim: sha256(Buffer.from('a')) },
      { molecule: moleculeOf('people'), claim: sha256(Buffer.from('b')) },
    ]),
    null,
  )
})

// ───────────────────────────────────────────────────────────────────────────
test('the deploy is IDEMPOTENT (no clock in the bytes) and a REPLAY is caught per row', () => {
  const root = new Root()
  const s = new MoleculeStore({ root, author: 'me' })
  s.save([], 'notes')
  s.save(['notes'], 'draft', { text: 'v1' })

  const first = mintHeadMap(s, { route: [] })
  const rebuilt = mintHeadMap(s, { route: [] })
  assert.equal(rebuilt.sig, first.sig, 'a rebuild that changed nothing is the SAME signature')

  s.save(['notes'], 'draft', { text: 'v2' })
  const second = mintHeadMap(s, { route: [] })
  assert.notEqual(second.sig, first.sig, 'a real edit moves it')

  const delta = headMapDiff(first.record, second.record)
  assert.deepEqual(delta.moved, [moleculeOf('notes')], 'and the diff says WHICH molecule moved')
  assert.deepEqual(delta.added, [])
  assert.deepEqual(delta.removed, [])

  // BOTH maps verify, and that is correct: every byte of the older one is
  // genuinely signed by me for this exact address, so a host replaying it
  // FORGES NOTHING and a verifier must not call it forged. What separates them
  // is inside the SIGNATURE — `seq`, which cannot be raised without the secret.
  const read = claimReaderOf(contentOnlyHostOf(root), verifyEd25519)
  const older = verifyHeadMap(first.record, s.pubkey, read)
  const newer = verifyHeadMap(second.record, s.pubkey, read)
  assert.equal(older.ok, true)
  assert.equal(newer.ok, true)
  assert.deepEqual(
    headMapRegressions(newer.verified, older.verified).map((r) => r.molecule),
    [moleculeOf('notes')],
    'a reader that has seen the newer generation can never be talked back down',
  )
  assert.deepEqual(headMapRegressions(older.verified, newer.verified), [])
})

// ───────────────────────────────────────────────────────────────────────────
test('REFUSE-OR-PARSE: a second spelling of one set cannot exist', () => {
  const s = new MoleculeStore({ author: 'me' })
  s.save([], 'business')
  s.save(['business'], 'people')
  const { record, bytes } = mintHeadMap(s, { route: [] })
  const canonical = bytes.toString('utf8')

  assert.deepEqual(parseHeadMap(canonical), record)
  assert.equal(parseHeadMap(`${canonical} `), null, 'trailing space')
  assert.equal(parseHeadMap(JSON.stringify(JSON.parse(canonical), null, 2)), null, 'pretty-printed')
  assert.equal(parseHeadMap(canonical.replace('"v":1', '"v":2')), null, 'a v2 REFUSES rather than mis-parses')
  assert.equal(parseHeadMap(canonical.replace('{"kind"', '{"at":1,"kind"')), null, 'an added field')

  // rows out of order: same meaning, different bytes, refused
  const reversed = `{"kind":"hypercomb.head-map","v":1,"pubkey":"${record.pubkey}","rows":[` +
    [...record.rows].reverse().map(([m, c]) => `["${m}","${c}"]`).join(',') +
    `],"refs":[${record.refs.map((r) => `"${r}"`).join(',')}]}`
  assert.equal(parseHeadMap(reversed), null)
})

// ───────────────────────────────────────────────────────────────────────────
test('the scope is MY OWN HEADS: a molecule I only read is named by nobody', () => {
  const shared = new Root()
  const me = new MoleculeStore({ root: shared, author: 'me' })
  me.save([], 'business')
  me.save(['business'], 'mine')

  // A molecule that exists in my directory but that I have never committed to
  // (a stranger's, replicated in) must not appear in MY map: I hold no claim
  // there, so I have nothing to assert.
  const theirRoot = new Root()
  const them = new MoleculeStore({ root: theirRoot, author: 'stranger' })
  them.save([], 'business')
  them.save(['business'], 'theirs')
  me.replicateMolecule(hostOf(theirRoot), moleculeOf('theirs'))

  const pairs = molecularScope(me, [])
  assert.ok(
    !pairs.some((p) => p.molecule === moleculeOf('theirs')),
    'sign("theirs") is in my root and is NOT in my map — I head nothing there',
  )
  assert.ok(
    pairs.some((p) => p.molecule === moleculeOf('business')),
    'and sign("business"), which I DO head, is in it',
  )
  // The rule stated plainly: a molecule is enumerated iff I hold a claim in it.
  // Reachability decides which molecules are LOOKED AT; my own bucket decides
  // which are NAMED. `sign("theirs")` is reachable from nothing of mine anyway,
  // and `sign("mine")` is reachable but headless, so neither is asserted.
  assert.ok(!pairs.some((p) => p.molecule === moleculeOf('mine')))
  void signText
})
