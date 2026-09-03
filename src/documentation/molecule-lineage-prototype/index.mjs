export { MoleculeStore, moleculeOf, ROOT_MOLECULE, CLOSURE_ATOM_CAP } from './molecule.mjs'
export { Root } from './root.mjs'
export { hostOf } from './host.mjs'
export { putPoolDoc, getPoolDoc, poolSignature, BARE_WORD_POOL_MEANINGS } from './pool.mjs'
export { canonName, canonicalizeSegment, lineageKey } from './canon.mjs'
export { sha256, signText, canonicalJSON, EMPTY_SIG } from './sig.mjs'
// The deploy signature (step 4): a flat, signed head map, not a recursive seal.
export {
  HEAD_MAP_KIND, HEAD_MAP_V1, HEAD_MAP_MAX_BYTES, HEAD_MAP_ATTEST_V1,
  canonicalHeadMap, encodeHeadMap, splitHeadMap, parseHeadMap, headMapRefusal,
  headMapClaimFor, headMapDiff, mergeHeadMap, headMapRegressions,
  headMapAttestationPreimage, verifyHeadMapRows, verifyDeploy,
  claimReaderOf, headReaderOf,
  molecularScope, mintedScope, mintHeadMap,
} from './head-map.mjs'
