// authority-skeptic-0.test.mjs — LENS: REPLAY + SUBSTITUTION.
//
// Take a head that was LEGITIMATELY SIGNED and serve it somewhere it does not
// belong: another molecule, another bucket, another host, an older generation.
// Anything that verifies where it should not is a blocker.
//
// HOW TO READ THIS FILE. Every test states the property the DESIGN claims, so:
//
//     a PASS = the property holds
//     a FAIL = the property does not
//
// THE FILE HAS BEEN INVERTED IN PLACE. It was written the other way round —
// a pass meant a defect reproduced — because at the time three of its five
// attacks worked. The ATTACKS ARE UNCHANGED, byte for byte; only the assertions
// moved, so a regression in any of the fixes fails here first. AS-2b is the one
// case still stated as a defect, and it says at length why.
//
// WHAT WAS ALREADY TRUE (AS-0): the six-line preimage binds molecule and
// pubkey, and the reader RENDERS it from its own walk. Every SPATIAL replay —
// another molecule, another key, a reserved system pool — was already dead.
//
// WHAT THIS FILE FOUND, AND WHAT FIXED IT: the TEMPORAL axis. `seq` refused an
// old claim only when the reader ALREADY HELD a newer one, so on FIRST SIGHT a
// host chose which of the author's genuinely signed generations the reader
// adopted — and `seq` + fork refusal then made that choice PERMANENT, because
// the real head arrived, could not prove descent, and was THROWN AWAY.
//
// Three changes close it, and none of them makes the first adoption smarter
// (nothing in one bucket read can):
//
//   1. AUTHENTICITY AND HEADSHIP ARE DIFFERENT QUESTIONS. `keep` is the bit a
//      storage caller acts on, and it is true for `stale` and `unproven` — the
//      author's own history. Kept entries are ranked by `resolveBucketHead`, so
//      the newest signed counter wins from then on and a reader that has once
//      seen generation 69 can never be talked back down.
//   2. `'unproven'` IS ITS OWN REFUSAL. "I gave up walking" is not "you
//      branched". Only a walk that reaches genesis says `fork`.
//   3. THE WALK IS BOUNDED BY THE SIGNED SEQ GAP, not by a constant 64 — which
//      is what the doctrine said all along, and is not attacker-inflatable
//      beyond what the author actually signed.

import test from 'node:test'
import assert from 'node:assert/strict'

import { MoleculeStore, ROOT_MOLECULE, moleculeOf } from './molecule.mjs'
import { Root } from './root.mjs'
import { hostOf } from './host.mjs'
import { mintKeys, verifyEd25519 } from './keys.mjs'
import { acceptHeadClaim, headClaimPreimage } from './head-claim.mjs'

/** A host that serves every atom + the root molecule, but only the head entries
 *  it is explicitly handed for `mol`. This is ALL a hostile host needs to be:
 *  it never forges a byte, it only chooses which genuine bytes to publish. */
const partialHost = (truth, mol, entries) => {
  const r = new Root()
  for (const p of truth.paths()) {
    if (!p.includes('/') || p.startsWith(`${ROOT_MOLECULE}/`)) r.write(p, truth.read(p))
  }
  for (const e of entries) r.write(`${mol}/${e.bucket}/${e.name}`, e.bytes)
  return hostOf(r)
}

// ───────────────────────────────────────────────────────────────────────────
// AS-0 (HOLDS) — the SPATIAL half of the fix. Keep these green.
// ───────────────────────────────────────────────────────────────────────────

test('AS-0 (HOLDS) a genuine claim is inert at every other molecule, key and system pool', () => {
  const keys = mintKeys()
  const truth = new Root()
  const alice = new MoleculeStore({ root: truth, keys })
  alice.save([], 'people')
  alice.save(['people'], 'Alice')

  const mol = moleculeOf('people')
  const held = alice.heldClaim(mol)
  const offered = { head: held.head, prev: held.prev, seq: held.seq, sig: held.sig }

  // the SAME genuine claim, offered at three addresses it was not signed for
  const bees = moleculeOf('bees') // a reserved system pool address
  const stranger = mintKeys().pubkey
  for (const address of [
    { molecule: bees, pubkey: keys.pubkey },
    { molecule: ROOT_MOLECULE, pubkey: keys.pubkey },
    { molecule: mol, pubkey: stranger },
  ]) {
    const v = acceptHeadClaim(address, offered, verifyEd25519)
    assert.equal(v.ok, false)
    assert.equal(v.reason, 'unsigned', `replay to ${address.molecule.slice(0, 8)}/${address.pubkey.slice(0, 8)} must not verify`)
    assert.equal(v.keep, false, 'and bytes that are not the bucket owner\'s are never kept')
  }

  // and at the address it WAS signed for, it verifies
  assert.equal(acceptHeadClaim({ molecule: mol, pubkey: keys.pubkey }, offered, verifyEd25519).ok, true)
})

// ───────────────────────────────────────────────────────────────────────────
// AS-1 — WAS A BLOCKER. One replayed genesis permanently blinded a cold
//        visitor. The attack is unchanged; the outcome is not.
// ───────────────────────────────────────────────────────────────────────────

test('AS-1 a replayed genesis is adopted on first sight — and the real head still arrives', () => {
  const keys = mintKeys()
  const truth = new Root()
  const alice = new MoleculeStore({ root: truth, keys })
  alice.save([], 'people')
  for (let i = 0; i < 70; i++) alice.save(['people'], `member-${i}`)

  const mol = moleculeOf('people')
  assert.equal(alice.viewOf(mol).length, 70)
  assert.equal(alice.heldClaim(mol).seq, 69)

  // The attacker forges NOTHING. It re-publishes Alice's own generation 0 —
  // a claim she really signed, at the molecule and bucket it was signed for.
  const genesis = alice.chain(mol)[0]
  const replay = alice.mintHeadEntry(mol, { head: genesis.sig, prev: null, seq: 0 })
  const hostile = partialHost(truth, mol, [{ bucket: keys.pubkey, name: replay.name, bytes: replay.bytes }])

  // A cold visitor meets the hostile host first, and STILL adopts generation 0.
  // That step is irreducible and is not what made this a blocker: nothing in
  // one bucket read can say "this is the latest thing that key signed". (The
  // answer to THAT is a signed head map — a later step.)
  const visitor = new MoleculeStore({ root: new Root(), keys: mintKeys() })
  visitor.materializeCold(hostile, ['people'])
  assert.deepEqual(visitor.viewOf(mol).map((r) => r.name), ['member-0'],
    'first sight is a guess, and a signature cannot make it a better one')

  // WHAT CHANGED: the guess is REVISABLE. The honest host's head has a higher
  // signed seq, the walk is budgeted by that gap rather than by a constant 64,
  // and descent is PROVEN — so it is accepted outright on the first pass.
  const honest = hostOf(truth)
  const report = visitor.replicateMolecule(honest, mol)
  assert.equal(report.refused.length, 0, 'the honest author is never accused of branching')
  assert.equal(report.accepted.length, 1)
  assert.deepEqual(
    visitor.viewOf(mol).map((r) => r.name),
    alice.viewOf(mol).map((r) => r.name),
    'all 70 of Alice\'s tiles, on the first sync after the poison',
  )

  // And it STAYS fixed: meeting the hostile host again cannot pull the visitor
  // back down, because the seq-69 entry is held and outranks the replay.
  visitor.replicateMolecule(hostile, mol)
  assert.equal(visitor.viewOf(mol).length, 70, 'the downgrade cannot be replayed a second time')

  // The poisoned entry was never deleted — it is Alice's own signature, and
  // data never heals. It simply loses.
  assert.equal(visitor.root.list(`${mol}/${keys.pubkey}`).length, 2)
})

// ───────────────────────────────────────────────────────────────────────────
// AS-2 — the sharper one: the victim does it to THEMSELVES. Split in two,
//        because one half is fixed and the other is genuinely irreducible.
// ───────────────────────────────────────────────────────────────────────────

test('AS-2a a replayed OWN claim no longer forks me off my own chain — I refuse to commit instead', () => {
  // THE ORDINARY SHAPE OF THIS ACCIDENT, and the one the finding named: OPFS is
  // gone (eviction under storage pressure, a partial "clear site data", a
  // restore from a folder backup) while `localStorage['hc:nostr:secret-key']`
  // survives — the two live in different stores and are cleared by different
  // gestures. So the MINT LEDGER, which lives beside the key, survives too.
  const keys = mintKeys()
  const ledger = new Map()
  const truth = new Root()
  const device1 = new MoleculeStore({ root: truth, keys, ledger })
  device1.save([], 'people')
  for (let i = 0; i < 10; i++) device1.save(['people'], `member-${i}`)

  const mol = moleculeOf('people')
  assert.equal(device1.heldClaim(mol).seq, 9)

  const genesis = device1.chain(mol)[0]
  const replay = device1.mintHeadEntry(mol, { head: genesis.sig, prev: null, seq: 0 })
  const hostile = partialHost(truth, mol, [{ bucket: keys.pubkey, name: replay.name, bytes: replay.bytes }])

  const rebuilt = new MoleculeStore({ root: new Root(), keys, ledger })
  rebuilt.materializeCold(hostile, ['people'])
  assert.equal(rebuilt.heldClaim(mol).seq, 0, 'the host still chose which generation I see')

  // THE POINT OF NO RETURN IS GONE. The next commit used to restart `seq` from
  // the poisoned bucket and sign a chain rooted at genesis — a legitimate local
  // write forking me off my own history, with nothing anywhere reporting it
  // because my own page rendered perfectly. Now the ledger outranks the host,
  // the mismatch is DETECTED, and the store refuses to publish a generation
  // whose members come from a head it can see while naming a prev it cannot.
  assert.throws(
    () => rebuilt.save(['people'], 'brand-new-tile'),
    /out of sync/,
    'fail closed and say what to do, rather than fork silently',
  )
  assert.equal(rebuilt.heldClaim(mol).seq, 0, 'and nothing was written')

  // And the instruction works: one sync from a current host restores everything.
  rebuilt.replicateMolecule(hostOf(truth), mol, { includeMine: true })
  assert.equal(rebuilt.viewOf(mol).length, 10, 'all ten tiles are back')
  rebuilt.save(['people'], 'brand-new-tile')
  assert.equal(rebuilt.heldClaim(mol).seq, 10, 'and my chain continues where I left it')
  assert.equal(rebuilt.viewOf(mol).length, 11)

  // The peer accepts it as an ordinary descendant — no stale, no fork.
  const peer = new MoleculeStore({ root: new Root(), keys: mintKeys() })
  peer.materializeCold(hostOf(truth), ['people'])
  const report = peer.replicateMolecule(hostOf(rebuilt.root), mol)
  assert.equal(report.refused.length, 0)
  assert.equal(peer.viewOf(mol).length, 11)
})

test('AS-2b OPEN — a genuinely FRESH second device on one key can still be forked by a replay', () => {
  // STILL REPRODUCING, DELIBERATELY. A PASS here is the defect.
  //
  // WHY IT CANNOT BE CLOSED HERE. The device is new: it has the key and NO mint
  // ledger, which is exactly what a real second device looks like. Nothing
  // available to it distinguishes "I am new, adopt what the host says is my
  // chain" from "I am wiped, and this host is behind" — the two are the same
  // bytes. A bucket cannot be its own authority on its own recency, which is
  // the same irreducible gap AS-1's first step has.
  //
  // WHAT WOULD CLOSE IT, and where it belongs:
  //   * a SIGNED HEAD MAP — one signed document listing (molecule -> head, seq)
  //     across a participant's molecules, so "is this the latest?" is a
  //     question with an answer. That is the next step, not this one.
  //   * a PER-DEVICE SUB-KEY, so two devices never share a bucket at all. Also
  //     the clean fix for S3-B, and already recorded as owed there.
  //
  // WHAT DID IMPROVE, and is asserted below: the true device loses NOTHING
  // (its 10 tiles survive, the intruding seq-1 claim is kept and ranked and
  // simply loses), and the fork is REPORTED on both sides rather than silent.
  const keys = mintKeys()
  const truth = new Root()
  const device1 = new MoleculeStore({ root: truth, keys })
  device1.save([], 'people')
  for (let i = 0; i < 10; i++) device1.save(['people'], `member-${i}`)
  const mol = moleculeOf('people')

  const genesis = device1.chain(mol)[0]
  const replay = device1.mintHeadEntry(mol, { head: genesis.sig, prev: null, seq: 0 })
  const hostile = partialHost(truth, mol, [{ bucket: keys.pubkey, name: replay.name, bytes: replay.bytes }])

  const device2 = new MoleculeStore({ root: new Root(), keys }) // no ledger: genuinely new
  device2.materializeCold(hostile, ['people'])
  assert.equal(device2.heldClaim(mol).seq, 0)
  device2.save(['people'], 'brand-new-tile')
  assert.equal(device2.heldClaim(mol).seq, 1, 'THE DEFECT: it forked, and nothing warned it')

  // The true device is UNHARMED — this is the half that changed. Device 2's
  // claim is authentic, so it is kept, and it simply loses on seq.
  const back = device1.replicateMolecule(hostOf(device2.root), mol, { includeMine: true })
  assert.deepEqual(back.kept.map((k) => k.reason), ['stale'])
  assert.equal(device1.viewOf(mol).length, 10, 'device 1 keeps every tile it had')

  // Device 2 stays on its branch, and is TOLD so rather than being silently wrong.
  const forward = device2.replicateMolecule(hostOf(truth), mol, { includeMine: true })
  assert.equal(forward.refused[0].reason, 'fork')
  assert.deepEqual(device2.viewOf(mol).map((r) => r.name), ['member-0', 'brand-new-tile'])
})

// ───────────────────────────────────────────────────────────────────────────
// AS-3 — WAS A MAJOR. No attacker at all: the bounded walk was a FALSE fork.
// ───────────────────────────────────────────────────────────────────────────

test('AS-3 a reader far behind catches up: a bounded walk is never an accusation', () => {
  const truth = new Root()
  const alice = new MoleculeStore({ root: truth, keys: mintKeys() })
  alice.save([], 'people')
  alice.save(['people'], 'first')
  const mol = moleculeOf('people')

  const bob = new MoleculeStore({ root: new Root(), keys: mintKeys() })
  bob.materializeCold(hostOf(truth), ['people'])
  assert.deepEqual(bob.viewOf(mol).map((r) => r.name), ['first'])

  // Bob goes on holiday. Alice keeps working — 100 ordinary saves. Under a
  // constant 64-hop budget this was a PERMANENT partition between two honest
  // participants on one honest host, and the refusal was spelled 'fork'.
  for (let i = 0; i < 100; i++) alice.save(['people'], `later-${i}`)
  assert.equal(alice.viewOf(mol).length, 101)

  const report = bob.replicateMolecule(hostOf(truth), mol)
  assert.equal(report.refused.length, 0,
    'the budget is the SIGNED SEQ GAP — exactly the number of hops descent can require')
  assert.deepEqual(bob.viewOf(mol).map((r) => r.name), alice.viewOf(mol).map((r) => r.name))
})

// ───────────────────────────────────────────────────────────────────────────
// AS-4 — WAS A MAJOR. The idempotent re-offer answered ok:true without ever
//        calling the verifier.
// ───────────────────────────────────────────────────────────────────────────

test('AS-4 ok:true is never returned for a claim nobody verified', () => {
  const mol = 'a'.repeat(64)
  const pubkey = 'b'.repeat(64)
  const head = 'c'.repeat(64)
  let consulted = 0
  const never = () => { consulted++; return false }

  const verdict = acceptHeadClaim(
    { molecule: mol, pubkey },
    // shape-valid and nothing else: `sig` is the word "deadbeef", `prev` and
    // `seq` are invented, and it is offered at an address nobody signed for.
    // Its `head` happens to match what is held, which is all the old
    // short-circuit needed.
    { head, prev: 'd'.repeat(64), seq: 999999, sig: 'deadbeef' },
    never,
    { held: { head, prev: null, seq: 0 } },
  )

  assert.equal(consulted, 1, 'the signature runs BEFORE every policy branch')
  assert.equal(verdict.ok, false)
  assert.equal(verdict.reason, 'unsigned')
  assert.equal(verdict.keep, false, 'and a caller reading `keep` stores nothing')

  // A GENUINE re-offer of the head I hold is still a cheap no-op.
  const keys = mintKeys()
  const store = new MoleculeStore({ root: new Root(), keys })
  store.save([], 'one')
  const held = store.heldClaim(ROOT_MOLECULE)
  const again = acceptHeadClaim(
    { molecule: ROOT_MOLECULE, pubkey: keys.pubkey },
    { head: held.head, prev: held.prev, seq: held.seq, sig: held.sig },
    verifyEd25519,
    { held },
  )
  assert.equal(again.ok, true)
  assert.equal(again.unchanged, true)
})

// ───────────────────────────────────────────────────────────────────────────
// AS-5 (HOLDS) — replays that really are dead. Keep these green.
// ───────────────────────────────────────────────────────────────────────────

test('AS-5 (HOLDS) an uppercase bucket, a non-hex bucket, and a same-seq rival are all handled', () => {
  const keys = mintKeys()
  const truth = new Root()
  const alice = new MoleculeStore({ root: truth, keys })
  alice.save([], 'people')
  alice.save(['people'], 'Alice')
  const mol = moleculeOf('people')
  const held = alice.heldClaim(mol)
  const entry = alice.mintHeadEntry(mol, { head: held.head, prev: held.prev, seq: held.seq })

  // (a) the SAME genuine bytes served under an UPPERCASE spelling of the same
  //     key. classifyDirectoryEntry calls that a bucket (case-insensitive);
  //     the acceptor refuses rather than lowercasing an address it asked for.
  const upper = partialHost(truth, mol, [
    { bucket: keys.pubkey.toUpperCase(), name: entry.name, bytes: entry.bytes },
  ])
  const v1 = new MoleculeStore({ root: new Root(), keys: mintKeys() })
  const r1 = v1.replicateMolecule(upper, mol)
  assert.equal(r1.accepted.length, 0)
  assert.equal(r1.refused[0].reason, 'malformed')
  assert.equal(v1.root.paths().filter((p) => p.toLowerCase().includes(keys.pubkey)).length, 0,
    'and nothing was written under either spelling')

  // (b) a bucket named 'dev-open' (http-auth.js's literal devOpen pubkey)
  const named = partialHost(truth, mol, [{ bucket: 'dev-open', name: entry.name, bytes: entry.bytes }])
  const v2 = new MoleculeStore({ root: new Root(), keys: mintKeys() })
  assert.equal(v2.replicateMolecule(named, mol).accepted.length, 0)

  // (c) A RIVAL AT THE SAME SEQ. This used to be spelled `fork` and refused,
  //     which is what left two readers of one author on two different heads
  //     forever. Two chains of the same LENGTH: neither can contain the other,
  //     no walk can help, and only the bucket's own key can produce the pair.
  //     So it is `rival` — kept, and settled by the total order every reader
  //     computes the same way.
  const rival = alice.mintHeadEntry(mol, { head: 'f'.repeat(64), prev: held.prev, seq: held.seq })
  const parsed = { head: 'f'.repeat(64), prev: held.prev, seq: held.seq, sig: rival.claim.sig }
  const v3 = acceptHeadClaim({ molecule: mol, pubkey: keys.pubkey }, parsed, verifyEd25519, { held })
  assert.equal(v3.ok, false)
  assert.equal(v3.reason, 'rival')
  assert.equal(v3.keep, true, 'kept so resolveBucketHead can rank it — never a blackout')

  // (d) the preimage really is the only thing signed — a one-character change
  //     to the molecule address kills it
  const bent = headClaimPreimage(`${mol.slice(0, 63)}0`, keys.pubkey, held.head, held.prev, held.seq)
  assert.equal(verifyEd25519(keys.pubkey, bent, held.sig), false)
})
