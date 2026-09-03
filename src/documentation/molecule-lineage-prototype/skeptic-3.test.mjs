// skeptic-3.test.mjs — LENS: COLD MATERIALIZATION + MULTITENANCY.
// Attacks the host path: empty root, listings + atom fetches only, and a
// directory that two tenants share.

import test from 'node:test'
import assert from 'node:assert/strict'

import { MoleculeStore, moleculeOf, ROOT_MOLECULE } from './molecule.mjs'
import { Root } from './root.mjs'
import { hostOf } from './host.mjs'
import { signText, bytesOf, sha256 } from './sig.mjs'

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
// and names a molecule the cold client never listed. Self-placement files it
// into the victim's bucket; the victim's page goes dark for every cold visitor.

test('S3-A - self-placement lets a hostile tenant blank a victim molecule for every cold visitor', () => {
  const alice = tenant('alice-hive')
  alice.save([], 'business')
  alice.save(['business'], 'people')
  alice.save(['business', 'people'], 'Alice', { role: 'founder' })
  alice.save(['business', 'people'], 'Bob')

  const mallory = tenant('mallory-hive')
  mallory.save([], 'games')

  // Mallory replaces the ONE file in her root-molecule bucket with an atom that
  // claims alice's author sig and claims the name 'people'. Nothing signs the
  // `author` field, and no atom is bound to the directory it sits in.
  const poison = {
    succession: 1,
    name: 'people',
    author: alice.authorSig,
    prev: null,
    members: [],
    at: 99,
  }
  const poisonSig = sha256(bytesOf(poison))
  mallory.root.write(poisonSig, bytesOf(poison))
  for (const f of mallory.root.list(`${ROOT_MOLECULE}/${mallory.authorSig}`)) {
    mallory.root.remove(`${ROOT_MOLECULE}/${mallory.authorSig}/${f.name}`)
  }
  mallory.root.write(`${ROOT_MOLECULE}/${mallory.authorSig}/${poisonSig}`)

  const { host } = sharedHost(alice, mallory)

  // Warm control: alice's own hive is fine.
  assert.deepEqual(names(alice.children(['business', 'people'])), ['Alice', 'Bob'])

  const cold = new MoleculeStore({ root: new Root(), author: 'cold-visitor' })
  const { children } = cold.materializeCold(host, ['business', 'people'])

  // The cold client wrote mallory's atom into ALICE's bucket in sign('people')
  const victimBucket = cold.root.list(`${moleculeOf('people')}/${alice.authorSig}`)
  assert.equal(victimBucket.length, 2, 'poison + real head now share the victim bucket')

  // ... and heads() drops any bucket that is not exactly one file, so the
  // victim's whole page is gone. THIS ASSERT IS THE FLAW:
  assert.deepEqual(names(children), ['Alice', 'Bob'],
    'a cold visitor must see the page the author published')
})

// -- S3-B --------------------------------------------------------------------
// ONE PARTICIPANT, TWO DEVICES - the ordinary case, not an attack. Both write
// under the same author sig. A host that carries both bricks the bucket.
// The marker model degrades (highest marker wins); this model resolves NOTHING.

test('S3-B - one participant on two devices bricks their own bucket on a host', () => {
  const laptop = tenant('jaime')
  laptop.save([], 'business')
  laptop.save(['business'], 'people')
  laptop.save(['business', 'people'], 'Alice')

  const phone = new MoleculeStore({ root: new Root(), author: 'jaime' })
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

test('S3-C - a crash mid-commit bricks the chain, and flatten() then destroys it', () => {
  const a = tenant('alice-hive')
  a.save([], 'business')
  a.save(['business'], 'people')
  const first = a.save(['business', 'people'], 'Alice').succession
  const mol = moleculeOf('people')
  const bucket = `${mol}/${a.authorSig}`

  // new-before-old, interrupted after the write: two entries in one bucket.
  const next = { succession: 1, name: 'people', author: a.authorSig, prev: first, members: [], at: 7 }
  const crashed = sha256(bytesOf(next))
  a.root.write(crashed, bytesOf(next))
  a.root.write(`${bucket}/${crashed}`)

  assert.equal(a.root.list(bucket).length, 2)
  assert.equal(a.headSig(mol), null, 'no head is derivable (documenting the state)')
  assert.deepEqual(a.chain(mol), [], 'the whole chain is unreachable')

  // The repair walker: it removes every file that is not the head - and the
  // head is null, so it removes them all.
  const removed = a.flatten(mol)
  assert.ok(!removed.includes(first),
    'the repair walker must not delete the last good head of my own chain')
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

test('S3-D - spec head rule (no entry names it as prev) is hijacked by one hostile entry', () => {
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
  assert.ok(evil)

  const heads = specHeads(root, mol).filter((h) => h.author === aliceSig)
  assert.deepEqual(heads.map((h) => h.sig), [s1],
    'a tenant must not be able to move another tenants head by writing an entry')
  assert.notEqual(heads[0]?.members?.[0], 'env-mallory')
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
