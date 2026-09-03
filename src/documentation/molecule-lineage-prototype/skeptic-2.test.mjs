// skeptic-2.test.mjs — ADDRESSING / COLLISIONS lens.
//
// The molecule model puts a PARTICIPANT-CHOSEN STRING into the hash preimage
// of a directory address, and puts an ATOM-DECLARED STRING into the placement
// decision on the receiving side. Every test below attacks that seam.

import test from 'node:test'
import assert from 'node:assert/strict'

import { MoleculeStore, moleculeOf, ROOT_MOLECULE } from './molecule.mjs'
import { Root } from './root.mjs'
import { hostOf } from './host.mjs'
import { putPoolDoc, getPoolDoc, poolSignature } from './pool.mjs'
import { canonName } from './canon.mjs'
import { sha256, signText, EMPTY_SIG } from './sig.mjs'
import { bytesOf } from './sig.mjs'

/** Write a raw atom into an arbitrary Root and return its sig. */
const plant = (root, obj) => {
  const bytes = bytesOf(obj)
  const sig = sha256(bytes)
  root.write(sig, bytes)
  return sig
}

// ───────────────────────────────────────────────────────────────────────────
// S2-1. A remote succession decides WHICH DIRECTORY it lands in.
//       `#absorbMolecule` writes to signText(succ.name) — never checking that
//       it equals the molecule it was listed under. A host I asked for ONE
//       molecule can therefore write into ANY address in my root, including a
//       reserved system pool.
// ───────────────────────────────────────────────────────────────────────────
test('S2-1 self-placing successions let a host write into a RESERVED SYSTEM POOL it was never asked about', () => {
  const hostileRoot = new Root()
  const evil = signText('evil')

  // A perfectly well-formed succession — that claims the name 'bees'.
  const vertex = plant(hostileRoot, { name: 'gotcha' })
  const env = plant(hostileRoot, { meta: 1, layer: vertex, root: 'gotcha', relation: 'child', slot: 0 })
  const succ = plant(hostileRoot, {
    succession: 1, name: 'bees', author: evil, prev: null, members: [env], at: 1,
  })
  // It is served from the ROOT molecule's listing. I only ever ask for the root.
  hostileRoot.write(`${ROOT_MOLECULE}/${evil}/${succ}`)

  const me = new MoleculeStore({ root: new Root(), author: 'me' })
  // My own real system pool, at the very address the attacker names.
  putPoolDoc(me.root, 'bees', { installed: ['drone-a'] })

  me.materializeCold(hostOf(hostileRoot), [])

  const beesPool = poolSignature('bees')
  const foreign = me.root.list(beesPool).filter((e) => e.kind === 'dir')

  assert.deepEqual(
    foreign, [],
    'a host serving the ROOT molecule planted a contributor bucket inside sign("bees"), ' +
    'a directory I never routed to. Placement is chosen by the SENDER: ' +
    '#absorbMolecule does root.write(signText(succ.name)/...) with no check that ' +
    'signText(succ.name) === the molecule I listed.',
  )
})

// ───────────────────────────────────────────────────────────────────────────
// S2-2. `author` is a self-declared field AND the bucket's address.
//       So a host can plant a head under MY author bucket. My own headSig(),
//       chain(), undo() and "mine:true" placement then read the attacker's
//       claim as my own history.
// ───────────────────────────────────────────────────────────────────────────
test('S2-2 a host can forge MY head: the bucket address is derived from a field the atom declares', () => {
  const me = new MoleculeStore({ root: new Root(), author: 'me' })
  const mySig = me.authorSig

  const hostileRoot = new Root()
  const vertex = plant(hostileRoot, { name: 'payload' })
  const env = plant(hostileRoot, { meta: 1, layer: vertex, root: 'payload', relation: 'child', slot: 0 })
  const forged = plant(hostileRoot, {
    succession: 1, name: '', author: mySig, prev: null, members: [env], at: 1,
  })
  hostileRoot.write(`${ROOT_MOLECULE}/${mySig}/${forged}`)

  me.materializeCold(hostOf(hostileRoot), [])

  assert.equal(
    me.headSig(ROOT_MOLECULE), null,
    'a cold materialize accepted a succession that merely SAYS author=<me> and installed it ' +
    `as my own head (${me.headSig(ROOT_MOLECULE)}). chain() now reports it as my history, ` +
    'viewOf() marks its members mine:true, and my next commit chains prev onto it. ' +
    'replicateMolecule() has a skip-mine guard and a #chainContains check; ' +
    '#absorbMolecule — the COLD path, the one the design sells — has neither.',
  )
})

// ───────────────────────────────────────────────────────────────────────────
// S2-3. A tile NAME is mined as a signature edge.
//       mineSignatures excludes only `author`. `succession.name`, `envelope.root`
//       and `vertex.name` all carry participant text. Name a tile with 64 hex
//       characters — which the UI shows the user constantly — and the name
//       becomes a phantom edge that every replication chases forever.
// ───────────────────────────────────────────────────────────────────────────
test('S2-3 a tile named with 64 hex chars becomes a phantom EDGE: replication fetches the NAME', () => {
  const source = new MoleculeStore({ root: new Root(), author: 'author-a' })
  const hexName = 'f'.repeat(64) // a legal name; canon preserves letters+digits
  assert.equal(canonName(hexName), hexName)
  source.save([], hexName, { note: 'a tile whose name looks like a sig' })

  const host = hostOf(source.root)
  const cold = new MoleculeStore({ root: new Root(), author: 'author-b' })
  cold.materializeCold(host, [])

  assert.equal(
    host.stats.misses, 0,
    `replication issued ${host.stats.misses} GET(s) for content that does not exist — ` +
    'the tile NAME was mined as an edge out of succession.name, envelope.root and vertex.name. ' +
    'sig.mjs states the rule itself ("a precise walker must skip it or every replication ' +
    'reports phantom misses") but REFERENT_FIELDS lists only `author`. ' +
    'Worse in the other direction: name a tile after a REAL atom sig and that atom is now ' +
    'reachable-by-name, so GC keeps it alive and a rename silently un-roots it.',
  )
})

// ───────────────────────────────────────────────────────────────────────────
// S2-4. The empty name IS the root's address, and only ONE of the four write
//       paths guards it. `revive` does not. An empty-named member aliases the
//       root molecule — and `remove` on it commits an EMPTY membership to the
//       ROOT, wiping the whole hive's top page.
// ───────────────────────────────────────────────────────────────────────────
test('S2-4 the empty name aliases the ROOT molecule and one unguarded path wipes the root page', () => {
  const s = new MoleculeStore({ root: new Root(), author: 'me' })
  s.save([], 'business')
  s.save([], 'websites')
  const orphan = s.save(['business'], 'Alice').vertex

  assert.deepEqual(s.childNames([]).sort(), ['business', 'websites'])

  // save() refuses the empty name...
  assert.throws(() => s.save([], '   '), /must have a name/)
  // ...but revive() shares no guard, and neither does the drain/absorb path.
  s.revive([], '   ', orphan)

  const emptyRow = s.children([]).find((r) => r.name === '')
  assert.equal(emptyRow?.name, '', 'precondition: an empty-named member exists')
  assert.equal(
    moleculeOf(''), ROOT_MOLECULE,
    'precondition: sign("") is BOTH the root molecule and the empty-content sig',
  )

  // Hide-first-delete-second on that member. It routes to the ROOT molecule.
  s.remove([], '   ')

  assert.deepEqual(
    s.childNames([]).sort(), ['business', 'websites'],
    'removing an empty-named member ran remove()\'s create-reset step against ' +
    'signText("") === ROOT_MOLECULE and committed an EMPTY succession to the root, ' +
    `erasing the whole top page (now ${JSON.stringify(s.childNames([]))}). ` +
    'The empty-name guard lives in save() alone; revive(), remove()\'s child step, ' +
    'the migration drain and #absorbMolecule all reach the same address unguarded.',
  )
})

// ───────────────────────────────────────────────────────────────────────────
// S2-5. The interop thesis is a claim about a HASH PREIMAGE, and canon
//       preserves case. Two participants who both have a "people" grammar do
//       NOT share an address if one of them capitalised.
// ───────────────────────────────────────────────────────────────────────────
test('S2-5 case defeats the interop claim: sign("People") !== sign("people")', () => {
  const alice = new MoleculeStore({ root: new Root(), author: 'alice' })
  const bob = new MoleculeStore({ root: new Root(), author: 'bob' })
  alice.save([], 'people')
  bob.save([], 'People')
  alice.save(['people'], 'Ana')
  bob.save(['People'], 'Ben')

  // Bob replicates from Alice's host into the address HE uses.
  bob.replicateMolecule(hostOf(alice.root), moleculeOf('People'))

  assert.deepEqual(
    bob.children(['People']).map((r) => r.name).sort(), ['Ana', 'Ben'],
    'the two grammars never met: sign("People") and sign("people") are different ' +
    'directories, so the headline interop claim (two participants who both have a ' +
    'people grammar share sign of people byte-for-byte) holds only when both humans ' +
    'typed the same capitalisation. Case-folding is the fix, but it is a PERMANENT ' +
    'address change and it breaks the migration claim that root-level bags are ALREADY ' +
    'their molecules (sha256(lineageKey([name])) preserves case too).',
  )
})

// ───────────────────────────────────────────────────────────────────────────
// S2-6. Homoglyphs: canon normalises NFC but not script. Two members that
//       render identically become two DIFFERENT molecules and two rows on the
//       same page — a spoofing surface the path model never had, because a
//       path was compared inside one tenant.
// ───────────────────────────────────────────────────────────────────────────
test('S2-6 DEMONSTRATION (passes): a Cyrillic homoglyph mints a second molecule that renders identically', () => {
  const s = new MoleculeStore({ root: new Root(), author: 'me' })
  const latin = 'people'
  const cyrillic = 'pеople' // U+0435 CYRILLIC SMALL LETTER IE

  s.save([], latin)
  s.save([], cyrillic)
  s.save([latin], 'real-record')
  s.save([cyrillic], 'decoy-record')

  const names = s.childNames([])
  assert.equal(names.length, 2, 'precondition: two rows on the root page')
  assert.notEqual(moleculeOf(latin), moleculeOf(cyrillic))

  const rendered = new Set(names.map((n) => n.normalize('NFKC')))
  assert.equal(
    rendered.size, 2,
    'two members of one page are visually indistinguishable and route to different ' +
    'molecules. Under the path model the ambiguity was contained inside one tenant; ' +
    'under a shared global name-space it is a way to shadow another participant\'s ' +
    'grammar on every host that serves both.',
  )
})

// ───────────────────────────────────────────────────────────────────────────
// S2-7. HOLD-CHECKS — things I tried to break that did not break.
// ───────────────────────────────────────────────────────────────────────────
test('S2-7 holds: pool record and molecule bucket coexist at one bare-word address', () => {
  const s = new MoleculeStore({ root: new Root(), author: 'me' })
  s.save([], 'bees')
  s.save(['bees'], 'worker')
  putPoolDoc(s.root, 'bees', { installed: ['drone-a'] })
  putPoolDoc(s.root, 'bees', { installed: ['drone-a', 'drone-b'] })

  assert.deepEqual(getPoolDoc(s.root, 'bees'), { installed: ['drone-a', 'drone-b'] })
  assert.deepEqual(s.childNames(['bees']), ['worker'])
})

test('S2-7 holds: the empty atom is never written, so the root molecule dir is safe', () => {
  const s = new MoleculeStore({ root: new Root(), author: 'me' })
  s.putBytes(Buffer.alloc(0))
  assert.equal(s.root.has(EMPTY_SIG), false)
  s.save([], 'a')
  assert.equal(s.root.list('').some((e) => e.name === EMPTY_SIG && e.kind === 'dir'), true)
})

test('S2-7 holds: a name is not a path, and listing order never leaks into the read model', () => {
  const s = new MoleculeStore({ root: new Root(), author: 'me' })
  assert.throws(() => s.save([], 'a/b'), /not a path/)
  s.save([], 'x'); s.save([], 'y'); s.save([], 'z')
  const natural = s.viewOf(ROOT_MOLECULE).map((r) => r.name)
  const reversedRoot = Object.create(Object.getPrototypeOf(s.root))
  Object.assign(reversedRoot, s.root)
  const s2 = new MoleculeStore({ root: s.root, author: 'me' })
  assert.deepEqual(s2.viewOf(ROOT_MOLECULE).map((r) => r.name), natural)
})

// ───────────────────────────────────────────────────────────────────────────
// S2-8. SPEC vs PROTOTYPE. The design's `layout` says entries under a molecule
//       are FLAT zero-byte succession sigs. The prototype silently changed
//       that to <mol>/<authorSig>/<succSig> — a DIR — because that is the only
//       thing that survives putPoolDoc's sibling-file sweep. Run the design as
//       written and a system pool write hard-deletes a tile's whole lineage.
// ───────────────────────────────────────────────────────────────────────────
test('S2-8 the DESIGN\'s flat <mol>/<succSig> layout is destroyed by a pool write; only the prototype\'s undocumented bucket dir survives', () => {
  const root = new Root()
  const mol = poolSignature('bees') // === sign(canon('bees')), the same directory
  const succA = 'a'.repeat(64)
  const succB = 'b'.repeat(64)
  root.write(`${mol}/${succA}`) // flat entry, exactly as the design's layout states
  root.write(`${mol}/${succB}`)

  putPoolDoc(root, 'bees', { installed: ['drone-a'] })

  const survivors = root.list(mol).map((e) => e.name).filter((n) => n === succA || n === succB)
  assert.deepEqual(
    survivors, [succA, succB],
    'putPoolDoc keeps ONE current record and removes every sibling FILE, so the flat ' +
    'membership entries the design specifies were hard-deleted by an ordinary install. ' +
    'The prototype only passes because it quietly nests entries one level deeper under ' +
    'an author DIR — a layout the design document never states, and the load-bearing ' +
    'reason the bare-word collision "holds".',
  )
})
