// authority-skeptic-2.test.mjs — PLACEMENT lens, second pass, AFTER step 3.
//
// Step 3 closed ONE placement door: a succession no longer declares `name` or
// `author`, the reader files at the address it asked for, the bucket is a
// public key, and the head entry is a signed claim over that address. I read
// `hypercomb-core/src/core/head-claim.ts`, its 34-case spec, `head-claim.mjs`
// and every write site in `molecule.mjs`, and I could not defeat any of that:
// the four HOLD tests at the bottom of this file are my failed attempts.
//
// So I attacked the OTHER door, the one step 3 did not touch.
//
// A MOLECULE ADDRESS AND AN ATOM ADDRESS LIVE IN ONE FLAT NAMESPACE.
//
//   <root>/<sig>                     content atom          (a FILE)
//   <root>/<sign(canon(name))>/...   a molecule            (a DIRECTORY)
//   <root>/<sign(meaning)>/...       a system pool         (a DIRECTORY)
//   <root>/<sha256("")>/...          the ROOT molecule     (a DIRECTORY)
//
// `pullClosure` writes host bytes at `sha256(bytes)`. That check proves the
// bytes match the NAME — it does not prove the name is an atom address rather
// than a directory address, and it cannot, because the two are the same
// alphabet by design (`classifyDirectoryEntry`: 64-hex is `member` when it is a
// file and `bucket` when it is a directory — the ENTRY decides).
//
// A pool address is `sha256(<meaning>)` and a molecule address is
// `sha256(<canonical name>)`. Both preimages are SHORT, PUBLIC STRINGS. So a
// remote does not need a hash collision to choose where my bytes land: it
// serves the preimage itself as the atom body. `sha256("bees")` IS the drone
// pool. `sha256("")` IS the root molecule.
//
// Nothing in the atom declares a location — the step-3 property holds
// literally. The atom instead NAMES a location, in an edge field, and the
// content-addressed fetcher does the writing.
//
// CONVENTION IN THIS FILE (the skeptic-2 convention, not the skeptic-0 one):
// every P-* test ASSERTS THE PROPERTY THE DESIGN CLAIMS. A FAILURE is the
// defect reproduced; a PASS means the hole is closed and the test has become a
// ratchet. The four HOLDS at the bottom assert the opposite way round — they
// pass today and must keep passing.
//
// AS OF THE FIX PASS: P-1..P-4 PASS. Nothing in the attacks changed except two
// fixtures that had to change to stay faithful — `publishHead` and the
// hand-built successions in P-3 now carry `signer`, because a succession names
// its signer since the adoption refusal landed, and an atom that does not name
// its bucket is refused FOR THAT REASON, which would have made these pass for
// entirely the wrong reason.
//
// WHAT CLOSED EACH:
//   P-1/P-2  a byte-level gate on replicated bodies. Every directory address
//            this system mints is sha256 of a canonical NAME or a pool MEANING,
//            and both alphabets are letters, digits, '-' and ':'. So a fetched
//            body that COULD be one is never stored — conservative in the safe
//            direction, and it loses nothing, because such a body is a handful
//            of bytes. See `looksLikeAddressPreimage`; the real cure is domain
//            separation on the ADDRESS, which relocates or re-mints every
//            signature in every existing hive and so belongs to a migration.
//   P-3      acceptance is settled against the CLAIM before any closure is
//            pulled: the fork walk READS WITHOUT KEEPING, and only the winning
//            head's closure is ever written.
//   P-4      a same-generation sibling is a `rival`, kept and ranked, never
//            refused — and NOTHING prunes a foreign bucket any more.

import test from 'node:test'
import assert from 'node:assert/strict'

import { MoleculeStore, moleculeOf, ROOT_MOLECULE } from './molecule.mjs'
import { Root } from './root.mjs'
import { hostOf } from './host.mjs'
import { poolSignature, BARE_WORD_POOL_MEANINGS } from './pool.mjs'
import { sha256, signText, bytesOf, EMPTY_SIG } from './sig.mjs'
import { mintKeys } from './keys.mjs'

/** Clone a Root — used to model one key on two devices. */
const cloneRoot = (src) => {
  const out = new Root()
  for (const p of src.paths()) out.write(p, src.read(p))
  return out
}

/** Union two Roots into one host-served pile of bytes. */
const mergeRoots = (...roots) => {
  const out = new Root()
  for (const r of roots) for (const p of r.paths()) out.write(p, r.read(p))
  return out
}

/**
 * Publish a hand-crafted succession as `store`'s head, the way a hostile client
 * would: the ATOM is arbitrary, the CLAIM is genuinely signed by the store's own
 * key for its own bucket in `mol`. Everything step 3 requires is satisfied.
 */
const publishHead = (store, mol, succObj) => {
  const prev = store.headSig(mol)
  const held = store.heldClaim(mol)
  // `signer` is what makes this a faithful hostile client rather than a broken
  // one: a succession that does not name its bucket is refused as an adoption
  // attempt, which is a DIFFERENT defence from the one under test here.
  const succ = { succession: 1, signer: store.pubkey, prev: prev ?? null, ...succObj }
  const head = store.putAtom(succ)
  const seq = (held?.seq ?? -1) + 1
  const entry = store.mintHeadEntry(mol, { head, prev: prev ?? null, seq })
  const bucket = `${mol}/${store.pubkey}`
  for (const e of store.root.list(bucket)) store.root.remove(`${bucket}/${e.name}`)
  store.root.write(`${bucket}/${entry.name}`, entry.bytes)
  return head
}

// ───────────────────────────────────────────────────────────────────────────
// P-1. THE PREIMAGE IS THE ADDRESS.
//
//      A remote peer publishes an ordinary, ordinarily-signed page whose
//      succession lists three extra "members". They are not envelopes. They are
//      the addresses of a reserved system pool, of an ordinary tile's molecule,
//      and of the ROOT MOLECULE ITSELF — and the peer serves, at each of those
//      addresses, the short string that hashes to it.
//
//      `pullClosure` fetches each one, confirms sha256(bytes) === sig (it
//      does — that is the whole trick), and writes a FILE at a name that is a
//      DIRECTORY address. A PASS here is the defect reproduced.
// ───────────────────────────────────────────────────────────────────────────
test('P-1 a remote can NO LONGER choose the root path my bytes land at, even by serving the PREIMAGE of a directory address', () => {
  const POOL_BEES = poolSignature('bees')          // sha256("bees")  — the drone pool
  const MOL_PEOPLE = moleculeOf('people')          // sha256("people") — a molecule
  assert.equal(POOL_BEES, sha256(Buffer.from('bees', 'utf8')))
  assert.equal(MOL_PEOPLE, sha256(Buffer.from('people', 'utf8')))
  assert.equal(ROOT_MOLECULE, EMPTY_SIG, 'the root molecule directory is sha256("")')

  const mallory = new MoleculeStore({ root: new Root(), author: 'mallory' })
  mallory.save([], 'holiday-photos', { note: 'an ordinary page' })

  // The bodies. Each one is the literal preimage of the address it sits at, so
  // every hash check downstream passes with room to spare.
  mallory.root.write(POOL_BEES, Buffer.from('bees', 'utf8'))
  mallory.root.write(MOL_PEOPLE, Buffer.from('people', 'utf8'))
  mallory.root.write(ROOT_MOLECULE, Buffer.alloc(0)) // sha256("") === ""

  // One more succession on Mallory's own chain, signed by Mallory's own key for
  // Mallory's own bucket in the ROOT molecule. Reader-derived placement is
  // satisfied: this claim is filed exactly where it was signed to live.
  const realMembers = mallory.getAtom(mallory.headSig(ROOT_MOLECULE)).members
  publishHead(mallory, ROOT_MOLECULE, {
    members: [...realMembers, POOL_BEES, MOL_PEOPLE, ROOT_MOLECULE],
    at: 99,
  })

  const host = hostOf(mallory.root)
  const victim = new MoleculeStore({ root: new Root(), author: 'victim' })

  assert.equal(victim.root.has(POOL_BEES), false, 'precondition: nothing at the bees pool address')
  assert.equal(victim.root.has(ROOT_MOLECULE), false, 'precondition: nothing at the root molecule address')

  const cold = victim.materializeCold(host, [])

  // The claim was ACCEPTED — it is authentic, correctly placed, and passes every
  // step-3 rule. That is the point: this is not a forgery, it is a legal page.
  assert.equal(
    cold.reports[0].accepted.some((a) => a.author === mallory.pubkey), true,
    'precondition: Mallory\'s head is a legitimate, verified, correctly-placed claim',
  )

  const planted = [POOL_BEES, MOL_PEOPLE, ROOT_MOLECULE].filter((a) => victim.root.has(a))
  assert.deepEqual(
    planted, [],
    'REMOTE-CHOSEN PLACEMENT (a FAILURE here means it is back).\n' +
    `A stranger's page caused my store to write files at ${planted.length} address(es) it chose:\n` +
    `  ${POOL_BEES}  = sign('bees')   — the RESERVED drone-bundle pool\n` +
    `  ${MOL_PEOPLE} = sign('people') — an ordinary tile's molecule\n` +
    `  ${ROOT_MOLECULE} = sha256("")  — THE ROOT MOLECULE ITSELF\n` +
    'No atom declared a location, so the step-3 rule is literally satisfied: the atom NAMES\n' +
    'an address in an edge field (`members`) and pullClosure (molecule.mjs) does the writing,\n' +
    'because sha256(bytes) === sig proves the bytes match the NAME and can never prove the\n' +
    'name is an atom rather than a directory — 64-hex is one alphabet for both by design\n' +
    '(classifyDirectoryEntry: file => member, directory => bucket).\n\n' +
    'IN THE REAL STORE THIS IS NOT COSMETIC. hypercomb-runtime/src/store.ts:811 writes root\n' +
    'content with `hypercombRoot.getFileHandle(signature, {create:true})`, while a pool /\n' +
    'molecule / bag is `getDirectoryHandle(address, {create:true})`. OPFS has ONE namespace\n' +
    'per directory: whichever kind is created first makes the other throw TypeMismatchError\n' +
    'forever. So one served peer either (a) permanently prevents sign(\'bees\') from ever being\n' +
    'created — the drone pool, i.e. no modules install — or (b) makes every replication throw\n' +
    'if it already exists. sha256("") is worse still: it is the root molecule of every hive.\n' +
    'Every preimage needed is a public constant — CLAUDE.md prints the pool table.\n\n' +
    'THE FIX IS NOT A BLOCKLIST (a molecule address is any word any participant ever typed,\n' +
    'so no list can be complete). It is that a content atom must be addressed somewhere a\n' +
    'directory can never be — e.g. sign over a domain-separated preimage for content\n' +
    '(`hc:atom:v1\\n<bytes>`) exactly as head-claim.ts already domain-separates head claims,\n' +
    'or store atoms one level down. head-claim.ts:152 makes this argument for signatures and\n' +
    'the same argument is unmade for addresses.',
  )
})

// ───────────────────────────────────────────────────────────────────────────
// P-2. THE POOL TABLE IS A TARGET LIST.
//
//      P-1 with one address is a curiosity. The preimages of every reserved
//      system pool are published in CLAUDE.md and frozen in pool.mjs, so the
//      whole table is reachable in one page load.
// ───────────────────────────────────────────────────────────────────────────
test('P-2 ONE served page plants a file at NO reserved system-pool address', () => {
  const targets = BARE_WORD_POOL_MEANINGS.map((m) => ({ meaning: m, sig: poolSignature(m) }))

  const mallory = new MoleculeStore({ root: new Root(), author: 'mallory' })
  mallory.save([], 'a-page')
  for (const t of targets) mallory.root.write(t.sig, Buffer.from(t.meaning, 'utf8'))

  const members = mallory.getAtom(mallory.headSig(ROOT_MOLECULE)).members
  publishHead(mallory, ROOT_MOLECULE, { members: [...members, ...targets.map((t) => t.sig)], at: 7 })

  const victim = new MoleculeStore({ root: new Root(), author: 'victim' })
  victim.materializeCold(hostOf(mallory.root), [])

  const hit = targets.filter((t) => victim.root.has(t.sig)).map((t) => t.meaning)
  assert.deepEqual(
    hit, [],
    `one visit to one host planted a FILE at ${hit.length}/${targets.length} reserved pool ` +
    `addresses: ${hit.join(', ')}. Every preimage is a public constant (CLAUDE.md's pool ` +
    'table, pool.mjs\'s frozen list). In OPFS a file and a directory cannot share a name, so ' +
    'each one is a permanent, remote-triggered denial of that pool.',
  )
})

// ───────────────────────────────────────────────────────────────────────────
// P-3. A REFUSED CLAIM STILL WRITES.
//
//      Acceptance step 4 (fork refusal) calls `chainContains`, which calls
//      `pullClosure` at every hop to fetch the atom it needs. So the bytes of a
//      chain the reader is ABOUT TO REJECT are downloaded and stored first —
//      including whatever addresses that chain names. Rejection is a verdict on
//      the head, not on the writes the verdict cost.
// ───────────────────────────────────────────────────────────────────────────
test('P-3 a claim REFUSED as a fork has written NOTHING: the walk reads without keeping', () => {
  const TARGET = poolSignature('clipboard')

  const mallory = new MoleculeStore({ root: new Root(), author: 'mallory' })
  mallory.save([], 'first-page')
  const honest = mallory.headSig(ROOT_MOLECULE)

  const victim = new MoleculeStore({ root: new Root(), author: 'victim' })
  victim.materializeCold(hostOf(mallory.root), [])
  assert.equal(victim.headSig(ROOT_MOLECULE, mallory.pubkey), honest, 'precondition: I hold Mallory\'s head')

  // Now Mallory builds a chain that does NOT contain what I hold, and names the
  // target address from inside it. Genesis + one child, both genuinely signed.
  mallory.root.write(TARGET, Buffer.from('clipboard', 'utf8'))
  const signer = mallory.pubkey
  const forkGenesis = mallory.putAtom({ succession: 1, signer, prev: null, members: [TARGET], at: 50 })
  const forkHead = mallory.putAtom({ succession: 1, signer, prev: forkGenesis, members: [TARGET], at: 51 })
  const entry = mallory.mintHeadEntry(ROOT_MOLECULE, { head: forkHead, prev: forkGenesis, seq: 1 })
  const bucket = `${ROOT_MOLECULE}/${mallory.pubkey}`
  for (const e of mallory.root.list(bucket)) mallory.root.remove(`${bucket}/${e.name}`)
  mallory.root.write(`${bucket}/${entry.name}`, entry.bytes)

  const report = victim.replicateMolecule(hostOf(mallory.root), ROOT_MOLECULE)

  assert.equal(
    report.refused.some((r) => r.reason === 'fork'), true,
    'precondition: the head is refused, exactly as history-never-branches requires',
  )
  assert.equal(victim.headSig(ROOT_MOLECULE, mallory.pubkey), honest, 'precondition: my head did not move')

  assert.equal(
    victim.root.has(TARGET), false,
    'THE REFUSAL COST ME THE WRITES. acceptHeadClaim refused this head as a fork, and my head ' +
    'never moved — but fork refusal runs `chainContains`, which calls `pullClosure` at every ' +
    `hop, so ${TARGET} (= sign('clipboard'), a reserved pool address) was fetched and stored ` +
    'anyway. The budget is 64 hops and each hop pulls a FULL page closure, so a single refused ' +
    'claim is also a bounded-but-large, remote-controlled write amplifier: bytes the reader ' +
    'decided not to trust are already on disk at addresses the sender chose. Acceptance should ' +
    'be settled against the CLAIM (head/prev/seq/sig are all in the signed preimage) before any ' +
    'closure is pulled; only the accepted head\'s closure should ever be written.',
  )
})

// ───────────────────────────────────────────────────────────────────────────
// P-4. `resolveBucketHead` is order-independent; the PIPELINE AROUND IT IS NOT.
//
//      head-claim.ts:334-339 claims the tie-break exists "so every reader on
//      every host converges on the same head". It does not: `replicateMolecule`
//      PRUNES the losing entry out of a foreign bucket after accepting, and
//      refuses the rival as a fork on the next pass — so a reader never gets to
//      run the tie-break over both. Which head a reader ends up holding depends
//      on which one it saw FIRST.
// ───────────────────────────────────────────────────────────────────────────
test('P-4 two readers AGREE about one author, because nothing prunes a foreign bucket and resolution sees both', () => {
  const keys = mintKeys() // ONE participant, TWO devices — the S3-B shape

  const deviceA = new MoleculeStore({ root: new Root(), author: 'owner', keys })
  deviceA.save([], 'shared-start')

  const deviceB = new MoleculeStore({ root: cloneRoot(deviceA.root), author: 'owner', keys })
  deviceA.save([], 'from-device-a')
  deviceB.save([], 'from-device-b')

  const headA = deviceA.headSig(ROOT_MOLECULE)
  const headB = deviceB.headSig(ROOT_MOLECULE)
  assert.notEqual(headA, headB, 'precondition: two genuine seq-1 heads under one key')
  assert.equal(deviceA.heldClaim(ROOT_MOLECULE).seq, 1)
  assert.equal(deviceB.heldClaim(ROOT_MOLECULE).seq, 1)

  const [smaller, larger] = headA < headB ? [deviceA, deviceB] : [deviceB, deviceA]
  const both = hostOf(mergeRoots(deviceA.root, deviceB.root))

  // Reader ONE is cold and sees both entries: the tie-break picks the smaller sig.
  const cold = new MoleculeStore({ root: new Root(), author: 'cold' })
  cold.materializeCold(both, [])

  // Reader TWO happened to meet the larger-sig device first, then met the host
  // that has both.
  const warm = new MoleculeStore({ root: new Root(), author: 'warm' })
  warm.replicateMolecule(hostOf(larger.root), ROOT_MOLECULE)
  warm.replicateMolecule(both, ROOT_MOLECULE)

  assert.equal(
    cold.headSig(ROOT_MOLECULE, keys.pubkey),
    warm.headSig(ROOT_MOLECULE, keys.pubkey),
    'TWO READERS, ONE AUTHOR, TWO DIFFERENT HEADS, FOREVER.\n' +
    `cold  renders ${JSON.stringify(cold.viewOf(ROOT_MOLECULE).map((r) => r.name))}\n` +
    `warm  renders ${JSON.stringify(warm.viewOf(ROOT_MOLECULE).map((r) => r.name))}\n` +
    'resolveBucketHead IS total and order-independent — but replicateMolecule never lets it ' +
    'see both entries. It accepts one, hard-deletes every sibling in that FOREIGN bucket ' +
    '("the loser is NEVER deleted", head-claim.ts:339, is false of the caller), and then ' +
    'refuses the rival as a fork on every later pass. So the documented convergence property ' +
    'is really "whichever entry a reader met first wins", and a cold visitor and a warm one ' +
    'render different pages for the same author on the same host.',
  )
})

// ───────────────────────────────────────────────────────────────────────────
// HOLDS — placement attacks I ran against step 3 that FAILED. Each of these
// worked before the fix; each is now a structural no-op.
// ───────────────────────────────────────────────────────────────────────────

test('HOLDS: a host cannot choose the FILENAME of the entry it plants in my store', () => {
  // The obvious next move after P-1: serve the head entry itself under a
  // filename that is a reserved address. The reader renames it to sha256 of the
  // bytes it received (molecule.mjs, `const name = sha256(bytes)`), so the host
  // never gets to choose a path segment at all.
  const m = new MoleculeStore({ root: new Root(), author: 'mallory' })
  m.save([], 'page')
  const bucket = `${ROOT_MOLECULE}/${m.pubkey}`
  const real = m.root.list(bucket)[0]
  const bytes = m.root.read(`${bucket}/${real.name}`)
  m.root.remove(`${bucket}/${real.name}`)
  m.root.write(`${bucket}/${poolSignature('threads')}`, bytes) // hostile filename

  const v = new MoleculeStore({ root: new Root(), author: 'victim' })
  v.replicateMolecule(hostOf(m.root), ROOT_MOLECULE)

  assert.equal(v.root.has(`${bucket}/${poolSignature('threads')}`), false)
  assert.deepEqual(v.root.list(bucket).map((e) => e.name), [sha256(bytes)])
})

test('HOLDS: a bucket directory that is not lowercase 64-hex is never a write target', () => {
  const m = new MoleculeStore({ root: new Root(), author: 'mallory' })
  m.save([], 'page')
  const bucket = `${ROOT_MOLECULE}/${m.pubkey}`
  const real = m.root.list(bucket)[0]
  const bytes = m.root.read(`${bucket}/${real.name}`)

  for (const hostile of ['dev-open', '..', m.pubkey.toUpperCase(), 'a'.repeat(63), 'bees']) {
    m.root.write(`${ROOT_MOLECULE}/${hostile}/${real.name}`, bytes)
  }

  const v = new MoleculeStore({ root: new Root(), author: 'victim' })
  const report = v.replicateMolecule(hostOf(m.root), ROOT_MOLECULE)

  const written = v.root.paths().filter((p) => p.startsWith(`${ROOT_MOLECULE}/`) && !p.includes(m.pubkey))
  assert.deepEqual(written, [], `wrote to a non-bucket directory: ${written.join(', ')}`)
  assert.equal(report.refused.filter((r) => r.reason === 'malformed').length >= 5, true)
})

test('HOLDS: a nested directory inside a bucket is never read and never written', () => {
  const m = new MoleculeStore({ root: new Root(), author: 'mallory' })
  m.save([], 'page')
  const bucket = `${ROOT_MOLECULE}/${m.pubkey}`
  const real = m.root.list(bucket)[0]
  const bytes = m.root.read(`${bucket}/${real.name}`)
  m.root.write(`${bucket}/${'c'.repeat(64)}/${real.name}`, bytes)   // one level deeper
  m.root.write(`${bucket}/${'c'.repeat(64)}/${'d'.repeat(64)}/x`, bytes)

  const v = new MoleculeStore({ root: new Root(), author: 'victim' })
  v.replicateMolecule(hostOf(m.root), ROOT_MOLECULE)

  const deep = v.root.paths().filter((p) => p.split('/').length > 3)
  assert.deepEqual(deep, [], `a nested path was written: ${deep.join(', ')}`)
})

test('HOLDS: a claim signed for a tile molecule is inert when served from a system pool address (and vice versa)', () => {
  // The bare-word collision is real — sign(canon('bees')) === sign('bees') — so
  // the reserved pool and a tile molecule ARE one directory. Step 3 is what
  // makes that survivable: a claim minted at one address does not verify at the
  // other, because both addresses are inside the signed preimage.
  assert.equal(moleculeOf('bees'), poolSignature('bees'), 'the collision is real and is the design')

  const m = new MoleculeStore({ root: new Root(), author: 'mallory' })
  m.save([], 'bees')
  m.save(['bees'], 'worker')
  const beesMol = moleculeOf('bees')
  const entry = m.root.list(`${beesMol}/${m.pubkey}`)[0]
  const bytes = m.root.read(`${beesMol}/${m.pubkey}/${entry.name}`)

  // Move that genuine, genuinely-signed entry to another molecule.
  const elsewhere = moleculeOf('people')
  m.root.write(`${elsewhere}/${m.pubkey}/${entry.name}`, bytes)

  const v = new MoleculeStore({ root: new Root(), author: 'victim' })
  const report = v.replicateMolecule(hostOf(m.root), elsewhere)
  assert.deepEqual(report.accepted, [])
  assert.equal(report.refused[0].reason, 'unsigned')
  assert.equal(v.root.paths().some((p) => p.startsWith(`${elsewhere}/`)), false)
})
