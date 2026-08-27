// diamondcoreprocessor.com/history/meta-record.ts
//
// Compatibility surface for the core life primitive. The protocol lives in
// @hypercomb/core so Store, History, renderers, installers, and native clients
// can share one declaration without importing an essentials behavior.
//
// NEW STANDARD
// ────────────
// Every artifact reference is a declared meta envelope. Installed layer,
// resource, dependency, and bee payload formats remain unchanged. Bare sigs
// inside their existing scalar/array slots are passively wrapped through
// `healLegacyLayer`; reading alone never appends history.
//
//     meta(layer) -> growable layer -> meta(any artifact) -> ...
//
// A feature that needs recursive growth uses a layer payload. Atomic resource,
// dependency, and bee bytes remain terminal artifacts with metadata incidence.

import {
  entriesNeedingResolution as coreEntriesNeedingResolution,
  isMetaEnvelope,
  metaPayloadOf,
  mintMetaEnvelope,
  type MetaEnvelope,
} from '@hypercomb/core'

export {
  canonicalLifeLayer,
  healLegacyLayer,
  healMetaReference,
  inspectLifeClosure,
  isLifeLayer,
  isMetaEnvelope,
  lifeReferenceSigs,
  metaPayloadOf,
  mintMetaEnvelope,
  type LegacyLayer,
  type LifeClosureIssue,
  type LifeLayer,
  type LifeMaterialization,
  type MetaEnvelope,
  type MetaPayload,
  type MetaPayloadKind,
  type PassiveMetaHealer,
} from '@hypercomb/core'

/** Historical name retained while callers move to MetaEnvelope. */
export type MetaRecord = MetaEnvelope
/** Historical name retained while callers move to isMetaEnvelope. */
export const isMetaRecord = isMetaEnvelope
/** Historical name retained while callers move to mintMetaEnvelope. */
export const mintMetaRecord = mintMetaEnvelope

/**
 * Compatibility identity projection for diffs over legacy layers. A bare entry
 * remains readable as itself; canonical new entries resolve through meta.
 */
export const identityOf = (
  entry: string,
  resolved?: ReadonlyMap<string, MetaRecord | null | undefined>,
): string => {
  const record = resolved?.get(entry)
  return isMetaEnvelope(record) ? metaPayloadOf(record)!.sig : entry
}

/** Only changed entries need resolving during the legacy drain. */
export const entriesNeedingResolution = coreEntriesNeedingResolution
