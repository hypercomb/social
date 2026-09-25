// Local selection around the shared, framework-free public offering reader.
import {
  SignatureService, HOST_OFFERINGS_MEANING, parseHostOffering, readHostCreations, readHostOfferings,
  type HostCreation, type HostOffering,
} from '@hypercomb/core'
import { hostRouteName, readHostActivation, writeHostActivation,
  type HostActivation } from '@hypercomb/runtime/host-activation'
import { disableCreation, installCreationHead, listCreations, readCreation } from '@hypercomb/runtime/meaning-creations'
import { isTextThemeLayer, refreshTextThemes } from '@hypercomb/runtime/text-theme-pool'
import { clearPendingSelectionLayer, listPendingSelectionLayers, stagePendingSelectionLayer,
  type PendingSelection } from './pending-selections'
import { isComplete, resolveInventory, type ReplicationIo } from '@hypercomb/runtime/replication-walker'
import { siteLayerReferences, siteResourceReferences,
  type SiteReference, type SiteReferenceKind } from '@hypercomb/runtime/site-references'
import type { Store as RuntimeStore } from '@hypercomb/runtime/store'
import { verifyEvent } from 'nostr-tools/pure'

export const OFFERINGS_MEANING = HOST_OFFERINGS_MEANING
export const ADOPTIONS_MEANING = 'host:adoptions'
export const REVISION_CANDIDATES_MEANING = 'host:revision-candidates'
export { PENDING_SELECTIONS_MEANING, type PendingSelection } from './pending-selections'
const SIG = /^[a-f0-9]{64}$/
const LOOPBACK = /^(?:[a-z0-9-]+\.)*localhost(?::\d{1,5})?$/
const text = new TextEncoder()
const exact = (bytes: Uint8Array): ArrayBuffer =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
export type Offering = HostOffering
export type PublicCreation = HostCreation

export type Adoption = {
  kind: 'host:adoption'
  route: string
  /** The selected local hostname. Older records may not have one. */
  localRoute?: string
  lineage: string
  pubkey: string
  head: string
  source: string
  at: number
}

/** The participant's current on switch. Adoption records remain as history
 *  when this pool member is removed. */
export type ActiveOffering = HostActivation

/** The exact roots a participant saw when a carried creation moved. The
 *  record is itself content-addressed and does not imply acceptance. */
export type SiteRevisionCandidate = {
  kind: 'host:revision-candidate'
  pubkey: string
  lineage: string
  route: string
  source: string
  location: string
  from: string
  to: string
  index: string
}

export type CreationRevisionCandidate = {
  kind: 'host:revision-candidate'
  meaning: string
  key: string
  title: string
  host: string
  pubkey: string
  source: string
  location: string
  from: string
  to: string
  payload: string
  index: string
}

export type RevisionCandidate = SiteRevisionCandidate | CreationRevisionCandidate

const digest = (bytes: ArrayBuffer): Promise<string> => SignatureService.sign(bytes)
const verifyIndex = (index: Record<string, unknown>): boolean => {
  try { return verifyEvent(index as never) } catch { return false }
}
export const parseOffering = (raw: unknown): Offering | null => parseHostOffering(raw, verifyIndex)
export const readOfferings = (host: string): Promise<Offering[]> => readHostOfferings(host, verifyIndex)
export const readPublicCreations = (host: string): Promise<PublicCreation[]> => readHostCreations(host, verifyIndex)
export const publicCreationOrigin = (host: string): string => `${LOOPBACK.test(host) ? 'http' : 'https'}://${host}`

const publicKey = (creation: PublicCreation): string => `${creation.pubkey}:${creation.key}`

export type ActivePublicCreation = { meaning: string; key: string; pubkey: string; head: string }

export const listActivePublicCreations = async (): Promise<ActivePublicCreation[]> => {
  const local = store()
  if (!local) return []
  const themes = await listCreations(local, 'themes:text').catch(() => [])
  return themes.flatMap(row => {
    const match = /^([a-f0-9]{64}):(.+)$/.exec(row.key)
    return match ? [{ meaning: 'themes:text', key: match[2]!, pubkey: match[1]!, head: row.head }] : []
  })
}

/** How far a replication is: files held here against the files known so far. */
export type ReplicationProgress = { done: number; total: number }

const fetchSignedBytes = async (host: string, sig: string, limit: number): Promise<Uint8Array | null> => {
  try {
    const url = new URL(`/${sig}`, publicCreationOrigin(host))
    const response = await fetch(url, { cache: 'no-store' })
    if (!response.ok || Number(response.headers.get('content-length') ?? 0) > limit) return null
    const bytes = new Uint8Array(await response.arrayBuffer())
    return bytes.byteLength <= limit && await digest(exact(bytes)) === sig ? bytes : null
  } catch { return null }
}

/** The first generic adoption supports a data-only text theme. Its exact
 * publisher head is selected in our meaning pool, with no new identity. */
export const addPublicCreation = async (creation: PublicCreation): Promise<boolean> => {
  if (creation.meaning !== 'themes:text') return false
  const current = (await readPublicCreations(creation.host))
    .find(row => row.pubkey === creation.pubkey && row.location === creation.location)
  if (!current || current.head !== creation.head || current.payload !== creation.payload) return false
  const local = store()
  if (!local) return false
  await local.initialize()
  const meta = await fetchSignedBytes(creation.host, creation.head, 65_536)
  const layer = await fetchSignedBytes(creation.host, creation.payload, 1_048_576)
  let theme: unknown
  try { theme = layer ? JSON.parse(new TextDecoder().decode(layer)) : null } catch { return false }
  if (!isTextThemeLayer(theme)) return false
  if (!meta || !layer || await local.putResource(new Blob([exact(meta)], { type: 'application/json' }),
    { emit: false }) !== creation.head) return false
  await local.writeLayerBytes(creation.payload, exact(layer))
  if (await digest(exact(await local.getLayerPoolBytes(creation.payload) ?? new Uint8Array())) !== creation.payload) return false
  const installed = await installCreationHead(local, creation.meaning, publicKey(creation), creation.head)
  if (!installed) return false
  try { await refreshTextThemes(local as unknown as RuntimeStore) } catch { /* the pool remains authoritative */ }
  return true
}

export const turnOffPublicCreation = async (creation: PublicCreation): Promise<boolean> => {
  if (creation.meaning !== 'themes:text') return false
  const local = store()
  if (!local) return false
  const current = await readCreation(local, creation.meaning, publicKey(creation))
  if (!current || !await disableCreation(local, creation.meaning, publicKey(creation), current.head)) return false
  try { await refreshTextThemes(local as unknown as RuntimeStore) } catch { /* no change to the signed off layer */ }
  return true
}

type Store = {
  initialize(): Promise<void>
  getPool(meaning: string): Promise<FileSystemDirectoryHandle | null>
  openPool(meaning: string): Promise<FileSystemDirectoryHandle | null>
  putResource(blob: Blob, options?: { emit?: boolean }): Promise<string>
  opfsRoot: FileSystemDirectoryHandle
  writeLayerBytes(sig: string, bytes: ArrayBuffer): Promise<void>
  getLayerPoolBytes(sig: string): Promise<Uint8Array | null>
  getResourceLocal(sig: string): Promise<Blob | null>
  putArtifactMeta(kind: 'layer', sig: string, incidence: Record<string, unknown>): Promise<string>
  getBeeBytes(sig: string): Promise<Uint8Array | null>
  writeBeeBytes(sig: string, bytes: Uint8Array): Promise<void>
  getDependencyBytes(sig: string): Promise<Uint8Array | null>
  writeDependencyBytes(sig: string, bytes: Uint8Array): Promise<void>
}
const store = (): Store | null => window.ioc?.get?.<Store>('@hypercomb.social/Store') ?? null

/** A remote click records only a signed, current offering reference. It does
 * not fetch its closure or switch on its code. That is a separate local click. */
export const stagePendingSelection = async (offer: Offering, source: string): Promise<boolean> => {
  const verified = parseOffering(offer)
  const local = store()
  if (!verified || !local) return false
  try {
    await local.initialize()
    return await stagePendingSelectionLayer(local, { source, route: verified.route,
      pubkey: verified.pubkey, lineage: verified.lineage, head: verified.head })
  } catch { return false }
}

/** A data creation uses the same private choice pool as a site deployment. */
export const stagePendingCreation = async (creation: PublicCreation, source: string): Promise<boolean> => {
  const local = store()
  if (!local || creation.host !== source || creation.meaning !== 'themes:text') return false
  try {
    await local.initialize()
    return await stagePendingSelectionLayer(local, { kind: 'creation', source,
      pubkey: creation.pubkey, meaning: creation.meaning, key: creation.key,
      location: creation.location, head: creation.head })
  } catch { return false }
}

export const listPendingSelections = async (): Promise<PendingSelection[]> => {
  const local = store()
  if (!local) return []
  try {
    await local.initialize()
    return await listPendingSelectionLayers(local)
  } catch { return [] }
}

/** Append an off layer only after the local decision succeeds. */
export const clearPendingSelection = async (selection: PendingSelection): Promise<boolean> => {
  const local = store()
  if (!local) return false
  try {
    await local.initialize()
    return await clearPendingSelectionLayer(local, selection)
  } catch { return false }
}

export const listAdoptions = async (): Promise<Adoption[]> => {
  const dir = await store()?.openPool(ADOPTIONS_MEANING)
  if (!dir) return []
  const rows: Adoption[] = []
  try {
    for await (const [name, handle] of dir.entries()) {
      if (!SIG.test(name) || handle.kind !== 'file') continue
      try {
        const bytes = await (await (handle as FileSystemFileHandle).getFile()).arrayBuffer()
        if (await digest(bytes) !== name) continue
        const row = JSON.parse(new TextDecoder().decode(bytes)) as Adoption
        if (row.kind === 'host:adoption' && SIG.test(row.head) && SIG.test(row.pubkey)
          && Number.isFinite(row.at) && typeof row.lineage === 'string') rows.push(row)
      } catch { /* one damaged record cannot hide other adoptions */ }
    }
  } catch { return [] }
  return rows.sort((a, b) => b.at - a.at)
}

/** Adoption members discover chosen routes. The newest layer at each local
 *  hostname alone decides whether that route is on. Earlier heads remain. */
export const listActiveOfferings = async (): Promise<ActiveOffering[]> => {
  const local = store()
  if (!local?.opfsRoot || !local.getLayerPoolBytes) return []
  const rows = await listAdoptions()
  const routes = new Map<string, Set<string>>()
  for (const adoption of rows) {
    const route = hostRouteName(adoption.localRoute ?? '')
    if (!route) continue
    let chosen = routes.get(route)
    if (!chosen) { chosen = new Set<string>(); routes.set(route, chosen) }
    chosen.add(`${adoption.pubkey}:${adoption.lineage}:${adoption.head}`)
  }
  const active: ActiveOffering[] = []
  const candidates = [...routes]
  for (let at = 0; at < candidates.length; at += 12) {
    const group = await Promise.all(candidates.slice(at, at + 12).map(async ([route, chosen]) => {
      try {
        const current = await readHostActivation(local, route)
        const row = current?.layer
        return row?.enabled && chosen.has(`${row.pubkey}:${row.lineage}:${row.head}`) ? row : null
      } catch { return null }
    }))
    active.push(...group.filter((row): row is ActiveOffering => !!row))
  }
  return active
}

export const turnOffOffering = async (pubkey: string, lineage: string): Promise<boolean> => {
  if (!SIG.test(pubkey)) return false
  const local = store()
  if (!local?.opfsRoot || !local.writeLayerBytes) return false
  let changed = false
  const seen = new Set<string>()
  for (const adoption of await listAdoptions()) {
    if (adoption.pubkey !== pubkey || adoption.lineage !== lineage) continue
    const route = hostRouteName(adoption.localRoute ?? '')
    if (!route || seen.has(route)) continue
    seen.add(route)
    try {
      const current = await readHostActivation(local, route)
      if (!current?.layer.enabled || current.layer.pubkey !== pubkey
        || current.layer.lineage !== lineage) continue
      await writeHostActivation(local, { ...current.layer, enabled: false })
      changed = true
    } catch { /* another route may still be active */ }
  }
  return changed
}

/** Preserve an offered update for a later byte diff or AI audit. Repeated
 *  sightings of the same pair mint the same pool member. */
export const rememberRevisionCandidate = async (held: Adoption, offer: Offering): Promise<string | null> => {
  if (held.pubkey !== offer.pubkey || held.lineage !== offer.lineage || held.head === offer.head
    || !SIG.test(held.head) || !SIG.test(offer.head) || !parseOffering(offer)) return null
  const local = store()
  if (!local) return null
  await local.initialize()
  const dir = await local.getPool(REVISION_CANDIDATES_MEANING)
  if (!dir) return null
  const record: SiteRevisionCandidate = {
    kind: 'host:revision-candidate', pubkey: offer.pubkey, lineage: offer.lineage,
    route: offer.route, source: held.source, location: offer.location ?? '',
    from: held.head, to: offer.head, index: String(offer.index['id'] ?? ''),
  }
  return writeRevisionCandidate(dir, record)
}

/** A changed public creation is only a candidate. The participant keeps its
 * selected head until another explicit turn-on. */
export const rememberPublicCreationCandidate = async (
  held: ActivePublicCreation, offer: PublicCreation, source: string,
): Promise<string | null> => {
  if (held.pubkey !== offer.pubkey || held.meaning !== offer.meaning || held.key !== offer.key
    || held.head === offer.head || !SIG.test(held.head) || !SIG.test(offer.head)
    || !SIG.test(offer.payload) || !SIG.test(offer.location) || !SIG.test(String(offer.index['id'] ?? '')))
    return null
  const local = store()
  if (!local) return null
  await local.initialize()
  const dir = await local.getPool(REVISION_CANDIDATES_MEANING)
  if (!dir) return null
  const record: CreationRevisionCandidate = {
    kind: 'host:revision-candidate', meaning: offer.meaning, key: offer.key,
    title: offer.title, host: offer.host, pubkey: offer.pubkey, source,
    location: offer.location, from: held.head, to: offer.head,
    payload: offer.payload, index: String(offer.index['id']),
  }
  return writeRevisionCandidate(dir, record)
}

const writeRevisionCandidate = async (
  dir: FileSystemDirectoryHandle, record: RevisionCandidate,
): Promise<string | null> => {
  const data = text.encode(JSON.stringify(record))
  const signature = await digest(data.buffer as ArrayBuffer)
  try {
    const handle = await dir.getFileHandle(signature, { create: true })
    const writable = await handle.createWritable()
    try { await writable.write(data) } finally { await writable.close() }
    return signature
  } catch { return null }
}

export const listRevisionCandidates = async (): Promise<RevisionCandidate[]> => {
  const dir = await store()?.openPool(REVISION_CANDIDATES_MEANING)
  if (!dir) return []
  const rows: RevisionCandidate[] = []
  try {
    for await (const [name, handle] of dir.entries()) {
      if (!SIG.test(name) || handle.kind !== 'file') continue
      try {
        const bytes = await (await (handle as FileSystemFileHandle).getFile()).arrayBuffer()
        if (await digest(bytes) !== name) continue
        const row = JSON.parse(new TextDecoder().decode(bytes)) as RevisionCandidate
        if (row.kind === 'host:revision-candidate' && SIG.test(row.pubkey) && SIG.test(row.from)
          && SIG.test(row.to) && ('lineage' in row && typeof row.lineage === 'string'
            || 'meaning' in row && typeof row.meaning === 'string'
              && typeof row.key === 'string' && SIG.test(row.location))) rows.push(row)
      } catch { /* another record may still be valid */ }
    }
  } catch { return [] }
  return rows
}

/** Carry the selected site's declared typed closure before its local on layer
 * can become current. The walk is bounded and stops on unknown reference
 * shapes; unused package siblings stay remote. */
const replicateSiteClosure = async (held: Store, offer: Offering, sources: string[],
  onProgress?: (progress: ReplicationProgress) => void): Promise<boolean> => {
  const tell = (done: number, total: number): void => { try { onProgress?.({ done, total }) } catch { /* the card's problem */ } }
  let networkBytes = 0
  const fetched = new Map<string, Uint8Array<ArrayBuffer>>()
  const fetchOne = async (sig: string): Promise<Uint8Array<ArrayBuffer> | null> => {
    const existing = fetched.get(sig)
    if (existing) return existing
    let bytes: Uint8Array | null = null
    for (const source of sources) {
      bytes = await fetchSignedBytes(source, sig, 8_388_608)
      if (bytes) break
    }
    if (!bytes) return null
    networkBytes += bytes.byteLength
    if (networkBytes > 67_108_864) return null
    const copy = new Uint8Array(exact(bytes))
    fetched.set(sig, copy)
    return copy
  }
  const read = async (sig: string, kind: SiteReferenceKind): Promise<Uint8Array<ArrayBuffer> | null> => {
    const bytes = kind === 'layer' ? await held.getLayerPoolBytes(sig)
      : kind === 'bee' ? await held.getBeeBytes(sig)
        : kind === 'dependency' ? await held.getDependencyBytes(sig)
          : await held.getResourceLocal(sig)?.then(blob => blob?.arrayBuffer())
    return bytes ? new Uint8Array(bytes instanceof Uint8Array ? exact(bytes) : bytes) : null
  }
  const io = (kind: SiteReferenceKind): ReplicationIo => ({
    read: sig => read(sig, kind), fetch: fetchOne,
    write: async (sig, bytes) => {
      if (kind === 'layer') await held.writeLayerBytes(sig, exact(bytes))
      else if (kind === 'bee') await held.writeBeeBytes(sig, bytes)
      else if (kind === 'dependency') await held.writeDependencyBytes(sig, bytes)
      else if (await held.putResource(new Blob([exact(bytes)]), { emit: false }) !== sig) {
        throw new Error(`Could not hold resource ${sig}`)
      }
      const saved = await read(sig, kind)
      if (!saved || await digest(exact(saved)) !== sig) throw new Error(`Could not hold ${kind} ${sig}`)
    },
  })
  const root = await fetchOne(offer.head)
  if (!root) return false
  let layer: unknown
  try { layer = JSON.parse(new TextDecoder().decode(root)) } catch { return false }
  if (!layer || typeof layer !== 'object' || Array.isArray(layer)
    || typeof (layer as Record<string, unknown>)['name'] !== 'string') return false
  const queue: SiteReference[] = []
  const queued = new Set<string>()
  const kinds = new Map<string, SiteReferenceKind>()
  const enqueue = (ref: SiteReference): boolean => {
    if (!SIG.test(ref.sig)) return false
    const prior = kinds.get(ref.sig)
    if (prior && prior !== ref.kind) return false
    kinds.set(ref.sig, ref.kind)
    const key = `${ref.kind}:${ref.sig}:${ref.role ?? 'ordinary'}`
    if (queued.has(key)) return true
    if (queued.size >= 10_000) return false
    queued.add(key)
    queue.push(ref)
    return true
  }
  if (!enqueue({ sig: offer.head, kind: 'layer' })) return false
  tell(0, queue.length)
  for (let at = 0; at < queue.length;) {
    const batch = queue.slice(at, at + 8)
    at += batch.length
    const byKind = new Map<SiteReferenceKind, string[]>()
    for (const ref of batch) {
      const sigs = byKind.get(ref.kind) ?? []
      sigs.push(ref.sig)
      byKind.set(ref.kind, sigs)
    }
    for (const [kind, sigs] of byKind) {
      const result = await resolveInventory(offer.head, sigs, io(kind), { concurrency: 8 })
      if (!isComplete(result) || result.held.length !== new Set(sigs).size) return false
    }
    const discoveries = await Promise.all(batch.map(async ref => {
      const bytes = await read(ref.sig, ref.kind)
      if (!bytes) return null
      if (ref.kind === 'bee' || ref.kind === 'dependency') return []
      if (ref.kind === 'resource') return siteResourceReferences(bytes, ref.role)
      let parsed: unknown
      try { parsed = JSON.parse(new TextDecoder().decode(bytes)) } catch { return null }
      return siteLayerReferences(parsed)
    }))
    for (const refs of discoveries) {
      if (!refs) return false
      for (const ref of refs) if (!enqueue(ref)) return false
    }
    // The total grows as layers name what they use: a bar that can move
    // backwards is honest here, one that claims to know the end is not.
    tell(at, queue.length)
  }
  return true
}

/** Add only this signed root and its used references. */
export const addOffering = async (offer: Offering, localRoute: string, selectedHost?: string,
  onProgress?: (progress: ReplicationProgress) => void): Promise<boolean> => {
  const held = store()
  if (!held) return false
  const target = hostRouteName(localRoute)
  if (!target) return false
  if (!parseOffering(offer) || !SIG.test(String(offer.location))) return false
  try {
    const host = new URL(offer.route).hostname
    if (await digest(text.encode(host).buffer as ArrayBuffer) !== offer.location) return false
  } catch { return false }
  // The gallery can be left open while a publisher advances or withdraws a
  // location. Re-read a signed door and its current location bag at click time.
  // `readOfferings` returns only an explicitly listed, current signed head.
  const hostname = new URL(offer.route).hostname
  const doors = [...new Set(offer.doors.filter(door => hostname === door
    || hostname.endsWith(`.${door}`)))]
  if (!doors.length) return false
  const carrying = selectedHost ? [selectedHost] : doors
  const currentOffers = (await Promise.all(carrying.map(door => readOfferings(door).catch(() => [])))).flat()
  if (!currentOffers.some(current => current.route === offer.route
    && current.lineage === offer.lineage && current.pubkey === offer.pubkey
    && current.location === offer.location && current.head === offer.head)) return false
  await held.initialize()
  const source = selectedHost ?? new URL(offer.route).host
  const bytesFrom = [...new Set([source, new URL(offer.route).host])]
  try { if (!await replicateSiteClosure(held, offer, bytesFrom, onProgress)) return false }
  catch { return false }
  // A failed route replacement must not create a newer adoption record that
  // can mask the route's actual, still-on layer in the management gallery.
  try {
    const current = await readHostActivation(held, target)
    if (current?.layer.enabled && (current.layer.pubkey !== offer.pubkey
      || current.layer.lineage !== offer.lineage)) return false
  } catch { return false }
  const dir = await held.getPool(ADOPTIONS_MEANING)
  if (!dir) return false
  const record: Adoption = { kind: 'host:adoption', route: offer.route, localRoute: target,
    lineage: offer.lineage, pubkey: offer.pubkey, head: offer.head, source, at: Date.now() }
  const data = text.encode(JSON.stringify(record))
  try {
    const handle = await dir.getFileHandle(await digest(data.buffer as ArrayBuffer), { create: true })
    const writable = await handle.createWritable()
    try { await writable.write(data) } finally { await writable.close() }
    if (!held.opfsRoot || !held.writeLayerBytes) return false
    await writeHostActivation(held, { enabled: true, pubkey: offer.pubkey,
      lineage: offer.lineage, sourceRoute: offer.route, localRoute: target,
      head: offer.head, source })
    return true
  } catch { return false }
}
