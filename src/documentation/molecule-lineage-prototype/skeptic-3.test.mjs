// skeptic-3.test.mjs — LENS: COLD MATERIALIZATION + MULTITENANCY.
// Attacks the host path: empty root, listings + atom fetches only, and a
// directory that two tenants share.

import test from 'node:test'
import assert from 'node:assert/strict'

import { MoleculeStore, moleculeOf, ROOT_MOLECULE } from './molecule.mjs'
import { Root } from './root.mjs'
import { hostOf } from './host.mjs'
import { signText, bytesOf, sha256 } from './sig.mjs'
import { mintKeys } from './keys.mjs'
import { headClaimPreimage } from './head-claim.mjs'

const names = (rows) => rows.map((r) => r.name)
const tenant = (author) => new MoleculeStore({ root: new Root(), author })

/** Merge two tenants' roots into ONE host pile — what a host actually holds. */
const sharedHost = (...stores) => {
  const root = new Root()
  for (const s of stores) for (const p of s.root.paths()) root.write(p, s.root.read(p))
  return { root, host: hostOf(root) }
}

// -- S3-A --------------------------------------------------------------------
// A hostile tenant publishes a succession that NAMES ANOTHER TENANT AS AUTHOR
// and names a molecule the cold client never listed. Self-placement filed it
// into the victim's bucket; the victim's page went dark for every cold visitor.
//
// CHANGED BY STEP 3. The attack is kept and STRENGTHENED — Mallory now holds a
// real key and mints a real SIGNED claim whose preimage names ALICE's bucket in
// sign('people'), which is the strongest thing she can produce without Alice's
// secret. Two things stop it:
//
//   1. The claim is served from MALLORY's bucket in the ROOT molecule, and
//      placement is reader-derived, so the only address it could ever be filed
//      at is `${ROOT_MOLECULE}/${mallory.pubkey}`.
//   2. There the reader rebuilds a preimage naming the root molecule and
//      Mallory's key — not the string she signed — so it is refused 'unsigned'.
//
// NOTE THE PRECONDITION THAT HAD TO BREAK. The old test asserted the victim
// bucket ended up holding TWO entries. It now holds ONE, because the poison
// never reaches it at all; leaving that assert would have kept this test red
// for entirely the wrong reason.

test('S3-A - a hostile tenant can no longer blank a victim molecule for cold visitors', () => {
  const alice = tenant('alice-hive')
  alice.save([], 'business')
  alice.save(['business'], 'people')
  alice.save(['business', 'people'], 'Alice', { role: 'founder' })
  alice.save(['business', 'people'], 'Bob')

  const mallory = tenant('mallory-hive')
  mallory.save([], 'games')

  // Mallory replaces the ONE entry in her root-molecule bucket with a signed
  // claim aimed at Alice's bucket in sign('people').
  const peopleMol = moleculeOf('people')
  const poison = { succession: 1, prev: null, members: [], at: 99 }
  const poisonSig = sha256(bytesOf(poison))
  mallory.root.write(poisonSig, bytesOf(poison))
  const poisonClaim = {
    head: poisonSig, prev: null, seq: 0,
    sig: mallory.keys.sign(headClaimPreimage(peopleMol, alice.pubkey, poisonSig, null, 0)),
  }
  const poisonBytes = bytesOf(poisonClaim)
  for (const f of mallory.root.list(`${ROOT_MOLECULE}/${mallory.pubkey}`)) {
    mallory.root.remove(`${ROOT_MOLECULE}/${mallory.pubkey}/${f.name}`)
  }
  mallory.root.write(`${ROOT_MOLECULE}/${mallory.pubkey}/${sha256(poisonBytes)}`, poisonBytes)

  const { host } = sharedHost(alice, mallory)

  // Warm control: alice's own hive is fine.
  assert.deepEqual(names(alice.children(['business', 'people'])), ['Alice', 'Bob'])

  const cold = new MoleculeStore({ root: new Root(), author: 'cold-visitor' })
  const { children, reports } = cold.materializeCold(host, ['business', 'people'])

  const victimBucket = cold.root.list(`${peopleMol}/${alice.pubkey}`)
  assert.equal(victimBucket.length, 1, 'the poison never reached the victim bucket')
  assert.equal(
    reports[0].refused.find((f) => f.author === mallory.pubkey)?.reason, 'unsigned',
    'it was refused at the ONLY address it could have been filed at: her own bucket',
  )

  assert.deepEqual(names(children), ['Alice', 'Bob'],
    'a cold visitor sees the page the author published')
})

// -- S3-B --------------------------------------------------------------------
// ONE PARTICIPANT, TWO DEVICES - the ordinary case, not an attack. Both write
// under the same author sig. A host that carries both bricks the bucket.
// The marker model degrades (highest marker wins); this model resolves NOTHING.

// CHANGED BY STEP 3: this now HOLDS. Two devices sharing one key are
// indistinguishable from a fork by construction, so the model no longer tries
// to distinguish them — it makes the divergence RESOLVABLE instead of fatal.
// `if (files.length !== 1) continue` is retired; every verified entry is a
// candidate and `resolveBucketHead` picks the highest seq (ties by the
// lexicographically smallest head sig). The loser is never deleted.
//
// STILL OWED, and not claimed here: the losing device is silently unpublished
// until its owner commits forward onto the winner. The clean fix is a
// per-device sub-key so the two never share a bucket at all.
test('S3-B - one participant on two devices no longer bricks their own bucket on a host', () => {
  const laptop = tenant('jaime')
  laptop.save([], 'business')
  laptop.save(['business'], 'people')
  laptop.save(['business', 'people'], 'Alice')

  // ONE key, two devices — which is what "one participant" now means.
  const phone = new MoleculeStore({ root: new Root(), author: 'jaime', keys: laptop.keys })
  phone.save([], 'business')
  phone.save(['business'], 'people')
  phone.save(['business', 'people'], 'Bob')

  const { host } = sharedHost(laptop, phone)
  const cold = new MoleculeStore({ root: new Root(), author: 'cold-visitor' })
  const { children } = cold.materializeCold(host, ['business', 'people'])

  assert.ok(children.length > 0,
    'a host holding two devices of one participant must still resolve a head')
})

// -- S3-C --------------------------------------------------------------------
// The bucket is a MUTABLE POINTER written new-before-old. A crash between the
// write and the sibling delete is unrecoverable: the head cannot be derived,
// the chain reads empty, the next commit forks (prev = null), and flatten() -
// the repair walker - deletes BOTH entries.

// CHANGED BY STEP 3: the crash is UNCHANGED and #setHead is STILL two
// non-atomic steps — but a half-applied write no longer bricks the chain. The
// crash is modelled with a real SIGNED claim now, because an entry that is not
// a verifiable claim is simply ignored, which would have made this pass for the
// wrong reason. The atomicity half of blocker 6 remains owed.
test('S3-C - a crash mid-commit no longer bricks the chain, and flatten() keeps the winner', () => {
  const a = tenant('alice-hive')
  a.save([], 'business')
  a.save(['business'], 'people')
  const first = a.save(['business', 'people'], 'Alice').succession
  const mol = moleculeOf('people')
  const bucket = `${mol}/${a.pubkey}`

  // new-before-old, interrupted after the write: two entries in one bucket.
  // The atom NAMES ITS SIGNER (the authority pass's adoption refusal), so a
  // faithful crash fixture has to carry it — an atom that does not name this
  // bucket is refused for it, which would make this pass for the wrong reason.
  const next = { succession: 1, signer: a.pubkey, prev: first, members: [], at: 7 }
  const crashed = sha256(bytesOf(next))
  a.root.write(crashed, bytesOf(next))
  const entry = a.mintHeadEntry(mol, { head: crashed, prev: first, seq: 1 })
  a.root.write(`${bucket}/${entry.name}`, entry.bytes)

  assert.equal(a.root.list(bucket).length, 2)
  assert.equal(a.headSig(mol), crashed, 'the higher seq resolves: a head IS derivable')
  assert.deepEqual(a.chain(mol).map((c) => c.sig), [first, crashed], 'the chain is reachable')

  // The repair walker sweeps only entries that LOST to a verified winner in my
  // own bucket. It can never remove the winner, and it owns nothing else.
  const removed = a.flatten(mol)
  assert.ok(!removed.includes(first),
    'the repair walker must not delete the last good head of my own chain')
  assert.equal(a.headSig(mol), crashed, 'and the head survives the sweep')
  assert.equal(a.root.list(bucket).length, 1)
})

// -- S3-D --------------------------------------------------------------------
// The PUBLISHED SPEC's head rule (flat entries; head = the entry no other entry
// names as prev) is hijackable by any tenant that can write one entry.
// The prototype quietly abandoned this rule for author buckets.

const specHeads = (root, mol) => {
  const entries = root.list(mol).filter((e) => e.kind === 'file').map((e) => e.name)
  const atoms = new Map(entries.map((s) => [s, JSON.parse(root.read(s).toString('utf8'))]))
  const named = new Set([...atoms.values()].map((a) => a.prev).filter(Boolean))
  return entries.filter((s) => !named.has(s)).map((s) => ({ sig: s, ...atoms.get(s) }))
}

// CHANGED BY STEP 3 — SPLIT IN TWO, AND THE ATTACK IS KEPT IN BOTH HALVES.
//
// D1 is the ORIGINAL attack against the published spec's FLAT layout, left
// intact as a NEGATIVE CONTROL (like legacyFlatten): a PASS here means the flat
// rule really is hijackable, which is the reason step 3 retires that layout.
// The old assertion stated the desired property and failed; it now states what
// actually happens, so the demonstration is preserved rather than deleted.
//
// D2 is the same attack against the layout step 3 actually ships — per-author
// buckets addressed by a public key, with a signed head claim — where it fails.
test('S3-D1 DEMONSTRATION (passes): the spec flat head rule IS hijacked by one hostile entry', () => {
  const root = new Root()
  const mol = moleculeOf('people')
  const aliceSig = signText('alice-hive')

  const put = (obj) => {
    const sig = sha256(bytesOf(obj))
    root.write(sig, bytesOf(obj))
    root.write(`${mol}/${sig}`)
    return sig
  }
  const s0 = put({ succession: 1, name: 'people', author: aliceSig, prev: null, members: ['env-alice'], at: 1 })
  const s1 = put({ succession: 1, name: 'people', author: aliceSig, prev: s0, members: ['env-alice', 'env-bob'], at: 2 })

  assert.deepEqual(specHeads(root, mol).map((h) => h.sig), [s1], 'honest head')

  // Mallory writes ONE entry claiming alice's author and naming her head as prev.
  const evil = put({ succession: 1, name: 'people', author: aliceSig, prev: s1, members: ['env-mallory'], at: 3 })

  const heads = specHeads(root, mol).filter((h) => h.author === aliceSig)
  assert.deepEqual(heads.map((h) => h.sig), [evil],
    'under the FLAT layout one entry moves another tenant s head — the rule is unusable')
  assert.equal(heads[0]?.members?.[0], 'env-mallory')
})

test('S3-D2 - the same hijack fails against per-key buckets and signed head claims', () => {
  const alice = tenant('alice-hive')
  alice.save([], 'people')
  alice.save(['people'], 'Alice')
  const mol = moleculeOf('people')
  const honest = alice.headSig(mol)
  assert.ok(honest)

  // Mallory writes the strongest entry she can: a real succession naming
  // alice's head as prev, and a claim signed by her own key for alice's bucket.
  const mallory = mintKeys()
  const evilSucc = alice.putAtom({ succession: 1, prev: honest, members: [], at: 3 })
  const evilClaim = {
    head: evilSucc, prev: honest, seq: 99,
    sig: mallory.sign(headClaimPreimage(mol, alice.pubkey, evilSucc, honest, 99)),
  }
  const bytes = bytesOf(evilClaim)
  alice.root.write(`${mol}/${alice.pubkey}/${sha256(bytes)}`, bytes)

  assert.equal(alice.headSig(mol), honest,
    'the entry is in the right directory and names the right prev, and is still inert: ' +
    'a head claim must verify under the KEY THAT NAMES THE BUCKET')
  assert.deepEqual(names(alice.children(['people'])), ['Alice'])
})

// -- S3-E --------------------------------------------------------------------
// remove() writes an EMPTY succession into the removed member's OWN molecule.
// Because a name is one molecule everywhere, deleting a tile on one page blanks
// a live, unrelated page that still lists the same name.

test('S3-E - removing a tile on one page blanks a live page elsewhere', () => {
  const a = tenant('alice-hive')
  a.save([], 'business')
  a.save([], 'club')
  a.save(['business'], 'people')
  a.save(['club'], 'people')
  a.save(['business', 'people'], 'Alice')
  a.save(['club', 'people'], 'Bob')

  assert.deepEqual(names(a.children(['club', 'people'])), ['Alice', 'Bob'], 'one molecule (declared)')

  a.remove(['business'], 'people') // tidy up the business page only

  assert.deepEqual(names(a.children(['club', 'people'])), ['Alice', 'Bob'],
    'the club page was never touched and must still hold its members')
})

// -- S3-F --------------------------------------------------------------------
// HOLDS: cold materialization is independent of readdir order.

test('S3-F (holds) - cold rebuild is byte-identical under reversed listing order', () => {
  const a = tenant('alice-hive')
  a.save([], 'business')
  a.save(['business'], 'people')
  a.save(['business', 'people'], 'Alice', { role: 'founder' })
  a.save(['business', 'people'], 'Bob')

  const b = tenant('bob-hive')
  b.save([], 'club')
  b.save(['club'], 'people')
  b.save(['club', 'people'], 'Zoe')

  const { root } = sharedHost(a, b)
  const natural = new MoleculeStore({ root: new Root(), author: 'cold' })
  const reversed = new MoleculeStore({ root: new Root(), author: 'cold' })
  const r1 = natural.materializeCold(hostOf(root, { order: 'natural' }), ['business', 'people'])
  const r2 = reversed.materializeCold(hostOf(root, { order: 'reverse' }), ['business', 'people'])
  assert.deepEqual(names(r1.children), names(r2.children))
  assert.deepEqual(r1.children.map((c) => c.position), r2.children.map((c) => c.position))
})
