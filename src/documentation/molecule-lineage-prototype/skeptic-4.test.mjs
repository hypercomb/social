// skeptic-4.test.mjs — LENS: MERKLE CASCADE + PRUNE SAFETY.
//
// Claims under attack:
//   (1) "business need not re-commit when people changes"  — true, but see (2).
//   (2) "a merkle root is minted on demand by SEALING"     — a sealed root is
//       only well-defined on a DAG. The molecule graph is keyed by NAME, so it
//       is a general directed graph with cycles, and cycles are reachable by a
//       one-word tile that any author on any tenant may write.
//   (3) "history never branches / prune is GC over heads"  — prune is a no-op,
//       and the only way to make it non-trivial forks you off the mesh.
//   (4) "the entry decides, never the directory"           — holds for the
//       shipped pool writer, fails for the doctrine-sanctioned derived-cache
//       WIPE, which is directory-scoped by definition.

import test from 'node:test'
import assert from 'node:assert/strict'

import { MoleculeStore, moleculeOf, ROOT_MOLECULE } from './molecule.mjs'
import { Root } from './root.mjs'
import { hostOf } from './host.mjs'
import { poolSignature, putPoolDoc } from './pool.mjs'
import { signText, mineSignatures, canonicalJSON } from './sig.mjs'

// ── the seal the design promises, written faithfully to its own words ───────
// "seal(M) = a derived succession whose envelopes add succession:<seal(child
//  molecule head)> recursively, written as atoms with no entry in any molecule"
const seal = (store, molSig, name = '', depth = 0) => {
  if (depth > 64) throw new Error('SEAL DID NOT TERMINATE: the name graph is cyclic')
  const members = store.viewOf(molSig).map((row) => ({
    meta: 1,
    layer: row.vertex,
    root: row.name,
    slot: row.slot,
    succession: seal(store, signText(row.name), row.name, depth + 1),
  }))
  return store.putAtom({ succession: 1, sealed: true, name, members })
}

// seal with cycle-breaking — the only way to make it terminate at all
const sealCut = (store, molSig, name = '', onPath = new Set()) => {
  if (onPath.has(molSig)) return null // cut the back-edge
  const next = new Set([...onPath, molSig])
  const members = store.viewOf(molSig).map((row) => ({
    meta: 1,
    layer: row.vertex,
    root: row.name,
    slot: row.slot,
    succession: sealCut(store, signText(row.name), row.name, next),
  }))
  return store.putAtom({ succession: 1, sealed: true, name, members })
}

/** Every head in every molecule directory at the root — the design's GC roots. */
const allHeads = (store) => {
  const out = []
  for (const dir of store.root.list('')) {
    if (dir.kind !== 'dir') continue
    for (const bucket of store.root.list(dir.name)) {
      if (bucket.kind !== 'dir') continue
      for (const f of store.root.list(`${dir.name}/${bucket.name}`)) {
        if (f.kind === 'file') out.push(f.name)
      }
    }
  }
  return out
}

/** Mark-and-sweep over the whole root, rooted at every head. */
const gc = (store) => {
  const live = new Set()
  const mark = (sig) => {
    if (!sig || live.has(sig) || !store.root.has(sig)) return
    live.add(sig)
    const atom = store.getAtom(sig)
    if (atom) for (const next of mineSignatures(atom)) mark(next)
  }
  for (const h of allHeads(store)) mark(h)
  const swept = []
  for (const p of store.root.paths()) {
    if (p.includes('/')) continue
    if (!live.has(p)) {
      store.root.remove(p)
      swept.push(p)
    }
  }
  return swept
}

// ───────────────────────────────────────────────────────────────────────────
test('A — NO MERKLE ROOT EXISTS: one ordinary tile name closes a cycle and seal never terminates', () => {
  const s = new MoleculeStore({ author: 'me' })
  s.save([], 'business')
  s.save(['business'], 'people')
  // Perfectly ordinary: a tile named "business" filed under people (a role, a
  // back-link, a note). Under paths this is a DIFFERENT bag. Under molecules
  // it is sign('business') — the ancestor.
  s.save(['business', 'people'], 'business')

  // The route is genuinely infinite and the store happily walks it.
  assert.equal(
    s.moleculeFor(['business', 'people', 'business', 'people', 'business']),
    moleculeOf('business'),
  )

  // "history is the deploy" needs ONE sig that summarizes everything. There is none.
  assert.throws(() => seal(s, ROOT_MOLECULE), /SEAL DID NOT TERMINATE/)
})

test('A2 — cycle-breaking does not rescue it: the SAME molecule seals to two different sigs depending on entry point', () => {
  const s = new MoleculeStore({ author: 'me' })
  s.save([], 'alpha')
  s.save(['alpha'], 'beta')
  s.save(['alpha', 'beta'], 'gamma')
  s.save(['alpha', 'beta', 'gamma'], 'alpha') // 3-cycle alpha→beta→gamma→alpha

  // `beta` sealed as part of the whole-hive publish (root → alpha → beta …)
  const fromRoot = s.getAtom(sealCut(s, ROOT_MOLECULE, ''))
  const alphaViaRoot = s.getAtom(fromRoot.members.find((m) => m.root === 'alpha').succession)
  const betaViaRoot = alphaViaRoot.members.find((m) => m.root === 'beta').succession

  // `beta` sealed as the publish of the /alpha/beta page on its own
  const betaDirect = sealCut(s, moleculeOf('beta'), 'beta')

  assert.notEqual(
    betaViaRoot,
    betaDirect,
    'a molecule must have ONE merkle identity; it has one per traversal entry point',
  )
  // Two publishes of the same page, same bytes underneath, two different pins:
  // a visitor cannot tell "changed" from "entered by a different door".
})

test('B — THE CASCADE COMES BACK, TRIGGERED BY A STRANGER: my deploy sig moves when another tenant commits', () => {
  const shared = new Root()
  const me = new MoleculeStore({ root: shared, author: 'me' })
  me.save([], 'business')
  me.save(['business'], 'people')
  me.save(['business', 'people'], 'Alice')

  const before = sealCut(me, ROOT_MOLECULE, '')

  // A different tenant, on a different host, files a person under THEIR
  // 'people' tile. Same word ⇒ same molecule ⇒ their head lands in mine.
  const theirRoot = new Root()
  const them = new MoleculeStore({ root: theirRoot, author: 'stranger' })
  them.save([], 'people')
  them.save(['people'], 'Bob')
  const theirHost = hostOf(theirRoot)
  me.replicateMolecule(theirHost, moleculeOf('people'))

  const after = sealCut(me, ROOT_MOLECULE, '')
  assert.notEqual(after, before, 'seal folds LIVE heads, so a foreign write re-mints my root')

  // and it is not cosmetic: the stranger's member is inside my published tree
  const names = me.childNames(['business', 'people'])
  assert.deepEqual(names.sort(), ['Alice', 'Bob'])
})

test('C — THE HEAD CLOSURE IS THE WHOLE HISTORY: cold replication of a 30-edit page pulls all 30 dead generations', () => {
  const srcRoot = new Root()
  const src = new MoleculeStore({ root: srcRoot, author: 'me' })
  src.save([], 'notes')
  for (let i = 0; i < 30; i++) src.save(['notes'], 'draft', { text: `v${i}` })

  const host = hostOf(srcRoot)
  const cold = new MoleculeStore({ root: new Root(), author: 'me' })
  cold.materializeCold(host, ['notes'])

  // ONE member is current. Everything else is superseded and unreachable by any route.
  assert.equal(cold.children(['notes']).length, 1)
  const atoms = cold.root.paths().filter((p) => !p.includes('/')).length
  assert.ok(
    atoms >= 90,
    `expected the whole chain (~3 atoms x 30 commits) to arrive, got ${atoms}`,
  )
  // `prev` is a mined edge, so there is no way to ask a host for "current only".
  assert.ok(host.stats.gets >= 90, `fetched ${host.stats.gets} atoms to render 1 tile`)
})

test('D — PRUNE IS A NO-OP: a faithful GC over every head frees nothing, ever', () => {
  const s = new MoleculeStore({ author: 'me' })
  s.save([], 'notes')
  for (let i = 0; i < 10; i++) s.save(['notes'], 'draft', { text: `v${i}` })
  s.save(['notes'], 'secret', { text: 'delete me' })
  s.remove(['notes'], 'secret')
  s.hide(['notes'], 'draft')

  const before = s.root.paths().filter((p) => !p.includes('/')).length
  const swept = gc(s)
  const after = s.root.paths().filter((p) => !p.includes('/')).length

  assert.deepEqual(swept, [], 'GC freed nothing — `prev` keeps every dead generation live')
  assert.equal(after, before)
  // The "deleted" secret's bytes are still reachable from the head chain.
  assert.ok(
    s.root.paths().some((p) => {
      const a = s.getAtom(p)
      return a && a.text === 'delete me'
    }),
    'removed content is still resident and still merkle-reachable from the head',
  )
})

test('D2 — THE ONLY REAL PRUNE FORKS YOU OFF THE MESH: truncating the chain makes every peer refuse your head', () => {
  const mineRoot = new Root()
  const me = new MoleculeStore({ root: mineRoot, author: 'me' })
  me.save([], 'notes')
  for (let i = 0; i < 5; i++) me.save(['notes'], 'draft', { text: `v${i}` })

  // A peer replicates me at generation 5.
  const peer = new MoleculeStore({ root: new Root(), author: 'peer' })
  peer.replicateMolecule(hostOf(mineRoot), moleculeOf('notes'))
  const mol = moleculeOf('notes')
  const peerHeld = peer.root.list(`${mol}/${me.authorSig}`)[0].name
  assert.ok(peerHeld)

  // I prune: re-mint my head with prev:null so the dead generations become
  // collectable. This is the ONLY thing that frees bytes.
  const head = me.getAtom(me.headSig(mol))
  const truncated = me.putAtom({ ...head, prev: null })
  me.root.write(`${mol}/${me.authorSig}/${truncated}`)
  me.root.remove(`${mol}/${me.authorSig}/${me.chain(mol).at(-1)?.sig ?? ''}`)
  for (const f of me.root.list(`${mol}/${me.authorSig}`)) {
    if (f.name !== truncated) me.root.remove(`${mol}/${me.authorSig}/${f.name}`)
  }
  const freed = gc(me)
  assert.ok(freed.length > 0, 'truncation is what actually frees bytes')

  // The peer now sees a head whose chain does not contain the head it holds.
  const report = peer.replicateMolecule(hostOf(mineRoot), mol)
  assert.equal(report.accepted.length, 0)
  assert.equal(report.refused.length, 1, 'pruning reads as BRANCHING; the peer refuses me forever')
})

test('E — remove() SILENTLY WIPES A LIVE SIBLING ROUTE, and one undo cannot put it back', () => {
  const s = new MoleculeStore({ author: 'me' })
  s.save([], 'business')
  s.save([], 'club')
  s.save(['business'], 'people')
  s.save(['club'], 'people')
  s.save(['business', 'people'], 'Alice')
  assert.deepEqual(s.childNames(['club', 'people']), ['Alice'])

  // Tidy up the business page. I never touched /club.
  s.remove(['business'], 'people')

  assert.deepEqual(
    s.childNames(['club', 'people']),
    [],
    'removing a tile on one page emptied a DIFFERENT, untouched page',
  )

  // Undo where I acted. The tile comes back; its contents do not.
  s.undo(['business'])
  assert.deepEqual(s.childNames(['business']), ['people'], 'the tile is back')
  assert.deepEqual(
    s.childNames(['business', 'people']),
    [],
    'its members are NOT back — remove wrote to two chains, undo rewinds one',
  )
})

test('F — A DERIVED-CACHE WIPE (doctrine: pools are wipe-safe) DESTROYS A TILE\'S HISTORY, including other authors\'', () => {
  const shared = new Root()
  const me = new MoleculeStore({ root: shared, author: 'me' })
  me.save([], 'manifests') // an ordinary word; a frozen bare-word pool meaning
  me.save(['manifests'], 'Q3 shipping manifest')

  const them = new MoleculeStore({ root: shared, author: 'stranger' })
  them.save([], 'manifests')
  them.save(['manifests'], 'their manifest')

  putPoolDoc(shared, 'manifests', { derived: true, of: 'something' })
  const pool = poolSignature('manifests')
  assert.equal(pool, moleculeOf('manifests'), 'the pool address IS the tile molecule')

  // The sanctioned operation: wipe a derived cache. A wipe is directory-scoped
  // by definition — there is no per-entry rule that survives "rm -rf the cache".
  for (const p of shared.paths()) if (p.startsWith(`${pool}/`)) shared.remove(p)

  assert.equal(me.headSig(pool), null, "my tile's entire lineage head is gone")
  assert.equal(me.heads(pool).length, 0, "and so is the stranger's — a wipe is per-directory")
  // The tile still ROUTES (the parent's envelope survives) — it is simply and
  // silently empty forever. No error, no husk, no recovery: the head that named
  // the members is the only index, and it was in the wiped directory.
  assert.deepEqual(me.children(['manifests']), [])
})

test('G — REPLICATION LETS A REMOTE CHOOSE WHERE MY WRITES LAND: a foreign atom plants a bucket inside a system pool', () => {
  const theirRoot = new Root()
  const them = new MoleculeStore({ root: theirRoot, author: 'stranger' })
  them.save([], 'landing')

  // A hostile (or merely buggy) host puts ONE extra succession in the molecule
  // I asked for. Its `name` field says 'bees'. #absorbMolecule is SELF-PLACING:
  // it writes to signText(succ.name), an address the REMOTE picked.
  const lie = them.putAtom({
    succession: 1, name: 'bees', author: signText('stranger'), prev: null, members: [], at: 1,
  })
  theirRoot.write(`${ROOT_MOLECULE}/${signText('impostor')}/${lie}`)

  const me = new MoleculeStore({ root: new Root(), author: 'me' })
  me.materializeCold(hostOf(theirRoot), [])

  const beesPool = poolSignature('bees')
  const planted = me.root.list(beesPool).filter((e) => e.kind === 'dir')
  assert.ok(
    planted.length > 0,
    'I asked for the root molecule and got a bucket inside the bees POOL: the address came from remote bytes',
  )
  // Content-addressing keeps the BYTES honest. It does not keep the LOCATION
  // honest, because a molecule address is derived from a FIELD, not from a hash.
})

test('H — SEALING NEEDS LISTINGS, SO A SEALED ROOT CANNOT BE VERIFIED FROM IMMUTABLE ATOMS ALONE', () => {
  const srcRoot = new Root()
  const src = new MoleculeStore({ root: srcRoot, author: 'me' })
  src.save([], 'business')
  src.save(['business'], 'people')
  src.save(['business', 'people'], 'Alice')
  const sealed = sealCut(src, ROOT_MOLECULE, '')

  // A visitor holds ONLY the sealed root sig and a content-only host (the shape
  // every static host has today: GET /<sig>, no readdir).
  const contentOnly = {
    stats: { listings: 0, gets: 0, misses: 0 },
    list() {
      throw new Error('no directory branch')
    },
    content: (sig) => srcRoot.read(sig),
  }
  const visitor = new MoleculeStore({ root: new Root(), author: 'visitor' })
  visitor.pullClosure(contentOnly, sealed)

  // The bytes arrive...
  assert.ok(visitor.getAtom(sealed))
  // ...but nothing places them: no molecule directory exists, so no route resolves.
  assert.throws(() => visitor.children(['business']), /dead route|no member/)
  assert.equal(
    visitor.root.list('').filter((e) => e.kind === 'dir').length,
    0,
    'a sealed pin is inert without a mutable, unverifiable listing to place it',
  )
})
