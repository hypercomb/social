// core/mathematically-backed-truth.spec.ts
//
// THE EXPERIMENTS behind documentation/mathematically-backed-truth-research.md.
//
// jwize's theory (2026-11-04): a claim the hive makes about its pools of
// meaning and its categorized signatures is ROCK SOLID when mathematics backs
// it — when anyone holding the inputs recomputes the same answer and has to
// trust nobody. Each experiment below is one such claim, run against the
// primitives the hive actually ships (never a model where the real thing
// exists), with an INDEPENDENT verifier (node:crypto, which knows nothing of
// the hive) wherever the claim is "a stranger would get the same answer". The
// research document carries the hypothesis, the prediction and the recorded
// result for every experiment id used here.
//
// Nothing here is hardcoded hex: every expected signature is derived, so the
// doctrine ratchet on 64-hex literals stays tight and the spec obeys P2.

import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { SignatureService } from './signature.service.js'
import {
  BARE_WORD_POOL_MEANINGS,
  isPoolAddress,
  poolMeaningOf,
  registerPoolMeaning,
  spellPoolMeaning,
} from './pool-registry.js'
import { groupPreimage, groupSignature } from './group-signature.js'
import { canonicalizeLineageSegment, lineageKey, standardName } from './lineage-key.js'
import {
  facetAddress,
  isReservedPoolWord,
  moleculeAddress,
  moleculeKey,
  rootMoleculeAddress,
} from './molecule-address.js'
import { canonicalLayerJson, type CanonicalLayerContent } from './canonical-layer.js'
import { mintMetaEnvelope } from './life-primitive.js'
import { headClaimPreimage, parseHeadClaimPreimage, resolveBucketHead } from './head-claim.js'
import { derivedMeaning } from './derivation.js'

// ── the two verifiers ──────────────────────────────────────────────────────

const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text)
const asBuffer = (bytes: Uint8Array): ArrayBuffer =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer

/** The hive's own signer — the one chokepoint every address goes through. */
const hive = (bytes: Uint8Array): Promise<string> => SignatureService.sign(asBuffer(bytes))
const hiveText = (text: string): Promise<string> => hive(utf8(text))

/** The stranger's verifier: not the hive's code, not its memo, not its registry. */
const stranger = (bytes: Uint8Array | string): string =>
  createHash('sha256').update(bytes).digest('hex')

// ── reproducible randomness: same seed, same experiment ───────────────────

const prng = (seed: number): (() => number) => {
  let s = (seed >>> 0) || 1
  return () => {
    s ^= s << 13; s >>>= 0
    s ^= s >>> 17
    s ^= s << 5; s >>>= 0
    return s
  }
}
const randomBytes = (next: () => number, n: number): Uint8Array => {
  const out = new Uint8Array(n)
  for (let i = 0; i < n; i++) out[i] = next() & 0xff
  return out
}
const popcount = (x: number): number => { let c = 0; while (x) { c += x & 1; x >>>= 1 } return c }
const bitsDiffering = (a: string, b: string): number => {
  let d = 0
  for (let i = 0; i < a.length; i += 2) d += popcount(parseInt(a.slice(i, i + 2), 16) ^ parseInt(b.slice(i, i + 2), 16))
  return d
}

// ── the seal: the canonical bytes of a SET ─────────────────────────────────
//
// Unique members, sorted, one per line. Insertion order, arrival order and
// which replica wrote them are not in the bytes, so they are not in the
// signature. This is the smallest model of "an enumeration minted as an
// atom" (head-map.ts) — the experiments ask what it proves that a readdir
// cannot.

const sealBytes = (members: Iterable<string>): string => [...new Set(members)].sort().join('\n')
const seal = (members: Iterable<string>): Promise<string> => hiveText(sealBytes(members))

const SIGNATURE = /^[0-9a-f]{64}$/

/** Names the way they really arrive: typed, pasted, translated, emoji. */
const NAMES = [
  'My Tile', 'my-tile', '  café  ', 'Chapter 1', '日本語', 'a—b', 'a b', '“quoted”',
  '🙂', ':', 'AB-CD', 'ABCD', 'games:solomon:talk', 'cigar:brand', 'people/places', 'x__y', '',
]

// ═══════════════════════════════════════════════════════════════════════════

describe('E1 identity: a stranger recomputes the same signature (I1)', () => {
  it('SignatureService.sign agrees with an independent sha256 on every byte string tried', async () => {
    const next = prng(1)
    const samples = [
      utf8(''), utf8('hypercomb'), utf8('日本語 🙂'),
      randomBytes(next, 1), randomBytes(next, 4096), randomBytes(next, 65536),
    ]
    for (const bytes of samples) expect(await hive(bytes)).toBe(stranger(bytes))
  })

  it('the empty document is the root address, and both verifiers derive it', async () => {
    expect(await rootMoleculeAddress()).toBe(stranger(''))
    expect(await hiveText('')).toBe(stranger(''))
  })

  it('same bytes, same signature; one byte more, another signature; the old one stays what it was', async () => {
    const before = await hiveText('a tile body')
    expect(await hiveText('a tile body')).toBe(before)
    expect(await hiveText('a tile body.')).not.toBe(before)
    expect(await hiveText('a tile body')).toBe(before)
  })
})

describe('E2 address: a pool, a group, a molecule and a facet are recomputable from the word alone (P1, P2, A3, N1)', () => {
  it('every frozen bare-word pool is sha256(word) to a stranger who never loaded the registry', async () => {
    for (const meaning of BARE_WORD_POOL_MEANINGS) {
      expect(await registerPoolMeaning(meaning), meaning).toBe(stranger(meaning))
    }
  })

  it('a colon meaning too, and the registry answers the inverse question', async () => {
    const sig = await registerPoolMeaning('websites:menu')
    expect(sig).toBe(stranger('websites:menu'))
    expect(await isPoolAddress(sig)).toBe(true)
    expect(await poolMeaningOf(sig)).toBe('websites:menu')
  })

  it('a group is sha256("group:" + meaning); a molecule is sha256 of the folded word; a facet is sha256(plural:subject)', async () => {
    expect(await groupSignature(' tutorial:course:beginner ')).toBe(stranger('group:tutorial:course:beginner'))
    expect(groupPreimage('x')).toBe('group:x')
    expect(await moleculeAddress('People')).toBe(stranger('people'))
    expect(await moleculeAddress('People')).toBe(stranger(moleculeKey('People')))
    const subject = await hiveText('a subject')
    expect(await facetAddress('notes', subject)).toBe(stranger(`notes:${subject}`))
  })
})

describe('E3 avalanche: tampering is never subtle', () => {
  it('flipping one input bit changes about half of the 256 output bits, every single time', async () => {
    const next = prng(3)
    const trials = 256
    let total = 0
    let min = 256
    for (let t = 0; t < trials; t++) {
      const a = randomBytes(next, 64)
      const b = new Uint8Array(a)
      const bit = next() % (64 * 8)
      b[bit >> 3] ^= 1 << (bit & 7)
      const d = bitsDiffering(await hive(a), await hive(b))
      total += d
      if (d < min) min = d
    }
    const mean = total / trials
    console.info(`[E3] ${trials} single-bit flips: mean ${mean.toFixed(2)} of 256 output bits differ, minimum ${min}`)
    expect(min).toBeGreaterThan(80)
    expect(mean).toBeGreaterThan(120)
    expect(mean).toBeLessThan(136)
  })
})

describe('E4 the birthday bound: the number behind "rock solid"', () => {
  it('a collision among 10^18 atoms has probability below 10^-40; even odds need about 2^128 atoms', () => {
    const collisionProbability = (atoms: number): number => (atoms * atoms) / 2 ** 257
    expect(collisionProbability(1e18)).toBeLessThan(1e-40)
    const atomsForEvenOdds = Math.sqrt(2 ** 257 * 0.5)
    expect(atomsForEvenOdds / 2 ** 128).toBeCloseTo(1, 6)
    console.info(`[E4] p(collision | 10^18 atoms) ≈ ${collisionProbability(1e18).toExponential(2)}; even odds at ≈ ${atomsForEvenOdds.toExponential(2)} atoms`)
  })
})

describe('E5 canonical folds are fixed points: a spelling spelled again is itself', () => {
  const folds: Record<string, (raw: unknown) => string> = {
    standardName, canonicalizeLineageSegment, moleculeKey, spellPoolMeaning,
  }

  it('each fold is idempotent over a corpus of hostile names', () => {
    for (const [label, fold] of Object.entries(folds)) {
      for (const name of NAMES) {
        const once = fold(name)
        expect(fold(once), `${label}(${JSON.stringify(name)})`).toBe(once)
      }
    }
  })

  it('lineageKey of a lineageKey is itself', () => {
    for (const name of NAMES) {
      const once = lineageKey([name])
      expect(lineageKey([once]), JSON.stringify(name)).toBe(once)
    }
  })

  it('equivalent spellings converge; distinct words never merge', () => {
    expect(moleculeKey('My Tile')).toBe(moleculeKey('my-tile'))
    expect(standardName('Chapter 1')).toBe('chapter-1')
    expect(moleculeKey('AB-CD')).not.toBe(moleculeKey('ABCD'))
    expect(moleculeKey('chapter 1')).not.toBe(moleculeKey('chapter 2'))
  })
})

describe('E6 the bag/pool collision is arithmetic, and so is the fence around it (P3, P4)', () => {
  it('a root tile named "bees" would address the bee pool: sha256 of the very same preimage', async () => {
    expect(await hiveText(lineageKey(['bees']))).toBe(await registerPoolMeaning('bees'))
    expect(isReservedPoolWord('Bees')).toBe(true)
    expect(isReservedPoolWord('websites')).toBe(false)
  })

  it('a tile preimage either has no colon or has no letters and digits, so no family:name pool is reachable from the tile tree', async () => {
    const next = prng(6)
    const probes = [
      ...NAMES, 'websites:menu', 'system:threads', 'group:x', '::', 'a:b',
      ...Array.from({ length: 200 }, () => String.fromCharCode(...randomBytes(next, 12))),
    ]
    const menu = await registerPoolMeaning('websites:menu')
    const carriesLettersOrDigits = /[\p{L}\p{N}]/u
    for (const probe of probes) {
      for (const key of [lineageKey([probe]), moleculeKey(probe)]) {
        const safe = !key.includes(':') || !carriesLettersOrDigits.test(key)
        expect(safe, `${JSON.stringify(probe)} → ${JSON.stringify(key)}`).toBe(true)
        expect(await hiveText(key)).not.toBe(menu)
      }
    }
    expect(groupPreimage('anything')).toContain(':')
  })
})

describe('E7 composition is transitive: a change anywhere below re-signs everything above, and nothing else (L1, L2, A6)', () => {
  const layerSig = (layer: CanonicalLayerContent): Promise<string> => hiveText(canonicalLayerJson(layer))

  it('a grandchild edit re-signs its ancestors; the untouched sibling keeps its signature (dedup for free)', async () => {
    const leaf = await layerSig({ name: 'leaf', note: await hiveText('a note') })
    const other = await layerSig({ name: 'other' })
    const child = await layerSig({ name: 'child', children: [leaf] })
    const sibling = await layerSig({ name: 'sibling', children: [other] })
    const root = await layerSig({ name: 'root', children: [child, sibling] })

    const leafEdited = await layerSig({ name: 'leaf', note: await hiveText('a note, edited') })
    const childAfter = await layerSig({ name: 'child', children: [leafEdited] })
    const siblingAfter = await layerSig({ name: 'sibling', children: [other] })
    const rootAfter = await layerSig({ name: 'root', children: [childAfter, siblingAfter] })

    expect(leafEdited).not.toBe(leaf)
    expect(childAfter).not.toBe(child)
    expect(rootAfter).not.toBe(root)
    expect(siblingAfter).toBe(sibling)
  })

  it('the canonical layer form forgets insertion order and empties, so one state is one signature', async () => {
    const a = canonicalLayerJson({ name: 'x', zeta: 1, alpha: ['k'], empty: [], nothing: {}, gone: undefined })
    const b = canonicalLayerJson({ alpha: ['k'], name: 'x', zeta: 1 })
    expect(a).toBe(b)
    expect(await hiveText(a)).toBe(await hiveText(b))
  })

  it('the order of children is content: swapping two children is another layer (children is ordered)', async () => {
    const a = await hiveText('a')
    const b = await hiveText('b')
    expect(await layerSig({ name: 'p', children: [a, b] })).not.toBe(await layerSig({ name: 'p', children: [b, a] }))
  })

  it('a meta envelope has one byte form however its fields were given, and is one hop from its payload', async () => {
    const payload = await hiveText('payload')
    const first = JSON.stringify(mintMetaEnvelope({ relation: 'cells', layer: payload, at: 5 }))
    const second = JSON.stringify(mintMetaEnvelope({ at: 5, layer: payload, relation: 'cells' }))
    expect(first).toBe(second)
    expect(await hiveText(first)).not.toBe(payload)
  })
})

describe('E8 location never enters identity; the name is checked against the bytes (S2, S3)', () => {
  it('the same bytes under two roots have one name; moving them is not an identity event', async () => {
    const bytes = utf8('the same picture')
    const rootA = new Map<string, Uint8Array>()
    const rootB = new Map<string, Uint8Array>()
    const sig = await hive(bytes)
    rootA.set(sig, bytes)
    rootB.set(sig, bytes)
    expect([...rootA.keys()]).toEqual([...rootB.keys()])
    const moved = rootA.get(sig)!
    rootA.delete(sig)
    rootB.set(await hive(moved), moved)
    expect(rootB.size).toBe(1)
  })

  it('bytes whose name is not their hash are refused before write, and the stranger refuses them too', async () => {
    const bytes = utf8('served by a hostile host')
    const claimed = await hiveText('what the host said it was')
    const admit = async (name: string, b: Uint8Array): Promise<boolean> =>
      (await hive(b)) === name && stranger(b) === name
    expect(await admit(claimed, bytes)).toBe(false)
    expect(await admit(await hive(bytes), bytes)).toBe(true)
  })
})

describe('E9 categorization: a listing is a replica fact; a mark or a seal is a mathematical one (P6, A3, N5)', () => {
  it('two replicas holding the same members can list them differently, and a third with one more looks just as valid', async () => {
    const [m1, m2, m3, m4] = await Promise.all(['m1', 'm2', 'm3', 'm4'].map(hiveText)) as [string, string, string, string]
    const replicaA = [m1, m2, m3]
    const replicaB = [m3, m1, m2]
    const replicaC = [m3, m1, m2, m4]
    expect(replicaA).not.toEqual(replicaB)
    expect(new Set(replicaA)).toEqual(new Set(replicaB))
    for (const listing of [replicaA, replicaB, replicaC]) {
      expect(listing.every(s => SIGNATURE.test(s))).toBe(true)
    }
    expect(await seal(replicaA)).toBe(await seal(replicaB))
    expect(await seal(replicaC)).not.toBe(await seal(replicaA))
    expect(await seal(replicaA)).toBe(stranger(sealBytes(replicaB)))
  })

  it('a mark inside the member is categorization that travels: it is verified by hashing the member alone', async () => {
    const group = await groupSignature('style:christmas')
    const marked = canonicalLayerJson({
      name: 'menu',
      decorations: [{ kind: 'group', appliesTo: [], payload: { sig: group, meaning: 'style:christmas' } }],
    })
    const bare = canonicalLayerJson({ name: 'menu' })
    expect(await hiveText(marked)).not.toBe(await hiveText(bare))

    const wears = (bytes: string, meaning: string): boolean => {
      const layer = JSON.parse(bytes) as { decorations?: Array<{ kind: string; payload: { sig: string } }> }
      return (layer.decorations ?? []).some(d => d.kind === 'group' && d.payload.sig === stranger(`group:${meaning}`))
    }
    expect(wears(marked, 'style:christmas')).toBe(true)
    expect(wears(bare, 'style:christmas')).toBe(false)
  })
})

describe('E10 a pool under union is a join-semilattice: replica order never matters. Overwrite is not.', () => {
  const sets = async (seed: number): Promise<{ x: string[]; y: string[]; z: string[] }> => {
    const next = prng(seed)
    const draw = async (tag: string): Promise<string[]> => {
      const n = 3 + (next() % 6)
      const out: string[] = []
      for (let i = 0; i < n; i++) out.push(await hiveText(`${tag}:${next() % 12}`))
      return out
    }
    return { x: await draw('x'), y: await draw('y'), z: await draw('z') }
  }
  const union = (...parts: string[][]): string[] => parts.flat()

  it('associative, commutative, idempotent — by signature equality, over several random draws', async () => {
    for (const seed of [10, 11, 12, 13, 14]) {
      const { x, y, z } = await sets(seed)
      expect(await seal(union(x, union(y, z)))).toBe(await seal(union(union(x, y), z)))
      expect(await seal(union(x, y))).toBe(await seal(union(y, x)))
      expect(await seal(union(x, x))).toBe(await seal(x))
    }
  })

  it('a replace-the-prior-members write is order dependent: two replicas that saw the same two writes in different orders disagree', async () => {
    const { x, y } = await sets(20)
    const replace = (_prior: string[], incoming: string[]): string[] => incoming
    const first = replace(replace([], x), y)
    const second = replace(replace([], y), x)
    expect(await seal(first)).not.toBe(await seal(second))
    expect(await seal(union(x, y))).toBe(await seal(union(y, x)))
  })
})

describe('E11 currency: the order of one key\'s claims is total and reader-derived; absence is the one thing no signature supplies (H1, T2)', () => {
  it('the preimage round-trips and carries the molecule it was signed for: lifted into another row it does not parse to that row', async () => {
    const molecule = await moleculeAddress('people')
    const pubkey = await hiveText('a pubkey stand-in')
    const head = await hiveText('head 1')
    const prev = await hiveText('head 0')
    const text = headClaimPreimage(molecule, pubkey, head, prev, 1)
    expect(parseHeadClaimPreimage(text)).toEqual({ molecule, pubkey, head, prev, seq: 1 })
    expect(parseHeadClaimPreimage(text)?.molecule).not.toBe(await moleculeAddress('places'))
    expect(parseHeadClaimPreimage(`${text}\n`)).toBeNull()
    expect(parseHeadClaimPreimage(headClaimPreimage(molecule, pubkey, head, null, 1))).toBeNull()
  })

  it('every reader resolves the same head from the same claims; a reader who has not heard the newest resolves to its horizon', async () => {
    const [h0, h1, h2] = await Promise.all(['h0', 'h1', 'h2'].map(hiveText)) as [string, string, string]
    const claims = [
      { head: h0, prev: null, seq: 0 },
      { head: h1, prev: h0, seq: 1 },
      { head: h2, prev: h1, seq: 2 },
    ]
    expect(resolveBucketHead(claims)?.head).toBe(h2)
    expect(resolveBucketHead([...claims].reverse())?.head).toBe(h2)
    expect(resolveBucketHead(claims.slice(0, 2))?.head).toBe(h1)
  })

  it('equivocation is a proof two strings make together: same key, same seq, two heads', async () => {
    const molecule = await moleculeAddress('people')
    const pubkey = await hiveText('a pubkey stand-in')
    const prev = await hiveText('h0')
    const left = parseHeadClaimPreimage(headClaimPreimage(molecule, pubkey, await hiveText('left'), prev, 1))!
    const right = parseHeadClaimPreimage(headClaimPreimage(molecule, pubkey, await hiveText('right'), prev, 1))!
    const equivocates = left.molecule === right.molecule && left.pubkey === right.pubkey
      && left.seq === right.seq && left.head !== right.head
    expect(equivocates).toBe(true)
    const pick = resolveBucketHead([left, right])!.head
    expect(pick).toBe([left.head, right.head].sort()[0])
  })
})

describe('E12 a derived record is a proof by recomputation (D1, D3): keyed by its input, a cold client rebuilds it bit for bit', () => {
  it('the same pure function over the same input gives the same record on two machines; a changed input is a miss, never a stale hit', async () => {
    const derive = async (text: string): Promise<{ input: string; key: string; record: string }> => {
      const input = await hiveText(text)
      const record = JSON.stringify({ from: input, words: text.split(/\s+/).length })
      return { input, key: derivedMeaning(input)!, record: await hiveText(record) }
    }
    const warm = await derive('three little words')
    const cold = await derive('three little words')
    expect(cold).toEqual(warm)
    expect(warm.key).toBe(`derived:${warm.input}`)
    const changed = await derive('three little words more')
    expect(changed.key).not.toBe(warm.key)
    expect(changed.record).not.toBe(warm.record)
  })
})
