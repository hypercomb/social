// core/life-primitive.ts
//
// THE LIFE PRIMITIVE.
//
// Every artifact reference is the signature of a meta envelope. The envelope
// declares exactly one typed payload hop (`layer`, `resource`, `dependency`,
// or `bee`). A `layer` payload is a structured LifeLayer. A LifeLayer contains
// its existing artifact bytes. Layer/resource/dependency/bee payload formats
// do not change; metadata is the typed incidence wrapped around them.
//
//     meta -> layer -> meta -> layer -> ...
//
// The alternation is recursive closure: any referenced feature can become the
// root of another tree. Images and other atomic bytes can still terminate a
// content hop, but no FEATURE needs a terminal schema of its own.
//
// Legacy layers are read-compatible. `healLegacyLayer` wraps sigs already held
// by their existing scalar/array slots without changing the layer's shape. The
// synthesized records are deterministic and may be pool-materialized
// additively; the next ordinary edit writes the canonical form. No destructive
// migration pass is required.

import { isSignature } from './signature-predicate.js'
import { CHILD_SLOTS } from './level-roster.js'
import { isReferentField } from './edge-registry.js'

export const META_VERSION = 1 as const
export const META_PAYLOAD_FIELDS = ['layer', 'resource', 'dependency', 'bee'] as const
export type MetaPayloadKind = typeof META_PAYLOAD_FIELDS[number]

export type MetaEnvelope = {
  meta: typeof META_VERSION
  /** Exactly one payload key is present; the key declares how its sig resolves. */
  layer?: string
  resource?: string
  dependency?: string
  bee?: string
  /** How the containing layer holds this incidence. */
  relation?: string
  /** Stable canonical grammar name, when this is a root/reference incidence. */
  root?: string
  agent?: string
  recipients?: string[]
  at?: number
  [field: string]: unknown
}

/**
 * Existing growable layer artifact. Metadata changes how artifact references
 * are represented, not which slots an installed layer format already owns.
 */
export type LifeLayer = {
  name: string
  children?: string[]
  [slot: string]: unknown
}

export type LifeRecordKind = 'meta' | 'layer'

export type LifeMaterialization = {
  sig: string
  kind: LifeRecordKind
  bytes: Uint8Array
  value: MetaEnvelope | LifeLayer
}

export type PassiveMetaHealer = {
  /** sha256 in production; injected so the protocol helper stays pure/testable. */
  sign(bytes: Uint8Array): Promise<string>
  /** Resolve a signature only when it already names a declared meta envelope. */
  readMeta?(sig: string): Promise<MetaEnvelope | null>
  /** Classify legacy atomic payloads without content sniffing. */
  payloadKindFor?(relation: string): Exclude<MetaPayloadKind, 'layer'>
  /** Optional additive pool write. It must not advance a lineage head. */
  materialize?(record: LifeMaterialization): Promise<void>
}

const cleanRelation = (value: unknown): string => String(value ?? '').trim()
const cleanRoot = (value: unknown): string => String(value ?? '').trim()

export type MetaPayload = { kind: MetaPayloadKind; sig: string }

/** Read the one self-declared payload. Multiple/missing keys are invalid. */
export const metaPayloadOf = (value: unknown): MetaPayload | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const present = META_PAYLOAD_FIELDS.filter(field => record[field] !== undefined)
  if (present.length !== 1) return null
  const kind = present[0]
  const sig = record[kind]
  return isSignature(sig) ? { kind, sig: sig.toLowerCase() } : null
}

/** Self-declared only. Shape-sniffing referenced bytes is forbidden. */
export const isMetaEnvelope = (value: unknown): value is MetaEnvelope => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  return (value as Record<string, unknown>)['meta'] === META_VERSION
    && metaPayloadOf(value) !== null
}

/**
 * Mint deterministic envelope bytes. Known fields have a fixed order; extra
 * protocol fields follow alphabetically. Empty optionals are omitted.
 */
export const mintMetaEnvelope = (fields: {
  layer?: string
  resource?: string
  dependency?: string
  bee?: string
  relation?: string
  root?: string
  agent?: string
  recipients?: readonly string[]
  at?: number
  [field: string]: unknown
}): MetaEnvelope => {
  const payload = metaPayloadOf({ meta: META_VERSION, ...fields })
  if (!payload) {
    throw new Error('meta-envelope: expected exactly one signed payload key: layer, resource, dependency, or bee')
  }
  const record: MetaEnvelope = {
    meta: META_VERSION,
    [payload.kind]: payload.sig,
  }
  const relation = cleanRelation(fields.relation)
  const root = cleanRoot(fields.root)
  if (relation) record.relation = relation
  if (root) record.root = root
  if (typeof fields.agent === 'string' && fields.agent.trim()) record.agent = fields.agent.trim()
  if (fields.recipients && fields.recipients.length > 0) {
    record.recipients = fields.recipients.map(String).filter(Boolean)
  }
  if (typeof fields.at === 'number' && Number.isFinite(fields.at)) record.at = fields.at

  const known = new Set(['meta', ...META_PAYLOAD_FIELDS, 'relation', 'root', 'agent', 'recipients', 'at'])
  for (const key of Object.keys(fields).filter(key => !known.has(key)).sort()) {
    const value = fields[key]
    if (value === undefined || value === null) continue
    if (Array.isArray(value) && value.length === 0) continue
    if (typeof value === 'object' && !Array.isArray(value)
      && Object.keys(value as object).length === 0) continue
    record[key] = value
  }
  return record
}

/** Artifact-layer validation; open slots intentionally retain existing shapes. */
export const isLifeLayer = (value: unknown): value is LifeLayer => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const layer = value as Record<string, unknown>
  if (typeof layer['name'] !== 'string') return false
  return layer['children'] === undefined
    || (Array.isArray(layer['children']) && (layer['children'] as unknown[]).every(isSignature))
}

/** Stable helper order for synthesized compatibility layers only. */
export const canonicalLifeLayer = (input: LifeLayer): LifeLayer => {
  if (!isLifeLayer(input)) {
    throw new Error('life-layer: expected an artifact layer with a name and optional signed children')
  }
  const layer: LifeLayer = { name: input.name }
  if (input.children && input.children.length > 0) {
    layer.children = input.children.map(sig => sig.toLowerCase())
  }
  for (const field of Object.keys(input).filter(k => k !== 'name' && k !== 'children').sort()) {
    layer[field] = input[field]
  }
  return layer
}

export const lifeReferenceSigs = (layer: LifeLayer): string[] => {
  const canonical = canonicalLifeLayer(layer)
  const refs = new Set<string>()
  for (const [field, value] of Object.entries(canonical)) {
    if (field === 'name' || isReferentField(field)) continue
    if (isSignature(value)) refs.add(value.toLowerCase())
    else if (Array.isArray(value)) {
      for (const entry of value) if (isSignature(entry)) refs.add(entry.toLowerCase())
    }
  }
  return [...refs]
}

/**
 * Signatures that must be fetched before two legacy entry lists can be
 * compared on semantic identity. Shared entries are already byte-identical.
 */
export const entriesNeedingResolution = (
  prev: readonly string[],
  next: readonly string[],
): string[] => {
  const shared = new Set(prev.filter(entry => next.includes(entry)))
  const out = new Set<string>()
  for (const entry of [...prev, ...next]) {
    if (!shared.has(entry) && isSignature(entry)) out.add(entry.toLowerCase())
  }
  return [...out]
}

const bytesOf = (value: MetaEnvelope | LifeLayer): Uint8Array =>
  new TextEncoder().encode(JSON.stringify(value))

const signedRecord = async (
  value: MetaEnvelope | LifeLayer,
  kind: LifeRecordKind,
  healer: PassiveMetaHealer,
): Promise<LifeMaterialization> => {
  const bytes = bytesOf(value)
  const sig = (await healer.sign(bytes)).toLowerCase()
  if (!isSignature(sig)) throw new Error(`life-primitive: signer returned an invalid signature: ${sig}`)
  const record = { sig, kind, bytes, value }
  await healer.materialize?.(record)
  return record
}

/**
 * Return an existing meta incidence unchanged, otherwise synthesize a
 * deterministic envelope around the legacy target. This is the atomic passive
 * heal used for child entries and scalar slot references.
 */
export const healMetaReference = async (
  target: string,
  relation: string,
  healer: PassiveMetaHealer,
  payloadKind: MetaPayloadKind = 'layer',
): Promise<LifeMaterialization | { sig: string; kind: 'meta'; value: MetaEnvelope; bytes?: undefined }> => {
  if (!isSignature(target)) throw new Error(`life-primitive: legacy reference is not a signature: ${target}`)
  const normalized = target.toLowerCase()
  const existing = await healer.readMeta?.(normalized)
  if (existing) {
    const payload = metaPayloadOf(existing)
    if (!payload || payload.kind !== payloadKind) {
      throw new Error(
        `life-primitive: ${relation} expected ${payloadKind} metadata, got ${payload?.kind ?? 'invalid'}`,
      )
    }
    return { sig: normalized, kind: 'meta', value: existing }
  }
  const payload = payloadKind === 'layer' ? { layer: normalized }
    : payloadKind === 'resource' ? { resource: normalized }
      : payloadKind === 'dependency' ? { dependency: normalized }
        : { bee: normalized }
  return signedRecord(mintMetaEnvelope({ ...payload, relation }), 'meta', healer)
}

const defaultAtomicKind = (slot: string): Exclude<MetaPayloadKind, 'layer'> =>
  slot === 'dependencies' ? 'dependency'
    : slot === 'bees' ? 'bee'
      : 'resource'

export type LegacyLayer = {
  name?: unknown
  children?: unknown
  [slot: string]: unknown
}

/**
 * Passive compatibility projection:
 *
 * - raw child sig -> child meta envelope
 * - scalar artifact sig -> one typed meta envelope in the same slot
 * - sig-array slot -> the same array shape, with one meta per artifact
 *
 * Inline non-signature values are retained unchanged. Artifact formats stay
 * intact; only artifact references gain metadata.
 */
export const healLegacyLayer = async (
  legacy: LegacyLayer,
  healer: PassiveMetaHealer,
): Promise<{ layer: LifeLayer; incompatible: string[] }> => {
  const name = typeof legacy.name === 'string' ? legacy.name : ''
  const incompatible: string[] = []
  const childTargets = Array.isArray(legacy.children) ? legacy.children : []
  const children: string[] = []
  for (const raw of childTargets) {
    if (!isSignature(raw)) { incompatible.push('children'); continue }
    children.push((await healMetaReference(raw, 'children', healer, 'layer')).sig)
  }

  const layer: LifeLayer = { name }
  if (children.length > 0) layer.children = children
  for (const slot of Object.keys(legacy).filter(k => k !== 'name' && k !== 'children').sort()) {
    const value = legacy[slot]
    if (isSignature(value)) {
      // A scalar child slot is the installed pointer-to-list form: the sig
      // names a JSON array resource. Inline arrays below contain the child
      // layer incidences themselves. Preserve that existing distinction.
      const kind = (CHILD_SLOTS as readonly string[]).includes(slot)
        ? 'resource'
        : healer.payloadKindFor?.(slot) ?? defaultAtomicKind(slot)
      layer[slot] = (await healMetaReference(value, slot, healer, kind)).sig
      continue
    }
    if (Array.isArray(value) && value.every(isSignature)) {
      const references: string[] = []
      const kind = (CHILD_SLOTS as readonly string[]).includes(slot)
        ? 'layer'
        : healer.payloadKindFor?.(slot) ?? defaultAtomicKind(slot)
      for (const target of value) {
        references.push((await healMetaReference(target, slot, healer, kind)).sig)
      }
      layer[slot] = references
      continue
    }
    layer[slot] = value
  }
  return { layer: canonicalLifeLayer(layer), incompatible: [...new Set(incompatible)] }
}

export type LifeClosureIssue = {
  sig: string
  kind: 'missing-meta' | 'missing-layer' | 'invalid-meta' | 'invalid-layer' | 'cycle'
}

/**
 * Verify recursive closure from one meta root. Real content-addressed graphs
 * cannot mint a direct forward cycle, but the active-stack guard also protects
 * tests, malformed imports, and future symbolic resolution adapters.
 */
export const inspectLifeClosure = async (
  rootMetaSig: string,
  readJson: (sig: string) => Promise<unknown | null>,
): Promise<{ metas: string[]; layers: string[]; atoms: string[]; issues: LifeClosureIssue[] }> => {
  const metas = new Set<string>()
  const layers = new Set<string>()
  const atoms = new Set<string>()
  const issues: LifeClosureIssue[] = []
  const active = new Set<string>()

  const visitMeta = async (sig: string): Promise<void> => {
    if (active.has(sig)) { issues.push({ sig, kind: 'cycle' }); return }
    if (metas.has(sig)) return
    active.add(sig)
    const value = await readJson(sig)
    if (value === null) issues.push({ sig, kind: 'missing-meta' })
    else if (!isMetaEnvelope(value)) issues.push({ sig, kind: 'invalid-meta' })
    else {
      metas.add(sig)
      const payload = metaPayloadOf(value)!
      if (payload.kind === 'layer') await visitLayer(payload.sig)
      else atoms.add(payload.sig)
    }
    active.delete(sig)
  }

  const visitLayer = async (sig: string): Promise<void> => {
    if (active.has(sig)) { issues.push({ sig, kind: 'cycle' }); return }
    if (layers.has(sig)) return
    active.add(sig)
    const value = await readJson(sig)
    if (value === null) issues.push({ sig, kind: 'missing-layer' })
    else if (!isLifeLayer(value)) issues.push({ sig, kind: 'invalid-layer' })
    else {
      layers.add(sig)
      for (const ref of lifeReferenceSigs(value)) await visitMeta(ref)
    }
    active.delete(sig)
  }

  if (!isSignature(rootMetaSig)) {
    issues.push({ sig: rootMetaSig, kind: 'invalid-meta' })
  } else {
    await visitMeta(rootMetaSig.toLowerCase())
  }
  return { metas: [...metas], layers: [...layers], atoms: [...atoms], issues }
}

export type ArtifactResolutionKind = 'meta' | MetaPayloadKind

export type MetaArtifactResolutionIO = {
  /** Hot path: memory/OPFS only. Never starts network resolution. */
  readLocal(sig: string, kind: ArtifactResolutionKind): Promise<Uint8Array | null>
  /** Immutable HTTP-by-signature resolution. */
  fetchHttp(sig: string, kind: ArtifactResolutionKind): Promise<Uint8Array | null>
  /** SHA-256 (or the protocol signer in tests). */
  sign(bytes: Uint8Array): Promise<string>
  /** Write verified HTTP bytes through to the appropriate local cache. */
  cacheLocal?(sig: string, kind: ArtifactResolutionKind, bytes: Uint8Array): Promise<void>
}

export type ResolvedMetaArtifact = {
  metaSig: string
  meta: MetaEnvelope
  payload: MetaPayload
  bytes: Uint8Array
  metaSource: 'local' | 'http'
  artifactSource: 'local' | 'http'
}

const verifiedArtifactBytes = async (
  sig: string,
  kind: ArtifactResolutionKind,
  io: MetaArtifactResolutionIO,
): Promise<{ bytes: Uint8Array; source: 'local' | 'http' } | null> => {
  const expected = sig.toLowerCase()
  const verify = async (bytes: Uint8Array | null): Promise<Uint8Array | null> => {
    if (!bytes) return null
    return (await io.sign(bytes)).toLowerCase() === expected ? bytes : null
  }

  const local = await verify(await io.readLocal(expected, kind))
  if (local) return { bytes: local, source: 'local' }

  const remote = await verify(await io.fetchHttp(expected, kind))
  if (!remote) return null
  await io.cacheLocal?.(expected, kind, remote)
  return { bytes: remote, source: 'http' }
}

/**
 * Resolve one metadata incidence and its typed artifact without scanning or
 * sniffing. Both hops are local-first, immutable HTTP-by-signature on miss,
 * SHA-256 verified, and write-through cached. Meta itself uses the generic
 * flat resource transport; its declared payload key selects the second hop.
 */
export const resolveMetaArtifact = async (
  metaSig: string,
  io: MetaArtifactResolutionIO,
): Promise<ResolvedMetaArtifact | null> => {
  if (!isSignature(metaSig)) return null
  const normalizedMetaSig = metaSig.toLowerCase()
  const metaResult = await verifiedArtifactBytes(normalizedMetaSig, 'meta', io)
  if (!metaResult) return null

  let meta: unknown
  try { meta = JSON.parse(new TextDecoder().decode(metaResult.bytes)) }
  catch { return null }
  if (!isMetaEnvelope(meta)) return null

  const payload = metaPayloadOf(meta)!
  const artifactResult = await verifiedArtifactBytes(payload.sig, payload.kind, io)
  if (!artifactResult) return null
  return {
    metaSig: normalizedMetaSig,
    meta,
    payload,
    bytes: artifactResult.bytes,
    metaSource: metaResult.source,
    artifactSource: artifactResult.source,
  }
}
