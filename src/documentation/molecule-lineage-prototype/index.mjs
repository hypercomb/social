export { MoleculeStore, moleculeOf, ROOT_MOLECULE } from './molecule.mjs'
export { Root } from './root.mjs'
export { hostOf } from './host.mjs'
export { putPoolDoc, getPoolDoc, poolSignature, BARE_WORD_POOL_MEANINGS } from './pool.mjs'
export { canonName, canonicalizeSegment, lineageKey } from './canon.mjs'
export { sha256, signText, canonicalJSON, EMPTY_SIG } from './sig.mjs'
// The deploy signature (step 4): a flat, signed head map, not a recursive seal.
export {
  HEAD_MAP_KIND, HEAD_MAP_V1,
  canonicalHeadMap, encodeHeadMap, parseHeadMap, headMapClaimFor, headMapDiff,
  headMapRegressions, verifyHeadMap, claimReaderOf,
  molecularScope, mintedScope, mintHeadMap,
} from './head-map.mjs'
