// authority-skeptic-1.test.mjs — LENS: THE SIGNER SEAM.
//
// Step 3 closed the placement hole: a claim is authenticated for the address
// the READER asked for, so bytes can no longer choose a directory. This file
// does not re-litigate that — it holds. It attacks what the fix RESTS ON:
//
//   * `seq`, the anti-replay counter that replaced the wall clock, is computed
//     from LOCAL state (`(held?.seq ?? -1) + 1` in `#setHead`) and local state
//     is rebuilt FROM A HOST. So whoever answers `GET /<mol>/<pubkey>/` picks
//     the number my next signature commits to.
//   * fork refusal is only as strong as the `prev` walk, and that walk has a
//     hard 64-hop budget.
//
// In both cases the crypto was impeccable and the outcome was still wrong.
//
// THE FILE HAS BEEN INVERTED IN PLACE. The attacks are unchanged; the
// assertions now state the property, so a PASS means the property holds and a
// regression fails here first. AS1-3 is unchanged (it always stated a real,
// mild residual) and AS1-5 was always a control.
//
// WHAT FIXED EACH:
//   AS1-1  a MINT LEDGER — a local, never-replicated record of the last claim
//          this instance signed, living beside the KEY rather than in the
//          content tree, so it survives the accidents the key survives — plus
//          an OUT-OF-SYNC REFUSAL: fail closed and say what to do, instead of
//          publishing a generation whose members come from a head I can see
//          while naming a prev I cannot.
//   AS1-2  the fork walk is bounded by the SIGNED SEQ GAP, and giving up says
//          'unproven', which is never an accusation.
//   AS1-4  the succession NAMES ITS SIGNER, compared against a bucket address
//          the reader has already authenticated.

import test from 'node:test'
import assert from 'node:assert/strict'

import { MoleculeStore, ROOT_MOLECULE } from './molecule.mjs'
import { Root } from './root.mjs'
import { hostOf } from './host.mjs'
import { mintKeys } from './keys.mjs'
import { headClaimPreimage } from './head-claim.mjs'
import { bytesOf, sha256 } from './sig.mjs'

/** Copy a set of paths out of one root into a fresh one — a host's pile. */
const pileOf = (root, keep = () => true) => {
  const out = new Root()
  for (const p of root.paths()) if (keep(p)) out.write(p, root.read(p))
  return out
}

const bucketOf = (mol, pubkey) => `${mol}/${pubkey}`

// ── AS1-1 ───────────────────────────────────────────────────────────────────
// SEQ IS REPLICATED STATE, SO A HOST CHOOSES MY NEXT SIGNATURE'S COUNTER.
//
// `seq` was adopted over a wall clock because "it cannot be raised without the
// secret". True — and irrelevant to this attack, which never raises anything.
// It LOWERS it, by controlling what I rebuild from.
//
// The setup is not even adversarial. A host that is merely BEHIND — it has my
// atoms and my genesis entry but not my latest head entry — is enough. Alice
// loses her OPFS (eviction under storage pressure, a partial "clear site data",
// a restore from a folder backup) while `localStorage['hc:nostr:secret-key']`
// survives, which is the ordinary shape of that accident: the two live in
// different stores and are cleared by different gestures.
//
// She rebuilds cold, signs her next commit at seq 1 — and every peer that
// already holds her seq 2 refuses her, first as 'stale' and then, once she has
// committed past them, as 'fork'. Forever. Nothing anywhere reports it: her own
// page renders perfectly.
test('AS1-1 a host that is merely BEHIND can no longer reset my signed seq', () => {
  const keys = mintKeys() // ONE participant, one key, throughout
  // The LEDGER lives beside the key, in the store the secret lives in — which
  // is precisely the store that survives an OPFS eviction. Sharing it between
  // the two MoleculeStores is what models that, and is the whole fix.
  const ledger = new Map()
  const alice = new MoleculeStore({ root: new Root(), author: 'alice', keys, ledger })

  alice.save([], 'one')
  // Snapshot the GENESIS head entry before `#setHead` prunes it away.
  const bucket = bucketOf(ROOT_MOLECULE, alice.pubkey)
  const genesisEntries = alice.root.list(bucket).map((e) => ({
    path: `${bucket}/${e.name}`,
    bytes: alice.root.read(`${bucket}/${e.name}`),
  }))
  assert.equal(genesisEntries.length, 1, 'one entry per bucket after a clean commit')

  alice.save([], 'two')
  alice.save([], 'three')
  const liveHead = alice.headSig(ROOT_MOLECULE)
  const liveSeq = alice.heldClaim(ROOT_MOLECULE).seq
  assert.equal(liveSeq, 2, 'three commits => seq 0,1,2')

  // Bob replicates from a CURRENT host and holds Alice at seq 2.
  const current = hostOf(pileOf(alice.root))
  const bob = new MoleculeStore({ root: new Root(), author: 'bob' })
  bob.replicateMolecule(current, ROOT_MOLECULE)
  assert.equal(bob.headSig(ROOT_MOLECULE, alice.pubkey), liveHead)

  // THE LAGGING HOST: every atom Alice ever wrote, but only her GENESIS entry.
  // Nothing here is forged. This is a host that missed two pushes.
  const laggingPile = pileOf(alice.root, (p) => !p.startsWith(`${bucket}/`))
  for (const e of genesisEntries) laggingPile.write(e.path, e.bytes)
  const lagging = hostOf(laggingPile)

  // Alice's OPFS is gone; her KEY, and the ledger that lives beside it, are not.
  const rebuilt = new MoleculeStore({ root: new Root(), author: 'alice', keys, ledger })
  rebuilt.materializeCold(lagging)

  // The host still hands her generation 0 — that part is unchanged, and no
  // client-side rule can stop a host answering with older truth.
  assert.equal(rebuilt.heldClaim(ROOT_MOLECULE).seq, 0)

  // WHAT CHANGED. The next commit used to take the host's counter, restart at
  // seq 1 with genesis as its parent, and succeed — forking her off her own
  // chain while her page rendered perfectly and nothing anywhere reported it.
  // Now the ledger outranks the host, the mismatch is detected, and she is told
  // exactly what to do instead of publishing a broken generation.
  assert.throws(() => rebuilt.save([], 'four'), /out of sync/)
  assert.equal(rebuilt.heldClaim(ROOT_MOLECULE).seq, 0, 'and nothing was written')

  // One sync from a CURRENT host and everything is right again.
  rebuilt.replicateMolecule(current, ROOT_MOLECULE, { includeMine: true })
  assert.equal(rebuilt.headSig(ROOT_MOLECULE), liveHead)
  assert.equal(rebuilt.heldClaim(ROOT_MOLECULE).seq, liveSeq)

  rebuilt.save([], 'four')
  assert.equal(rebuilt.heldClaim(ROOT_MOLECULE).seq, liveSeq + 1, 'her counter continues, never restarts')

  // And Bob takes it as an ordinary descendant: no stale, no fork, no partition.
  const after = bob.replicateMolecule(hostOf(pileOf(rebuilt.root)), ROOT_MOLECULE)
  assert.deepEqual(after.refused.map((r) => r.reason), [])
  assert.ok(bob.viewOf(ROOT_MOLECULE).some((r) => r.name === 'four'),
    'her work reaches everyone, which is the whole point')
})

// ── AS1-1b (OPEN) ───────────────────────────────────────────────────────────
// A PASS here is a residual, stated rather than papered over.
//
// If the ledger is lost TOO — a full "clear site data", a brand-new device —
// there is nothing left that knows what this key signed, and a lagging host's
// answer is indistinguishable from the truth. Alice's next commit forks. What
// improved is the BLAST RADIUS: the peer keeps every tile it had, her claim is
// kept and ranked rather than discarded, and the divergence is reported on both
// sides. Closing it needs a SIGNED HEAD MAP (a signed document naming
// molecule -> head/seq, so "is this the latest?" has an answer) — a later step,
// not a client-side rule.
test('AS1-1b OPEN — with the ledger ALSO lost, a lagging host still forks me (blast radius reduced)', () => {
  const keys = mintKeys()
  const alice = new MoleculeStore({ root: new Root(), author: 'alice', keys })
  alice.save([], 'one')
  const bucket = bucketOf(ROOT_MOLECULE, alice.pubkey)
  const genesisEntries = alice.root.list(bucket).map((e) => ({
    path: `${bucket}/${e.name}`,
    bytes: alice.root.read(`${bucket}/${e.name}`),
  }))
  alice.save([], 'two')
  alice.save([], 'three')
  const liveHead = alice.headSig(ROOT_MOLECULE)

  const bob = new MoleculeStore({ root: new Root(), author: 'bob' })
  bob.replicateMolecule(hostOf(pileOf(alice.root)), ROOT_MOLECULE)

  const laggingPile = pileOf(alice.root, (p) => !p.startsWith(`${bucket}/`))
  for (const e of genesisEntries) laggingPile.write(e.path, e.bytes)

  const rebuilt = new MoleculeStore({ root: new Root(), author: 'alice', keys }) // no ledger
  rebuilt.materializeCold(hostOf(laggingPile))
  rebuilt.save([], 'four')
  assert.equal(rebuilt.heldClaim(ROOT_MOLECULE).seq, 1, 'THE RESIDUAL: it forked, silently')

  // Bob is not harmed: her seq-1 claim is authentic, so it is KEPT and simply
  // loses to his seq-2 on the author's own counter.
  const first = bob.replicateMolecule(hostOf(pileOf(rebuilt.root)), ROOT_MOLECULE)
  assert.deepEqual(first.kept.map((r) => r.reason), ['stale'])
  assert.equal(bob.headSig(ROOT_MOLECULE, alice.pubkey), liveHead, 'Bob keeps every tile he had')

  // Once she commits past him it is a real, reported divergence — and refusing
  // it costs him nothing, because a disproven fork is never even stored.
  rebuilt.save([], 'five')
  rebuilt.save([], 'six')
  const later = bob.replicateMolecule(hostOf(pileOf(rebuilt.root)), ROOT_MOLECULE)
  assert.deepEqual(later.refused.map((r) => r.reason), ['fork'])
  assert.equal(bob.headSig(ROOT_MOLECULE, alice.pubkey), liveHead)
})

// ── AS1-2 ───────────────────────────────────────────────────────────────────
// THE 64-HOP BUDGET IS A PERMANENT PARTITION AT 65 EDITS, WITH NO ATTACKER.
//
// `#chainContains` gives up after `budget` hops "rather than letting a hostile
// chain run forever". The bound is not on hostile chains; it is on ALL chains.
// A peer who syncs, goes offline for 65 of my edits, and comes back is refused
// as a 'fork' — and because the distance only ever grows, the refusal is
// terminal. Two honest participants, one honest host, permanent divergence.
test('AS1-2 65 ordinary edits while a peer is offline no longer partition them', () => {
  const alice = new MoleculeStore({ root: new Root(), author: 'alice' })
  alice.save([], 'page', { v: 0 })

  const bob = new MoleculeStore({ root: new Root(), author: 'bob' })
  bob.replicateMolecule(hostOf(pileOf(alice.root)), ROOT_MOLECULE)
  const bobHeld = bob.headSig(ROOT_MOLECULE, alice.pubkey)
  assert.ok(bobHeld, 'Bob is in sync at generation 0')

  // Alice edits the same tile 70 more times. Nothing unusual, nothing hostile.
  for (let i = 1; i <= 70; i++) alice.save([], 'page', { v: i })
  assert.equal(alice.heldClaim(ROOT_MOLECULE).seq, 70)

  const report = bob.replicateMolecule(hostOf(pileOf(alice.root)), ROOT_MOLECULE)
  assert.deepEqual(
    report.refused.map((r) => r.reason),
    [],
    'the budget is the SIGNED SEQ GAP — the exact number of hops descent needs',
  )
  assert.equal(bob.headSig(ROOT_MOLECULE, alice.pubkey), alice.headSig(ROOT_MOLECULE),
    'Bob catches up in one pass')

  // And it keeps working as the gap grows: nothing here is a constant.
  for (let i = 71; i <= 200; i++) alice.save([], 'page', { v: i })
  const again = bob.replicateMolecule(hostOf(pileOf(alice.root)), ROOT_MOLECULE)
  assert.deepEqual(again.refused.map((r) => r.reason), [])
  assert.equal(bob.headSig(ROOT_MOLECULE, alice.pubkey), alice.headSig(ROOT_MOLECULE))
  assert.notEqual(bob.headSig(ROOT_MOLECULE, alice.pubkey), bobHeld)
})

// ── AS1-3 ───────────────────────────────────────────────────────────────────
// A REFUSAL MID-COMMIT (the NIP-07 "deny" button) LEAVES THE ATOMS BEHIND.
//
// `save()` writes the vertex, the envelope and the succession atom BEFORE
// `#setHead` asks the key to sign. A signer that refuses at that moment throws
// out of the middle of the commit: the head never moves (good — the write is
// not half-authenticated) but three atoms are already at the content root, and
// skeptic-4 D established that prune is a no-op, so they are permanent.
//
// This is the mild half. The sharp half is the ORDER: because the atoms land
// first, a caller that reports success on the ATOM write rather than on the
// signed entry would publish an unreferenced generation. The prototype gets the
// order right by throwing; `signHeadClaim` in essentials returns
// `{ok:false,'signing refused'}` as a VALUE, and there is nothing in the tree
// yet that unwinds it.
test('AS1-3 a signer that refuses mid-commit leaves orphan atoms and no head', () => {
  const keys = mintKeys()
  let deny = false
  const flaky = {
    pubkey: keys.pubkey,
    sign: (preimage) => {
      if (deny) throw new Error('nip-07: user rejected the signing request')
      return keys.sign(preimage)
    },
  }
  const alice = new MoleculeStore({ root: new Root(), author: 'alice', keys: flaky })

  alice.save([], 'kept')
  const headBefore = alice.headSig(ROOT_MOLECULE)
  const sizeBefore = alice.root.size

  deny = true
  assert.throws(() => alice.save([], 'denied'), /user rejected/)

  assert.equal(alice.headSig(ROOT_MOLECULE), headBefore, 'the head did NOT move — no half-signed write')
  assert.ok(alice.root.size > sizeBefore, 'but the atoms are already written')
  assert.ok(
    !alice.viewOf(ROOT_MOLECULE).some((r) => r.name === 'denied'),
    'and unreachable from every read path: permanent orphans',
  )

  // Retrying works, which is the one piece of good news here.
  deny = false
  alice.save([], 'denied')
  assert.ok(alice.viewOf(ROOT_MOLECULE).some((r) => r.name === 'denied'))
})

// ── AS1-4 ───────────────────────────────────────────────────────────────────
// THE CLAIM AUTHENTICATES THE BUCKET, NOT THE AUTHORSHIP OF WHAT IS IN IT.
//
// `name` and `author` were deleted from the succession atom so that no field
// could choose a location. The side effect is that an atom is now bound to
// NOTHING: any key may sign a perfectly valid head claim naming SOMEONE ELSE'S
// succession sig as its head, in its own bucket, at the right molecule. It
// verifies, because everything the preimage commits to is true.
//
// `viewOf` then attributes rows to whichever author absorbs first — mine, then
// the others SORTED BY PUBKEY. So a stranger who mints keys until they sort
// below the real author takes the byline for the entire page, on every reader,
// deterministically. Content-addressed dedup means the theft is invisible: the
// rows look identical, only `author` changed.
test('AS1-4 a stranger can no longer adopt my succession, or take the byline for it', () => {
  const alice = new MoleculeStore({ root: new Root(), author: 'alice' })
  alice.save([], 'alice-wrote-this')
  const aliceHead = alice.headSig(ROOT_MOLECULE)

  // Grind keys until Mallory sorts BEFORE Alice — the whole cost of the attack.
  let mallory = mintKeys()
  for (let i = 0; i < 200 && mallory.pubkey >= alice.pubkey; i++) mallory = mintKeys()
  assert.ok(mallory.pubkey < alice.pubkey, 'a few dozen keygens buys the sort order')

  const thief = new MoleculeStore({ root: new Root(), author: 'mallory', keys: mallory })
  // She signs for HER OWN bucket, at the RIGHT molecule, naming ALICE's atom.
  // Every field in the preimage is true, so it verifies for every reader.
  const adopted = thief.mintHeadEntry(ROOT_MOLECULE, { head: aliceHead, prev: null, seq: 0 })

  const pile = pileOf(alice.root)
  pile.write(`${ROOT_MOLECULE}/${mallory.pubkey}/${adopted.name}`, adopted.bytes)

  const bob = new MoleculeStore({ root: new Root(), author: 'bob' })
  const report = bob.replicateMolecule(hostOf(pile), ROOT_MOLECULE)

  // The CLAIM is still genuinely valid — every field in its preimage is true,
  // and that is exactly why no signature check could ever have caught this. The
  // ATOM is what refuses: a succession names its SIGNER, and Mallory's bucket
  // is not it. Note the difference from the `name`/`author` fields that were
  // deleted: `signer` is never a path segment and chooses nothing, it is
  // compared against an address the reader has ALREADY AUTHENTICATED — which is
  // precisely why the check is safe now and was not before.
  assert.ok(report.refused.some((r) => r.author === mallory.pubkey && r.reason === 'atom-mismatch'))
  assert.equal(bob.headSig(ROOT_MOLECULE, mallory.pubkey), null,
    "Mallory's bucket heads nothing at all")

  const row = bob.viewOf(ROOT_MOLECULE).find((r) => r.name === 'alice-wrote-this')
  assert.ok(row)
  assert.equal(row.author, alice.pubkey, 'THE BYLINE stays with the key that signed the atom')
  assert.notEqual(row.author, mallory.pubkey)
  assert.equal(row.stack.length, 0)
})

// ── AS1-5 (HOLDS) ───────────────────────────────────────────────────────────
// The placement fix itself is not shaken by any of the above. A claim signed
// for one address is inert at every other, so nobody can write into a bucket
// they lack the key for. Kept as a control so a regression in the fix shows up
// in THIS file too.
test('AS1-5 HOLDS: a claim signed for my bucket is inert when served from another', () => {
  const alice = new MoleculeStore({ root: new Root(), author: 'alice' })
  alice.save([], 'real')

  const mallory = mintKeys()
  // The preimage NAMES ALICE'S BUCKET, at a seq far ahead of hers, and is
  // served from a directory named with Alice's pubkey — the only place a reader
  // could ever file it. Every field is well-formed; only the KEY is wrong.
  const aliceHead = alice.headSig(ROOT_MOLECULE)
  const usurper = sha256(bytesOf({ succession: 1, prev: aliceHead, members: [], at: 99 }))
  const preimageForAlice = headClaimPreimage(ROOT_MOLECULE, alice.pubkey, usurper, aliceHead, 9)
  const forged = { head: usurper, prev: aliceHead, seq: 9, sig: mallory.sign(preimageForAlice) }
  const bytes = bytesOf(forged)

  const pile = pileOf(alice.root)
  pile.write(`${ROOT_MOLECULE}/${alice.pubkey}/${sha256(bytes)}`, bytes)

  const bob = new MoleculeStore({ root: new Root(), author: 'bob' })
  const report = bob.replicateMolecule(hostOf(pile), ROOT_MOLECULE)
  assert.equal(bob.headSig(ROOT_MOLECULE, alice.pubkey), aliceHead, 'Alice keeps her head')
  assert.ok(
    report.refused.some((r) => r.reason === 'unsigned'),
    'the seq-9 forgery is refused: it is not signed by the key that NAMES the bucket',
  )
})
