// core/head-map.third-party.spec.ts
//
// THIRD-PARTY VERIFICATION, ADVERSARIAL. The reader holds ONE signature and a
// dumb byte host that refuses to list, omits entries, serves stale bytes and
// lies. `head-map.spec.ts` proves the four findings the seal died of are gone;
// this file is the four the REPLACEMENT was found to have, and their closures:
//
//   NOTHING SIGNED THE SET. `verifyHeadMap` proved every row was a genuine
//   claim of this key. It did not prove THIS IS THE SET THE PUBLISHER DEPLOYED,
//   and the module declined to close that on purpose ("a third signature would
//   prove authorship and never recency … would close nothing"). That argument
//   conflated two properties. Recency is indeed unprovable by signature.
//   AUTHORSHIP OF THE SET is a different property, it was exactly what was
//   missing, and it is exactly what a signature closes. So:
//     TRUNCATION / THE EMPTY DEPLOY / CHERRY-PICK   -> `unattested`.
//   THE DECLARED CLOSURE CARRIED NO CONTENT, so ok:true could not tell a whole
//   site from no site                               -> `readHead`.
//   THE CLAIM READER'S `sig` WAS OPTIONAL, so a lying host downgraded a row
//   under an unchanged deploy signature             -> `sig` required, and the
//                                                      lie is `mismatched`.
//   NO FUNCTION TOOK A DEPLOY SIGNATURE, so steps 0-1 of the documented recipe
//   were owned by nobody                            -> `verifyDeploy`.
//
// EVERY TEST HERE ASSERTS THE REQUIREMENT: the attack is still built, and then
// refused. A FAILURE means a closed attack came back.
//
// Companion: `documentation/molecule-lineage-prototype/headmap-skeptic-2.test.mjs`,
// which carries the same four attacks over a real molecule store and renders
// the page a cold reader gets.

import { describe, expect, it } from 'vitest'
import { createHash, createPublicKey, generateKeyPairSync, sign as nodeSign, verify as nodeVerify } from 'node:crypto'

import { acceptHeadClaim, headClaimPreimage } from './head-claim.js'
import {
  canonicalHeadMap,
  encodeHeadMap,
  headMapAttestationPreimage,
  headMapRegressions,
  verifyDeploy,
  verifyHeadMapRows,
  type HeadMapClaimReader,
  type HeadMapHeadReader,
  type HeadMapPair,
  type HeadMapRecord,
} from './head-map.js'

const sha256 = (bytes: Buffer | string): string => createHash('sha256').update(bytes).digest('hex')
const sign64 = (text: string): string => sha256(Buffer.from(text, 'utf8'))
const digest = async (text: string): Promise<string> => sha256(text)

interface Identity { readonly pubkey: string; readonly sign: (preimage: string) => string }

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

/** A byte host with no listing verb — and a swap table, because hosts lie. */
class LyingHost {
  readonly bytes = new Map<string, Buffer>()
  readonly swap = new Map<string, string>()
  readonly omit = new Set<string>()

  put(text: string): string {
    const buf = Buffer.from(text, 'utf8')
    const sig = sha256(buf)
    this.bytes.set(sig, buf)
    return sig
  }

  get(sig: string): Buffer | null {
    if (this.omit.has(sig)) return null
    return this.bytes.get(this.swap.get(sig) ?? sig) ?? null
  }

  list(): never {
    throw new Error('no directory branch')
  }
}

const publishClaim = (
  host: LyingHost,
  identity: Identity,
  molecule: string,
  head: string,
  prev: string | null,
  seq: number,
): string => {
  const sig = identity.sign(headClaimPreimage(molecule, identity.pubkey, head, prev, seq))
  return host.put(JSON.stringify({ head, prev, seq, sig }))
}

/**
 * THE DISCIPLINED READER: fetch by signature, HASH WHAT CAME BACK, and REPORT
 * that hash. It does not refuse on a mismatch — refusing collapses "this host
 * answered with something else" into "this byte was cold", and those are
 * opposite facts about a host. The verifier compares and says `mismatched`.
 */
const strictReader = (host: LyingHost): HeadMapClaimReader => async (claimSig) => {
  const bytes = host.get(claimSig)
  if (!bytes) return null
  const p = JSON.parse(bytes.toString('utf8')) as { head: string; prev: string | null; seq: number; sig: string }
  return {
    offered: { head: p.head, prev: p.prev ?? null, seq: p.seq, sig: p.sig },
    verify: verifyEd25519,
    sig: sha256(bytes),
  }
}

/**
 * A reader that does NOT say what it fetched. `sig` used to be optional and to
 * say nothing in the type about hashing, so this is what a caller wrote when
 * they read the signature and not the prose. It is now a compile error to omit
 * `sig`, and at runtime a missing one is `unchecked` — silence is not consent.
 */
const looseReader = (host: LyingHost): HeadMapClaimReader => (async (claimSig: string) => {
  const bytes = host.get(claimSig)
  if (!bytes) return null
  const p = JSON.parse(bytes.toString('utf8')) as { head: string; prev: string | null; seq: number; sig: string }
  return { offered: { head: p.head, prev: p.prev ?? null, seq: p.seq, sig: p.sig }, verify: verifyEd25519 }
}) as unknown as HeadMapClaimReader

const headReaderFor = (host: LyingHost): HeadMapHeadReader => async (headSig) => {
  const bytes = host.get(headSig)
  return !!bytes && sha256(bytes) === headSig
}

const asPairs = (record: HeadMapRecord): HeadMapPair[] =>
  record.rows.map(([molecule, claim]) => ({ molecule, claim }))

const deployOf = (identity: Identity, record: HeadMapRecord): {
  sig: string; bytes: string; attestation: string
} => {
  const bytes = encodeHeadMap(record)
  const sig = sha256(bytes)
  return { sig, bytes, attestation: identity.sign(headMapAttestationPreimage(identity.pubkey, sig)) }
}

const composeAs = (pubkey: string, pairs: HeadMapPair[]): { sig: string; bytes: string; record: HeadMapRecord } => {
  const record = canonicalHeadMap(pubkey, pairs)!
  const bytes = encodeHeadMap(record)
  return { sig: sha256(bytes), bytes, record }
}

describe('the SET is signed', () => {
  const me = mintKeys()
  const business = sign64('business')
  const people = sign64('people')
  const club = sign64('club')

  const build = (): { host: LyingHost; record: HeadMapRecord; heads: Map<string, string> } => {
    const host = new LyingHost()
    const heads = new Map<string, string>()
    const rows: HeadMapPair[] = [business, people, club].map((molecule, i) => {
      const head = host.put(`page-${i}`)
      heads.set(molecule, head)
      return { molecule, claim: publishClaim(host, me, molecule, head, null, 0) }
    })
    return { host, record: canonicalHeadMap(me.pubkey, rows)!, heads }
  }

  it('TRUNCATION: a deploy with a page cut out of it is NOT the publisher’s', async () => {
    const { host, record } = build()
    const deps = { digest, verify: verifyEd25519, readClaim: strictReader(host), accept: acceptHeadClaim }
    const honest = deployOf(me, record)

    expect((await verifyDeploy(honest, me.pubkey, deps)).ok).toBe(true)

    // A stranger, holding no key, composes a smaller set out of the publisher's
    // own rows. Every row is genuinely signed; their ABSENCE used to be signed
    // by nobody, so the verdict was byte-identical to the truth.
    const cut = composeAs(me.pubkey, asPairs(record).filter((p) => p.molecule !== club))
    const verdict = await verifyDeploy(
      { sig: cut.sig, bytes: cut.bytes, attestation: honest.attestation }, me.pubkey, deps,
    )

    expect(verdict.ok).toBe(false)
    expect(verdict.reason).toBe('unattested')
    expect(verdict.reason).not.toBe((await verifyDeploy(honest, me.pubkey, deps)).reason)
    expect(verdict.verified).toEqual([])
  })

  it('THE EMPTY DEPLOY: “this publisher published nothing” needs their signature', async () => {
    const { host } = build()
    const deps = { digest, verify: verifyEd25519, readClaim: strictReader(host), accept: acceptHeadClaim }
    const empty = canonicalHeadMap(me.pubkey, [])!
    const bytes = encodeHeadMap(empty)

    const unsigned = await verifyDeploy({ sig: sha256(bytes), bytes, attestation: null }, me.pubkey, deps)
    expect(unsigned.ok).toBe(false)
    expect(unsigned.reason).toBe('unattested')

    // …and it is still a legitimate deploy when the publisher signs it: "I
    // publish nothing" is a statement they are allowed to make.
    const signed = await verifyDeploy(deployOf(me, empty), me.pubkey, deps)
    expect(signed.ok).toBe(true)
    expect(signed.verified).toEqual([])
    expect(signed.reason).toBeNull()
  })

  it('CHERRY-PICK: an old generation riding in a current map is refused before it renders', async () => {
    const host = new LyingHost()
    const deps = { digest, verify: verifyEd25519, readClaim: strictReader(host), accept: acceptHeadClaim }
    const genesis = publishClaim(host, me, people, sign64('gen-0'), null, 0)
    const current = publishClaim(host, me, people, sign64('gen-1'), sign64('gen-0'), 1)
    const other = publishClaim(host, me, business, sign64('gen-b'), null, 0)

    const live = canonicalHeadMap(me.pubkey, [
      { molecule: people, claim: current },
      { molecule: business, claim: other },
    ])!
    const liveDeploy = deployOf(me, live)
    const rolled = composeAs(me.pubkey, [
      { molecule: people, claim: genesis },
      { molecule: business, claim: other },
    ])

    const verdict = await verifyDeploy(
      { sig: rolled.sig, bytes: rolled.bytes, attestation: liveDeploy.attestation }, me.pubkey, deps,
    )
    expect(verdict.ok).toBe(false)
    expect(verdict.reason).toBe('unattested')

    // The rows really were all genuine, which is exactly why this could never
    // have been caught per row and needed a signature over the SET.
    const rows = await verifyHeadMapRows(rolled.record, me.pubkey, strictReader(host), acceptHeadClaim)
    expect(rows.rowsAuthentic).toBe(true)
    expect(rows.verified.find((r) => r.molecule === people)?.seq).toBe(0)

    // OPEN, PERMANENTLY: replaying the WHOLE older attested deploy. A signature
    // proves authorship and never recency, and `headMapRegressions` needs rows
    // the reader has ALREADY proven — a first-time visitor, the party this
    // scheme exists for, has none. What mitigates it is the freshness of the
    // POINTER, which is why the pointer must come from a source with a clock.
    const older = deployOf(me, canonicalHeadMap(me.pubkey, [{ molecule: people, claim: genesis }])!)
    const replayed = await verifyDeploy(older, me.pubkey, deps)
    expect(replayed.ok).toBe(true)
    expect(headMapRegressions([], replayed.verified)).toEqual([])
    expect(headMapRegressions([{ molecule: people, seq: 1 }], replayed.verified)).toHaveLength(1)
  })

  it('THE DEPLOY SIGNATURE IS CHECKED: other bytes at that address are forged', async () => {
    const { host, record } = build()
    const deps = { digest, verify: verifyEd25519, readClaim: strictReader(host), accept: acceptHeadClaim }
    const mine = deployOf(me, record)
    const empty = deployOf(me, canonicalHeadMap(me.pubkey, [])!)

    // Steps 0-1 of the documented recipe used to be owned by nobody: there was
    // no function anywhere that took a deploy signature, so a caller who
    // skipped them got no signal of any kind and the API gave them no place to
    // pass the one value that would have caught it.
    const verdict = await verifyDeploy(
      { sig: mine.sig, bytes: empty.bytes, attestation: empty.attestation }, me.pubkey, deps,
    )
    expect(verdict.reason).toBe('forged')
    expect(verdict.sig).toBe(mine.sig)
    expect(verdict.record).toBeNull() // refused before the bytes were even parsed
  })

  it('A DEPLOY WITH NO CONTENT BEHIND IT is a hole on every row it cannot reach', async () => {
    const { host, record, heads } = build()
    const deploy = deployOf(me, record)

    // `refs` is the record's self-declared closure and it carries CLAIMS; a
    // claim's `head` is not an edge and `prev` is a declared REFERENT, so a
    // replica built from the deploy's own closure holds the map and the claims
    // and NOT ONE BYTE of the hive. That part is design — a deploy names WHERE
    // the pages are and a reader pulls each head on demand. What was NOT design
    // is that it verified ok:true, byte-identical to a complete host.
    for (const head of heads.values()) host.omit.add(head)

    const pointersOnly = await verifyDeploy(deploy, me.pubkey, {
      digest, verify: verifyEd25519, readClaim: strictReader(host), accept: acceptHeadClaim,
    })
    expect(pointersOnly.ok).toBe(true) // the caller asked only about pointers

    const withContent = await verifyDeploy(deploy, me.pubkey, {
      digest,
      verify: verifyEd25519,
      readClaim: strictReader(host),
      accept: acceptHeadClaim,
      readHead: headReaderFor(host),
    })
    expect(withContent.ok).toBe(false)
    expect(withContent.reason).toBe('incomplete')
    expect([...new Set(withContent.holes.map((h) => h.reason))]).toEqual(['head-absent'])
    expect(() => host.list()).toThrow(/no directory branch/) // still no listing needed

    // FAILURE IS PER ROW: restore one page and that row verifies again.
    host.omit.delete(heads.get(business)!)
    const mixed = await verifyDeploy(deploy, me.pubkey, {
      digest,
      verify: verifyEd25519,
      readClaim: strictReader(host),
      accept: acceptHeadClaim,
      readHead: headReaderFor(host),
    })
    expect(mixed.verified.map((v) => v.molecule)).toEqual([business])
    expect(mixed.holes).toHaveLength(2)
  })

  it('A LYING HOST is reported as lying, not as cold, under an unchanged deploy', async () => {
    const host = new LyingHost()
    const genesis = publishClaim(host, me, people, sign64('gen-0'), null, 0)
    const current = publishClaim(host, me, people, sign64('gen-1'), sign64('gen-0'), 1)
    const record = canonicalHeadMap(me.pubkey, [{ molecule: people, claim: current }])!
    const deploy = deployOf(me, record)

    // GET /<current> answers with the bytes of /<genesis>.
    host.swap.set(current, genesis)

    // A reader written strictly to the old type omitted `sig` — and the
    // substituted row VERIFIED, downgrading a live page under a correctly
    // signed deploy whose signature never moved. `sig` is required now, and a
    // reader that reports nothing has proven nothing.
    const loose = await verifyDeploy(deploy, me.pubkey, {
      digest, verify: verifyEd25519, readClaim: looseReader(host), accept: acceptHeadClaim,
    })
    expect(loose.ok).toBe(false)
    expect(loose.holes.map((h) => h.reason)).toEqual(['unchecked'])

    // And the disciplined reader NAMES the lie instead of degrading to
    // "absent", which used to be indistinguishable from a host that is offline.
    const strict = await verifyDeploy(deploy, me.pubkey, {
      digest, verify: verifyEd25519, readClaim: strictReader(host), accept: acceptHeadClaim,
    })
    expect(strict.ok).toBe(false)
    expect(strict.holes.map((h) => h.reason)).toEqual(['mismatched'])

    // a genuinely absent byte is still `absent`, so the two stay separable
    host.swap.clear()
    host.omit.add(current)
    const cold = await verifyDeploy(deploy, me.pubkey, {
      digest, verify: verifyEd25519, readClaim: strictReader(host), accept: acceptHeadClaim,
    })
    expect(cold.holes.map((h) => h.reason)).toEqual(['absent'])

    // and my signature never moved throughout: this was always a downgrade of a
    // correctly-signed deploy, never a forged one.
    expect(sha256(encodeHeadMap(record))).toBe(deploy.sig)
  })
})
