// hypercomb-shim/src/bootstrap/hosts.ts
//
// THE DOMAINS YOU CARRY — moved to runtime, re-exported here.
//
// Implementation: `@hypercomb/runtime/host-zones`. Both shells read and write
// the same `community:hosts` pool by ADDRESS, so there must be exactly one
// implementation of what a host record IS — the member is named by the hash of
// its own bytes, and a stray difference would mint a second member for the
// same host instead of being the no-op that adding twice is supposed to be.
export {
  addHostZone,
  hostZone,
  listHostZones,
  removeHostZone,
} from '@hypercomb/runtime/host-zones'
