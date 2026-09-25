// sharing/participant-features.ts
//
// FEATURES FOR PARTICIPANTS ONLY — a pool of meaning, not a list in code.
//
// A published site is read, never authored: its readers do not chat with the
// assistant, edit tiles, drag them or run workflows. The features that exist
// only for a participant are MEMBERS of the `features:participant` pool —
// artifacts named by their own content, exactly like the hosts in
// `community:hosts` (community-hosts.ts) — so any module, any hive, can add
// its own feature without touching code or a file convention, and the set is
// read, never declared.
//
// A member names a feature by its layer name (the folder a package is built
// from: `assistant`, `editor`, …). `features publish` folds the pool into one
// content-addressed snapshot, sends it to the host under the participant's key
// and names it in their signed index as `pool:features:participant`. A
// read-only reader of any site this key publishes then never loads a bee under
// a layer so named (hypercomb-runtime script-preloader.ts #quietBees).
// Participants are untouched.

import { SignatureService } from '@hypercomb/core'
import { artifactKindFor } from '../pheromones/enrollment.js'

const get = <T,>(key: string): T | undefined => (window as any).ioc?.get?.(key) as T | undefined

export const PARTICIPANT_FEATURES_POOL = 'features:participant'
/** Where the published snapshot is named in the signed index. */
export const PARTICIPANT_FEATURES_POINTER = 'pool:features:participant'

const FEATURE_FAMILY = 'feature'
const FEATURE_ARTIFACT_KIND = artifactKindFor(FEATURE_FAMILY)

type PoolStore = { getPool?: (meaning: string) => Promise<FileSystemDirectoryHandle | null> }

/** A feature is named as its layer is: lower case, letters, digits, dots and
 *  dashes. Anything else names no layer and is refused. */
export const featureName = (raw: unknown): string => {
  const name = String(raw ?? '').trim().toLowerCase()
  return /^[a-z0-9][a-z0-9.-]{0,62}$/.test(name) ? name : ''
}

/** One member: canonical, so the same feature always lands on the same name. */
export const featureRecord = (name: string): Record<string, unknown> => ({
  kind: FEATURE_ARTIFACT_KIND,
  meaning: `${FEATURE_FAMILY}:${name}`,
  payload: { feature: name },
})

const encode = (value: unknown): ArrayBuffer =>
  new TextEncoder().encode(JSON.stringify(value)).buffer as ArrayBuffer

export const featureArtifactSig = (name: string): Promise<string> => SignatureService.sign(encode(featureRecord(name)))

/** The snapshot a reader receives: the names, sorted, nothing else. */
export const participantSnapshot = (names: readonly string[]): { bytes: Uint8Array; sigOf: () => Promise<string> } => {
  const bytes = new Uint8Array(encode({ features: [...new Set(names)].sort() }))
  return { bytes, sigOf: () => SignatureService.sign(bytes.buffer as ArrayBuffer) }
}

const pool = async (): Promise<FileSystemDirectoryHandle | null> => {
  try { return await get<PoolStore>('@hypercomb.social/Store')?.getPool?.(PARTICIPANT_FEATURES_POOL) ?? null } catch { return null }
}

/** Every feature the pool names, alphabetically. The pool IS the set. */
export async function listParticipantFeatures(): Promise<string[]> {
  const dir = await pool()
  if (!dir) return []
  const names = new Set<string>()
  try {
    for await (const [, handle] of (dir as unknown as { entries(): AsyncIterableIterator<[string, FileSystemHandle]> }).entries()) {
      if (handle.kind !== 'file') continue
      try {
        const record = JSON.parse(await (await (handle as FileSystemFileHandle).getFile()).text()) as { kind?: unknown; payload?: { feature?: unknown } }
        const name = record?.kind === FEATURE_ARTIFACT_KIND ? featureName(record.payload?.feature) : ''
        if (name) names.add(name)
      } catch { /* a member that will not parse names no feature */ }
    }
  } catch { return [] }
  return [...names].sort()
}

/** Add a feature. Idempotent: the member is named by its own bytes. */
export async function addParticipantFeature(raw: unknown): Promise<string> {
  const name = featureName(raw)
  const dir = name ? await pool() : null
  if (!dir) return ''
  try {
    const handle = await dir.getFileHandle(await featureArtifactSig(name), { create: true })
    const writable = await handle.createWritable()
    try { await writable.write(new Blob([encode(featureRecord(name))])) } finally { await writable.close() }
    return name
  } catch { return '' }
}

/** Give a feature back to every reader. */
export async function removeParticipantFeature(raw: unknown): Promise<boolean> {
  const name = featureName(raw)
  const dir = name ? await pool() : null
  if (!dir) return false
  try { await dir.removeEntry(await featureArtifactSig(name)); return true } catch { return false }
}
