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
import { mintKeys } from './keys.mjs'

const seed = (store) => {
  store.save([], 'business')
  store.save(['business'], 'people')
  store.save([], 'club')
  store.save(['club'], 'people')
  return store
}

// ───────────────────────────────────────────────────────────────────────────
// A. THE BUCKET HAS NO TIE-BREAK RULE. The old bag had "max marker wins"; the
//    molecule bucket had nothing, so a bucket with != 1 file was SILENTLY dead.
//    #setHead is write-then-prune: two steps, no atomicity. A crash (or a
//    second tab, or the replicator racing the committer) between them erased
//    the author's entire chain from every read path, and the NEXT commit forked
//    a fresh chain with prev:null — history branched, silently.
//
//    CHANGED BY STEP 3 (signed head claims). The attack is UNCHANGED — the same
//    crash, the same two entries in one bucket — but it no longer blanks the
//    page. `if (files.length !== 1) continue` was the amplifier that turned any
//    second entry into a total blackout for every reader, and it is retired:
//    `resolveBucketHead` picks the highest `seq`, ties broken by the
//    lexicographically smallest head sig. That order is total, deterministic
//    and reader-derived, so every reader converges on the same head.
//
//    NOTE WHAT IS STILL BROKEN. #setHead is STILL write-then-prune and STILL
//    not atomic. Step 3 made a half-applied write SURVIVABLE, not atomic; the
//    atomicity half of blocker 6 is untouched and still owed.
//
//    The crash is now modelled with a REAL SIGNED CLAIM for the older
//    generation, because an entry that is not a verifiable claim is simply
//    ignored — which would have made this test pass for the wrong reason.
// ───────────────────────────────────────────────────────────────────────────
test('A — a bucket with two entries RESOLVES instead of erasing the author (was: silently erased)', () => {
  const store = seed(new MoleculeStore({ author: 'owner' }))
  store.save(['business', 'people'], 'Alice')
  store.save(['business', 'people'], 'Bob')

  const mol = moleculeOf('people')
  const chainBefore = store.chain(mol)
  assert.equal(chainBefore.length, 2)
  assert.deepEqual(store.childNames(['business', 'people']), ['Alice', 'Bob'])

  // Crash between `write(new)` and `remove(old)` — i.e. #setHead half-applied.
  // Generation 0 is re-planted beside the live generation 1, both signed by the
  // bucket's own key, exactly as an interrupted commit would leave them.
  const stale = store.mintHeadEntry(mol, { head: chainBefore[0].sig, prev: null, seq: 0 })
  store.root.write(`${mol}/${store.pubkey}/${stale.name}`, stale.bytes)
  assert.equal(store.root.list(`${mol}/${store.pubkey}`).length, 2, 'two entries in one bucket')

  const head = store.heads(mol)[0]
  assert.equal(head.sig, chainBefore[1].sig, 'the higher seq wins — the head is not ambiguous')
  assert.equal(head.rivals, 1, 'and the loser is REPORTED, never deleted: data never heals')
  assert.deepEqual(store.childNames(['business', 'people']), ['Alice', 'Bob'], 'the page still renders')
  assert.equal(store.chain(mol).length, 2, 'the chain is still reachable: undo still works')

  // And the next commit CHAINS ON rather than forking with prev:null.
  store.save(['business', 'people'], 'Carol')
  const after = store.chain(mol)
  assert.equal(after.length, 3)
  assert.equal(after[2].prev, chainBefore[1].sig, 'history did NOT branch')
  assert.deepEqual(store.childNames(['business', 'people']), ['Alice', 'Bob', 'Carol'])
})

// ───────────────────────────────────────────────────────────────────────────
// B. SELF-PLACING TRUSTED THE ATOM'S OWN `author`. materializeCold wrote
//    `${sign(succ.name)}/${succ.author}/${head}` from bytes a host handed over.
//    Nothing checked that succ.author was the bucket the bytes came from, and
//    nothing checked that succ.author wasn't ME. One foreign atom claiming my
//    author sig landed a second file in MY bucket -> case A -> my hive blanked.
//
//    CHANGED BY STEP 3. The attack is kept in BOTH of its forms, and both are
//    now refused:
//
//      B1 — A PEER REPLAYING MY IDENTITY. Under the old model "my identity" was
//      `sign('owner')`: anyone who typed the string owned the address. A bucket
//      is now a PUBLIC KEY, so a peer who is not me simply has a different
//      bucket and can never reach mine. `succ.author` is gone from the atom
//      entirely — there is no field left to claim.
//
//      B2 — GENUINELY MY OWN KEY, ON A SECOND DEVICE. This is the honest case
//      the old model could not distinguish from an attack. It never lands in a
//      way that blanks the page.
//
//      REFINED BY THE AUTHORITY PASS. The second device here is at the SAME
//      generation as me, and two chains of the same LENGTH are a `rival`, not a
//      `fork`: neither can contain the other, no walk can help, and refusing it
//      outright is what left two readers of one author on two different heads
//      forever. So it is KEPT and RANKED — and MY OWN head still does not move,
//      because the mint ledger (local, never replicated) says which of the two
//      siblings I actually signed. A device that has genuinely committed PAST
//      me is a different case and is still a hard refusal: see B3.
// ───────────────────────────────────────────────────────────────────────────
test('B — a host-served succession claiming to be mine is REFUSED (was: it destroyed my head)', () => {
  const mine = seed(new MoleculeStore({ author: 'owner' }))
  mine.save(['business', 'people'], 'Alice')
  const molRoot = ROOT_MOLECULE
  const myHead = mine.headSig(molRoot)
  assert.equal(mine.heads(molRoot).length, 1)

  // B1 — a peer that types the same author string. Its bytes are perfectly
  // valid and hash-verify; its head claim simply is not signed by my key.
  const theirs = seed(new MoleculeStore({ author: 'owner' }))
  theirs.save([], 'Mallory') // diverges at the ROOT molecule
  assert.notEqual(theirs.pubkey, mine.pubkey, 'an author STRING is no longer an address')

  const r1 = mine.materializeCold(hostOf(theirs.root), [])
  assert.equal(
    mine.root.list(`${molRoot}/${mine.pubkey}`).filter((e) => e.kind === 'file').length,
    1,
    'my bucket still holds exactly one entry — nothing of theirs could reach it',
  )
  assert.equal(mine.headSig(molRoot), myHead, 'my head never moved')
  assert.ok(mine.childNames([]).includes('business'), 'my ROOT page still renders')
  // Their head landed in THEIR OWN bucket, which is federation working.
  assert.ok(r1.reports[0].accepted.some((a) => a.author === theirs.pubkey))

  // B2 — the same KEY on a second device, with a genuinely DIVERGENT chain:
  // it agrees with me at generation 0 ('business') and then commits something
  // else at generation 1, where I committed 'club'.
  const secondDevice = new MoleculeStore({ author: 'owner', keys: mine.keys })
  secondDevice.save([], 'business')
  secondDevice.save([], 'Mallory')
  const r2 = mine.materializeCold(hostOf(secondDevice.root), [])
  const noted = r2.reports[0].kept.find((f) => f.author === mine.pubkey)
  assert.ok(noted, 'a divergent chain under my own key is REPORTED, not silently applied')
  assert.equal(noted.reason, 'rival', 'same generation, so it is a sibling and not an accusation')
  assert.equal(mine.headSig(molRoot), myHead,
    'and my head still never moved: the mint ledger says which sibling I signed')
  assert.ok(mine.childNames([]).includes('business'), 'and my ROOT page still renders')

  // B3 — MY OWN KEY, GENUINELY AHEAD OF ME, ON A CHAIN THAT ABANDONS MINE.
  // The walk can reach its genesis, so descent is DISPROVEN rather than merely
  // unproven: a hard fork, refused, and refusing it costs me nothing at all.
  const rogue = new MoleculeStore({ author: 'owner', keys: mine.keys })
  rogue.save([], 'somewhere-else')
  rogue.save([], 'and-again')
  rogue.save([], 'and-once-more')
  const before = mine.root.paths().length
  const r3 = mine.materializeCold(hostOf(rogue.root), [])
  const forked = r3.reports[0].refused.find((f) => f.author === mine.pubkey)
  assert.ok(forked, 'a chain that abandons mine is refused outright')
  assert.equal(forked.reason, 'fork', 'history never branches')
  assert.equal(mine.headSig(molRoot), myHead)
  assert.equal(mine.root.paths().length, before, 'and not one byte of it was written')
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
// D. remove() EMPTIED THE CHILD MOLECULE GLOBALLY. Deleting `people` from
//    /business appended an EMPTY succession to sign('people') — the molecule
//    that /club/people is also reading — and every tile under the other route
//    vanished. The guard that would have prevented it ("is this molecule still
//    named by any other envelope?") is UNCOMPUTABLE by construction: the design
//    deleted the parent->child edge from layer bytes AND the reverse map.
//
// FIXED (step 4). The attack is kept verbatim and the assertion is INVERTED.
// `remove()` no longer takes a second commit against `signText(canon)`; it
// touches THE INCIDENCE and nothing else, which is this project's own rule —
// relations are marks the members wear, never a parent that holds them. The
// old second commit was scoped to the child MOLECULE, which is global; the
// thing actually removed is the ENVELOPE, which is per-route. See the comment
// on `MoleculeStore.remove` for the four witnesses and for why the
// "create-reset guard" it claimed to be is not owed under a model where a name
// IS one page.
// ───────────────────────────────────────────────────────────────────────────
test('D — removing a member in one route leaves the same-named page intact in every other route', () => {
  const store = seed(new MoleculeStore({ author: 'owner' }))
  store.save(['business', 'people'], 'Alice')
  store.save(['club', 'people'], 'Bob')

  assert.deepEqual(store.childNames(['club', 'people']), ['Alice', 'Bob'], 'the firehose, as declared')

  store.remove(['business'], 'people')

  assert.deepEqual(store.childNames([]), ['business', 'club'], 'club is untouched...')
  assert.deepEqual(
    store.childNames(['club', 'people']),
    ['Alice', 'Bob'],
    '...and /club/people STILL HOLDS ITS MEMBERS — a delete on a page that never held Bob cannot destroy him',
  )
  assert.deepEqual(
    store.childNames(['business']),
    [],
    'the page the user actually acted on is the only one that changed',
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
  // CHANGED BY STEP 3: the bucket is a PUBLIC KEY, so "author-hash order" is
  // now pubkey order. The defect is identical — a visitor still renders the
  // page in an order the owner cannot pin — so the fixture mints identities
  // either side of the owner's key instead of hashing author strings.
  const ownerKeys = mintKeys()

  let below = null
  let above = null
  for (let i = 0; i < 500 && (!below || !above); i++) {
    const k = mintKeys()
    if (!below && k.pubkey < ownerKeys.pubkey) below = k
    if (!above && k.pubkey > ownerKeys.pubkey) above = k
  }
  assert.ok(below && above, 'found identities on both sides of the owner')

  const build = (guestKeys) => {
    const shared = new Root()
    const owner = new MoleculeStore({ root: shared, author: 'owner', keys: ownerKeys })
    owner.save([], 'Owner-First')
    owner.save([], 'Owner-Second')
    const guest = new MoleculeStore({ root: shared, author: 'guest', keys: guestKeys })
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
    "a guest's tile is rendered FIRST on the owner's published page, because guestPubkey < ownerPubkey",
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
    // CHANGED BY STEP 3: identity is a KEY, not the string 'aaa'. To read AS
    // `a` the view must hold a's keys — which is the whole point of the change.
    const view = new MoleculeStore({ root: shared, author: 'aaa', keys: a.keys })
    view.root.list = ((orig) => (dir, o) => orig.call(view.root, dir, { ...o, order }))(Root.prototype.list)
    assert.deepEqual(view.childNames([]), natural, `stable under listing order=${order}`)
  }
  assert.deepEqual(natural, ['One', 'Two', 'Three'])
})
