// skeptic-0.test.mjs — adversarial pass. LENS: ORDERING.
// A shared molecule is a SET. Every place order is assumed is attacked:
// interleaved saves across routes, undo in one route, two tenants, a visitor,
// a crash mid-commit, and a hostile/careless host listing.

import test from 'node:test'
import assert from 'node:assert/strict'

import { MoleculeStore, moleculeOf, ROOT_MOLECULE } from './molecule.mjs'
import { Root } from './root.mjs'
import { hostOf } from './host.mjs'
import { signText } from './sig.mjs'

const seed = (store) => {
  store.save([], 'business')
  store.save(['business'], 'people')
  store.save([], 'club')
  store.save(['club'], 'people')
  return store
}

// ───────────────────────────────────────────────────────────────────────────
// A. THE BUCKET HAS NO TIE-BREAK RULE. The old bag had "max marker wins"; the
//    molecule bucket has nothing, so a bucket with != 1 file is SILENTLY dead.
//    #setHead is write-then-prune: two steps, no atomicity. A crash (or a
//    second tab, or the replicator racing the committer) between them erases
//    the author's entire chain from every read path, and the NEXT commit forks
//    a fresh chain with prev:null — history branched, silently.
// ───────────────────────────────────────────────────────────────────────────
test('A — a bucket with two entries silently erases the author: no order rule exists to break the tie', () => {
  const store = seed(new MoleculeStore({ author: 'owner' }))
  store.save(['business', 'people'], 'Alice')
  store.save(['business', 'people'], 'Bob')

  const mol = moleculeOf('people')
  const chainBefore = store.chain(mol)
  assert.equal(chainBefore.length, 2)
  assert.deepEqual(store.childNames(['business', 'people']), ['Alice', 'Bob'])

  // Crash between `write(new)` and `remove(old)` — i.e. #setHead half-applied.
  store.root.write(`${mol}/${store.authorSig}/${chainBefore[0].sig}`)

  assert.equal(store.heads(mol).length, 0, 'the head is not merely ambiguous — it is GONE')
  assert.deepEqual(store.childNames(['business', 'people']), [], 'the page reads EMPTY, no error, no warning')
  assert.equal(store.chain(mol).length, 0, 'the whole chain is unreachable: undo cannot recover it')

  // And the next commit forks: prev:null, members [] — history branched.
  store.save(['business', 'people'], 'Carol')
  const forked = store.chain(mol)
  assert.equal(forked.length, 1)
  assert.equal(forked[0].prev, null, 'history BRANCHED — the new chain does not name the old head')
  assert.deepEqual(store.childNames(['business', 'people']), ['Carol'], 'Alice and Bob are gone from the head forever')
})

// ───────────────────────────────────────────────────────────────────────────
// B. SELF-PLACING TRUSTS THE ATOM'S OWN `author`. materializeCold writes
//    `${sign(succ.name)}/${succ.author}/${head}` from bytes a host handed over.
//    Nothing checks that succ.author is the bucket the bytes came from, and
//    nothing checks that succ.author isn't ME. One foreign atom claiming my
//    author sig lands a second file in MY bucket -> case A -> my hive blanks.
//    replicateMolecule guards this (`includeMine`); materializeCold does not.
// ───────────────────────────────────────────────────────────────────────────
test('B — a host-served succession that claims my author sig destroys my head (self-placing is unauthenticated)', () => {
  const mine = seed(new MoleculeStore({ author: 'owner' }))
  mine.save(['business', 'people'], 'Alice')

  // Another device / a peer that replayed my identity — same author string,
  // different chain. Its bytes are perfectly valid and hash-verify.
  const theirs = seed(new MoleculeStore({ author: 'owner' }))
  theirs.save([], 'Mallory') // diverges at the ROOT molecule

  const host = hostOf(theirs.root)
  const molRoot = ROOT_MOLECULE

  assert.equal(mine.heads(molRoot).length, 1)
  mine.materializeCold(host, [])

  assert.equal(
    mine.root.list(`${molRoot}/${mine.authorSig}`).filter((e) => e.kind === 'file').length,
    2,
    'two heads in one bucket, written by a plain replication read',
  )
  assert.equal(mine.heads(molRoot).length, 0)
  assert.deepEqual(mine.childNames([]), [], 'my ROOT page is now blank because a host handed me bytes')
})

// ───────────────────────────────────────────────────────────────────────────
// C. `hidden` IS KEYED BY A CONTENT-ADDRESSED ENVELOPE SIG. Envelopes are
//    deliberately shared ("share, never copy"), so hiding SOMEONE ELSE's
//    member poisons that incidence for me FOREVER — including a member I
//    create myself later with identical content and slot. Born hidden, no
//    error, and there is no unhide verb anywhere in the model.
// ───────────────────────────────────────────────────────────────────────────
test('C — hiding a foreign member makes MY OWN identical member invisible on creation (content-addressed hide poisoning)', () => {
  const shared = new Root()
  const me = new MoleculeStore({ root: shared, author: 'me' })
  const them = new MoleculeStore({ root: shared, author: 'them' })

  them.save([], 'Alice', { note: 'their Alice' })
  assert.deepEqual(me.childNames([]), ['Alice'], 'I see their Alice')

  me.hide([], 'Alice')
  assert.deepEqual(me.childNames([]), [], 'hidden — correct so far')

  // Now I create my own Alice. Same name, same body, my members are empty so
  // nextFreeSlot is 0 -> byte-identical envelope -> already in my hidden set.
  const res = me.save([], 'Alice', { note: 'their Alice' })
  assert.equal(res.committed, true, 'the save reports success')
  assert.deepEqual(
    me.childNames([]),
    [],
    'MY OWN tile is invisible the moment it is created, and nothing says so',
  )
  assert.equal(them.childNames([]).length, 1, 'and they are unaffected, so nobody can diagnose it')
})

// ───────────────────────────────────────────────────────────────────────────
// D. remove() EMPTIES THE CHILD MOLECULE GLOBALLY. Deleting `people` from
//    /business appends an EMPTY succession to sign('people') — the molecule
//    that /club/people is also reading. Every tile under the other route
//    vanishes. The guard that would prevent it ("is this molecule still named
//    by any other envelope?") is UNCOMPUTABLE by construction: the design
//    deleted the parent->child edge from layer bytes AND the reverse map.
// ───────────────────────────────────────────────────────────────────────────
test('D — removing a member in one route empties the same-named page in every other route', () => {
  const store = seed(new MoleculeStore({ author: 'owner' }))
  store.save(['business', 'people'], 'Alice')
  store.save(['club', 'people'], 'Bob')

  assert.deepEqual(store.childNames(['club', 'people']), ['Alice', 'Bob'], 'the firehose, as declared')

  store.remove(['business'], 'people')

  assert.deepEqual(store.childNames([]), ['business', 'club'], 'club is untouched...')
  assert.deepEqual(
    store.childNames(['club', 'people']),
    [],
    '...but /club/people is now EMPTY — Bob was destroyed by a delete in a page that never held him',
  )
})

// ───────────────────────────────────────────────────────────────────────────
// E. UNDO IS PER-MOLECULE, SO IT IS PER-*ALL-ROUTES*. Rewind on /club/people
//    and then commit anything on /business/people and the head silently drops
//    every member added after the cursor — including the ones that belong to
//    the OTHER route. promoteToHead is documented; the cross-route reach is
//    the ordering cost nobody can see coming.
// ───────────────────────────────────────────────────────────────────────────
test('E — undo on one route + a save on another silently deletes the first route\'s tiles from the head', () => {
  const store = seed(new MoleculeStore({ author: 'owner' }))
  store.save(['business', 'people'], 'Alice')
  store.save(['club', 'people'], 'Bob') // Bob belongs to the club page

  store.undo(['club', 'people']) // user rewinds ON THE CLUB PAGE
  store.save(['business', 'people'], 'Carol') // ...then adds a tile on BUSINESS

  const head = store.chain(moleculeOf('people')).at(-1)
  const names = head.members.map((m) => store.getAtom(m).root)
  assert.deepEqual(names, ['Alice', 'Carol'])
  assert.equal(names.includes('Bob'), false, 'Bob is off the head; every peer that replicates sees him deleted')
  assert.deepEqual(store.childNames(['club', 'people']), ['Alice', 'Carol'])
})

// ───────────────────────────────────────────────────────────────────────────
// F. THE ORDER A VISITOR SEES IS SHA-256 OF PARTICIPANT IDS. viewOf puts MY
//    head first and sorts every other head by author sig. A visitor owns no
//    head, so ALL heads are foreign and the page's tile order is decided by
//    the hash of the contributors' identities. Same bytes, same successions,
//    same slots — rename the contributor and the published order flips.
//    There is no sig that names this projection: it is not content-addressed
//    and cannot be pinned (the design's answer, sealing, is unimplemented).
// ───────────────────────────────────────────────────────────────────────────
test('F — a visitor renders the page in author-hash order; the owner cannot pin the order they published', () => {
  const ownerName = 'owner'
  const ownerSig = signText(ownerName)

  // Two contributor identities: one hashing BELOW the owner, one ABOVE.
  let below = null
  let above = null
  for (let i = 0; i < 500 && (!below || !above); i++) {
    const n = `guest-${i}`
    const s = signText(n)
    if (!below && s < ownerSig) below = n
    if (!above && s > ownerSig) above = n
  }
  assert.ok(below && above, 'found identities on both sides of the owner')

  const build = (guestName) => {
    const shared = new Root()
    const owner = new MoleculeStore({ root: shared, author: ownerName })
    owner.save([], 'Owner-First')
    owner.save([], 'Owner-Second')
    const guest = new MoleculeStore({ root: shared, author: guestName })
    guest.save([], 'Guest-Tile')
    const visitor = new MoleculeStore({ root: shared, author: 'a-passing-visitor' })
    return { owner, visitor }
  }

  const lo = build(below)
  const hi = build(above)

  assert.deepEqual(
    lo.owner.childNames([]),
    ['Owner-First', 'Owner-Second', 'Guest-Tile'],
    'the OWNER always sees their own order',
  )
  assert.deepEqual(hi.owner.childNames([]), ['Owner-First', 'Owner-Second', 'Guest-Tile'])

  // Identical content in both hives. The only difference is a participant id.
  assert.deepEqual(hi.visitor.childNames([]), ['Owner-First', 'Owner-Second', 'Guest-Tile'])
  assert.deepEqual(
    lo.visitor.childNames([]),
    ['Guest-Tile', 'Owner-First', 'Owner-Second'],
    "a guest's tile is rendered FIRST on the owner's published page, because sha256(guest) < sha256(owner)",
  )

  // And there is no verb that produces a signature for what was rendered.
  assert.equal(typeof lo.owner.seal, 'undefined', 'no seal(): the projection has no content address')
})

// ───────────────────────────────────────────────────────────────────────────
// G. `revive` (share-never-copy, the replacement for the create-reset guard)
//    appends without checking the name. A second envelope with the same name
//    is swallowed into a stack and NEVER RENDERED — the tile exists in the
//    committed membership and is invisible on every surface.
// ───────────────────────────────────────────────────────────────────────────
test('G — revive of an existing name commits a member that no read path will ever show', () => {
  const store = seed(new MoleculeStore({ author: 'owner' }))
  const { vertex } = store.save(['business', 'people'], 'Alice', { v: 1 })
  store.save(['business', 'people'], 'Alice', { v: 2 }) // Alice now points at v2

  store.revive(['business', 'people'], 'Alice', vertex) // bring the old vertex back

  const head = store.chain(moleculeOf('people')).at(-1)
  assert.equal(head.members.length, 2, 'two envelopes named Alice are committed')
  const rows = store.children(['business', 'people'])
  assert.equal(rows.length, 1, 'but only one row renders')
  assert.equal(rows[0].stack.length, 1, 'the revived member is buried in a stack of MY OWN row')
  assert.notEqual(rows[0].vertex, vertex, 'and the revived vertex is not the one shown')
})

// ───────────────────────────────────────────────────────────────────────────
// H. Control: the things that genuinely hold. Directory listing order really
//    is irrelevant, and the two-tenant union really does converge.
// ───────────────────────────────────────────────────────────────────────────
test('H — HOLDS: listing order is irrelevant and the two-tenant union converges', () => {
  const shared = new Root()
  const a = new MoleculeStore({ root: shared, author: 'aaa' })
  const b = new MoleculeStore({ root: shared, author: 'bbb' })
  a.save([], 'One')
  a.save([], 'Two')
  b.save([], 'Three')

  const natural = a.childNames([])
  for (const order of ['reverse', 'sorted']) {
    const view = new MoleculeStore({ root: shared, author: 'aaa' })
    view.root.list = ((orig) => (dir, o) => orig.call(view.root, dir, { ...o, order }))(Root.prototype.list)
    assert.deepEqual(view.childNames([]), natural, `stable under listing order=${order}`)
  }
  assert.deepEqual(natural, ['One', 'Two', 'Three'])
})
