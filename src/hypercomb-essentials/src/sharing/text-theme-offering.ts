// One explicit public switch for a held text-theme creation. The local
// themes:text pool remains private; the host projects only signed selections.
import { CODE_FONTS, READ_FONTS, SignatureService, get, isMetaEnvelope,
  latestLayerMarker, metaPayloadOf, type TextTheme } from '@hypercomb/core'
import { fetchHiveIndex, putHiveManifest } from './hive-pointer.js'

const MEANING = 'themes:text'
const SIG = /^[a-f0-9]{64}$/
const DOMAIN = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/
const STORE_KEY = '@hypercomb.social/Store'
const SYNC_KEY = '@diamondcoreprocessor.com/HostSyncService'
const SIGNER_KEY = '@diamondcoreprocessor.com/NostrSigner'

type StoreLike = {
  openPool: (meaning: string) => Promise<FileSystemDirectoryHandle | null>
  getResourceLocal: (sig: string) => Promise<Blob | null>
  getLayerPoolBytes: (sig: string) => Promise<Uint8Array | null>
}
type SyncLike = {
  publicHostDomain: () => string
  publishAtoms: (host: string, sigs: readonly string[], bytesOf: (sig: string) => Promise<Uint8Array | null>) =>
    Promise<{ ok: true; sent: number; held: number } | { ok: false; error: string; sig?: string }>
}
type SignerLike = { getPublicKeyHex: () => Promise<string | null> }

export type TextThemeOfferState = 'off' | 'current' | 'outdated' | 'pending'
export type TextThemeOfferResult =
  | { ok: true; state: TextThemeOfferState }
  | { ok: false; reason: string }

export type TextThemeOfferDeps = {
  store?: StoreLike
  sync?: SyncLike
  pubkey?: () => Promise<string | null>
  readIndex?: typeof fetchHiveIndex
  putIndex?: typeof putHiveManifest
  readMarker?: (host: string, location: string) => Promise<string | null>
}

const exact = (bytes: Uint8Array): ArrayBuffer =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
const digest = (bytes: Uint8Array): Promise<string> => SignatureService.sign(exact(bytes))
const encoder = new TextEncoder()

/** The chosen visible domain, never a route or a content endpoint. */
export const textThemeOfferHost = (sync?: Pick<SyncLike, 'publicHostDomain'>): string => {
  const target = sync ?? get<SyncLike>(SYNC_KEY)
  const contentHost = String(target?.publicHostDomain?.() ?? '').trim().toLowerCase()
  return contentHost.startsWith('content.') ? contentHost.slice('content.'.length) : contentHost
}

const cleanHost = (raw: string): string | null => {
  const host = String(raw ?? '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/+$/, '')
  return DOMAIN.test(host) ? host : null
}

const identity = async (theme: TextTheme): Promise<string | null> => {
  if (!theme.key || !SIG.test(String(theme.location)) || !SIG.test(String(theme.head))) return null
  return await digest(encoder.encode(`${MEANING}:${theme.key}`)) === theme.location ? theme.location : null
}

type HeldTheme = { head: string; payload: string; bytes: Map<string, Uint8Array> }

/** Read only held bytes and the latest local location marker. An old selected
 *  head cannot silently replace a newer revision when the switch is pressed. */
export const heldTextTheme = async (theme: TextTheme, store: StoreLike): Promise<HeldTheme | null> => {
  const location = await identity(theme)
  if (!location) return null
  try {
    const pool = await store.openPool(MEANING)
    const bag = await pool?.getDirectoryHandle(location, { create: false })
    if (!bag || (await latestLayerMarker(bag))?.layer !== theme.head) return null
    const metaBlob = await store.getResourceLocal(theme.head!)
    if (!metaBlob) return null
    const metaBytes = new Uint8Array(await metaBlob.arrayBuffer())
    if (await digest(metaBytes) !== theme.head) return null
    const meta = JSON.parse(new TextDecoder().decode(metaBytes)) as unknown
    const payload = metaPayloadOf(meta)
    if (!isMetaEnvelope(meta) || payload?.kind !== 'layer' || meta.relation !== MEANING) return null
    const layerBytes = await store.getLayerPoolBytes(payload.sig)
    if (!layerBytes || await digest(layerBytes) !== payload.sig) return null
    const layer = JSON.parse(new TextDecoder().decode(layerBytes)) as Record<string, unknown>
    if (!layer || typeof layer !== 'object' || Array.isArray(layer)
      || layer['name'] !== 'text-theme' || layer['label'] !== theme.label
      || layer['read'] !== theme.read || layer['code'] !== theme.code
      || typeof layer['label'] !== 'string' || !layer['label'].trim()
      || layer['label'].length > 80
      || !READ_FONTS.some(face => face.key === layer['read'])
      || !CODE_FONTS.some(face => face.key === layer['code'])
      || (layer['source'] !== undefined && !SIG.test(String(layer['source'])))
      || !Object.keys(layer).every(key => ['name', 'label', 'read', 'code', 'source'].includes(key))) return null
    // `source` is borrowed-revision provenance. The worker's typed-leaf
    // reader does not dereference it, so it is not part of this deploy payload.
    return { head: theme.head!, payload: payload.sig,
      bytes: new Map([[payload.sig, layerBytes], [theme.head!, metaBytes]]) }
  } catch { return null }
}

const currentMarker = async (host: string, location: string): Promise<string | null> => {
  const base = `https://${host}/content/${location}/`
  try {
    const listing = await fetch(base, { cache: 'no-store' })
    if (!listing.ok) return null
    const names = (await listing.text()).split(/\r?\n/).filter(name => /^\d{8}$/.test(name)).sort()
    const name = names.at(-1)
    if (!name) return null
    const marker = await fetch(base + name, { cache: 'no-store' })
    if (!marker.ok || Number(marker.headers.get('content-length') ?? 0) > 65_536) return null
    const bytes = await marker.arrayBuffer()
    if (bytes.byteLength > 65_536) return null
    const record = JSON.parse(new TextDecoder().decode(bytes)) as { layer?: unknown }
    return SIG.test(String(record.layer)) ? String(record.layer) : null
  } catch { return null }
}

const scope = async (host: string, deps: TextThemeOfferDeps): Promise<
  { host: string; endpoint: string; pubkey: string; sync: SyncLike } | { reason: string }
> => {
  const selected = cleanHost(host)
  if (!selected) return { reason: 'Choose a root domain such as jwize.com.' }
  const sync = deps.sync ?? get<SyncLike>(SYNC_KEY)
  if (!sync?.publishAtoms || !sync.publicHostDomain) return { reason: 'Host sync is unavailable.' }
  const endpoint = String(sync.publicHostDomain()).trim().toLowerCase()
  if (!DOMAIN.test(endpoint)) return { reason: 'Choose a public content host in Hosts first.' }
  const signer = get<SignerLike>(SIGNER_KEY)
  const pubkey = String(await (deps.pubkey?.() ?? signer?.getPublicKeyHex?.()) ?? '').toLowerCase()
  if (!SIG.test(pubkey)) return { reason: 'A signing key is required.' }
  return { host: selected, endpoint, pubkey, sync }
}

const indexAt = async (endpoint: string, pubkey: string, deps: TextThemeOfferDeps) => {
  const read = await (deps.readIndex ?? fetchHiveIndex)(endpoint, pubkey)
  if (read.ok && !read.manifest.signedContent) return { ok: false as const, reason: 'Verified index content is unavailable.' }
  if (!read.ok && !(read.reason === 'http' && read.status === 404)) {
    return { ok: false as const, reason: `Cannot safely read the host index (${read.reason}).` }
  }
  return { ok: true as const, read }
}

const declaration = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null

/** Read the signed public switch and the host's current location marker. */
export const textThemeOfferingStatus = async (
  theme: TextTheme, host: string, deps: TextThemeOfferDeps = {},
): Promise<TextThemeOfferResult> => {
  const location = await identity(theme)
  if (!location) return { ok: false, reason: 'Choose a saved theme from this hive.' }
  const target = await scope(host, deps)
  if ('reason' in target) return { ok: false, reason: target.reason }
  const indexed = await indexAt(target.endpoint, target.pubkey, deps)
  if (!indexed.ok) return indexed
  const read = indexed.read
  const offered = declaration(read.ok ? read.manifest.offerings?.[location] : undefined)
  if (!offered || offered['host'] !== target.host || offered['meaning'] !== MEANING
    || offered['key'] !== theme.key) return { ok: true, state: 'off' }
  if (offered['head'] !== theme.head || offered['title'] !== theme.label) return { ok: true, state: 'outdated' }
  const marker = await (deps.readMarker ?? currentMarker)(target.host, location)
  return { ok: true, state: marker === theme.head ? 'current' : 'pending' }
}

/** Stage the exact typed leaf before signing its public declaration. Off only
 *  removes that declaration; the host retains named bytes and old revisions. */
export const setTextThemeOffering = async (
  theme: TextTheme, host: string, on: boolean, deps: TextThemeOfferDeps = {},
): Promise<TextThemeOfferResult> => {
  if ((globalThis as typeof globalThis & { __HC_READONLY__?: boolean }).__HC_READONLY__ === true) {
    return { ok: false, reason: 'This visitor hive cannot publish.' }
  }
  const location = await identity(theme)
  if (!location) return { ok: false, reason: 'Choose a saved theme from this hive.' }
  const target = await scope(host, deps)
  if ('reason' in target) return { ok: false, reason: target.reason }
  const indexed = await indexAt(target.endpoint, target.pubkey, deps)
  if (!indexed.ok) return indexed
  const read = indexed.read
  const previous = read.ok ? read.manifest.signedContent! : undefined
  const offerings = { ...(read.ok ? read.manifest.offerings ?? {} : {}) }
  const already = declaration(offerings[location])
  if (!on && (!already || already['host'] !== target.host)) return { ok: true, state: 'off' }
  if (on) {
    const store = deps.store ?? get<StoreLike>(STORE_KEY)
    const held = store ? await heldTextTheme(theme, store) : null
    if (!held) return { ok: false, reason: 'The selected theme is not the current held revision.' }
    const sent = await target.sync.publishAtoms(target.endpoint, [held.payload, held.head],
      async sig => held.bytes.get(sig) ?? null)
    if (!sent.ok) return { ok: false, reason: sent.error }
    offerings[location] = { meaning: MEANING, key: theme.key, head: held.head,
      title: theme.label, host: target.host }
  } else {
    delete offerings[location]
  }
  const put = await (deps.putIndex ?? putHiveManifest)(target.endpoint,
    read.ok ? read.manifest.roots : {}, read.ok ? read.manifest.doors ?? {} : {},
    read.ok ? read.manifest.createdAt : 0, { ...previous, offerings })
  if (!put.ok) return { ok: false, reason: put.reason ?? 'The signed index refused the change.' }
  if (put.pubkey !== target.pubkey) return { ok: false, reason: 'The signing key changed during publication.' }
  const result = await textThemeOfferingStatus(theme, target.host, deps)
  if (!result.ok) return result
  if (on && result.state !== 'current') return { ok: false, reason: 'The host has not served the offered revision yet.' }
  if (!on && result.state !== 'off') return { ok: false, reason: 'The host still declares this theme.' }
  return result
}
