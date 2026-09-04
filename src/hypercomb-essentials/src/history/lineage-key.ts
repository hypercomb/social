// history/lineage-key.ts
//
// MOVED TO CORE (2026-09-03). The rule itself now lives at
// `hypercomb-core/src/core/lineage-key.ts`; this file is a pure re-export so
// every existing importer, the `history/index.ts` barrel line and the
// generated `essentials-keys.ts` module mapping keep working untouched.
//
// WHY IT MOVED. The colon reservation — the thing that keeps system pools and
// molecule addresses in two namespaces that can never collide — IS the theorem
// "canon can never emit a colon". Three files that ASSERT that theorem in prose
// live in packages which cannot import essentials (`core/pool-registry.ts`,
// `core/group-signature.ts`, `hypercomb-runtime/src/packed-store-engine.ts`),
// and `core/molecule-address.ts` now needs the rule itself. A duplicate plus a
// byte-identity ratchet would only prove the two copies have not drifted YET;
// moving it makes drift unrepresentable, which is the same argument the file's
// own header already makes about being the SINGLE source of truth.
//
// The direction stays legal: essentials imports core, never the reverse.

export {
  canonicalizeLineageSegment,
  lineageKey,
  rawLineageKey,
} from '@hypercomb/core'
