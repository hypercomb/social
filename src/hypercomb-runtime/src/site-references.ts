// The typed references a selected public site actually carries. The cold host
// reads these declarations before it enables a local route. An unknown form
// returns null, so a new reference kind cannot silently produce a partial site.
import { CHILD_SLOTS, isEdgeField, isMetaEnvelope, isReferentField, metaPayloadOf } from '@hypercomb/core'

export type SiteReferenceKind = 'layer' | 'bee' | 'dependency' | 'resource'
export type SiteResourceRole = 'ordinary' | 'html' | 'child-list'
export type SiteReference = { sig: string; kind: SiteReferenceKind; role?: SiteResourceRole }

const SIG = /^[a-f0-9]{64}$/
const CHILDREN = new Set<string>(CHILD_SLOTS)
const text = new TextDecoder()
const RESOURCE_FIELDS = new Set(['image', 'attachment', 'asset', 'entry', 'link', 'preview', 'thumbnail', 'requiredBouquet'])
const RESOURCE_LISTS = new Set(['children', 'images', 'attachments', 'assets', 'pages', 'resources'])

const signature = (raw: unknown, module = false): string => {
  const value = String(raw ?? '').trim().toLowerCase()
  const bare = module ? value.replace(/\.(?:js|json)$/, '') : value
  return SIG.test(bare) ? bare : ''
}

const containsSignature = (value: unknown): boolean => {
  const pending = [value]
  let examined = 0
  while (pending.length) {
    if (++examined > 10_000) return true
    const next = pending.pop()
    if (typeof next === 'string' && /[a-f0-9]{64}/i.test(next)) return true
    if (Array.isArray(next)) {
      for (const item of next) pending.push(item)
    } else if (next && typeof next === 'object') {
      for (const [key, item] of Object.entries(next as Record<string, unknown>)) {
        if (!isReferentField(key)) pending.push(item)
      }
    }
  }
  return false
}

const distinct = (refs: SiteReference[]): SiteReference[] => {
  const held = new Set<string>()
  return refs.filter(ref => {
    const key = `${ref.kind}:${ref.sig}:${ref.role ?? ''}`
    if (held.has(key)) return false
    held.add(key)
    return true
  })
}

/** `cells`, `layers`, `children` are layers; the two executable slots retain
 * their kinds; every other signature slot is a resource. A scalar child slot
 * is the older pointer to a JSON array of child layer signatures. */
export const siteLayerReferences = (raw: unknown): SiteReference[] | null => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const layer = raw as Record<string, unknown>
  if (layer['meta'] === 1) {
    if (!isMetaEnvelope(layer)) return null
    const payload = metaPayloadOf(layer)
    if (!payload) return null
    const role = payload.kind === 'resource' && CHILDREN.has(String(layer['relation'] ?? ''))
      ? 'child-list' : undefined
    return [{ sig: payload.sig, kind: payload.kind, ...(role ? { role } : {}) }]
  }
  if (typeof layer['name'] !== 'string') return null
  const refs: SiteReference[] = []
  for (const [slot, value] of Object.entries(layer)) {
    if (slot === 'name' || isReferentField(slot) || value == null || value === '') continue
    const child = CHILDREN.has(slot)
    const kind: SiteReferenceKind = child ? 'layer'
      : slot === 'bees' ? 'bee' : slot === 'dependencies' ? 'dependency' : 'resource'
    const required = child || slot === 'bees' || slot === 'dependencies'
      || slot === 'decorations' || slot === 'properties' || slot === 'context'
    if (Array.isArray(value)) {
      for (const item of value) {
        const rawSig = typeof item === 'string' ? item
          : item && typeof item === 'object' ? (item as Record<string, unknown>)['sig'] : ''
        const sig = signature(rawSig, kind === 'bee' || kind === 'dependency' || child)
        if (sig) {
          if (item && typeof item === 'object') {
            const { sig: _declared, ...rest } = item as Record<string, unknown>
            if (containsSignature(rest)) return null
          }
          refs.push({ sig, kind })
        }
        else if (required || containsSignature(item)) return null
      }
    } else if (typeof value === 'string') {
      const sig = signature(value, kind === 'bee' || kind === 'dependency' || child)
      if (sig) refs.push(child ? { sig, kind: 'resource', role: 'child-list' } : { sig, kind })
      else if (required || containsSignature(value)) return null
    } else if (containsSignature(value)) return null
  }
  return distinct(refs)
}

/** The renderer rewrites `resource:<sig>` and bare-sig src/href attributes.
 * Its already-rewritten `/@resource/<sig>` URL also names a local resource.
 * Refuse recognizable malformed references before enabling the site. */
export const sitePageReferences = (bytes: Uint8Array): SiteReference[] | null => {
  const html = text.decode(bytes)
  const sigs = new Set<string>()
  for (const match of html.matchAll(/(?:resource:|\/@resource\/)([^\s'"()<>]+)/g)) {
    const sig = match[1]!.split(/[/?#]/, 1)[0]!
    if (!SIG.test(sig)) return null
    sigs.add(sig)
  }
  for (const match of html.matchAll(/(?:src|href|data-src)=(['"])(.*?)\1/g)) {
    const value = match[2]!
    if (SIG.test(value)) sigs.add(value)
    // A bare signature with a path suffix is not one of the renderer's
    // rewrite forms; accepting it would leave a broken relative URL.
    else if (/^\/?[a-f0-9]{64}(?:[/?#]|$)/.test(value)) return null
  }
  return [...sigs].map(sig => ({ sig, kind: 'resource' }))
}

const jsonObject = (bytes: Uint8Array): Record<string, unknown> | null => {
  let first = 0
  while (first < bytes.length && [9, 10, 13, 32].includes(bytes[first]!)) first++
  if (bytes[first] !== 123) return null
  try {
    const value = JSON.parse(text.decode(bytes)) as unknown
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown> : null
  } catch { return null }
}

const resourceValue = (value: unknown): string => {
  const direct = signature(value)
  if (direct) return direct
  if (typeof value !== 'string') return ''
  const url = /^(?:resource:|\/?@resource\/)([a-f0-9]{64})(?:\/[^?#]*)?(?:[?#].*)?$/.exec(value.trim().toLowerCase())
  return url?.[1] ?? ''
}

/** Collect only fields the shared edge grammar or a known resource-bearing
 * property names. An ordinary sentence containing 64 hex characters is data,
 * not an instruction to fetch bytes. A declared reference with an unknown
 * shape makes the site incomplete instead of silently dropping an edge. */
const dataResourceReferences = (record: Record<string, unknown>): SiteReference[] | null => {
  const refs: SiteReference[] = []
  const pending: { value: unknown; key: string }[] = [{ value: record, key: '' }]
  let examined = 0
  while (pending.length) {
    if (++examined > 10_000) return null
    const { value, key } = pending.pop()!
    if (isReferentField(key)) continue
    const named = isEdgeField(key) || key.endsWith('Sig') || RESOURCE_FIELDS.has(key)
    const list = RESOURCE_LISTS.has(key)
    const kind: SiteReferenceKind = key === 'layer' || key === 'bee' || key === 'dependency'
      ? key : 'resource'
    if (typeof value === 'string') {
      if (!named && !list) continue
      const sig = resourceValue(value)
      if (sig) refs.push({ sig, kind,
        ...(key === 'htmlSig' || key === 'entry' ? { role: 'html' as const } : {}) })
      else if (key.endsWith('Sig') || key === 'requiredBouquet'
        || key === 'refs' || key === 'members' || list
        || /^(?:resource:|\/?@resource\/)/i.test(value.trim())) return null
    } else if (Array.isArray(value)) {
      if (key === 'refs' || key === 'members' || list) {
        for (const item of value) {
          const sig = resourceValue(item)
          if (!sig) return null
          refs.push({ sig, kind, ...(key === 'pages' ? { role: 'html' as const } : {}) })
        }
      } else {
        for (const item of value) pending.push({ value: item, key })
      }
    } else if (value && typeof value === 'object') {
      if (key.endsWith('Sig') || key === 'requiredBouquet'
        || key === 'refs' || key === 'members') return null
      if (list) {
        for (const item of Object.values(value as Record<string, unknown>)) {
          const sig = resourceValue(item)
          if (!sig) return null
          refs.push({ sig, kind, ...(key === 'pages' ? { role: 'html' as const } : {}) })
        }
      } else for (const [child, item] of Object.entries(value as Record<string, unknown>)) {
        pending.push({ value: item, key: child })
      }
    } else if (value != null && value !== '' && (key.endsWith('Sig')
      || key === 'requiredBouquet' || key === 'refs' || list)) return null
  }
  return distinct(refs)
}

/** Resource records can name further resources. Decoration `refs` is the
 * forward contract; older page decorations name an HTML body whose rendered
 * src/href references are then read with `sitePageReferences`. */
export const siteResourceReferences = (bytes: Uint8Array, role: SiteResourceRole = 'ordinary'):
  SiteReference[] | null => {
  const record = jsonObject(bytes)
  if (record?.['meta'] === 1) {
    if (!isMetaEnvelope(record)) return null
    const payload = metaPayloadOf(record)
    if (!payload || role === 'child-list' && payload.kind !== 'resource'
      || role === 'html' && payload.kind !== 'resource') return null
    return [{ sig: payload.sig, kind: payload.kind,
      ...(role !== 'ordinary' ? { role } : {}) }]
  }
  if (role === 'html') return sitePageReferences(bytes)
  if (role === 'child-list') {
    let list: unknown
    try { list = JSON.parse(text.decode(bytes)) } catch { return null }
    if (!Array.isArray(list)) return null
    const refs = list.map(value => signature(value))
    return refs.every(Boolean) ? refs.map(sig => ({ sig, kind: 'layer' })) : null
  }
  if (!record) return []
  const kind = record['kind']
  if (typeof kind === 'number') return [] // signed events carry identities
  if (kind === 'group' || kind === 'creation') return [] // identity-only
  return dataResourceReferences(record)
}
