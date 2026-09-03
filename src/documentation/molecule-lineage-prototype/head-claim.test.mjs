// head-claim.test.mjs — the STEP 3 authentication scenarios, end to end against
// a real host: reader-derived placement, pubkey buckets, signed head entries.
//
// The skeptic files carry the ATTACKS these close. This file carries the
// PROPERTIES, stated positively, so a regression names itself.

import test from 'node:test'
import assert from 'node:assert/strict'

import { MoleculeStore, moleculeOf, ROOT_MOLECULE } from './molecule.mjs'
import { Root } from './root.mjs'
import { hostOf } from './host.mjs'
import { poolSignature } from './pool.mjs'
import { bytesOf, sha256 } from './sig.mjs'
import { mintKeys } from './keys.mjs'
import { acceptHeadClaim, headClaimPreimage, parseHeadClaimPreimage, resolveBucketHead } from './head-claim.mjs'

const names = (rows) => rows.map((r) => r.name)

/** Plant a head entry at an arbitrary address, the way a hostile host would. */
const plantEntry = (root, molSig, bucket, claim) => {
  const bytes = bytesOf(claim)
  root.write(`${molSig}/${bucket}/${sha256(bytes)}`, bytes)
  return sha256(bytes)
}

// ── the preimage itself ─────────────────────────────────────────────────────

test('the preimage is six lines and is rebuilt by the READER, never parsed out of bytes', () => {
  const k = mintKeys()
  const p = headClaimPreimage(ROOT_MOLECULE, k.pubkey, 'a'.repeat(64), null, 0)
  assert.equal(p.split('\n').length, 6)
  assert.equal(p.split('\n')[0], 'hc:molecule-head:v1')
  assert.equal(p.split('\n')[4], '-', 'genesis is the literal "-", which no hex address can be')
  assert.deepEqual(parseHeadClaimPreimage(p), {
    molecule: ROOT_MOLECULE, pubkey: k.pubkey, head: 'a'.repeat(64), prev: null, seq: 0,
  })
  // A NIP-98 header (empty content) or a hive index (JSON content) can never be
  // reinterpreted as a head claim: line one is domain separation.
  assert.equal(parseHeadClaimPreimage(''), null)
  assert.equal(parseHeadClaimPreimage(JSON.stringify({ v: 1, roots: {} })), null)
})

test('a bucket is the RAW public key — the shape classifyDirectoryEntry already calls a bucket', () => {
  const s = new MoleculeStore({ root: new Root(), author: 'me' })
  s.save([], 'thing')
  assert.match(s.pubkey, /^[0-9a-f]{64}$/)
  const dirs = s.root.list(ROOT_MOLECULE).filter((e) => e.kind === 'dir')
  assert.deepEqual(dirs.map((d) => d.name), [s.pubkey])
})

// ── placement ───────────────────────────────────────────────────────────────

test('a claim minted for one molecule is INERT at every other molecule', () => {
  const alice = new MoleculeStore({ root: new Root(), author: 'alice' })
  alice.save([], 'business')
  const head = alice.headSig(ROOT_MOLECULE)
  const entry = alice.mintHeadEntry(ROOT_MOLECULE, { head, prev: null, seq: 0 })

  // Byte-identical entry, replayed into a reserved system pool by a host.
  const victim = new MoleculeStore({ root: new Root(), author: 'victim' })
  const bees = poolSignature('bees')
  victim.root.write(`${bees}/${alice.pubkey}/${entry.name}`, entry.bytes)
  victim.root.write(head, alice.root.read(head))

  assert.equal(victim.headSig(bees, alice.pubkey), null,
    'the reader rebuilds the preimage from sign("bees"), which is not what was signed')
  assert.equal(victim.heads(bees).length, 0)
  // ...and at the address it WAS signed for, the same bytes are good.
  victim.root.write(`${ROOT_MOLECULE}/${alice.pubkey}/${entry.name}`, entry.bytes)
  assert.equal(victim.headSig(ROOT_MOLECULE, alice.pubkey), head)
})

test('a claim minted under one key is INERT in every other key\'s bucket', () => {
  const alice = new MoleculeStore({ root: new Root(), author: 'alice' })
  alice.save([], 'business')
  const head = alice.headSig(ROOT_MOLECULE)
  const bob = mintKeys()

  // Bob writes a preimage that NAMES alice's bucket. He can write the string;
  // he cannot make it verify under her key.
  plantEntry(alice.root, ROOT_MOLECULE, alice.pubkey, {
    head, prev: null, seq: 5,
    sig: bob.sign(headClaimPreimage(ROOT_MOLECULE, alice.pubkey, head, null, 5)),
  })
  assert.equal(alice.root.list(`${ROOT_MOLECULE}/${alice.pubkey}`).length, 2, 'the bytes are on disk')
  assert.equal(alice.headSig(ROOT_MOLECULE), head, 'and completely inert')
  assert.equal(alice.heads(ROOT_MOLECULE)[0].rivals, 0, 'it is not even a candidate')
})

test('the reader files at the address it ASKED FOR, and the atom carries no location at all', () => {
  const alice = new MoleculeStore({ root: new Root(), author: 'alice' })
  alice.save([], 'business')
  alice.save(['business'], 'people')
  alice.save(['business', 'people'], 'Alice')
  const succ = alice.getAtom(alice.headSig(moleculeOf('people')))

  // NO LOCATION. `name` and `author` were the two fields the cold path turned
  // into path segments, and they are gone for good.
  assert.equal(succ.name, undefined)
  assert.equal(succ.author, undefined)

  // ONE BINDING, added by the authority review: `signer`. It is not a location
  // and chooses nothing — it is compared against a bucket address the reader
  // ALREADY AUTHENTICATED, which is why it is safe now and was not before.
  // Without it a stranger could mint a valid claim over someone else's
  // succession and take the byline for the whole page.
  assert.deepEqual(Object.keys(succ).sort(), ['at', 'members', 'prev', 'signer', 'succession'])
  assert.equal(succ.signer, alice.pubkey)

  // And it is never a path: the entry lives where the READER walked, and
  // rewriting `signer` cannot move it anywhere — it only stops verifying.
  const bucket = `${moleculeOf('people')}/${alice.pubkey}`
  assert.equal(alice.root.list(bucket).length, 1)
})

test('ADOPTION REFUSAL: a valid claim over SOMEONE ELSE\'S succession takes no byline', () => {
  // The claim binds (molecule, pubkey, head) — so two keys can each mint a
  // perfectly valid claim naming the SAME succession, every field true. `viewOf`
  // attributes rows to whichever author absorbs first (mine, then others sorted
  // by pubkey), so a stranger who grinds keys until theirs sorts first used to
  // take the byline for every row, on every reader, invisibly: dedup by envelope
  // sig meant the rows were byte-identical and only `author` changed.
  const alice = new MoleculeStore({ root: new Root(), author: 'alice' })
  alice.save([], 'alice-wrote-this')
  const aliceHead = alice.headSig(ROOT_MOLECULE)

  let thiefKeys = mintKeys()
  for (let i = 0; i < 400 && thiefKeys.pubkey >= alice.pubkey; i++) thiefKeys = mintKeys()
  const thief = new MoleculeStore({ root: new Root(), author: 'thief', keys: thiefKeys })
  const adopted = thief.mintHeadEntry(ROOT_MOLECULE, { head: aliceHead, prev: null, seq: 0 })

  const pile = new Root()
  for (const path of alice.root.paths()) pile.write(path, alice.root.read(path))
  pile.write(`${ROOT_MOLECULE}/${thiefKeys.pubkey}/${adopted.name}`, adopted.bytes)

  const bob = new MoleculeStore({ root: new Root(), author: 'bob' })
  bob.replicateMolecule(hostOf(pile), ROOT_MOLECULE)

  assert.equal(bob.headSig(ROOT_MOLECULE, thiefKeys.pubkey), null,
    'the thief\'s bucket heads nothing: the atom does not name it as signer')
  const row = bob.viewOf(ROOT_MOLECULE).find((r) => r.name === 'alice-wrote-this')
  assert.ok(row)
  assert.equal(row.author, alice.pubkey, 'the byline stays with the key that signed the atom')
})

// ── recency ─────────────────────────────────────────────────────────────────

test('a genuinely signed OLDER head is refused as stale (a signature never proves recency)', () => {
  const alice = new MoleculeStore({ root: new Root(), author: 'alice' })
  alice.save([], 'one')
  const gen0 = alice.mintHeadEntry(ROOT_MOLECULE, { head: alice.headSig(ROOT_MOLECULE), prev: null, seq: 0 })
  alice.save([], 'two')
  const current = alice.headSig(ROOT_MOLECULE)

  const held = alice.heldClaim(ROOT_MOLECULE)
  const replay = JSON.parse(gen0.bytes.toString('utf8'))
  const verdict = acceptHeadClaim(
    { molecule: ROOT_MOLECULE, pubkey: alice.pubkey }, replay, alice.verify, { held },
  )
  assert.equal(verdict.ok, false)
  assert.equal(verdict.reason, 'stale')
  assert.equal(alice.headSig(ROOT_MOLECULE), current)
})

test('a future-dated claim is impossible: seq is signed, so there is no clock to skew', () => {
  const alice = new MoleculeStore({ root: new Root(), author: 'alice' })
  alice.save([], 'one')
  alice.save([], 'two')
  const held = alice.heldClaim(ROOT_MOLECULE)
  assert.equal(held.seq, 1)
  // Raise seq without the secret -> the preimage changes -> unsigned.
  const verdict = acceptHeadClaim(
    { molecule: ROOT_MOLECULE, pubkey: alice.pubkey },
    { head: held.head, prev: held.prev, seq: 9999, sig: held.sig },
    alice.verify, { held: null },
  )
  assert.equal(verdict.ok, false)
  assert.equal(verdict.reason, 'unsigned')
})

// ── forks ───────────────────────────────────────────────────────────────────

test('fork refusal survives, and now walks prev DELIBERATELY across two generations', () => {
  const alice = new MoleculeStore({ root: new Root(), author: 'alice' })
  alice.save([], 'notes')
  const peer = new MoleculeStore({ root: new Root(), author: 'peer' })
  peer.replicateMolecule(hostOf(alice.root), ROOT_MOLECULE)
  assert.equal(peer.headSig(ROOT_MOLECULE, alice.pubkey), alice.headSig(ROOT_MOLECULE))

  // Two more generations. `prev` is a REFERENT and is never in a closure, so
  // the intermediate atom only arrives because the walk fetches it on purpose.
  alice.save([], 'more')
  alice.save([], 'even-more')
  const report = peer.replicateMolecule(hostOf(alice.root), ROOT_MOLECULE)
  assert.equal(report.accepted.length, 1, 'a head two generations ahead is accepted')
  assert.equal(peer.headSig(ROOT_MOLECULE, alice.pubkey), alice.headSig(ROOT_MOLECULE))

  // A genuinely divergent chain under the same key, LONGER than the one I hold,
  // so the walk can actually reach its genesis and DISPROVE descent. That is a
  // hard `fork`: refused, and — because a refusal must cost the reader nothing —
  // not one byte of it is stored.
  const rogue = new MoleculeStore({ root: new Root(), author: 'alice', keys: alice.keys })
  rogue.save([], 'notes')
  rogue.save([], 'elsewhere')
  rogue.save([], 'elsewhere-again')
  rogue.save([], 'elsewhere-once-more')
  const before = peer.root.paths().length
  const refusal = peer.replicateMolecule(hostOf(rogue.root), ROOT_MOLECULE)
  assert.equal(refusal.accepted.length, 0)
  assert.equal(refusal.refused[0].reason, 'fork')
  assert.equal(peer.root.paths().length, before, 'a disproven fork writes NOTHING')
  assert.equal(peer.headSig(ROOT_MOLECULE, alice.pubkey), alice.headSig(ROOT_MOLECULE))
})

test('a walk that GIVES UP says "unproven", and the higher signed seq still wins', () => {
  // "I walked your chain and you branched" is permanent and is an accusation.
  // "I gave up walking" says nothing about the author. Collapsing them is what
  // turned 65 ordinary edits made while a peer was offline into a permanent
  // partition, and let one replayed genesis pin a cold visitor forever.
  const alice = new MoleculeStore({ root: new Root(), author: 'alice' })
  alice.save([], 'page')
  const peer = new MoleculeStore({ root: new Root(), author: 'peer' })
  peer.replicateMolecule(hostOf(alice.root), ROOT_MOLECULE)

  // 200 ordinary edits — far past any constant hop budget.
  for (let i = 0; i < 200; i++) alice.save([], `later-${i}`)
  const report = peer.replicateMolecule(hostOf(alice.root), ROOT_MOLECULE)
  assert.equal(report.refused.filter((r) => r.reason === 'fork').length, 0,
    'an honest absence is never reported as a branch')
  assert.equal(peer.headSig(ROOT_MOLECULE, alice.pubkey), alice.headSig(ROOT_MOLECULE))
  assert.equal(peer.viewOf(ROOT_MOLECULE).length, 201)
})

test('a REFUSED head costs the reader nothing: the fork walk reads without keeping', () => {
  // Fork refusal used to walk `prev` with `pullClosure`, so the closure of a
  // chain the reader was ABOUT TO REJECT was downloaded and committed to disk
  // first — up to 64 hops, a full page each, at addresses the sender chose. A
  // verdict is not a rollback of the writes it cost.
  const alice = new MoleculeStore({ root: new Root(), author: 'alice' })
  alice.save([], 'page')
  const peer = new MoleculeStore({ root: new Root(), author: 'peer' })
  peer.replicateMolecule(hostOf(alice.root), ROOT_MOLECULE)
  const snapshot = peer.root.paths().sort()

  const rogue = new MoleculeStore({ root: new Root(), author: 'alice', keys: alice.keys })
  for (let i = 0; i < 6; i++) rogue.save([], `forked-${i}`)
  const report = peer.replicateMolecule(hostOf(rogue.root), ROOT_MOLECULE)

  assert.equal(report.refused[0].reason, 'fork')
  assert.deepEqual(peer.root.paths().sort(), snapshot,
    'not one atom of the refused chain reached the store')
})

// ── multi-entry buckets ─────────────────────────────────────────────────────

test('resolveBucketHead is total and order-independent, so a second entry never blanks a page', () => {
  const a = new MoleculeStore({ root: new Root(), author: 'a' })
  a.save([], 'one')
  a.save([], 'two')
  const chain = a.chain(ROOT_MOLECULE)
  const stale = a.mintHeadEntry(ROOT_MOLECULE, { head: chain[0].sig, prev: null, seq: 0 })
  a.root.write(`${ROOT_MOLECULE}/${a.pubkey}/${stale.name}`, stale.bytes)

  assert.equal(a.root.list(`${ROOT_MOLECULE}/${a.pubkey}`).length, 2)
  assert.equal(a.headSig(ROOT_MOLECULE), chain[1].sig)
  assert.deepEqual(names(a.children([])), ['one', 'two'])

  // Same answer under every listing order.
  for (const order of ['reverse', 'sorted']) {
    assert.equal(a.heads(ROOT_MOLECULE, { order })[0].sig, chain[1].sig)
  }
  // And a tie is broken by the smallest head sig, in both directions.
  const tie = [{ head: 'b'.repeat(64), prev: null, seq: 3 }, { head: 'a'.repeat(64), prev: null, seq: 3 }]
  assert.equal(resolveBucketHead(tie).head, 'a'.repeat(64))
  assert.equal(resolveBucketHead([...tie].reverse()).head, 'a'.repeat(64))
})

// ── read-only visitors ──────────────────────────────────────────────────────

test('a reader with NO bucket of its own verifies and materializes everything normally', () => {
  const alice = new MoleculeStore({ root: new Root(), author: 'alice' })
  alice.save([], 'business')
  alice.save(['business'], 'people')
  alice.save(['business', 'people'], 'Alice')

  // Verification is against the BUCKET's key, never the reader's, so a visitor
  // that owns nothing reads the whole hive.
  const visitor = new MoleculeStore({ root: new Root(), author: 'visitor' })
  const { children } = visitor.materializeCold(hostOf(alice.root), ['business', 'people'])
  assert.deepEqual(names(children), ['Alice'])
  assert.equal(visitor.headSig(moleculeOf('people')), null, 'and owns no bucket anywhere')
  assert.deepEqual(children.map((c) => c.mine), [false])

  // Its flatten is therefore a structural no-op: the cold path that used to be
  // the attack surface can no longer delete anything at all.
  const peopleMol = moleculeOf('people')
  const before = visitor.root.list(`${peopleMol}/${alice.pubkey}`).length
  assert.deepEqual(visitor.flatten(peopleMol), [])
  assert.equal(visitor.root.list(`${peopleMol}/${alice.pubkey}`).length, before)
})

// ── shape gate ──────────────────────────────────────────────────────────────

test('a non-64-hex bucket name is never a write target ("dev-open" and friends)', () => {
  const alice = new MoleculeStore({ root: new Root(), author: 'alice' })
  alice.save([], 'business')
  const entry = alice.mintHeadEntry(ROOT_MOLECULE, { head: alice.headSig(ROOT_MOLECULE), prev: null, seq: 0 })

  const hostile = new Root()
  for (const p of alice.root.paths()) hostile.write(p, alice.root.read(p))
  hostile.write(`${ROOT_MOLECULE}/dev-open/${entry.name}`, entry.bytes)

  const cold = new MoleculeStore({ root: new Root(), author: 'cold' })
  const report = cold.replicateMolecule(hostOf(hostile), ROOT_MOLECULE)
  assert.ok(report.refused.some((f) => f.author === 'dev-open' && f.reason === 'malformed'))
  assert.equal(cold.root.list(`${ROOT_MOLECULE}/dev-open`).length, 0,
    'a "foreign" entry name would veto deletion of the whole molecule forever')
})

test('an entry that is not a claim at all is IGNORED, never deleted — data never heals', () => {
  const a = new MoleculeStore({ root: new Root(), author: 'a' })
  a.save([], 'one')
  const head = a.headSig(ROOT_MOLECULE)
  a.root.write(`${ROOT_MOLECULE}/${a.pubkey}/${'c'.repeat(64)}`, Buffer.from('not json', 'utf8'))
  assert.equal(a.headSig(ROOT_MOLECULE), head, 'ignored')
  assert.ok(a.root.has(`${ROOT_MOLECULE}/${a.pubkey}/${'c'.repeat(64)}`), 'and still on disk')
})
