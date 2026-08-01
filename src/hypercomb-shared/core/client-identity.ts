// hypercomb-shared/core/client-identity.ts
// Re-export — the implementation lives in core so drone modules (which may
// only import core) and the shells share ONE identity primitive.
export { getClientIdentity, setClientName, type ClientIdentity } from '@hypercomb/core'
