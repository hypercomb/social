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
//
// AND, SINCE THE THIRD-PARTY REVIEW OF STEP 4 ITSELF: the SET is signed. Every
// row was independently signed and the composition was signed by nobody, so a
// stranger could compose a truncation, an empty deploy or a cherry-picked
// mixture of generations out of the publisher's own rows and have it verify
// clean. `verifyDeploy` is the door that refuses those; `verifyHeadMapRows` is
// the weaker inner half and its verdict has no `ok` field at all, so the two
// answers can never be confused. The attacks live in headmap-skeptic-*.

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
  headMapAttestationPreimage,
  headMapClaimFor,
  headMapDiff,
  headMapRegressions,
  headReaderOf,
  mintHeadMap,
  molecularScope,
  parseHeadMap,
  verifyDeploy,
  verifyHeadMapRows,
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

/** The full third-party procedure, from the two things a visitor is given. */
const verifyMinted = (store, host, minted, { readHead = true } = {}) => verifyDeploy(
  { sig: minted.sig, bytes: minted.bytes.toString('utf8'), attestation: minted.attestation },
  store.pubkey,
  {
    verify: verifyEd25519,
    readClaim: claimReaderOf(host, verifyEd25519),
    readHead: readHead ? headReaderOf(host) : null,
  },
)

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

  // The fold has no fixpoint here. The ENUMERATION does not need one: the
  // whole-hive scope is the mint LEDGER, which is a list and has no graph in it
  // at all, and a branch scope is set MEMBERSHIP, where revisiting a molecule
  // can only re-add what is already in the set — which is precisely why the
  // global visited set that was tried and REVERTED for sealSubtree is sound for
  // a map and was not for a fold.
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
    'the set is the three molecules I head, and no more',
  )
  // and a BRANCH scope over the same cycle terminates too
  const branch = mintHeadMap(s, { route: ['business'] })
  assert.ok(branch, 'a branch scope on a cyclic graph mints')
  assert.equal(new Set(branch.record.rows.map((r) => r[0])).size, branch.record.rows.length)
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
test('A3 — THE ROOT SCOPE CONTAINS EVERY BRANCH SCOPE INSIDE IT', () => {
  // The first cut of `molecularScope` walked MY OWN heads and stopped at any
  // molecule I did not head, so publishing "everything from the root" published
  // strictly LESS than publishing a branch inside it, and neither contained the
  // other. The root scope is the LEDGER now, which is a superset by definition.
  const shared = new Root()
  const me = new MoleculeStore({ root: shared, author: 'me' })
  const them = new MoleculeStore({ root: shared, author: 'stranger' })
  me.save([], 'shop')
  them.save(['shop'], 'aisle') // a tile in the middle of MY route, made by somebody else
  me.save(['shop', 'aisle'], 'jam')
  me.save(['shop', 'aisle', 'jam'], 'lid')

  const wide = mintHeadMap(me, { route: [] })
  const deep = mintHeadMap(me, { route: ['shop', 'aisle'] })
  const wideSet = new Set(wide.record.rows.map((r) => r[0]))

  assert.ok(
    deep.record.rows.every((r) => wideSet.has(r[0])),
    'every molecule a branch publishes is in the whole-hive publish',
  )
  assert.deepEqual(
    wide.record.rows.map((r) => r[0]).sort(),
    [ROOT_MOLECULE, moleculeOf('aisle'), moleculeOf('jam')].sort(),
    'and the stranger\'s tile does not amputate /shop/aisle/jam from my deploy',
  )
  assert.deepEqual(deep.outOfScope.sort(), [ROOT_MOLECULE].sort(),
    'a branch publish REPORTS what it leaves behind rather than dropping it silently')
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

  // and the same for a BRANCH scope, which reads `heads` and not `viewOf`
  const branchBefore = mintHeadMap(s, { route: ['notes'] }).sig
  s.undo(['notes'])
  assert.equal(mintHeadMap(s, { route: ['notes'] }).sig, branchBefore)
})

// ───────────────────────────────────────────────────────────────────────────
test('H — A DEPLOY VERIFIES FROM IMMUTABLE ATOMS ALONE, WITH NO DIRECTORY LISTING', () => {
  const srcRoot = new Root()
  const src = new MoleculeStore({ root: srcRoot, author: 'me' })
  src.save([], 'business')
  src.save(['business'], 'people')
  src.save(['business', 'people'], 'Alice')
  const deploy = mintHeadMap(src, { route: [] })

  // The visitor holds ONE signature, the publisher's key, the attestation, and
  // a host with no readdir branch at all — the shape skeptic-4 H says a sealed
  // pin cannot survive.
  const host = contentOnlyHostOf(srcRoot)
  assert.throws(() => host.list(''), /no directory branch/)

  // 1. GET /<deploySig>, assert the hash, refuse-or-parse.
  const bytes = host.content(deploy.sig)
  assert.equal(sha256(bytes), deploy.sig, 'the bytes are the ones named')
  assert.ok(parseHeadMap(bytes.toString('utf8')), 'the canonical form parses')

  // 2. The whole procedure in one door: hash, parse, compare the key, check the
  //    ATTESTATION over these exact bytes, then each row — GET /<claimSig>,
  //    hash it, rebuild the preimage from the row KEY and the key I asked for.
  const verdict = verifyMinted(src, host, deploy)
  assert.equal(verdict.ok, true)
  assert.equal(verdict.attested, true)
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
test('H2 — the substitution doors are shut: a wrong key, a moved row, a swapped byte', () => {
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
  const forged = verifyDeploy(
    { sig: deploy.sig, bytes: deploy.bytes.toString('utf8'), attestation: deploy.attestation },
    stranger.pubkey,
    { verify: verifyEd25519, readClaim: read },
  )
  assert.equal(forged.ok, false)
  assert.equal(forged.reason, 'forged')

  // (b) the bytes a host served are not the ones the signature names: FORGED.
  //     This is the step the module used to have no function for at all.
  const other = mintHeadMap(me, { route: ['alpha'] })
  const swapped = verifyDeploy(
    { sig: deploy.sig, bytes: other.bytes.toString('utf8'), attestation: deploy.attestation },
    me.pubkey,
    { verify: verifyEd25519, readClaim: read },
  )
  assert.equal(swapped.reason, 'forged', 'the deploy signature is checked against the bytes')

  // (c) two of MY OWN rows swapped. Both claims are genuinely mine and
  //     genuinely signed — and both refuse, because the molecule the reader
  //     walked to is line two of the preimage it rebuilds. (The rows door is
  //     used directly here: a swapped set has no attestation, so `verifyDeploy`
  //     would refuse it one step earlier and never reach the rows.)
  const [a, b] = deploy.record.rows
  const moved = verifyHeadMapRows(
    canonicalHeadMap(me.pubkey, [
      { molecule: a[0], claim: b[1] },
      { molecule: b[0], claim: a[1] },
      ...deploy.record.rows.slice(2).map(([molecule, claim]) => ({ molecule, claim })),
    ]),
    me.pubkey,
    read,
  )
  assert.equal(moved.rowsAuthentic, false)
  assert.ok(
    moved.holes.some((h) => h.molecule === a[0] && h.reason === 'unsigned'),
    'a claim lifted to another row does not verify at its new address',
  )

  // (d) a claim minted by another key for one of my molecules is a HOLE, never
  //     a verified head — the map cannot speak for a bucket it does not own.
  const lie = { head: sha256(Buffer.from('nothing')), prev: null, seq: 0 }
  lie.sig = stranger.sign(headClaimPreimage(a[0], stranger.pubkey, lie.head, null, 0))
  const lieBytes = bytesOf(lie)
  root.write(sha256(lieBytes), lieBytes)
  const overreach = canonicalHeadMap(me.pubkey, [{ molecule: a[0], claim: sha256(lieBytes) }])
  assert.deepEqual(verifyHeadMapRows(overreach, me.pubkey, read).holes.map((h) => h.reason), ['unsigned'])
})

// ───────────────────────────────────────────────────────────────────────────
test('H3 — THE SET IS SIGNED: a composition the publisher never made is refused', () => {
  // The gap three adversarial passes found in the first cut of step 4: every
  // ROW was signed, the SET was signed by nobody, and `record.pubkey` is a
  // field whoever composes the bytes chooses. So any stranger holding the
  // published bytes could compose a smaller, fully-verifying "deploy".
  const root = new Root()
  const me = new MoleculeStore({ root, author: 'me' })
  me.save([], 'business')
  me.save([], 'finance')
  me.save(['finance'], 'ledger')
  const deploy = mintHeadMap(me, { route: [] })
  const host = contentOnlyHostOf(root)
  const deps = { verify: verifyEd25519, readClaim: claimReaderOf(host, verifyEd25519) }

  assert.equal(verifyMinted(me, host, deploy).ok, true, 'the genuine deploy verifies')

  const compose = (pairs) => {
    const record = canonicalHeadMap(me.pubkey, pairs)
    const bytes = encodeHeadMap(record)
    return { sig: sha256(Buffer.from(bytes, 'utf8')), bytes, record }
  }
  const finance = moleculeOf('finance')

  // (1) TRUNCATION — every surviving row is a genuine, unmodified claim of mine.
  const cut = compose(
    deploy.record.rows.filter((r) => r[0] !== finance).map(([molecule, claim]) => ({ molecule, claim })),
  )
  const truncated = verifyDeploy({ ...cut, attestation: deploy.attestation }, me.pubkey, deps)
  assert.equal(truncated.ok, false, 'a subtree cut out of my deploy is refused')
  assert.equal(truncated.reason, 'unattested')
  assert.equal(truncated.attested, false)

  // (2) THE EMPTY DEPLOY — "this publisher published nothing".
  const empty = compose([])
  assert.equal(verifyDeploy({ ...empty, attestation: null }, me.pubkey, deps).reason, 'unattested')
  // an EMPTY map is still a legitimate deploy when the publisher signs it
  const attestedEmpty = { ...empty, attestation: me.keys.sign(headMapAttestationPreimage(me.pubkey, empty.sig)) }
  assert.equal(verifyDeploy(attestedEmpty, me.pubkey, deps).ok, true,
    '"I publish nothing" is a statement a publisher is allowed to make — signed')

  // (3) THE ATTESTATION IS WELDED TO THE BYTES AND TO THE KEY. Lifting the
  //     genuine one onto other bytes fails because `mapSig` is line three;
  //     minting one under another key fails because `pubkey` is line two.
  const stranger = mintKeys()
  const relabelled = compose(deploy.record.rows.map(([molecule, claim]) => ({ molecule, claim })))
  assert.equal(relabelled.sig, deploy.sig, 'the same set is the same bytes')
  assert.equal(
    verifyDeploy(
      { ...cut, attestation: stranger.sign(headMapAttestationPreimage(me.pubkey, cut.sig)) },
      me.pubkey, deps,
    ).reason,
    'unattested',
    'a stranger signing MY pubkey line is still not my signature',
  )
})

// ───────────────────────────────────────────────────────────────────────────
test('H4 — A ROW THAT POINTS AT NOTHING IS A HOLE ON THAT ROW', () => {
  // `refs` is the record's declared closure and it carries CLAIMS; a claim's
  // `head` is not an edge and `prev` is a REFERENT, so a replica built from the
  // deploy's own closure holds the map and the claims and NOT ONE BYTE of the
  // hive — and used to verify ok:true over it, indistinguishable from a whole
  // site. `readHead` makes that a per-row hole.
  const root = new Root()
  const me = new MoleculeStore({ root, author: 'me' })
  me.save([], 'business')
  me.save(['business'], 'people')
  const deploy = mintHeadMap(me, { route: [] })

  const pointersOnly = new Root()
  pointersOnly.write(deploy.sig, root.read(deploy.sig))
  for (const claimSig of deploy.record.refs) pointersOnly.write(claimSig, root.read(claimSig))
  const hollow = contentOnlyHostOf(pointersOnly)

  const rowsOnly = verifyMinted(me, hollow, deploy, { readHead: false })
  assert.equal(rowsOnly.ok, true, 'every ROW is genuinely mine, which is all the rows door claims')

  const full = verifyMinted(me, hollow, deploy)
  assert.equal(full.ok, false, 'and a deploy over a site with no pages is not a verified deploy')
  assert.deepEqual([...new Set(full.holes.map((h) => h.reason))], ['head-absent'])
  assert.equal(hollow.stats.listings, 0, 'still no listing anywhere')

  // FAILURE IS PER ROW: restore one page and that row verifies again.
  const partial = new Root()
  for (const p of pointersOnly.paths()) partial.write(p, pointersOnly.read(p))
  const first = deploy.record.rows[0]
  const firstHead = me.heldClaim(first[0]).head
  partial.write(firstHead, root.read(firstHead))
  const mixed = verifyMinted(me, contentOnlyHostOf(partial), deploy)
  assert.equal(mixed.verified.length, 1)
  assert.equal(mixed.holes.length, deploy.record.rows.length - 1)
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
  assert.equal(rebuilt.attestation, first.attestation, 'and the attestation with it — no clock anywhere')

  s.save(['notes'], 'draft', { text: 'v2' })
  const second = mintHeadMap(s, { route: [] })
  assert.notEqual(second.sig, first.sig, 'a real edit moves it')

  const delta = headMapDiff(first.record, second.record)
  assert.deepEqual(delta.moved, [moleculeOf('notes')], 'and the diff says WHICH molecule moved')
  assert.deepEqual(delta.added, [])
  assert.deepEqual(delta.removed, [])

  // BOTH deploys verify, and that is correct: every byte of the older one is
  // genuinely mine, and I really did sign that set, so a host replaying it
  // FORGES NOTHING and a verifier must not call it forged. THE ATTESTATION
  // CHANGES NOTHING HERE, deliberately — a signature proves authorship and
  // never recency. What separates them is inside each CLAIM: `seq`, which
  // cannot be raised without the secret.
  const host = contentOnlyHostOf(root)
  const older = verifyMinted(s, host, first)
  const newer = verifyMinted(s, host, second)
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

  const { pairs } = molecularScope(me, ['business'])
  assert.ok(
    !pairs.some((p) => p.molecule === moleculeOf('theirs')),
    'sign("theirs") is in my root and is NOT in my map — I head nothing there',
  )
  assert.ok(
    pairs.some((p) => p.molecule === moleculeOf('business')),
    'and sign("business"), which I DO head, is in it',
  )
  // The rule stated plainly: a molecule is enumerated iff I hold a claim in it.
  // Reachability decides which molecules are LOOKED AT — over EVERY author's
  // members, so a stranger's page cannot amputate mine — and my own bucket
  // decides which are NAMED. `sign("mine")` is reachable but headless.
  assert.ok(!pairs.some((p) => p.molecule === moleculeOf('mine')))
  void signText
})
