// hypercomb-net/conformance/generate-vectors.ts
//
// GROUND TRUTH GENERATOR for the cross-implementation conformance suite.
//
// Every vector in `vectors.json` is produced by executing the REAL TypeScript
// implementation — never a transcription of it. That is the whole point: the
// C# node's tests assert against these bytes, so if the TS protocol logic ever
// changes, regenerating this file makes the C# suite fail loudly instead of the
// two implementations silently forking their merkle trees.
//
// Run:  npx tsx hypercomb-net/conformance/generate-vectors.ts
//
// The output is committed. Regenerating it is a PROTOCOL CHANGE and must be
// reviewed as one.

import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  lineageKey,
  rawLineageKey,
  canonicalizeLineageSegment,
} from '../../hypercomb-essentials/src/diamondcoreprocessor.com/history/lineage-key.js'
import {
  canonicalizeLayer,
  canonicalLayerJson,
  type CanonicalLayerContent,
} from '../../hypercomb-essentials/src/diamondcoreprocessor.com/history/canonical-layer.js'
import {
  BARE_WORD_POOL_MEANINGS,
  SCOPED_POOL_MEANINGS,
} from '../../hypercomb-core/src/core/pool-registry.js'

// ---------------------------------------------------------------------------
// signing — byte-identical to SignatureService.sign
// ---------------------------------------------------------------------------

const sign = async (bytes: Uint8Array): Promise<string> => {
  const buffer = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(buffer).set(bytes)
  const hash = await crypto.subtle.digest('SHA-256', buffer)
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s)
const signText = (s: string): Promise<string> => sign(utf8(s))

// ---------------------------------------------------------------------------
// 1. raw signatures — the primitive every other vector rests on
// ---------------------------------------------------------------------------

/** Chosen to pin UTF-8 handling, not just ASCII: multi-byte, astral-plane
 *  (surrogate pair), combining marks, and the empty string — which is the
 *  ROOT signature and has bitten this codebase before (the empty-hash /
 *  root-bag collision). */
const SIGNATURE_INPUTS: readonly string[] = [
  '',
  'a',
  'hypercomb',
  'the quick brown fox',
  'café',                    // combining-capable Latin
  'café',              // SAME grapheme, DECOMPOSED — must hash DIFFERENTLY
  '日本語',                   // CJK, 3-byte UTF-8
  '🐝',                      // astral plane, surrogate pair in UTF-16
  'Chapter 1',
  '{"children":[],"name":""}',
  '{"bees":[],"dependencies":[],"layers":[],"resources":[]}',
]

const signatures = async () =>
  Promise.all(SIGNATURE_INPUTS.map(async input => ({
    input,
    inputUtf8Hex: Buffer.from(utf8(input)).toString('hex'),
    signature: await signText(input),
  })))

// ---------------------------------------------------------------------------
// 2. lineage keys — canonical + legacy raw, and the bag address for each
// ---------------------------------------------------------------------------

/** Every case the canonicalization comment calls out, plus the guard paths.
 *  A conforming implementation that fails ANY of these will silently fork a
 *  user's history into a second bag. */
const LINEAGE_PATHS: readonly (readonly unknown[])[] = [
  [],                              // ROOT — key '' — signs as the empty hash
  ['websites'],                    // bare word: COLLIDES with sign('websites')
  ['my-cool-tile'],                // already canonical — must be idempotent
  ['Chapter 1'],                   // space folds to '-', so it RE-ADDRESSES
  ['My Tile', 'Sub Page'],
  ['  padded  '],                  // edge whitespace -> edge hyphens -> stripped
  ['a--b'],                        // a RUN of separators collapses to ONE hyphen
  ['a-b'],                         // ...so this must produce the SAME key as above
  ['en–dash'],                     // en-dash is a separator, not a letter
  ['smart’quote'],
  ['café'],                        // NFC-composed
  ['café'],                  // decomposed — NFC folds it to the SAME key
  ['日本語'],                       // non-Latin letters SURVIVE
  ['🐝'],                          // symbol-only: canonicalizes to '' -> raw fallback
  ['🐝', 'child'],
  ['trailing...'],
  ['...leading'],
  ['a', 'b', 'c'],
  ['a/b'],                         // '/' is a separator -> becomes ONE segment 'a-b'
  ['', 'real'],                    // empty raw segment is DROPPED
  ['websites', 'menu'],            // vs the pool meaning 'websites:menu'
]

const lineageKeys = async () =>
  Promise.all(LINEAGE_PATHS.map(async segments => {
    const canonical = lineageKey(segments)
    const raw = rawLineageKey(segments)
    return {
      segments,
      perSegmentCanonical: segments.map(s => canonicalizeLineageSegment(s)),
      canonicalKey: canonical,
      /** The lineage sigbag address: sha256(canonicalKey). */
      bagAddress: await signText(canonical),
      legacyRawKey: raw,
      /** Only differs when canonicalization changed the key — that difference
       *  IS the migration surface HistoryService unions over. */
      legacyBagAddress: await signText(raw),
      reAddressed: canonical !== raw,
    }
  }))

// ---------------------------------------------------------------------------
// 3. pool addresses — and the collision census against lineage bags
// ---------------------------------------------------------------------------

const poolAddresses = async () => {
  const rows = await Promise.all(
    [...BARE_WORD_POOL_MEANINGS, ...SCOPED_POOL_MEANINGS].map(async meaning => {
      const address = await signText(meaning)
      // Would a tile named this land on the same directory? For a bare word,
      // yes — that is the documented hazard. A colon can never be produced by
      // lineageKey, so a scoped meaning is collision-proof by construction.
      const asLineageBag = await signText(lineageKey([meaning]))
      return {
        meaning,
        address,
        scoped: meaning.includes(':'),
        collidesWithSameNamedTile: address === asLineageBag,
      }
    }),
  )
  return rows.sort((a, b) => a.meaning.localeCompare(b.meaning))
}

// ---------------------------------------------------------------------------
// 4. canonical layers — the sparse-layer invariant and slot ordering
// ---------------------------------------------------------------------------

const LAYERS: readonly { note: string; layer: CanonicalLayerContent }[] = [
  { note: 'empty layer minted on a bag first touch — name only, no children key',
    layer: { name: '' } },
  { note: 'root display name',
    layer: { name: '/' } },
  { note: 'empty children array is DROPPED (sparse invariant)',
    layer: { name: 'leaf', children: [] } },
  { note: 'children present',
    layer: { name: 'parent', children: ['a'.repeat(64), 'b'.repeat(64)] } },
  { note: 'slots sort alphabetically AFTER name, regardless of insertion order',
    layer: { name: 'x', zebra: 1, apple: 2, children: ['c'.repeat(64)] } as CanonicalLayerContent },
  { note: 'null and undefined slots are DROPPED',
    layer: { name: 'x', a: null, b: undefined, c: 1 } as CanonicalLayerContent },
  { note: 'empty object slot is DROPPED, non-empty is KEPT verbatim',
    layer: { name: 'x', empty: {}, full: { k: 'v' } } as CanonicalLayerContent },
  { note: 'child order is NOT sorted — it is the user-visible order and is content',
    layer: { name: 'ordered', children: ['f'.repeat(64), 'a'.repeat(64)] } },
  { note: 'nested slot values pass through untouched — each slot owns its own form',
    layer: { name: 'x', notes: { body: 'hello', marks: ['b', 'a'] } } as CanonicalLayerContent },
  { note: 'unicode name survives into the bytes',
    layer: { name: '日本語 🐝' } },
]

const layers = async () =>
  Promise.all(LAYERS.map(async ({ note, layer }) => {
    const json = canonicalLayerJson(layer)
    return {
      note,
      input: layer,
      canonical: canonicalizeLayer(layer),
      canonicalJson: json,
      /** The layer signature — what a parent stores in its `children` array. */
      signature: await sign(utf8(json)),
    }
  }))

// ---------------------------------------------------------------------------
// 5. markers — the pointer record and the max-marker-is-head rule
// ---------------------------------------------------------------------------

const markers = async () => {
  const layerJson = canonicalLayerJson({ name: 'demo' })
  const layerSig = await sign(utf8(layerJson))
  const pointer = JSON.stringify({ layer: layerSig })
  return {
    markerFilenameWidth: 8,
    markerFilenames: [0, 1, 2, 42, 99999999].map(n => String(n).padStart(8, '0')),
    headRule: 'the LEXICOGRAPHICALLY MAXIMUM marker filename in the bag IS the head; filenames carry no other meaning',
    pointerRecord: {
      note: 'modern marker: a pointer record naming which layer this revision is',
      layerJson,
      layerSig,
      markerBytes: pointer,
    },
    legacyInlineRecord: {
      note: 'legacy marker: the layer JSON ITSELF was the marker body. Readers detect a pointer by a 64-hex `.layer` field; anything else is legacy and its layer sig is sha256 of the marker bytes.',
      markerBytes: layerJson,
      derivedLayerSig: layerSig,
    },
  }
}

// ---------------------------------------------------------------------------
// 6. bee payload signature — note the DIFFERENT canonical rule
// ---------------------------------------------------------------------------

/** PayloadCanonical does NOT sort keys — it hashes JSON.stringify of the
 *  payload in INSERTION order. That is a genuinely different canonicalization
 *  from the layer form, and a C# implementation that assumes one rule for both
 *  will mint wrong bee signatures. Pinned here deliberately. */
const beePayload = async () => {
  const payload = {
    version: 1,
    bee: { name: 'demo', description: 'a demo bee', grammar: [], links: [] },
    source: { entry: 'index.js', files: { 'index.js': 'export default 1' } },
  }
  const canonicalJson = JSON.stringify(payload)
  return {
    note: 'INSERTION-ORDER canonicalization — unlike layers, keys are NOT sorted',
    payload,
    canonicalJson,
    signature: await sign(utf8(canonicalJson)),
  }
}

// ---------------------------------------------------------------------------

const main = async () => {
  const vectors = {
    $comment: 'GENERATED by generate-vectors.ts from the live TypeScript implementation. Do not hand-edit. Regenerating is a protocol change.',
    generator: 'hypercomb-net/conformance/generate-vectors.ts',
    signatureAlgorithm: 'SHA-256, lowercase hex, 64 chars',
    signatures: await signatures(),
    lineageKeys: await lineageKeys(),
    poolAddresses: await poolAddresses(),
    layers: await layers(),
    markers: await markers(),
    beePayload: await beePayload(),
  }

  const out = join(dirname(fileURLToPath(import.meta.url)), 'vectors.json')
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, JSON.stringify(vectors, null, 2) + '\n', 'utf8')
  console.log(`wrote ${out}`)
  console.log(`  signatures     ${vectors.signatures.length}`)
  console.log(`  lineage keys   ${vectors.lineageKeys.length}`)
  console.log(`  pool addresses ${vectors.poolAddresses.length}`)
  console.log(`  layers         ${vectors.layers.length}`)
}

main().catch(error => { console.error(error); process.exit(1) })
