// headmap-skeptic-2.test.mjs — THIRD-PARTY VERIFICATION, ADVERSARIAL.
//
// THE LENS. I am not the publisher and I am not on the publisher's device. I
// hold ONE signature and I can talk to a DUMB BYTE HOST that:
//
//   * refuses to list directories (`list()` throws — the shape of every static
//     host, and the premise of skeptic-4 H),
//   * OMITS entries it does not feel like serving,
//   * serves STALE bytes,
//   * and LIES: it will answer any GET with any bytes it likes.
//
// Under that lens, "the published state can be verified" has to mean: from the
// signature I hold, plus bytes fetched by signature, I can decide what the
// publisher published. Anything that secretly needs a listing, a clock, or
// trust in the host is a blocker.
//
// step 4 replaced the recursive seal with `mintHeadMap`. The four attacks it
// was built to answer (A, A2, B, H) DO NOT COME BACK. Four NEW ones landed on
// the replacement, all four in the gap between what the old `verifyHeadMap`
// checked (every ROW is a genuine claim of this key) and what its callers would
// read it as (this is the SET the publisher deployed). All four are closed:
//
//   S2-A  NOTHING SIGNED THE SET, so I could compose a truncation or an empty
//         deploy out of the publisher's own rows. CLOSED by an attestation over
//         (pubkey, mapSig), and by `verifyDeploy` being the only door that
//         takes a deploy SIGNATURE at all — steps 0 and 1 of the documented
//         recipe used to be owned by nobody.
//   S2-B  GENERATION CHERRY-PICK — a hive state that never existed on any
//         device. CLOSED by the same signature: a mixture is a set the
//         publisher never signed.
//   S2-C  THE DECLARED CLOSURE STOPPED AT THE POINTERS, so ok:true could not
//         tell a whole site from no site. CLOSED by `readHead`.
//   S2-D  `HeadMapClaimReader.sig` WAS OPTIONAL, so a lying host downgraded a
//         row under an unchanged deploy signature. CLOSED: `sig` is required
//         and is what the bytes ACTUALLY hash to, so the lie is `mismatched`
//         and not `absent`.
//
// EVERY TEST NOW ASSERTS THE REQUIREMENT — the attack is still built, line for
// line, and then refused. A FAILURE here means a closed attack came back.

import test from 'node:test'
import assert from 'node:assert/strict'

import { MoleculeStore, moleculeOf } from './molecule.mjs'
import { Root } from './root.mjs'
import { mintKeys, verifyEd25519 } from './keys.mjs'
import { sha256, EDGE_FIELDS, mineSignatures } from './sig.mjs'
import {
  canonicalHeadMap,
  claimReaderOf,
  encodeHeadMap,
  headMapAttestationPreimage,
  headMapRegressions,
  headReaderOf,
  mintHeadMap,
  parseHeadMap,
  verifyDeploy,
  verifyHeadMapRows,
} from './head-map.mjs'

// ── the adversary's host: bytes only, no readdir, and it will lie ──────────

const lyingHostOf = (root, { swap = new Map(), omit = new Set() } = {}) => ({
  stats: { gets: 0, misses: 0, listings: 0 },
  list() {
    throw new Error('no directory branch')
  },
  content(sig) {
    this.stats.gets++
    if (omit.has(sig)) {
      this.stats.misses++
      return null
    }
    const bytes = root.read(swap.get(sig) ?? sig)
    if (!bytes) this.stats.misses++
    return bytes
  },
})

/** An atom, fetched BY SIGNATURE from a host. No listing anywhere. */
const atomFrom = (host, sig) => {
  const bytes = host.content(sig)
  if (!bytes || !bytes.length) return null
  try {
    return JSON.parse(bytes.toString('utf8'))
  } catch {
    return null
  }
}

/**
 * WHAT A COLD THIRD PARTY RENDERS from one verified row: the succession the
 * claim names, then each member envelope, by signature. This is the whole
 * point of holding a deploy — a verdict that does not end in a page is not a
 * verification of anything a reader cares about.
 */
const renderRow = (host, row) => {
  const succ = atomFrom(host, row.head)
  if (!succ) return null
  const hidden = new Set(succ.hidden ?? [])
  return (succ.members ?? [])
    .filter((e) => !hidden.has(e))
    .map((e) => atomFrom(host, e)?.root)
    .filter((n) => typeof n === 'string')
}

/** A publisher with a small, ordinary hive. */
const publisherOf = () => {
  const keys = mintKeys()
  const s = new MoleculeStore({ author: 'publisher', keys, root: new Root() })
  s.save([], 'business')
  s.save([], 'club')
  s.save(['business'], 'people')
  s.save(['business', 'people'], 'Alice')
  s.save(['club'], 'Dylan')
  return s
}

const depsFor = (host, { readHead = true } = {}) => ({
  verify: verifyEd25519,
  readClaim: claimReaderOf(host, verifyEd25519),
  readHead: readHead ? headReaderOf(host) : null,
})

const offerOf = (minted) => ({
  sig: minted.sig,
  bytes: minted.bytes.toString('utf8'),
  attestation: minted.attestation,
})

// ───────────────────────────────────────────────────────────────────────────
// S2-A — THE SET IS SIGNED NOW.
// ───────────────────────────────────────────────────────────────────────────
test('S2-A — A STRANGER CANNOT MINT A DEPLOY THAT VERIFIES AS MINE, NOR THE EMPTY ONE', () => {
  const s = publisherOf()
  const real = mintHeadMap(s)
  assert.ok(real && real.record.rows.length >= 4, 'the publisher deploys four molecules')

  const host = lyingHostOf(s.root)
  const deps = depsFor(host)

  // The genuine article verifies, as advertised — and now it is verified by a
  // function that takes the DEPLOY SIGNATURE, so "these bytes are those bytes"
  // is checked rather than assumed. There used to be no function anywhere that
  // took one, which is what made skipping step 1 an easy mistake.
  const honest = verifyDeploy(offerOf(real), s.pubkey, deps)
  assert.equal(honest.ok, true)
  assert.equal(honest.sig, real.sig)

  // THE ATTACK. I am a stranger. I have no key of the publisher's. Every row of
  // a head map is INDEPENDENTLY signed — so I compose my own sets out of the
  // publisher's own rows, exactly as before. What has changed is that the SET
  // is signed too, and I cannot sign it.
  const compose = (pairs) => {
    const record = canonicalHeadMap(s.pubkey, pairs)
    const bytes = encodeHeadMap(record)
    return { record, bytes, sig: sha256(Buffer.from(bytes, 'utf8')) }
  }

  // (1) TRUNCATION. Drop `/club` — a whole page of the publisher's site.
  const club = moleculeOf('club')
  const cut = compose(
    real.record.rows.filter(([m]) => m !== club).map(([molecule, claim]) => ({ molecule, claim })),
  )
  const vTrunc = verifyDeploy({ ...cut, attestation: real.attestation }, s.pubkey, deps)
  assert.equal(vTrunc.ok, false, 'FIXED: a deploy with a page cut out of it is not the publisher\'s')
  assert.equal(vTrunc.reason, 'unattested')

  // (2) THE EMPTY DEPLOY. "This publisher published nothing."
  const empty = compose([])
  assert.equal(verifyDeploy({ ...empty, attestation: real.attestation }, s.pubkey, deps).reason, 'unattested')
  assert.equal(verifyDeploy({ ...empty, attestation: null }, s.pubkey, deps).reason, 'unattested')
  // …and it is STILL a legitimate deploy when the publisher actually signs it:
  // "I publish nothing" is a statement they are allowed to make.
  const signedEmpty = { ...empty, attestation: s.keys.sign(headMapAttestationPreimage(s.pubkey, empty.sig)) }
  assert.equal(verifyDeploy(signedEmpty, s.pubkey, deps).ok, true)

  // (3) AND THE FORGERIES ARE STILL REAL ATOMS — they hash, they parse, they
  // are canonical. That was never the question; the question was who assembled
  // them, and the answer used to be "nobody can tell".
  assert.ok(parseHeadMap(cut.bytes), 'refuse-or-parse accepts it: it IS canonical')
  assert.notEqual(cut.sig, real.sig)

  // THE VERDICTS ARE NO LONGER INDISTINGUISHABLE. That was the shape of the
  // hole: `reason` was null for the truth and null for the forgery.
  assert.equal(honest.reason, null)
  assert.equal(vTrunc.reason, 'unattested')
  assert.notEqual(honest.reason, vTrunc.reason)

  // (4) AND STEP 1 IS OWNED. A host that answers the deploy address with other
  // bytes — even a genuine, fully attested deploy of the same publisher — is
  // caught, because the signature the caller was TOLD to expect is an argument.
  assert.equal(
    verifyDeploy({ sig: real.sig, bytes: signedEmpty.bytes, attestation: signedEmpty.attestation }, s.pubkey, deps).reason,
    'forged',
  )
})

// ───────────────────────────────────────────────────────────────────────────
// S2-B — A DEPLOY THAT NEVER EXISTED.
// ───────────────────────────────────────────────────────────────────────────
test('S2-B — GENERATION CHERRY-PICK: a franken deploy is refused before it can render', () => {
  const s = publisherOf()
  const people = moleculeOf('people')

  // Deploy 1: /business/people holds ['Alice'].
  const d1 = mintHeadMap(s)
  const oldClaim = d1.record.rows.find(([m]) => m === people)[1]

  // Two more ordinary generations, then deploy 2.
  s.save(['business', 'people'], 'Bob')
  s.save(['business', 'people'], 'Carla')
  const d2 = mintHeadMap(s)
  const newClaim = d2.record.rows.find(([m]) => m === people)[1]
  assert.notEqual(oldClaim, newClaim)

  // Both claim atoms are on the host: content-addressed, and NOTHING IS EVER
  // DELETED is a rule of this design, not an accident of this fixture.
  const host = lyingHostOf(s.root)
  const deps = depsFor(host)
  assert.ok(host.content(oldClaim), 'the superseded claim is still fetchable, by design')

  // THE ATTACK: deploy 2 in every row EXCEPT /business/people, which is pinned
  // to deploy 1. This set was never minted by anybody.
  const franken = canonicalHeadMap(
    s.pubkey,
    d2.record.rows.map(([molecule, claim]) => ({
      molecule,
      claim: molecule === people ? oldClaim : claim,
    })),
  )
  const bytes = encodeHeadMap(franken)
  const verdict = verifyDeploy(
    { sig: sha256(Buffer.from(bytes, 'utf8')), bytes, attestation: d2.attestation },
    s.pubkey, deps,
  )
  assert.equal(verdict.ok, false, 'FIXED: every row is genuinely signed and the MIXTURE is not')
  assert.equal(verdict.reason, 'unattested')
  assert.deepEqual(verdict.verified, [], 'FIXED: refused before a row was fetched, so it never renders')

  // The rows themselves really were all genuine — which is exactly why this
  // needed a signature over the SET and could never have been caught per row.
  const rows = verifyHeadMapRows(franken, s.pubkey, deps.readClaim)
  assert.equal(rows.rowsAuthentic, true)
  const pinned = rows.verified.find((r) => r.molecule === people)
  const live = verifyDeploy(offerOf(d2), s.pubkey, deps).verified.find((r) => r.molecule === people)
  assert.ok(pinned.seq < live.seq, 'the pinned row is an older generation of the publisher\'s OWN chain')
  assert.deepEqual(renderRow(host, pinned), ['Alice'])
  assert.deepEqual(renderRow(host, live), ['Alice', 'Bob', 'Carla'])

  // WHAT REMAINS OPEN, AND CANNOT BE CLOSED BY A SIGNATURE: replaying d1 whole.
  // It is a set the publisher really did sign, so it verifies, and a COLD
  // reader has nothing to regress against. See headmap-skeptic-1 S1-B2.
  assert.equal(verifyDeploy(offerOf(d1), s.pubkey, deps).ok, true, 'OPEN: a whole older deploy replays')
  assert.deepEqual(headMapRegressions([], verifyDeploy(offerOf(d1), s.pubkey, deps).verified), [])
})

// ───────────────────────────────────────────────────────────────────────────
// S2-C — A VERIFIED DEPLOY MUST HAVE CONTENT BEHIND IT.
// ───────────────────────────────────────────────────────────────────────────
test('S2-C — THE DECLARED CLOSURE STILL STOPS AT THE POINTERS, AND ok:true NO LONGER DOES', () => {
  const s = publisherOf()
  const deploy = mintHeadMap(s)

  // `refs` is the record's self-declared flat closure, and it is CLAIMS. A
  // claim is `{head, prev, seq, sig}`; `head` is not an edge field and `prev` is
  // a declared REFERENT, so a precise walker that follows declared edges stops
  // dead at the pointers. THAT PART IS DESIGN — a deploy names WHERE the pages
  // are and a reader pulls each head on demand, which is what keeps a cold read
  // O(page) instead of O(every edit ever made).
  assert.equal(EDGE_FIELDS.has('head'), false, 'a claim\'s head is not an edge')
  const mapAtom = JSON.parse(s.root.read(deploy.sig).toString('utf8'))
  assert.deepEqual([...mineSignatures(mapAtom)].sort(), deploy.record.refs.slice().sort())
  for (const claimSig of deploy.record.refs) {
    const claim = JSON.parse(s.root.read(claimSig).toString('utf8'))
    assert.deepEqual([...mineSignatures(claim)], [], 'the closure terminates at the claim, by design')
  }

  // So a replica built by walking the deploy's OWN declared closure holds the
  // map and the claims and NOT ONE BYTE of the hive. THE DEFECT was that this
  // verified ok:true, byte-identical to the verdict over the complete host.
  const replica = new Root()
  replica.write(deploy.sig, s.root.read(deploy.sig))
  for (const claimSig of deploy.record.refs) replica.write(claimSig, s.root.read(claimSig))

  const host = lyingHostOf(replica)
  const verdict = verifyDeploy(offerOf(deploy), s.pubkey, depsFor(host))
  assert.equal(verdict.ok, false, 'FIXED: a deploy over a host with no content is not verified')
  assert.deepEqual([...new Set(verdict.holes.map((h) => h.reason))], ['head-absent'])
  assert.equal(verdict.reason, 'incomplete')
  assert.equal(host.stats.listings, 0, 'and it still needs no listing to find that out')

  // The two verdicts are now different, which is the whole point.
  const complete = verifyDeploy(offerOf(deploy), s.pubkey, depsFor(lyingHostOf(s.root)))
  assert.equal(complete.ok, true)
  assert.notDeepEqual(verdict.verified, complete.verified)

  // Every page really is unreachable on the hollow host, which is what the
  // holes are saying.
  for (const row of complete.verified) {
    assert.equal(host.content(row.head), null)
    assert.equal(renderRow(host, row), null)
  }

  // AND THE WEAKER ANSWER IS STILL AVAILABLE, DELIBERATELY, for a caller who
  // only wants "are these pointers this key's?" — it just cannot be mistaken
  // for the strong one, because its verdict has no `ok` field.
  const rowsOnly = verifyDeploy(offerOf(deploy), s.pubkey, depsFor(host, { readHead: false }))
  assert.equal(rowsOnly.rowsAuthentic, true)
  assert.equal(rowsOnly.ok, true, 'a caller that does not ask about content is not told about it')
  assert.equal(verifyHeadMapRows(deploy.record, s.pubkey, depsFor(host).readClaim).ok, undefined)
})

// ───────────────────────────────────────────────────────────────────────────
// S2-D — THE HOST LIES, AND IT IS LOUD.
// ───────────────────────────────────────────────────────────────────────────
test('S2-D — A LYING HOST IS REPORTED AS LYING, NOT AS COLD', () => {
  const s = publisherOf()
  const people = moleculeOf('people')
  const d1 = mintHeadMap(s)
  const oldClaim = d1.record.rows.find(([m]) => m === people)[1]
  s.save(['business', 'people'], 'Bob')
  const d2 = mintHeadMap(s)
  const newClaim = d2.record.rows.find(([m]) => m === people)[1]

  // The host answers a GET for the CURRENT claim with the bytes of the OLD one.
  const host = lyingHostOf(s.root, { swap: new Map([[newClaim, oldClaim]]) })

  // A reader written to the module's own type. `sig` used to be OPTIONAL and to
  // say nothing about hashing, so this one omitted it — and the substituted row
  // verified, downgrading a live page under a deploy signature that never
  // moved. `sig` is REQUIRED now, so a reader that does not say what it fetched
  // has checked nothing and the verifier says so.
  const sloppyRead = (claimSig) => {
    const bytes = host.content(claimSig)
    if (!bytes || !bytes.length) return null
    const c = JSON.parse(bytes.toString('utf8'))
    return { offered: { head: c.head, prev: c.prev ?? null, seq: c.seq, sig: c.sig }, verify: verifyEd25519 }
  }

  const sloppy = verifyDeploy(offerOf(d2), s.pubkey, { verify: verifyEd25519, readClaim: sloppyRead })
  assert.equal(sloppy.ok, false, 'FIXED: a reader that states nothing proves nothing')
  assert.ok(
    sloppy.holes.some((h) => h.molecule === people && h.reason === 'unchecked'),
    'FIXED: and the hole says which discipline was skipped',
  )

  // THE DISCIPLINED READER NAMES THE LIE. `claimReaderOf` reports the hash of
  // what actually came back instead of refusing on a mismatch — refusing
  // collapsed "this host answered with something else" into "this byte was
  // cold", and those are opposite facts about a host.
  const strict = verifyDeploy(offerOf(d2), s.pubkey, depsFor(host))
  assert.equal(strict.ok, false)
  assert.deepEqual(
    strict.holes.filter((h) => h.molecule === people).map((h) => h.reason),
    ['mismatched'],
    'FIXED: "mismatched", not "absent" — a lying host and an offline one are different verdicts',
  )

  // and a genuinely absent byte is still `absent`, so the two stay separable
  const omitting = lyingHostOf(s.root, { omit: new Set([newClaim]) })
  assert.deepEqual(
    verifyDeploy(offerOf(d2), s.pubkey, depsFor(omitting)).holes
      .filter((h) => h.molecule === people).map((h) => h.reason),
    ['absent'],
  )

  // The publisher's deploy signature is untouched throughout: this was always a
  // downgrade of a correctly-signed deploy, never a forged one.
  assert.equal(sha256(Buffer.from(encodeHeadMap(d2.record), 'utf8')), d2.sig)
})
