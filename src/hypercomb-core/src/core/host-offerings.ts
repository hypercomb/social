// One framework-free reader for a host's public offering set. A member names
// a stable location; that location's latest marker names the current head.
// The publisher's signed index authorizes the route and attests that head.
import { SignatureService } from './signature.service.js'
import { registerPoolMeaning } from './pool-registry.js'
import { isMetaEnvelope, metaPayloadOf } from './life-primitive.js'

const SIG = /^[a-f0-9]{64}$/
const HOST = /^[a-z0-9-]+(?:\.[a-z0-9-]+)*(:\d{1,5})?$/
const text = new TextEncoder()
export const HOST_OFFERINGS_MEANING = 'host:offerings'

export type HostOffering = {
  kind: 'host:offering'
  title: string
  route: string
  lineage: string
  pubkey: string
  head: string
  index: Record<string, unknown>
  doors: string[]
  /** Stable revision location: sign(hostname). */
  location?: string
}

/** A non-site creation explicitly offered by the publisher at one location. */
export type HostCreation = {
  kind: 'host:creation'
  meaning: string
  key: string
  location: string
  pubkey: string
  title: string
  host: string
  head: string
  payload: string
  index: Record<string, unknown>
}

type LocationOffering = Pick<HostOffering, 'kind' | 'title' | 'route' | 'lineage' | 'pubkey'>
  & { location: string }
export type VerifyHostIndex = (index: Record<string, unknown>) => boolean

const digest = (bytes: ArrayBuffer): Promise<string> => SignatureService.sign(bytes)
const encoded = (value: string): ArrayBuffer => text.encode(value).buffer as ArrayBuffer
const loopback = (host: string): boolean => /^(?:[a-z0-9-]+\.)*localhost(?::\d{1,5})?$/.test(host)
const baseOf = (host: string): string => `${loopback(host) ? 'http' : 'https'}://${host}`

const routeOf = (raw: string): URL | null => {
  let url: URL
  try { url = new URL(raw) } catch { return null }
  return HOST.test(url.host) && url.pathname === '/' && !url.search && !url.hash
    && (url.protocol === 'https:' || (loopback(url.host) && url.protocol === 'http:')) ? url : null
}

const signedHead = (index: Record<string, unknown>, pubkey: string, lineage: string,
  route: URL, verify: VerifyHostIndex): { head: string; doors: string[] } | null => {
  if (Number(index['kind']) !== 30564 || index['pubkey'] !== pubkey) return null
  try { if (!verify(index)) return null } catch { return null }
  let content: { roots?: Record<string, unknown>; doors?: Record<string, unknown> }
  try { content = JSON.parse(String(index['content'] ?? '')) } catch { return null }
  if (!content || typeof content !== 'object' || Array.isArray(content)
    || !content.roots || typeof content.roots !== 'object' || Array.isArray(content.roots)
    || !content.doors || typeof content.doors !== 'object' || Array.isArray(content.doors)) return null
  const head = content.roots?.[lineage]
  if (!SIG.test(String(head))) return null
  const doors = content.doors?.[lineage]
  if (!Array.isArray(doors) || !doors.some(zone => typeof zone === 'string'
    && (route.hostname === zone || route.hostname.endsWith(`.${zone}`)))) return null
  return { head: String(head),
    doors: Array.isArray(doors) ? doors.filter((zone): zone is string => typeof zone === 'string' && HOST.test(zone)) : [] }
}

/** Validate a fully resolved offer, including the publisher's attestation. */
export const parseHostOffering = (raw: unknown, verify: VerifyHostIndex): HostOffering | null => {
  const o = raw as Partial<HostOffering> | null
  if (!o || o.kind !== 'host:offering' || typeof o.title !== 'string'
    || typeof o.route !== 'string' || typeof o.lineage !== 'string'
    || !SIG.test(String(o.pubkey)) || !SIG.test(String(o.head))) return null
  const route = routeOf(o.route)
  if (!route || !o.index || typeof o.index !== 'object' || Array.isArray(o.index)) return null
  const signed = signedHead(o.index, String(o.pubkey), o.lineage, route, verify)
  if (!signed || signed.head !== o.head) return null
  return { kind: 'host:offering', title: o.title.trim().slice(0, 80) || o.lineage,
    route: route.origin + '/', lineage: o.lineage, pubkey: String(o.pubkey), head: String(o.head),
    index: o.index, doors: signed.doors, ...(o.location ? { location: o.location } : {}) }
}

const parseLocation = async (raw: unknown): Promise<LocationOffering | null> => {
  const o = raw as Partial<LocationOffering> | null
  if (!o || o.kind !== 'host:offering' || typeof o.title !== 'string'
    || typeof o.route !== 'string' || typeof o.lineage !== 'string'
    || !SIG.test(String(o.pubkey)) || !SIG.test(String(o.location))) return null
  const route = routeOf(o.route)
  if (!route || await digest(encoded(route.hostname)) !== o.location) return null
  return { kind: 'host:offering', title: o.title.trim().slice(0, 80) || o.lineage,
    route: route.origin + '/', lineage: o.lineage, pubkey: String(o.pubkey), location: o.location }
}

type LocationHead = { state: 'current'; head: string } | { state: 'absent' | 'invalid' }

const latestLocationHead = async (route: string, location: string): Promise<LocationHead> => {
  const base = `${new URL(route).origin}/content`
  try {
    const listing = await fetch(`${base}/${location}/`, { cache: 'no-store' })
    // A portal may expose a subdomain's offer without mirroring its bag.
    // Only an absent bag permits that legacy route to supply the marker.
    if (!listing.ok) return { state: listing.status === 404 ? 'absent' : 'invalid' }
    const markers = (await listing.text()).split(/\r?\n/).filter(name => /^\d{8}$/.test(name)).sort()
    const marker = markers.at(-1)
    if (!marker) return { state: 'invalid' }
    const response = await fetch(`${base}/${location}/${marker}`)
    if (!response.ok || Number(response.headers.get('content-length') ?? 0) > 65_536) return { state: 'invalid' }
    const bytes = await response.arrayBuffer()
    if (bytes.byteLength > 65_536) return { state: 'invalid' }
    let record: { layer?: unknown }
    try { record = JSON.parse(new TextDecoder().decode(bytes)) } catch { return { state: 'invalid' } }
    return SIG.test(String(record.layer))
      ? { state: 'current', head: String(record.layer) } : { state: 'invalid' }
  } catch { return { state: 'invalid' } }
}

const resolveLocation = async (raw: unknown, sourceHost: string, verify: VerifyHostIndex,
  indexes: Map<string, Promise<Record<string, unknown> | null>>): Promise<HostOffering | null> => {
  const entry = await parseLocation(raw)
  if (!entry) return null
  const indexKey = `${entry.route}${entry.pubkey}`
  let pending = indexes.get(indexKey)
  if (!pending) {
    pending = (async () => {
      try {
        const indexes = await registerPoolMeaning('hive:indexes')
        const response = await fetch(`${entry.route}${indexes}/${entry.pubkey}`, { cache: 'no-store' })
        if (!response.ok || Number(response.headers.get('content-length') ?? 0) > 524_288) return null
        const bytes = await response.arrayBuffer()
        return bytes.byteLength <= 524_288
          ? JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown> : null
      } catch { return null }
    })()
    indexes.set(indexKey, pending)
  }
  const index = await pending
  if (!index) return null
  const route = new URL(entry.route)
  const signed = signedHead(index, entry.pubkey, entry.lineage, route, verify)
  if (!signed) return null
  const source = baseOf(sourceHost)
  const published = await latestLocationHead(source, entry.location)
  const portal = route.hostname.endsWith(`.${new URL(source).hostname}`)
  const current = published.state === 'absent' && portal
    ? await latestLocationHead(entry.route, entry.location) : published
  if (current.state !== 'current' || current.head !== signed.head) return null
  return { ...entry, head: current.head, index, doors: signed.doors }
}

/** Discover current, explicitly public locations; never execute their code. */
export const readHostOfferings = async (host: string, verify: VerifyHostIndex): Promise<HostOffering[]> => {
  if (!HOST.test(host)) return []
  const pool = await digest(encoded(HOST_OFFERINGS_MEANING))
  for (const base of [`${baseOf(host)}/content`, baseOf(host)]) {
    try {
      const listing = await fetch(`${base}/${pool}/`, { cache: 'no-store' })
      if (!listing.ok) continue
      const names = [...new Set((await listing.text()).split(/\r?\n/).map(s => s.trim()).filter(s => SIG.test(s)))].slice(0, 1000)
      if (names.length === 0) continue
      const rows: (HostOffering | null)[] = []
      const indexes = new Map<string, Promise<Record<string, unknown> | null>>()
      for (let at = 0; at < names.length; at += 12) {
        rows.push(...await Promise.all(names.slice(at, at + 12).map(async name => {
          try {
            const response = await fetch(`${base}/${pool}/${name}`)
            if (!response.ok || Number(response.headers.get('content-length') ?? 0) > 262_144) return null
            const bytes = await response.arrayBuffer()
            if (bytes.byteLength > 262_144 || await digest(bytes) !== name) return null
            return await resolveLocation(JSON.parse(new TextDecoder().decode(bytes)), host, verify, indexes)
          } catch { return null }
        })))
      }
      const verified = rows.filter((row): row is HostOffering => !!row)
      if (verified.length > 0) return verified
    } catch { /* try the other content face */ }
  }
  return []
}

type CreationMember = Pick<HostCreation,
  'kind' | 'meaning' | 'key' | 'location' | 'pubkey' | 'title' | 'host'>

const fetchAtom = async (base: string, sig: string, limit: number): Promise<Uint8Array | null> => {
  try {
    const response = await fetch(`${base}/${sig}`, { cache: 'no-store' })
    if (!response.ok || Number(response.headers.get('content-length') ?? 0) > limit) return null
    const bytes = new Uint8Array(await response.arrayBuffer())
    return bytes.byteLength <= limit && await digest(bytes.buffer as ArrayBuffer) === sig ? bytes : null
  } catch { return null }
}

const creationMember = async (raw: unknown, host: string): Promise<CreationMember | null> => {
  const item = raw as Partial<CreationMember> | null
  if (!item || item.kind !== 'host:creation' || item.host !== host
    || typeof item.meaning !== 'string' || !item.meaning.includes(':') || item.meaning.length > 128
    || typeof item.key !== 'string' || !item.key || item.key.length > 256
    || typeof item.title !== 'string' || !item.title.trim() || item.title.length > 160
    || !SIG.test(String(item.pubkey)) || !SIG.test(String(item.location))) return null
  if (await digest(encoded(`${item.meaning}:${item.key}`)) !== item.location) return null
  return item as CreationMember
}

const declaredCreation = (index: Record<string, unknown>, member: CreationMember,
  verify: VerifyHostIndex): string | null => {
  if (Number(index['kind']) !== 30564 || index['pubkey'] !== member.pubkey) return null
  try { if (!verify(index)) return null } catch { return null }
  let content: Record<string, unknown>
  try { content = JSON.parse(String(index['content'] ?? '')) } catch { return null }
  if (!content || typeof content !== 'object' || Array.isArray(content)) return null
  const offerings = content['offerings'] as Record<string, unknown> | null
  if (!offerings || typeof offerings !== 'object' || Array.isArray(offerings)) return null
  const raw = offerings[member.location]
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const declared = raw as Record<string, unknown>
  if (declared['meaning'] !== member.meaning || declared['key'] !== member.key
    || declared['title'] !== member.title || declared['host'] !== member.host
    || !SIG.test(String(declared['head']))) return null
  return String(declared['head'])
}

/** Resolve one creation through its signed public switch and current bag. */
const resolveCreation = async (raw: unknown, host: string, verify: VerifyHostIndex,
  indexCache: Map<string, Promise<Record<string, unknown> | null>>): Promise<HostCreation | null> => {
  const member = await creationMember(raw, host)
  if (!member) return null
  const base = baseOf(host)
  let pending = indexCache.get(member.pubkey)
  if (!pending) {
    pending = (async () => {
      // A publisher's signed index is the member of sign('hive:indexes')
      // named by their key — addressed by signature, never a named route.
      try {
        const indexes = await registerPoolMeaning('hive:indexes')
        const response = await fetch(`${base}/${indexes}/${member.pubkey}`, { cache: 'no-store' })
        if (!response.ok || Number(response.headers.get('content-length') ?? 0) > 524_288) return null
        const value = await response.arrayBuffer()
        return value.byteLength <= 524_288
          ? JSON.parse(new TextDecoder().decode(value)) as Record<string, unknown> : null
      } catch { return null }
    })()
    indexCache.set(member.pubkey, pending)
  }
  const index = await pending
  if (!index) return null
  const head = declaredCreation(index, member, verify)
  const current = await latestLocationHead(base, member.location)
  if (!head || current.state !== 'current' || current.head !== head) return null
  const metaBytes = await fetchAtom(base, head, 65_536)
  if (!metaBytes) return null
  let meta: unknown
  try { meta = JSON.parse(new TextDecoder().decode(metaBytes)) } catch { return null }
  const payload = metaPayloadOf(meta)
  if (!isMetaEnvelope(meta) || meta.relation !== member.meaning || payload?.kind !== 'layer') return null
  const layerBytes = await fetchAtom(base, payload.sig, 1_048_576)
  if (!layerBytes) return null
  try {
    const layer = JSON.parse(new TextDecoder().decode(layerBytes)) as Record<string, unknown>
    if (!layer || typeof layer !== 'object' || Array.isArray(layer)
      || typeof layer['name'] !== 'string') return null
  } catch { return null }
  return { ...member, head, payload: payload.sig, index }
}

/** Read explicit non-site creations without importing or running their code. */
export const readHostCreations = async (host: string, verify: VerifyHostIndex): Promise<HostCreation[]> => {
  if (!HOST.test(host)) return []
  const pool = await digest(encoded(HOST_OFFERINGS_MEANING))
  for (const base of [`${baseOf(host)}/content`, baseOf(host)]) {
    try {
      const response = await fetch(`${base}/${pool}/`, { cache: 'no-store' })
      if (!response.ok) continue
      const names = [...new Set((await response.text()).split(/\r?\n/).map(s => s.trim())
        .filter(s => SIG.test(s)))].slice(0, 1000)
      const rows: HostCreation[] = []
      const indexes = new Map<string, Promise<Record<string, unknown> | null>>()
      for (let at = 0; at < names.length; at += 12) {
        const batch = await Promise.all(names.slice(at, at + 12).map(async name => {
          const bytes = await fetchAtom(`${base}/${pool}`, name, 262_144)
          if (!bytes) return null
          try { return await resolveCreation(JSON.parse(new TextDecoder().decode(bytes)), host, verify, indexes) }
          catch { return null }
        }))
        rows.push(...batch.filter((row): row is HostCreation => !!row))
      }
      if (rows.length) return rows
    } catch { /* try the other content face */ }
  }
  return []
}
