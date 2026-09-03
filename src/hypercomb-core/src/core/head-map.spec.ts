// core/head-map.spec.ts
//
// The deploy signature is a signed head map. These tests are the four
// adversarial findings from `documentation/hypergraph-molecule-prototype-
// report.md` turned into assertions, plus the shape gates that keep the bytes
// a total function of the SET:
//
//   A / A2  entry-point independence — a shuffled enumeration of one set
//           encodes byte-identically, so a molecule has ONE deploy identity.
//   B       a stranger's row cannot enter the map, and a row whose claim was
//           minted under another key is a HOLE rather than a verified head.
//   H       verification touches `GET /<64hex>` and nothing else: the fixture
//           host has no listing verb at all.
//
// The acceptor is the REAL `acceptHeadClaim`, passed in as a parameter. That
// is deliberate: `head-map.ts` imports nothing, so its claim types are
// re-declared structurally, and this call is what pins the two together — if
// they ever drifted, this file would stop compiling.

import { describe, expect, it } from 'vitest'
import { createHash, generateKeyPairSync, sign as nodeSign, verify as nodeVerify, createPublicKey } from 'node:crypto'

import { acceptHeadClaim, headClaimPreimage } from './head-claim.js'
import {
  HEAD_MAP_KIND,
  HEAD_MAP_V1,
  canonicalHeadMap,
  encodeHeadMap,
  HEAD_MAP_MAX_BYTES,
  headMapAttestationPreimage,
  headMapClaimFor,
  headMapRefusal,
  headMapDiff,
  headMapRegressions,
  mergeHeadMap,
  parseHeadMap,
  splitHeadMap,
  verifyDeploy,
  verifyHeadMapRows,
  type HeadMapClaimReader,
  type HeadMapHeadReader,
  type HeadMapPair,
  type HeadMapRecord,
} from './head-map.js'

// ── a signer and a content-addressed pile of bytes ─────────────────────────

const sha256 = (bytes: Buffer | string): string =>
  createHash('sha256').update(bytes).digest('hex')

const sign64 = (text: string): string => sha256(Buffer.from(text, 'utf8'))

interface Identity {
  readonly pubkey: string
  readonly sign: (preimage: string) => string
}

const mintKeys = (): Identity => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const jwk = publicKey.export({ format: 'jwk' }) as { x: string }
  const pubkey = Buffer.from(jwk.x, 'base64url').toString('hex')
  return {
    pubkey,
    sign: (preimage) => nodeSign(null, Buffer.from(preimage, 'utf8'), privateKey).toString('hex'),
  }
}

/** The injected verifier. Never parses the preimage, never reads an identity
 *  out of the signature envelope. */
const verifyEd25519 = (pubkeyHex: string, preimage: string, sigHex: string): boolean => {
  if (!/^[0-9a-f]{64}$/.test(pubkeyHex)) return false
  if (!/^[0-9a-f]{128}$/.test(sigHex)) return false
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

/**
 * A CONTENT-ONLY HOST — the shape every static host actually has: `GET /<sig>`
 * and nothing else. There is deliberately NO listing verb: skeptic-4 H is the
 * finding that a sealed root could only be placed by a mutable, unsigned
 * readdir, so a verification path that reached for one would be assuming
 * infrastructure that does not exist.
 */
class ContentOnlyHost {
  readonly bytes = new Map<string, Buffer>()
  gets = 0

  put(text: string): string {
    const buf = Buffer.from(text, 'utf8')
    const sig = sha256(buf)
    this.bytes.set(sig, buf)
    return sig
  }

  get(sig: string): Buffer | null {
    this.gets++
    return this.bytes.get(sig) ?? null
  }

  list(): never {
    throw new Error('no directory branch')
  }
}

/** Mint a signed head claim and store its bytes by their own signature. */
const publishClaim = (
  host: ContentOnlyHost,
  identity: Identity,
  molecule: string,
  head: string,
  prev: string | null = null,
  seq = 0,
): { claimSig: string; head: string; prev: string | null; seq: number } => {
  const sig = identity.sign(headClaimPreimage(molecule, identity.pubkey, head, prev, seq))
  const body = JSON.stringify({ head, prev, seq, sig })
  return { claimSig: host.put(body), head, prev, seq }
}

/**
 * The reader a third party uses. It fetches BY SIGNATURE and asserts the hash
 * before parsing — that is the only integrity check the transport supplies, and
 * it is enough because the claim's own signature supplies the rest.
 */
const readerFor = (host: ContentOnlyHost): HeadMapClaimReader => async (claimSig) => {
  const bytes = host.get(claimSig)
  if (!bytes) return null
  try {
    const parsed = JSON.parse(bytes.toString('utf8')) as {
      head: string; prev: string | null; seq: number; sig: string
    }
    // REPORT WHAT ACTUALLY CAME BACK. Refusing on a mismatch instead would
    // collapse "this host answered with something else" into "this byte was
    // cold", and those are opposite facts about a host.
    return {
      offered: { head: parsed.head, prev: parsed.prev ?? null, seq: parsed.seq, sig: parsed.sig },
      verify: verifyEd25519,
      sig: sha256(bytes),
    }
  } catch {
    return null
  }
}

/** `GET /<headSig>` + hash check: does this row point at bytes that exist? */
const headReaderFor = (host: ContentOnlyHost): HeadMapHeadReader => async (headSig) => {
  const bytes = host.get(headSig)
  return !!bytes && sha256(bytes) === headSig
}

/** The publisher's detached signature over these exact deploy bytes. */
const attest = (identity: Identity, record: HeadMapRecord): {
  sig: string; bytes: string; attestation: string
} => {
  const bytes = encodeHeadMap(record)
  const sig = sha256(bytes)
  return { sig, bytes, attestation: identity.sign(headMapAttestationPreimage(identity.pubkey, sig)) }
}

const digest = async (text: string): Promise<string> => sha256(text)

const pairs = (record: HeadMapRecord): HeadMapPair[] =>
  record.rows.map(([molecule, claim]) => ({ molecule, claim }))

// ───────────────────────────────────────────────────────────────────────────

describe('canonical form', () => {
  const me = mintKeys()

  it('an EMPTY map is a legitimate deploy, not an error', () => {
    const record = canonicalHeadMap(me.pubkey, [])
    expect(record).not.toBeNull()
    expect(record!.rows).toEqual([])
    expect(record!.refs).toEqual([])
    const bytes = encodeHeadMap(record!)
    expect(bytes).toBe(
      `{"kind":"${HEAD_MAP_KIND}","v":${HEAD_MAP_V1},"pubkey":"${me.pubkey}","rows":[],"refs":[]}`,
    )
    // and it round-trips, so "I publish nothing" is a statement a reader can verify
    expect(parseHeadMap(bytes)).toEqual(record)
  })

  it('a SINGLE entry encodes exactly, round-trips, and answers by molecule', () => {
    const molecule = sign64('people')
    const claim = sign64('claim-1')
    const record = canonicalHeadMap(me.pubkey, [{ molecule, claim }])!
    expect(encodeHeadMap(record)).toBe(
      `{"kind":"${HEAD_MAP_KIND}","v":${HEAD_MAP_V1},"pubkey":"${me.pubkey}",` +
      `"rows":[["${molecule}","${claim}"]],"refs":["${claim}"]}`,
    )
    expect(parseHeadMap(encodeHeadMap(record))).toEqual(record)
    expect(headMapClaimFor(record, molecule)).toBe(claim)
    expect(headMapClaimFor(record, sign64('nothing'))).toBeNull()
  })

  it('ENTRY-POINT INDEPENDENCE: a shuffled enumeration of one set is byte-identical', () => {
    // skeptic-4 A2: `sealCut` cuts on the RECURSION PATH, so the same molecule
    // seals to two sigs depending on which door you came in. A canonical
    // representative of a SET cannot do that — there is no path.
    const input: HeadMapPair[] = ['gamma', 'alpha', 'beta', 'delta'].map((n) => ({
      molecule: sign64(n),
      claim: sign64(`claim:${n}`),
    }))
    const forward = canonicalHeadMap(me.pubkey, input)!
    const reverse = canonicalHeadMap(me.pubkey, [...input].reverse())!
    const shuffled = canonicalHeadMap(me.pubkey, [input[2]!, input[0]!, input[3]!, input[1]!])!

    expect(encodeHeadMap(forward)).toBe(encodeHeadMap(reverse))
    expect(encodeHeadMap(forward)).toBe(encodeHeadMap(shuffled))
    expect(sha256(encodeHeadMap(forward))).toBe(sha256(encodeHeadMap(shuffled)))

    // ordering is TOTAL and ascending on the molecule sig
    const molecules = forward.rows.map((r) => r[0])
    expect(molecules).toEqual([...molecules].sort())
    expect(forward.refs).toEqual([...forward.refs].sort())
  })

  it('a repeated molecule with a DIFFERENT claim refuses the whole map', () => {
    const molecule = sign64('people')
    expect(canonicalHeadMap(me.pubkey, [
      { molecule, claim: sign64('a') },
      { molecule, claim: sign64('b') },
    ])).toBeNull()
    // an identical repeat is a set, and collapses
    const same = canonicalHeadMap(me.pubkey, [
      { molecule, claim: sign64('a') },
      { molecule, claim: sign64('a') },
    ])!
    expect(same.rows).toHaveLength(1)
  })

  it('a MOLECULE THAT IS A MEMBER OF ITSELF is one row, never two', () => {
    // The name graph is cyclic by construction (skeptic-4 A). A set does not
    // care: `people` inside `people` is the same address, so it is one row.
    const molecule = sign64('people')
    const record = canonicalHeadMap(me.pubkey, [
      { molecule, claim: sign64('c') },
      { molecule, claim: sign64('c') },
    ])!
    expect(record.rows).toEqual([[molecule, sign64('c')]])
  })

  it('REFUSE-OR-PARSE: a second spelling of one set is refused, never re-read', () => {
    const a = sign64('a-molecule')
    const b = sign64('b-molecule')
    const record = canonicalHeadMap(me.pubkey, [
      { molecule: a, claim: sign64('ca') },
      { molecule: b, claim: sign64('cb') },
    ])!
    const canonical = encodeHeadMap(record)
    expect(parseHeadMap(canonical)).toEqual(record)

    const [lo, hi] = a < b ? [a, b] : [b, a]
    const loClaim = headMapClaimFor(record, lo)!
    const hiClaim = headMapClaimFor(record, hi)!

    // rows out of order — same meaning, different bytes: REFUSED
    expect(parseHeadMap(
      `{"kind":"${HEAD_MAP_KIND}","v":1,"pubkey":"${me.pubkey}",` +
      `"rows":[["${hi}","${hiClaim}"],["${lo}","${loClaim}"]],"refs":["${[loClaim, hiClaim].sort()[0]}","${[loClaim, hiClaim].sort()[1]}"]}`,
    )).toBeNull()
    // whitespace
    expect(parseHeadMap(`${canonical} `)).toBeNull()
    expect(parseHeadMap(JSON.stringify(JSON.parse(canonical), null, 2))).toBeNull()
    // an added field
    expect(parseHeadMap(canonical.replace('{"kind"', '{"at":1,"kind"'))).toBeNull()
    // a future version REFUSES rather than mis-parses
    expect(parseHeadMap(canonical.replace('"v":1', '"v":2'))).toBeNull()
    // garbage
    expect(parseHeadMap('not json')).toBeNull()
    expect(parseHeadMap('[]')).toBeNull()
  })

  it('encode REFUSES a record a reader could not parse back', () => {
    const a = sign64('a')
    const b = sign64('b')
    const [lo, hi] = a < b ? [a, b] : [b, a]
    const claim = sign64('c')
    expect(() => encodeHeadMap({
      kind: HEAD_MAP_KIND, v: HEAD_MAP_V1, pubkey: me.pubkey,
      rows: [[hi, claim], [lo, claim]], refs: [claim],
    })).toThrow(/not sorted/)
    expect(() => encodeHeadMap({
      kind: HEAD_MAP_KIND, v: HEAD_MAP_V1, pubkey: me.pubkey,
      rows: [[lo, claim]], refs: [],
    })).toThrow(/refs/)
    expect(() => encodeHeadMap({
      kind: HEAD_MAP_KIND, v: HEAD_MAP_V1, pubkey: 'not-a-key',
      rows: [], refs: [],
    } as unknown as HeadMapRecord)).toThrow(/canonical/)
  })

  it('NO CLOCK, NO HOST, NO ROUTE — an identical rebuild is the identical signature', () => {
    // This is what hands `mintBuildRecord`'s idempotence test back: a rebuild
    // that changed nothing must yield the same deploy sig, and it does because
    // there is no timestamp in the bytes to move.
    const set: HeadMapPair[] = [{ molecule: sign64('x'), claim: sign64('cx') }]
    const first = sha256(encodeHeadMap(canonicalHeadMap(me.pubkey, set)!))
    const later = sha256(encodeHeadMap(canonicalHeadMap(me.pubkey, [...set])!))
    expect(later).toBe(first)
  })
})

describe('the size gate is the SAME in both directions', () => {
  const me = mintKeys()

  const pairsOf = (n: number): HeadMapPair[] => {
    const out: HeadMapPair[] = []
    for (let i = 0; i < n; i++) out.push({ molecule: sign64(`m${i}`), claim: sign64(`c${i}`) })
    return out
  }

  it('a row costs 203 bytes, so the cap lands at exactly 20,660 molecules', () => {
    const at = encodeHeadMap(canonicalHeadMap(me.pubkey, pairsOf(20660))!)
    expect(at.length).toBeLessThanOrEqual(HEAD_MAP_MAX_BYTES)
    expect(parseHeadMap(at)).not.toBeNull()

    // ONE MORE TILE NAME used to lose not one molecule but EVERY molecule: the
    // encoder had no ceiling, the reader refused at 4 MiB, and the failure was
    // silent at mint time and total at read time. Same gate now, and it throws
    // where the publisher can see it rather than where a visitor cannot.
    expect(() => encodeHeadMap(canonicalHeadMap(me.pubkey, pairsOf(20661))!)).toThrow(RangeError)
  })

  it('the refusal says WHICH gate failed: "too big" is not "tampered with"', () => {
    const good = encodeHeadMap(canonicalHeadMap(me.pubkey, [
      { molecule: sign64('a'), claim: sign64('c') },
    ])!)
    expect(headMapRefusal(good)).toBeNull()
    expect(headMapRefusal('x'.repeat(HEAD_MAP_MAX_BYTES + 1))).toBe('oversize')
    expect(headMapRefusal('not json')).toBe('unparseable')
    expect(headMapRefusal(`${good} `)).toBe('non-canonical')
  })

  it('the cap is not a cliff: a SET splits, and the split is deterministic', () => {
    const record = canonicalHeadMap(me.pubkey, pairsOf(500))!

    const shards = splitHeadMap(record, 20_000)
    expect(shards.length).toBeGreaterThan(1)
    for (const shard of shards) {
      const bytes = encodeHeadMap(shard)
      expect(bytes.length).toBeLessThanOrEqual(20_000)
      expect(parseHeadMap(bytes)).toEqual(shard)
    }
    // every molecule survives, exactly once, and a re-split is identical
    const seen = shards.flatMap((s) => s.rows.map((r) => r[0]))
    expect(new Set(seen).size).toBe(500)
    expect(splitHeadMap(record, 20_000).map((s) => s.rows.length))
      .toEqual(shards.map((s) => s.rows.length))
    // a record that already fits is one shard
    expect(splitHeadMap(record)).toHaveLength(1)
  })
})

describe('composition (nothing is inferred from absence)', () => {
  const me = mintKeys()
  const other = mintKeys()
  const a = sign64('a')
  const b = sign64('b')

  it('merge is explicit in BOTH directions and refuses a foreign prior', () => {
    const prior = canonicalHeadMap(me.pubkey, [{ molecule: a, claim: sign64('c1') }])!
    const next = mergeHeadMap(prior, [{ molecule: b, claim: sign64('c2') }])
    expect(next.record!.rows).toHaveLength(2)
    // absence does NOT remove: a scoped re-mint that names only `b` keeps `a`
    expect(headMapClaimFor(next.record!, a)).toBe(sign64('c1'))
    // removal is NAMED
    const dropped = mergeHeadMap(next.record, [], { remove: [a] })
    expect(headMapClaimFor(dropped.record!, a)).toBeNull()
    expect(headMapClaimFor(dropped.record!, b)).toBe(sign64('c2'))
    // a different publisher's prior is not composable
    expect(mergeHeadMap(prior, [], { pubkey: other.pubkey }).record).toBeNull()
  })

  it('a merge REPORTS what it overwrote, so "silently" is not available', () => {
    const prior = canonicalHeadMap(me.pubkey, [{ molecule: a, claim: sign64('c1') }])!
    const merged = mergeHeadMap(prior, [{ molecule: a, claim: sign64('c2') }])
    expect(merged.record).not.toBeNull()
    expect(merged.replaced).toEqual([{ molecule: a, from: sign64('c1'), to: sign64('c2') }])
  })

  it('and REFUSES a downgrade the caller can prove, unless it says otherwise', () => {
    // `HeadMapPair` carried no `seq`, so the composition primitive could not
    // rank and did not try — while one level down `acceptHeadClaim` makes
    // staleness its central rule. A stranger's older row merged over a held
    // newer one used to win, silently. The pair may carry a `seq` now, and the
    // caller passes the generations it has already PROVEN.
    const held = canonicalHeadMap(me.pubkey, [{ molecule: a, claim: sign64('gen1') }])!
    const down = mergeHeadMap(held, [{ molecule: a, claim: sign64('gen0'), seq: 0 }], {
      held: [{ molecule: a, seq: 1 }],
    })
    expect(down.record).toBeNull()
    expect(down.regressed).toEqual([{ molecule: a, heldSeq: 1, offeredSeq: 0 }])

    const forced = mergeHeadMap(held, [{ molecule: a, claim: sign64('gen0'), seq: 0 }], {
      held: [{ molecule: a, seq: 1 }],
      allowRegression: true,
    })
    expect(forced.record).not.toBeNull()
    expect(forced.regressed).toHaveLength(1) // reported even when allowed
  })

  it('diff answers WHICH MOLECULE moved, not merely "different"', () => {
    const before = canonicalHeadMap(me.pubkey, [
      { molecule: a, claim: sign64('c1') },
      { molecule: b, claim: sign64('c2') },
    ])!
    const after = canonicalHeadMap(me.pubkey, [
      { molecule: a, claim: sign64('c1') },
      { molecule: sign64('c'), claim: sign64('c3') },
    ])!
    expect(headMapDiff(before, after)).toEqual({
      added: [sign64('c')],
      removed: [b],
      moved: [],
      unchanged: [a],
    })
  })
})

describe('third-party verification, with no directory listing anywhere', () => {
  it('verifies a whole deploy from immutable atoms fetched BY SIGNATURE (skeptic-4 H)', async () => {
    const host = new ContentOnlyHost()
    const me = mintKeys()

    const business = sign64('business')
    const people = sign64('people')
    const alice = sign64('alice')

    const heads = [business, people, alice].map((_, i) => host.put(`succession-${i}`))
    const rows = [business, people, alice].map((molecule, i) =>
      publishClaim(host, me, molecule, heads[i]!, null, 0))

    const record = canonicalHeadMap(me.pubkey, [
      { molecule: business, claim: rows[0]!.claimSig },
      { molecule: people, claim: rows[1]!.claimSig },
      { molecule: alice, claim: rows[2]!.claimSig },
    ])!
    // the deploy: the map atom's own content sig, plus the publisher's
    // signature over it — the SET is signed, not only each row.
    const offer = attest(me, record)
    host.put(offer.bytes)

    // ── the third party holds (pubkey, deploySig, attestation) and a host ──
    const verdict = await verifyDeploy(
      { sig: offer.sig, bytes: host.get(offer.sig)!.toString('utf8'), attestation: offer.attestation },
      me.pubkey,
      {
        digest,
        verify: verifyEd25519,
        readClaim: readerFor(host),
        accept: acceptHeadClaim,
        readHead: headReaderFor(host),
      },
    )
    expect(verdict.ok).toBe(true)
    expect(verdict.attested).toBe(true)
    expect(verdict.reason).toBeNull()
    expect(verdict.holes).toEqual([])
    expect(verdict.sig).toBe(offer.sig)
    expect(verdict.verified.map((v) => v.molecule).sort()).toEqual([business, people, alice].sort())

    // and NOT ONE listing was needed — the host has no listing verb at all
    expect(() => host.list()).toThrow(/no directory branch/)
    expect(host.gets).toBeGreaterThan(0)
  })

  it('THE SET IS SIGNED: a truncation of my own genuine rows is refused, before any fetch', async () => {
    const host = new ContentOnlyHost()
    const me = mintKeys()
    const stranger = mintKeys()
    const business = sign64('business')
    const finance = sign64('finance')

    const record = canonicalHeadMap(me.pubkey, [
      { molecule: business, claim: publishClaim(host, me, business, sign64('hb'), null, 0).claimSig },
      { molecule: finance, claim: publishClaim(host, me, finance, sign64('hf'), null, 0).claimSig },
    ])!
    const honest = attest(me, record)
    const deps = { digest, verify: verifyEd25519, readClaim: readerFor(host), accept: acceptHeadClaim }
    expect((await verifyDeploy(honest, me.pubkey, deps)).ok).toBe(true)

    // A stranger, holding no key of mine, composes a smaller set out of my own
    // rows. Every surviving row is genuinely, unmodifiably mine.
    const cut = canonicalHeadMap(me.pubkey, pairs(record).filter((p) => p.molecule !== finance))!
    const cutBytes = encodeHeadMap(cut)
    const cutSig = sha256(cutBytes)

    host.gets = 0
    for (const attestation of [
      null,
      honest.attestation, // my genuine one, lifted — `mapSig` is line three
      stranger.sign(headMapAttestationPreimage(me.pubkey, cutSig)), // theirs — `pubkey` is line two
    ]) {
      const verdict = await verifyDeploy({ sig: cutSig, bytes: cutBytes, attestation }, me.pubkey, deps)
      expect(verdict.ok).toBe(false)
      expect(verdict.attested).toBe(false)
      expect(verdict.reason).toBe('unattested')
      expect(verdict.verified).toEqual([])
    }
    expect(host.gets).toBe(0) // refused before a byte was spent on it

    // THE EMPTY DEPLOY is still legitimate when the publisher signs it: "I
    // publish nothing" is a statement they are allowed to make.
    const empty = attest(me, canonicalHeadMap(me.pubkey, [])!)
    expect((await verifyDeploy(empty, me.pubkey, deps)).ok).toBe(true)

    // AND THE ROWS DOOR STILL ANSWERS THE WEAKER QUESTION — with a verdict that
    // has no `ok` field, so it cannot be mistaken for the stronger one.
    const rowsVerdict = await verifyHeadMapRows(cut, me.pubkey, readerFor(host), acceptHeadClaim)
    expect(rowsVerdict.rowsAuthentic).toBe(true)
    expect('ok' in rowsVerdict).toBe(false)
  })

  it('THE BYTES ARE THE ONES NAMED: other bytes at a deploy address are forged', async () => {
    const host = new ContentOnlyHost()
    const me = mintKeys()
    const molecule = sign64('people')
    const row = publishClaim(host, me, molecule, sign64('h'), null, 0)
    const mine = attest(me, canonicalHeadMap(me.pubkey, [{ molecule, claim: row.claimSig }])!)
    const other = attest(me, canonicalHeadMap(me.pubkey, [])!)
    const deps = { digest, verify: verifyEd25519, readClaim: readerFor(host), accept: acceptHeadClaim }

    const verdict = await verifyDeploy(
      { sig: mine.sig, bytes: other.bytes, attestation: other.attestation },
      me.pubkey, deps,
    )
    expect(verdict.reason).toBe('forged')
    // this is the step the module used to have NO function for: nothing
    // anywhere took a deploy signature, so nothing could check it.
    expect(verdict.sig).toBe(mine.sig)
  })

  it('a deploy verified against the WRONG expected key is forged before a byte is trusted', async () => {
    const host = new ContentOnlyHost()
    const me = mintKeys()
    const stranger = mintKeys()
    const molecule = sign64('people')
    const row = publishClaim(host, me, molecule, sign64('h'), null, 0)
    const offer = attest(me, canonicalHeadMap(me.pubkey, [{ molecule, claim: row.claimSig }])!)

    host.gets = 0
    const verdict = await verifyDeploy(offer, stranger.pubkey, {
      digest, verify: verifyEd25519, readClaim: readerFor(host), accept: acceptHeadClaim,
    })
    expect(verdict.ok).toBe(false)
    expect(verdict.reason).toBe('forged')
    expect(host.gets).toBe(0) // refused before any fetch
  })

  it('A TAMPERED ENTRY is a hole, and only that row — and it names the host lying', async () => {
    const host = new ContentOnlyHost()
    const me = mintKeys()
    const good = sign64('good')
    const bad = sign64('bad')
    const okRow = publishClaim(host, me, good, sign64('h1'), null, 0)
    const badRow = publishClaim(host, me, bad, sign64('h2'), null, 0)

    // Flip one hex digit inside the stored claim's signature. The body still
    // parses, so this is precisely the case a reader must NOT collapse into
    // "cold": the host answered a GET with bytes that are a different atom.
    const bytes = Buffer.from(host.bytes.get(badRow.claimSig)!)
    bytes[bytes.length - 4] = bytes[bytes.length - 4] === 0x61 ? 0x62 : 0x61
    host.bytes.set(badRow.claimSig, bytes)
    expect(() => JSON.parse(bytes.toString('utf8'))).not.toThrow()

    const record = canonicalHeadMap(me.pubkey, [
      { molecule: good, claim: okRow.claimSig },
      { molecule: bad, claim: badRow.claimSig },
    ])!
    const verdict = await verifyHeadMapRows(record, me.pubkey, readerFor(host), acceptHeadClaim)
    expect(verdict.rowsAuthentic).toBe(false)
    expect(verdict.reason).toBe('incomplete')
    // FAILURE IS PER ROW: the honest row still verifies
    expect(verdict.verified.map((v) => v.molecule)).toEqual([good])
    // `mismatched`, not `absent`: a lying host and an offline one are different
    // facts, and collapsing them is how a downgrade went unnoticed.
    expect(verdict.holes).toEqual([{ molecule: bad, claim: badRow.claimSig, reason: 'mismatched' }])
  })

  it('A ROW MOVED TO ANOTHER MOLECULE stops verifying: the address is in the preimage', async () => {
    const host = new ContentOnlyHost()
    const me = mintKeys()
    const a = sign64('alpha')
    const b = sign64('beta')
    const rowA = publishClaim(host, me, a, sign64('ha'), null, 0)
    const rowB = publishClaim(host, me, b, sign64('hb'), null, 0)

    // swap two of MY OWN rows — both claims are genuinely mine and genuinely
    // signed, and both still refuse, because the molecule the reader walked to
    // is line two of the preimage it rebuilds.
    const record = canonicalHeadMap(me.pubkey, [
      { molecule: a, claim: rowB.claimSig },
      { molecule: b, claim: rowA.claimSig },
    ])!
    const verdict = await verifyHeadMapRows(record, me.pubkey, readerFor(host), acceptHeadClaim)
    expect(verdict.rowsAuthentic).toBe(false)
    expect(verdict.verified).toEqual([])
    expect(verdict.holes.map((h) => h.reason)).toEqual(['unsigned', 'unsigned'])
  })

  it('A MOLECULE THE PUBLISHER DOES NOT OWN is a hole, never a verified head (skeptic-4 B)', async () => {
    const host = new ContentOnlyHost()
    const me = mintKeys()
    const stranger = mintKeys()
    const mine = sign64('business')
    const theirs = sign64('people')

    const myRow = publishClaim(host, me, mine, sign64('h-mine'), null, 0)
    // the stranger's genuine head in the SAME global molecule, on the same host
    const theirRow = publishClaim(host, stranger, theirs, sign64('h-theirs'), null, 0)

    // an honest map: it names only what I head. A stranger committing to
    // `sign('people')` changes nothing here — my bytes do not move.
    const honest = canonicalHeadMap(me.pubkey, [{ molecule: mine, claim: myRow.claimSig }])!
    const before = sha256(encodeHeadMap(honest))
    const after = sha256(encodeHeadMap(canonicalHeadMap(me.pubkey, pairs(honest))!))
    expect(after).toBe(before)
    expect((await verifyHeadMapRows(honest, me.pubkey, readerFor(host), acceptHeadClaim)).rowsAuthentic)
      .toBe(true)

    // a map that reaches for someone else's bucket cannot pass it off as mine
    const overreach = canonicalHeadMap(me.pubkey, [
      { molecule: mine, claim: myRow.claimSig },
      { molecule: theirs, claim: theirRow.claimSig },
    ])!
    const verdict = await verifyHeadMapRows(overreach, me.pubkey, readerFor(host), acceptHeadClaim)
    expect(verdict.rowsAuthentic).toBe(false)
    expect(verdict.verified.map((v) => v.molecule)).toEqual([mine])
    expect(verdict.holes).toEqual([{ molecule: theirs, claim: theirRow.claimSig, reason: 'unsigned' }])
  })

  it('a reader that does not SAY what it fetched has proven nothing', async () => {
    const host = new ContentOnlyHost()
    const me = mintKeys()
    const molecule = sign64('people')
    const row = publishClaim(host, me, molecule, sign64('h'), null, 0)
    const record = canonicalHeadMap(me.pubkey, [{ molecule, claim: row.claimSig }])!

    // `sig` used to be OPTIONAL and to say nothing about hashing, so a reader
    // written strictly to the type omitted it — and a host answering with the
    // publisher's own older claim downgraded a live row under an unchanged
    // deploy signature. Silence is not consent.
    const silent = (async () => ({
      offered: { head: sign64('h'), prev: null, seq: 0, sig: 'ff'.repeat(64) },
      verify: verifyEd25519,
    })) as unknown as HeadMapClaimReader
    expect((await verifyHeadMapRows(record, me.pubkey, silent, acceptHeadClaim)).holes.map((h) => h.reason))
      .toEqual(['unchecked'])

    const lyingReader: HeadMapClaimReader = async () => ({
      offered: { head: sign64('h'), prev: null, seq: 0, sig: 'ff'.repeat(64) },
      verify: verifyEd25519,
      sig: sign64('some-other-atom'),
    })
    expect((await verifyHeadMapRows(record, me.pubkey, lyingReader, acceptHeadClaim)).holes.map((h) => h.reason))
      .toEqual(['mismatched'])
  })

  it('A DEPLOY THAT NAMES NO CONTENT is a hole on every row it cannot reach', async () => {
    // `refs` carries CLAIMS, and a claim's `head` is neither an edge nor a
    // referent, so a replica built from the deploy's own declared closure holds
    // the map and the claims and NOT ONE BYTE of the hive — and used to verify
    // ok:true, byte-identical to the verdict over a complete host.
    const host = new ContentOnlyHost()
    const me = mintKeys()
    const a = sign64('a')
    const b = sign64('b')
    const headA = host.put('page-a')
    const rowA = publishClaim(host, me, a, headA, null, 0)
    const rowB = publishClaim(host, me, b, sign64('never-stored'), null, 0)
    const offer = attest(me, canonicalHeadMap(me.pubkey, [
      { molecule: a, claim: rowA.claimSig }, { molecule: b, claim: rowB.claimSig },
    ])!)

    const withoutHeads = await verifyDeploy(offer, me.pubkey, {
      digest, verify: verifyEd25519, readClaim: readerFor(host), accept: acceptHeadClaim,
    })
    expect(withoutHeads.ok).toBe(true) // pointers only: what the caller asked

    const withHeads = await verifyDeploy(offer, me.pubkey, {
      digest,
      verify: verifyEd25519,
      readClaim: readerFor(host),
      accept: acceptHeadClaim,
      readHead: headReaderFor(host),
    })
    expect(withHeads.ok).toBe(false)
    expect(withHeads.verified.map((v) => v.molecule)).toEqual([a]) // per row, as always
    expect(withHeads.holes).toEqual([{ molecule: b, claim: rowB.claimSig, reason: 'head-absent' }])
  })
})

describe('a replayed older map', () => {
  const me = mintKeys()

  it('is caught PER ROW on the author\'s own signed counter, not on the map', async () => {
    const host = new ContentOnlyHost()
    const molecule = sign64('notes')

    const gen0 = publishClaim(host, me, molecule, sign64('h0'), null, 0)
    const gen1 = publishClaim(host, me, molecule, sign64('h1'), sign64('h0'), 1)
    const gen2 = publishClaim(host, me, molecule, sign64('h2'), sign64('h1'), 2)

    const old = attest(me, canonicalHeadMap(me.pubkey, [{ molecule, claim: gen0.claimSig }])!)
    const current = attest(me, canonicalHeadMap(me.pubkey, [{ molecule, claim: gen2.claimSig }])!)
    const deps = { digest, verify: verifyEd25519, readClaim: readerFor(host), accept: acceptHeadClaim }

    // BOTH deploys verify — and that is correct, and is the whole point. Every
    // byte of the old one is genuinely signed by me for this exact address, and
    // I really did sign that set, so a host replaying it FORGES NOTHING and a
    // verifier must not call it forged. THE ATTESTATION CHANGES NOTHING HERE,
    // deliberately: a signature proves authorship and never recency.
    const oldVerdict = await verifyDeploy(old, me.pubkey, deps)
    const nowVerdict = await verifyDeploy(current, me.pubkey, deps)
    expect(oldVerdict.ok).toBe(true)
    expect(nowVerdict.ok).toBe(true)

    // What separates them is inside the SIGNATURE: `seq`, line six of the
    // claim preimage, which cannot be raised without the secret. A reader that
    // has once seen generation 2 can never be talked back down to 0.
    expect(headMapRegressions(nowVerdict.verified, oldVerdict.verified)).toEqual([
      { molecule, heldSeq: 2, offeredSeq: 0 },
    ])
    // and forwards is not a regression
    expect(headMapRegressions(oldVerdict.verified, nowVerdict.verified)).toEqual([])

    // a molecule the reader has never held is not a regression either — absence
    // is not evidence
    expect(headMapRegressions(nowVerdict.verified, [{ molecule: sign64('other'), seq: 0 }])).toEqual([])

    // OPEN, AND PERMANENTLY SO: a COLD reader holds nothing to compare, so a
    // replayed older attested deploy is invisible to a first-time visitor. No
    // signature closes that — the freshness of the POINTER is what does, which
    // is why the pointer must come from a source with a clock (in the shipped
    // app, the relay's `created_at` monotonicity on the kind-30564 event).
    expect(headMapRegressions([], oldVerdict.verified)).toEqual([])
    void gen1
  })
})
