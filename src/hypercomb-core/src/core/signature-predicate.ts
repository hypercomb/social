// hypercomb-core/src/core/signature-predicate.ts
//
// Canonical predicate: is this value a resource signature?
//
// A signature is the SHA-256 hex digest produced by SignatureService.sign —
// exactly 64 lowercase hex characters, no prefix, no separators. Anything
// else is a value (a name, a path, a number, a JSON fragment).
//
// This single predicate replaces the seven duplicate implementations that
// existed across the codebase (tile-properties, structure-materializer,
// script-preloader, dependency-loader, layer-graph-resolver, and two in
// commented-out paths). New code that needs to distinguish signatures
// from values imports this.

const SIGNATURE_PATTERN = /^[0-9a-f]{64}$/

export const isSignature = (value: unknown): value is string =>
  typeof value === 'string' && SIGNATURE_PATTERN.test(value)
