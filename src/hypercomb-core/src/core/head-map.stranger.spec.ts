// core/head-map.stranger.spec.ts
//
// ADVERSARIAL REVIEW OF STEP 4, LENS: THE STRANGER.
//
// I am another tenant. I hold my own key, I may write into my own buckets, and
// I can read everything the victim publishes — publishing is what it is for.
// The prototype twin is
// `documentation/molecule-lineage-prototype/headmap-skeptic-1.test.mjs`.
//
// THE FINDING, IN ONE SENTENCE: the first cut of `verifyHeadMap` proved that
// every row PRESENT was genuinely the publisher's, while the module's prose
// read that as "a third party can RE-DERIVE the deploy signature … rather than
// merely take its word". It could not. The record carried no completeness
// commitment and NO SIGNATURE OF ITS OWN, `record.pubkey` is a field the
// composer chooses, and there is no independent way to enumerate a publisher's
// buckets — so any SUBSET of a publisher's genuine rows, and any MIX of their
// generations, verified `ok:true, reason:null, holes:[]`.
//
// THE FIX WAS ONE LINE OF MACHINERY STEP 3 ALREADY BUILT: sign the canonical
// bytes with the same key, over a domain-separated three-line preimage, checked
// by the already-injected verifier. That conflation is worth naming, because
// the module argued its way out of it once: AUTHORSHIP OF THE SET is not
// recency. Recency is indeed unprovable by signature; authorship of a
// composition is exactly what a signature proves, and exactly what was missing.
//
// POLARITY: EVERY `it` HERE NOW ASSERTS THE REQUIREMENT. It was written the
// other way round — a PASS reproduced the attack — so every fixture is kept
// verbatim, the forgery is still built line for line, and only the assertions
// are inverted. A FAILURE here means a closed attack came back.

import { describe, expect, it } from 'vitest'
import { createHash, generateKeyPairSync, sign as nodeSign, verify as nodeVerify, createPublicKey } from 'node:crypto'

import { acceptHeadClaim, headClaimPreimage } from './head-claim.js'
import {
  canonicalHeadMap,
  encodeHeadMap,
  headMapAttestationPreimage,
  headMapRegressions,
  mergeHeadMap,
  verifyDeploy,
  verifyHeadMapRows,
  type HeadMapClaimReader,
  type HeadMapRecord,
} from './head-map.js'

const sha256 = (bytes: Buffer | string): string => createHash('sha256').update(bytes).digest('hex')
const sign64 = (text: string): string => sha256(Buffer.from(text, 'utf8'))
const digest = async (text: string): Promise<string> => sha256(text)

interface Identity {
  readonly pubkey: string
  readonly sign: (preimage: string) => string
}

const mintKeys = (): Identity => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const jwk = publicKey.export({ format: 'jwk' }) as { x: string }
  return {
    pubkey: Buffer.from(jwk.x, 'base64url').toString('hex'),
    sign: (preimage) => nodeSign(null, Buffer.from(preimage, 'utf8'), privateKey).toString('hex'),
  }
}

const verifyEd25519 = (pubkeyHex: string, preimage: string, sigHex: string): boolean => {
  if (!/^[0-9a-f]{64}$/.test(pubkeyHex) || !/^[0-9a-f]{128}$/.test(sigHex)) return false
  try {
    const key = createPublicKey({
      key: { kty: 'OKP', crv: 'Ed25519', x: Buffer.from(pubkeyHex, 'hex').toString('base64url') },
      format: 'jwk',
    })
    return nodeVerify(null, Buffer.from(preimage, 'utf8'), key, Buffer.from(sigHex, 'hex'))
  } catch {
    return false
  }
}

/** GET /<sig> and nothing else. `hide` models a host that withholds a byte. */
class ContentOnlyHost {
  readonly bytes = new Map<string, Buffer>()
  hide = new Set<string>()
  gets = 0

  put(text: string): string {
    const buf = Buffer.from(text, 'utf8')
    const sig = sha256(buf)
    this.bytes.set(sig, buf)
    return sig
  }

  get(sig: string): Buffer | null {
    this.gets++
    return this.hide.has(sig) ? null : this.bytes.get(sig) ?? null
  }

  list(): never {
    throw new Error('no directory branch')
  }
}

const publishClaim = (
  host: ContentOnlyHost, identity: Identity, molecule: string,
  head: string, prev: string | null = null, seq = 0,
): string => host.put(JSON.stringify({
  head, prev, seq, sig: identity.sign(headClaimPreimage(molecule, identity.pubkey, head, prev, seq)),
}))

/** Reports what the bytes ACTUALLY hash to; the verifier is what compares. */
const readerFor = (host: ContentOnlyHost): HeadMapClaimReader => async (claimSig) => {
  const bytes = host.get(claimSig)
  if (!bytes) return null
  const parsed = JSON.parse(bytes.toString('utf8')) as {
    head: string; prev: string | null; seq: number; sig: string
  }
  return { offered: { ...parsed, prev: parsed.prev ?? null }, verify: verifyEd25519, sig: sha256(bytes) }
}

const pairsOf = (record: HeadMapRecord): { molecule: string; claim: string }[] =>
  record.rows.map(([molecule, claim]) => ({ molecule, claim }))

/** The publisher's own deploy: the bytes, their signature, and the attestation. */
const deployOf = (identity: Identity, record: HeadMapRecord): {
  sig: string; bytes: string; attestation: string
} => {
  const bytes = encodeHeadMap(record)
  const sig = sha256(bytes)
  return { sig, bytes, attestation: identity.sign(headMapAttestationPreimage(identity.pubkey, sig)) }
}

/** A composition a STRANGER made: the bytes, their signature, no signature of the set. */
const composeAs = (pubkey: string, pairs: { molecule: string; claim: string }[]): {
  sig: string; bytes: string; record: HeadMapRecord
} => {
  const record = canonicalHeadMap(pubkey, pairs)!
  const bytes = encodeHeadMap(record)
  return { sig: sha256(bytes), bytes, record }
}

describe('THE STRANGER, against the signed head map', () => {
  it('S1-A CLOSED: a SUBSET of the victim\'s genuine rows is not their deploy', async () => {
    const host = new ContentOnlyHost()
    const victim = mintKeys()
    const stranger = mintKeys()
    const business = sign64('business')
    const finance = sign64('finance')

    const honestRecord = canonicalHeadMap(victim.pubkey, [
      { molecule: business, claim: publishClaim(host, victim, business, sign64('h-b'), null, 0) },
      { molecule: finance, claim: publishClaim(host, victim, finance, sign64('h-f'), null, 0) },
    ])!
    const honest = deployOf(victim, honestRecord)
    const deps = { digest, verify: verifyEd25519, readClaim: readerFor(host), accept: acceptHeadClaim }
    expect((await verifyDeploy(honest, victim.pubkey, deps)).ok).toBe(true)

    // I hold no secret. I read their published bytes and drop one row. Every
    // surviving row is a genuine, unmodified claim of theirs.
    const truncated = composeAs(victim.pubkey, pairsOf(honestRecord).filter((p) => p.molecule !== finance))

    host.gets = 0
    for (const [label, attestation] of [
      ['unsigned', null],
      ['their genuine one, lifted', honest.attestation],
      ['one I minted myself', stranger.sign(headMapAttestationPreimage(victim.pubkey, truncated.sig))],
    ] as const) {
      const verdict = await verifyDeploy(
        { sig: truncated.sig, bytes: truncated.bytes, attestation }, victim.pubkey, deps,
      )
      expect(verdict.ok, label).toBe(false)
      expect(verdict.reason, label).toBe('unattested')
      expect(verdict.attested, label).toBe(false)
    }
    // and refused before a byte was spent on it, the same discipline that
    // already refused a wrong `expected` before touching the host
    expect(host.gets).toBe(0)

    // WHY THE ATTESTATION CANNOT BE LIFTED: `mapSig` is line three of its
    // preimage and `pubkey` is line two, so it is welded to both.
    expect(headMapAttestationPreimage(victim.pubkey, honest.sig))
      .not.toBe(headMapAttestationPreimage(victim.pubkey, truncated.sig))

    // THE ROWS DOOR STILL SAYS WHAT IT ALWAYS SAID — and its verdict has no
    // `ok` field, so "every row present is genuinely theirs" can no longer be
    // read as "this is their deploy". That misreading WAS the attack.
    const rows = await verifyHeadMapRows(truncated.record, victim.pubkey, readerFor(host), acceptHeadClaim)
    expect(rows.rowsAuthentic).toBe(true)
    expect('ok' in rows).toBe(false)
  })

  it('S1-B CLOSED: a MIX of generations the publisher never signed as a set is refused', async () => {
    const host = new ContentOnlyHost()
    const victim = mintKeys()
    const notes = sign64('notes')
    const other = sign64('other')

    const gen0 = publishClaim(host, victim, notes, sign64('h0'), null, 0)
    const gen1 = publishClaim(host, victim, notes, sign64('h1'), sign64('h0'), 1)
    const otherRow = publishClaim(host, victim, other, sign64('h-o'), null, 0)

    const currentRecord = canonicalHeadMap(victim.pubkey, [
      { molecule: notes, claim: gen1 }, { molecule: other, claim: otherRow },
    ])!
    const current = deployOf(victim, currentRecord)
    const deps = { digest, verify: verifyEd25519, readClaim: readerFor(host), accept: acceptHeadClaim }

    // MY composition: their current /other, rolled back at /notes. No such set
    // was ever minted by them — and now nothing says otherwise.
    const franken = composeAs(victim.pubkey, [
      { molecule: notes, claim: gen0 }, { molecule: other, claim: otherRow },
    ])
    const verdict = await verifyDeploy(
      { sig: franken.sig, bytes: franken.bytes, attestation: current.attestation }, victim.pubkey, deps,
    )
    expect(verdict.ok).toBe(false)
    expect(verdict.reason).toBe('unattested')
    expect(verdict.verified).toEqual([])

    // the genuine current deploy is unaffected
    expect((await verifyDeploy(current, victim.pubkey, deps)).ok).toBe(true)

    // OPEN, AND NO DESIGN CLOSES IT: replaying their WHOLE older attested
    // deploy. A signature proves authorship and never recency, so a host
    // serving a set they really did sign, earlier, forges nothing. A COLD
    // reader — who a deploy is FOR — holds nothing to regress against.
    const older = deployOf(victim, canonicalHeadMap(victim.pubkey, [{ molecule: notes, claim: gen0 }])!)
    const replayed = await verifyDeploy(older, victim.pubkey, deps)
    expect(replayed.ok).toBe(true)
    expect(headMapRegressions([], replayed.verified)).toEqual([])
    // A WARM reader catches it exactly, on the author's own signed counter.
    const currentVerdict = await verifyDeploy(current, victim.pubkey, deps)
    expect(headMapRegressions(currentVerdict.verified, replayed.verified))
      .toEqual([{ molecule: notes, heldSeq: 1, offeredSeq: 0 }])
  })

  it('S1-C CLOSED: withholding is loud, and so is lying', async () => {
    const host = new ContentOnlyHost()
    const victim = mintKeys()
    const a = sign64('a')
    const b = sign64('b')
    const claimA = publishClaim(host, victim, a, sign64('ha'), null, 0)
    const record = canonicalHeadMap(victim.pubkey, [
      { molecule: a, claim: claimA },
      { molecule: b, claim: publishClaim(host, victim, b, sign64('hb'), null, 0) },
    ])!
    const honest = deployOf(victim, record)
    const deps = { digest, verify: verifyEd25519, readClaim: readerFor(host), accept: acceptHeadClaim }

    // (i) an honest host that simply cannot serve one byte
    host.hide.add(claimA)
    const withholding = await verifyDeploy(honest, victim.pubkey, deps)
    host.hide.clear()
    expect(withholding.ok).toBe(false)
    expect(withholding.reason).toBe('incomplete')
    expect(withholding.attested).toBe(true) // the deploy IS theirs; a byte was cold
    expect(withholding.holes.map((h) => h.reason)).toEqual(['absent'])

    // (ii) the SAME row removed by me, from the map instead of from the host
    const cut = composeAs(victim.pubkey, pairsOf(record).filter((p) => p.molecule !== a))
    const lying = await verifyDeploy(
      { sig: cut.sig, bytes: cut.bytes, attestation: honest.attestation }, victim.pubkey, deps,
    )
    expect(lying.ok).toBe(false)
    expect(lying.reason).toBe('unattested')
    expect(lying.attested).toBe(false)

    // THE VERDICT IS NO LONGER STRONGEST WHERE THE ADVERSARY IS WEAKEST, and
    // the two failures are distinguishable: `incomplete` + attested is an
    // honest publisher behind a lossy host; `unattested` is a set nobody signed.
    expect(withholding.reason).not.toBe(lying.reason)
    expect(withholding.attested && !lying.attested).toBe(true)
  })

  it('S1-E CLOSED: mergeHeadMap refuses my downgrade over a held newer row, and names it', async () => {
    const host = new ContentOnlyHost()
    const victim = mintKeys()
    const notes = sign64('notes')
    const gen0 = publishClaim(host, victim, notes, sign64('h0'), null, 0)
    const gen1 = publishClaim(host, victim, notes, sign64('h1'), sign64('h0'), 1)

    const held = canonicalHeadMap(victim.pubkey, [{ molecule: notes, claim: gen1 }])!
    const proven = (await verifyHeadMapRows(held, victim.pubkey, readerFor(host), acceptHeadClaim)).verified
    expect(proven[0]!.seq).toBe(1)

    // `HeadMapPair` carried no `seq`, so the composition primitive could not
    // rank and did not try, while one level down `acceptHeadClaim` makes
    // staleness its central rule. That discipline travels up now: the pair may
    // carry a `seq`, and the caller passes the generations it has PROVEN.
    const guarded = mergeHeadMap(held, [{ molecule: notes, claim: gen0, seq: 0 }], { held: proven })
    expect(guarded.record).toBeNull()
    expect(guarded.regressed).toEqual([{ molecule: notes, heldSeq: 1, offeredSeq: 0 }])

    // With nothing to rank by, the merge still proceeds — a caller composing
    // two of its own scoped mints has no generations to compare — but it
    // REPORTS what it overwrote, so "silently" is not available to anybody.
    const blind = mergeHeadMap(held, [{ molecule: notes, claim: gen0 }])
    expect(blind.record!.rows).toEqual([[notes, gen0]])
    expect(blind.replaced).toEqual([{ molecule: notes, from: gen1, to: gen0 }])
  })

  // ── the doors that HOLD (a pass here means the defence works) ────────────

  it('HOLDS: I cannot inject a row of my own, and I cannot move one of theirs', async () => {
    const host = new ContentOnlyHost()
    const victim = mintKeys()
    const stranger = mintKeys()
    const mine = sign64('secrets')
    const a = sign64('a')
    const b = sign64('b')

    const claimA = publishClaim(host, victim, a, sign64('ha'), null, 0)
    const claimB = publishClaim(host, victim, b, sign64('hb'), null, 0)

    const injected = canonicalHeadMap(victim.pubkey, [
      { molecule: a, claim: claimA },
      { molecule: mine, claim: publishClaim(host, stranger, mine, sign64('hm'), null, 0) },
    ])!
    const one = await verifyHeadMapRows(injected, victim.pubkey, readerFor(host), acceptHeadClaim)
    expect(one.rowsAuthentic).toBe(false)
    expect(one.holes.map((h) => h.reason)).toEqual(['unsigned'])

    const swapped = canonicalHeadMap(victim.pubkey, [
      { molecule: a, claim: claimB }, { molecule: b, claim: claimA },
    ])!
    const two = await verifyHeadMapRows(swapped, victim.pubkey, readerFor(host), acceptHeadClaim)
    expect(two.rowsAuthentic).toBe(false)
    expect(two.holes.map((h) => h.reason)).toEqual(['unsigned', 'unsigned'])
  })
})
