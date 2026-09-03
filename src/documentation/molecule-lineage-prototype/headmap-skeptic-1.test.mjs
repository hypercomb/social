// headmap-skeptic-1.test.mjs — THE STRANGER, against step 4.
//
// LENS: I am another tenant. I hold my own key and I may write into my own
// buckets. I can read everything the victim publishes, because publishing is
// what it is for. My goal is to MOVE, INVALIDATE or FREEZE the victim's deploy
// signature, and failing that, to make their map DISHONEST about what they
// actually publish.
//
// POLARITY, STATED ONCE, BECAUSE THE SUITE DOES NOT SHARE A CONVENTION AND THAT
// COST AN EARLIER REVIEW A WRONG VERDICT (skeptic-4 E):
//
//   EVERY TEST IN THIS FILE NOW ASSERTS THE REQUIREMENT. A pass means the
//   defence works; a FAILURE means a closed attack came back. The five attacks
//   S1-A … S1-E were written the other way round (a PASS reproduced the
//   defect); each fixture is kept VERBATIM and only the assertions are
//   inverted, with the original attack still executed line for line so the
//   forgery is really built before it is really refused.
//
// WHAT LANDED, AND WHAT CLOSED IT:
//
//   S1-A  I could mint a map under the victim's OWN pubkey that OMITTED whole
//         molecules they publish, and it verified ok:true / holes:[]. The
//         record carried no completeness commitment and NO SIGNATURE OF ITS
//         OWN, so "verified" meant "every row present is genuinely theirs" and
//         never "these are the rows they published".
//         CLOSED by `headMapAttestationPreimage`: the publisher signs
//         (pubkey, mapSig), and `verifyDeploy` refuses an unsigned SET as
//         `unattested` before it spends a single fetch.
//   S1-B  I could mix generations — their CURRENT rows plus one GENUINE OLDER
//         claim, still fetchable at the root forever because `mintHeadMap`'s
//         dual-carrier write is never swept and DATA NEVER HEALS.
//         CLOSED by the same signature: a mixture is a set they never signed.
//         WHAT IS *NOT* CLOSED, and cannot be: replaying their whole OLDER
//         ATTESTED deploy. A signature proves authorship and never recency.
//         Kept below as S1-B2 and marked OPEN.
//   S1-C  WITHHOLDING WAS LOUD AND LYING WAS SILENT — an honest host missing
//         one byte read ok:false while a fabricated set read ok:true.
//         CLOSED: the fabricated set is now the louder of the two.
//   S1-D  The victim could be made to publish the truncation THEMSELVES:
//         `mintedScope` dropped every ledger molecule whose bucket did not
//         resolve, silently, and `mintHeadMap` reported success.
//         CLOSED: `unresolved` is returned and a publish UI can refuse.
//   S1-E  `mergeHeadMap` was last-write-wins, so my older row silently
//         downgraded a held newer one.
//         CLOSED: it returns `replaced`/`regressed` and REFUSES a proven
//         regression unless the caller says otherwise in writing.

import test from 'node:test'
import assert from 'node:assert/strict'

import { MoleculeStore, moleculeOf } from './molecule.mjs'
import { Root } from './root.mjs'
import { verifyEd25519 } from './keys.mjs'
import { sha256 } from './sig.mjs'
import {
  canonicalHeadMap,
  claimReaderOf,
  encodeHeadMap,
  headMapAttestationPreimage,
  headMapRegressions,
  mergeHeadMap,
  mintHeadMap,
  parseHeadMap,
  verifyDeploy,
  verifyHeadMapRows,
} from './head-map.mjs'

/** The shape every static host has: GET /<sig>, and no readdir at all. */
const contentOnlyHostOf = (root, { hide = new Set() } = {}) => ({
  stats: { gets: 0 },
  list() {
    throw new Error('no directory branch')
  },
  content(sig) {
    this.stats.gets++
    return hide.has(sig) ? null : root.read(sig)
  },
})

/** A victim with three molecules of their own and one published deploy. */
const victimWithADeploy = () => {
  const root = new Root()
  const victim = new MoleculeStore({ root, author: 'victim' })
  victim.save([], 'business')
  victim.save(['business'], 'people')
  victim.save([], 'finance')
  victim.save(['finance'], 'ledger')
  return { root, victim, deploy: mintHeadMap(victim, { route: null }) }
}

/** Everything a stranger needs is PUBLIC: the pubkey, and the map bytes. */
const asPublished = (root, deploy) => parseHeadMap(root.read(deploy.sig).toString('utf8'))

/** Mint a map under someone else's pubkey and publish it at its own address. */
const publishMapAs = (root, pubkey, pairs) => {
  const record = canonicalHeadMap(pubkey, pairs)
  const text = encodeHeadMap(record)
  const bytes = Buffer.from(text, 'utf8')
  const sig = sha256(bytes)
  root.write(sig, bytes)
  return { sig, record, bytes, text }
}

const depsFor = (host) => ({ verify: verifyEd25519, readClaim: claimReaderOf(host, verifyEd25519) })

const offerOf = (minted) => ({
  sig: minted.sig,
  bytes: minted.bytes.toString('utf8'),
  attestation: minted.attestation,
})

// ───────────────────────────────────────────────────────────────────────────
test('S1-A — I ERASE A WHOLE SUBTREE FROM THE VICTIM\'S DEPLOY AND IT IS REFUSED', () => {
  const { root, victim, deploy } = victimWithADeploy()
  const host = contentOnlyHostOf(root)
  const deps = depsFor(host)

  const honest = verifyDeploy(offerOf(deploy), victim.pubkey, deps)
  assert.equal(honest.ok, true, 'the real deploy verifies')
  assert.equal(honest.attested, true)
  assert.equal(honest.verified.length, 3, 'root + business + finance')

  // I HOLD NO SECRET. I read the victim's published map off the host, delete
  // the row for sign('finance'), and re-canonicalize under THEIR pubkey. Every
  // surviving row is a genuine, unmodified claim of theirs.
  const published = asPublished(root, deploy)
  const finance = moleculeOf('finance')
  assert.ok(published.rows.some((r) => r[0] === finance), 'finance is in the real deploy')

  const forged = publishMapAs(
    root,
    victim.pubkey,
    published.rows.filter((r) => r[0] !== finance).map(([molecule, claim]) => ({ molecule, claim })),
  )

  // I can still attach the victim's own genuine attestation — it is public —
  // and it does not help me, because the attestation is welded to the MAP
  // SIGNATURE (line three of its preimage) and my bytes are different bytes.
  const verdict = verifyDeploy(
    { sig: forged.sig, bytes: forged.text, attestation: deploy.attestation },
    victim.pubkey,
    deps,
  )

  assert.equal(verdict.ok, false, 'FIXED: a map I minted is not the victim\'s deploy')
  assert.equal(verdict.reason, 'unattested', 'FIXED: and the verdict says exactly why')
  assert.equal(verdict.attested, false)
  assert.deepEqual(verdict.verified, [], 'FIXED: refused BEFORE a single row was fetched')
  assert.equal(host.stats.gets, honest.record.rows.length + 0, 'FIXED: my forgery cost the reader zero fetches')

  // Nor can I mint an attestation of my own: `pubkey` is line two, so a
  // signature by my key over the victim's key line is not the victim's.
  const stranger = new MoleculeStore({ root, author: 'stranger' })
  assert.equal(
    verifyDeploy(
      {
        sig: forged.sig,
        bytes: forged.text,
        attestation: stranger.keys.sign(headMapAttestationPreimage(victim.pubkey, forged.sig)),
      },
      victim.pubkey, deps,
    ).reason,
    'unattested',
  )

  // AND THE ROWS DOOR STILL SAYS WHAT IT ALWAYS SAID — which is why it is a
  // DIFFERENT function with a DIFFERENT verdict shape. It has no `ok` field, so
  // "every row present is genuinely theirs" cannot be misread as "this is their
  // deploy". That misreading is precisely what this attack exploited.
  const rows = verifyHeadMapRows(forged.record, victim.pubkey, deps.readClaim)
  assert.equal(rows.rowsAuthentic, true, 'every surviving row IS genuinely the victim\'s')
  assert.equal(rows.ok, undefined, 'FIXED: and there is no `ok` on this verdict to mistake for the deploy')
})

// ───────────────────────────────────────────────────────────────────────────
test('S1-B — I MIX GENERATIONS: current rows plus one genuine OLD claim, and it is refused', () => {
  const { root, victim, deploy: gen0 } = victimWithADeploy()
  const host = contentOnlyHostOf(root)
  const deps = depsFor(host)

  const business = moleculeOf('business')
  const oldClaim = gen0.record.rows.find((r) => r[0] === business)[1]

  // the victim works on, and re-publishes
  victim.save(['business'], 'Alice')
  const gen1 = mintHeadMap(victim, { route: null })
  const newClaim = gen1.record.rows.find((r) => r[0] === business)[1]
  assert.notEqual(oldClaim, newClaim)

  // THE OLD CLAIM IS STILL SERVED, FOREVER. `#setHead` sweeps the losing entry
  // out of my bucket, but `mintHeadMap`'s DUAL-CARRIER write put a copy at the
  // root by its own signature and nothing ever removes that — which is correct
  // under DATA NEVER HEALS, and is also the ammunition. That is now documented
  // in `mintHeadMap` rather than sold purely as a convenience for static hosts.
  assert.ok(root.read(oldClaim), 'the superseded claim is still fetchable at the root')

  // I publish a map the victim never minted: everything current EXCEPT
  // business, which I roll back one generation.
  const rolled = publishMapAs(
    root,
    victim.pubkey,
    gen1.record.rows.map(([molecule, claim]) => ({
      molecule,
      claim: molecule === business ? oldClaim : claim,
    })),
  )

  const verdict = verifyDeploy(
    { sig: rolled.sig, bytes: rolled.text, attestation: gen1.attestation },
    victim.pubkey, deps,
  )
  assert.equal(verdict.ok, false, 'FIXED: a set the publisher never signed is not their deploy')
  assert.equal(verdict.reason, 'unattested')

  // and the genuine current deploy still verifies, so the fix costs nothing
  assert.equal(verifyDeploy(offerOf(gen1), victim.pubkey, deps).ok, true)
})

// ───────────────────────────────────────────────────────────────────────────
test('S1-B2 — OPEN: a whole, genuinely ATTESTED older deploy replayed to a COLD reader', () => {
  // THIS IS NOT CLOSED AND NO SIGNATURE CLOSES IT. A signature proves
  // authorship and NEVER recency — `publish-heads.ts:17` says exactly this — so
  // a host that serves the publisher's own previous deploy, attestation and
  // all, forges nothing and a verifier must not call it forged. The attestation
  // closes COMPOSITION (a set nobody signed); it does not and cannot close
  // REPLAY (a set that was signed, earlier).
  //
  // The defence is per-row and needs memory: `seq` is line six of a signed
  // claim preimage and cannot be raised without the secret, so a reader that
  // has ONCE proven generation 1 can never be talked back down to 0. A COLD
  // reader holds nothing to compare against, and a cold reader is exactly who a
  // deploy is for.
  //
  // WHAT ACTUALLY MITIGATES IT lives outside this module, in the POINTER: the
  // shipped kind-30564 hive index is a replaceable event whose `created_at`
  // monotonicity the relay enforces. That is why the pointer, and not the map,
  // must come from a source with a clock. Kept here, failing nothing, so the
  // limit is never mistaken for an oversight.
  const { root, victim, deploy: older } = victimWithADeploy()
  const host = contentOnlyHostOf(root)
  const deps = depsFor(host)

  victim.save(['business'], 'Alice')
  const newer = mintHeadMap(victim, { route: null })

  const replayed = verifyDeploy(offerOf(older), victim.pubkey, deps)
  assert.equal(replayed.ok, true, 'OPEN: the older deploy is genuinely theirs and verifies')
  assert.equal(replayed.attested, true)

  const current = verifyDeploy(offerOf(newer), victim.pubkey, deps)
  assert.deepEqual(
    headMapRegressions([], replayed.verified), [],
    'OPEN: a cold reader has no held rows, so the rollback is invisible to it',
  )
  assert.deepEqual(
    headMapRegressions(current.verified, replayed.verified).map((r) => r.molecule),
    [moleculeOf('business')],
    'and a WARM reader catches it exactly, on the author\'s own signed counter',
  )
})

// ───────────────────────────────────────────────────────────────────────────
test('S1-C — WITHHOLDING IS LOUD, AND SO IS LYING', () => {
  const { root, victim, deploy } = victimWithADeploy()
  const dropped = deploy.record.rows[0][1]

  // (i) A host that simply does not serve one claim. I forge NOTHING.
  const withholding = verifyDeploy(
    offerOf(deploy),
    victim.pubkey,
    depsFor(contentOnlyHostOf(root, { hide: new Set([dropped]) })),
  )
  assert.equal(withholding.ok, false)
  assert.equal(withholding.reason, 'incomplete')
  assert.deepEqual(withholding.holes.map((h) => h.reason), ['absent'])
  assert.equal(withholding.attested, true, 'the deploy is theirs; a byte was merely unreachable')

  // (ii) The SAME row removed, but from the map instead of from the host.
  const forged = publishMapAs(
    root,
    victim.pubkey,
    deploy.record.rows.slice(1).map(([molecule, claim]) => ({ molecule, claim })),
  )
  const lying = verifyDeploy(
    { sig: forged.sig, bytes: forged.text, attestation: deploy.attestation },
    victim.pubkey,
    depsFor(contentOnlyHostOf(root)),
  )

  assert.equal(lying.ok, false, 'FIXED: the harder attack no longer produces the cleaner verdict')
  assert.equal(lying.reason, 'unattested')
  assert.equal(lying.attested, false)

  // AND THE TWO ARE DISTINGUISHABLE, which is the point. `incomplete` +
  // attested:true is an honest publisher behind a lossy host; `unattested` is a
  // set nobody signed. A consumer gating on `ok` now treats the fabricated set
  // as the worse of the two, not the better.
  assert.notEqual(withholding.reason, lying.reason)
  assert.ok(withholding.attested && !lying.attested)
})

// ───────────────────────────────────────────────────────────────────────────
test('S1-D — THE VICTIM CANNOT PUBLISH A TRUNCATION UNKNOWINGLY: mintedScope REPORTS', () => {
  const live = new Root()
  const victim = new MoleculeStore({ root: live, author: 'victim' })
  victim.save([], 'business')
  victim.save(['business'], 'people')
  victim.save([], 'finance')
  const honest = mintHeadMap(victim, { route: null })
  assert.equal(honest.record.rows.length, 2, 'root + business are the molecules committed at')
  assert.deepEqual(honest.unresolved, [], 'a healthy store resolves everything it minted')

  // THE ORDINARY ACCIDENT, stated by the ledger's own comment: OPFS is evicted
  // and localStorage survives, because the two are cleared by different
  // gestures. The recovery is "replicate from a current host" — and the host I
  // reach is behind, or is mine and simply answers nothing.
  const cold = new Root()
  const restored = new MoleculeStore({
    root: cold, keys: victim.keys, ledger: victim.minted, author: 'victim',
  })

  const republished = mintHeadMap(restored, { route: null })

  assert.equal(restored.minted.size, 2, 'the ledger still names every molecule I publish')
  assert.ok(republished, 'minting still SUCCEEDS — a caller may legitimately want the empty map')
  assert.deepEqual(republished.record.rows, [], 'and the rows really are empty')
  assert.deepEqual(
    republished.unresolved.slice().sort(),
    [...restored.minted.keys()].sort(),
    'FIXED: but every molecule it could not resolve is NAMED in the report',
  )
  assert.equal(
    republished.unresolved.length, 2,
    'FIXED: "I publish nothing" from a ledger that says otherwise is now impossible to mint SILENTLY',
  )

  // The report is part of the returned shape, so a publish UI cannot not-know.
  // Contrast `#commit`, which refuses LOUDLY on exactly this condition, and
  // `publish-branch.ts`, which REPORTS `missingFromIndex`.
  assert.deepEqual(
    Object.keys(republished).sort(),
    ['attestation', 'bytes', 'opaque', 'outOfScope', 'pairs', 'record', 'sig', 'unresolved'],
  )
  assert.throws(
    () => restored.save([], 'anything'),
    /out of sync|dead route/,
    'the COMMIT path still fails closed on the same store state',
  )
})

// ───────────────────────────────────────────────────────────────────────────
test('S1-E — mergeHeadMap REFUSES my downgrade over a held newer row, and names it', () => {
  const { root, victim, deploy: gen0 } = victimWithADeploy()
  const host = contentOnlyHostOf(root)
  const deps = depsFor(host)
  const business = moleculeOf('business')
  const oldClaim = gen0.record.rows.find((r) => r[0] === business)[1]

  victim.save(['business'], 'Alice')
  const gen1 = mintHeadMap(victim, { route: null })
  const newClaim = gen1.record.rows.find((r) => r[0] === business)[1]
  const proven = verifyDeploy(offerOf(gen1), victim.pubkey, deps).verified

  // WITH NOTHING TO RANK BY, the merge still proceeds — a caller composing two
  // of its own scoped mints has no generations to compare — but it REPORTS what
  // it overwrote, so "silently" is no longer available to anybody.
  const blind = mergeHeadMap(gen1.record, [{ molecule: business, claim: oldClaim }])
  assert.deepEqual(blind.replaced, [{ molecule: business, from: newClaim, to: oldClaim }],
    'FIXED: every overwritten molecule is named')

  // WITH THE ROWS THE READER HAS ALREADY PROVEN, it refuses outright. That is
  // `acceptHeadClaim`'s staleness rule, which used not to travel up with the
  // aggregate because `HeadMapPair` carried no `seq` — so the pair may now
  // carry one, and the caller passes what it holds.
  const guarded = mergeHeadMap(
    gen1.record,
    [{ molecule: business, claim: oldClaim, seq: 0 }],
    { held: proven },
  )
  assert.equal(guarded.record, null, 'FIXED: a proven regression refuses the whole merge')
  assert.deepEqual(guarded.regressed, [{ molecule: business, heldSeq: 1, offeredSeq: 0 }])

  // and a caller who really means it has to say so, in writing
  const forced = mergeHeadMap(
    gen1.record,
    [{ molecule: business, claim: oldClaim, seq: 0 }],
    { held: proven, allowRegression: true },
  )
  assert.ok(forced.record)
  assert.equal(forced.regressed.length, 1, 'and even then it is reported')
})

// ───────────────────────────────────────────────────────────────────────────
// THE HOLDS. Four doors I could not get through, asserted so a later change
// cannot quietly open one.
// ───────────────────────────────────────────────────────────────────────────

test('S1-H1 — HOLDS: my commit in my own bucket does not move the victim\'s deploy', () => {
  const shared = new Root()
  const victim = new MoleculeStore({ root: shared, author: 'victim' })
  victim.save([], 'business')
  victim.save(['business'], 'people')
  const before = mintHeadMap(victim, { route: null }).sig

  const stranger = new MoleculeStore({ root: shared, author: 'stranger' })
  stranger.save(['business'], 'STRANGER-TILE')
  stranger.save(['business'], 'ANOTHER')

  assert.equal(
    mintHeadMap(victim, { route: null }).sig,
    before,
    'HOLDS: the enumeration only ever opens <molecule>/<MY pubkey>/ — skeptic-4 B is closed',
  )
  assert.deepEqual(
    victim.childNames(['business']).sort(),
    ['ANOTHER', 'STRANGER-TILE', 'people'].sort(),
    'HOLDS: and the firehose is intact — my tiles still render on their page, the map is a FLOOR',
  )
})

test('S1-H1b — HOLDS: nor does a stranger\'s tile move a BRANCH deploy of molecules I head', () => {
  // The branch scope walks the UNION now, so a stranger CAN change which of my
  // molecules fall inside a branch — that is the deliberate, weaker exposure
  // taken in exchange for not amputating my subtree. What they still cannot do
  // is change a ROW, or reach a molecule I do not head.
  const shared = new Root()
  const victim = new MoleculeStore({ root: shared, author: 'victim' })
  victim.save([], 'business')
  victim.save(['business'], 'people')
  victim.save(['business', 'people'], 'Alice')
  const before = mintHeadMap(victim, { route: ['business'] })

  const stranger = new MoleculeStore({ root: shared, author: 'stranger' })
  stranger.save(['business', 'people'], 'Bob') // their head in a molecule I head too

  const after = mintHeadMap(victim, { route: ['business'] })
  assert.deepEqual(
    after.record.rows, before.record.rows,
    'HOLDS: their commit lands in their bucket; every row is still my own claim',
  )
  assert.equal(after.sig, before.sig)
})

test('S1-H2 — HOLDS: I cannot inject a row, even one that is genuinely mine', () => {
  const shared = new Root()
  const victim = new MoleculeStore({ root: shared, author: 'victim' })
  victim.save([], 'business')
  const stranger = new MoleculeStore({ root: shared, author: 'stranger' })
  stranger.save([], 'secrets')
  stranger.save(['secrets'], 'x') // sign('secrets') is a molecule ONLY I head

  const victimDeploy = mintHeadMap(victim, { route: null })
  const strangerDeploy = mintHeadMap(stranger, { route: null })
  const read = claimReaderOf(contentOnlyHostOf(shared), verifyEd25519)

  const injected = canonicalHeadMap(victim.pubkey, [
    ...victimDeploy.record.rows.map(([molecule, claim]) => ({ molecule, claim })),
    // my own genuine claim, at a molecule the victim does not head
    ...strangerDeploy.record.rows
      .filter((r) => !victimDeploy.record.rows.some((v) => v[0] === r[0]))
      .map(([molecule, claim]) => ({ molecule, claim })),
  ])
  const verdict = verifyHeadMapRows(injected, victim.pubkey, read)

  assert.equal(verdict.rowsAuthentic, false, 'HOLDS: a foreign row is refused')
  assert.ok(
    verdict.holes.every((h) => h.reason === 'unsigned'),
    'HOLDS: the preimage is rebuilt from the row KEY and the pubkey ASKED FOR, so my claim renders a string I never signed',
  )
})

test('S1-H3 — HOLDS: I cannot move one of the victim\'s own rows to another molecule', () => {
  const { root, victim, deploy } = victimWithADeploy()
  const read = claimReaderOf(contentOnlyHostOf(root), verifyEd25519)
  const rows = deploy.record.rows
  assert.ok(rows.length >= 2)

  // swap two of THEIR OWN claims between THEIR OWN molecules
  const swapped = canonicalHeadMap(victim.pubkey, [
    { molecule: rows[0][0], claim: rows[1][1] },
    { molecule: rows[1][0], claim: rows[0][1] },
    ...rows.slice(2).map(([molecule, claim]) => ({ molecule, claim })),
  ])
  const verdict = verifyHeadMapRows(swapped, victim.pubkey, read)

  assert.equal(verdict.rowsAuthentic, false)
  assert.deepEqual(
    verdict.holes.map((h) => h.reason).sort(),
    ['unsigned', 'unsigned'],
    'HOLDS: molecule is line two of the signed preimage; a row is welded to its address',
  )
})

test('S1-H4 — HOLDS: I cannot take the byline by claiming the victim\'s succession', () => {
  const shared = new Root()
  const victim = new MoleculeStore({ root: shared, author: 'victim' })
  victim.save([], 'business')
  victim.save(['business'], 'people')

  const stranger = new MoleculeStore({ root: shared, author: 'stranger' })
  const molecule = moleculeOf('business')
  const stolen = victim.headSig(molecule)

  // a claim over SOMEONE ELSE'S succession, correctly signed by me, filed in
  // MY OWN bucket — every field of the preimage true.
  const entry = stranger.mintHeadEntry(molecule, { head: stolen, prev: null, seq: 0 })
  shared.write(`${molecule}/${stranger.pubkey}/${entry.name}`, entry.bytes)

  assert.equal(
    stranger.heldClaim(molecule, stranger.pubkey),
    null,
    'HOLDS: the adoption refusal — the atom must name THIS bucket as its signer',
  )
  assert.ok(
    !mintHeadMap(stranger, { route: null }).record.rows.some((r) => r[0] === molecule),
    'HOLDS: and so the stolen molecule never reaches my own map either',
  )
})
