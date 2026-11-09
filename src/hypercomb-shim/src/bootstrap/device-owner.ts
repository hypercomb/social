// hypercomb-shim/src/bootstrap/device-owner.ts
//
// GOING LIVE FROM A PHONE (documentation/phone-showcase-signing.md, part 2; jwize
// 2026-11-04: "once in our community we can promote it by clicking to go live").
//
// The owner bridge (owner-bridge.ts) asks a hive beside the page to sign. A phone
// has no hive beside it. A browser that accepted its owner's invite
// (device-invite.ts) has its own key on the owner's list instead, and this is the
// same bridge answered by that key: hello says whose index this browser writes
// (the anchor), and a toggle does what the hive's applyToggle + signShowcase do —
// read the anchor's index and showcase on the zone, switch the one item, upload the
// new record, and sign the index again, tagged `['anchor', <anchor>]` and
// `['prev', <the index it replaces>]` so the host takes it as the anchor's and two
// places writing at once cannot drop each other's change.
//
// The index write touches ONE root and carries every other field of the index it
// read, read fresh right before signing — never a stale copy (hive-pointer.ts says
// why: a stale copy would sign powers the owner had turned off).

import { SignatureService, nip98Authorization, nip98Template } from '@hypercomb/core'
import { readDeviceBinding, type DeviceBinding } from './device-binding'
import { putKeyChain, readKeyChain } from './device-invite'
import { deviceSigner, type DeviceSigner } from './device-key'
import type { OwnerBridge, OwnerResult, OwnerToggle } from './owner-bridge'
import {
  readOwnerIndex, readShowcaseAtom, showcaseBytes, showcaseKey, showcasesItem, toggleShowcaseItem, zoneOrigin,
  type ShowcaseItem, type ShowcaseRecord,
} from './showcase-record'

const SIG = /^[0-9a-f]{64}$/
const HIVE_INDEX_KIND = 30564
const HIVE_LINK_VERSION = 1

const sha = (bytes: Uint8Array | string): Promise<string> =>
  SignatureService.sign((typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes).slice().buffer as ArrayBuffer)

const authFor = (signer: DeviceSigner, url: string, anchor: string, payload?: string): string =>
  nip98Authorization(signer.sign(nip98Template(url, 'PUT', Date.now() / 1000, payload, [['anchor', anchor]])))

/** Does the zone hold the anchor's list with this browser's key on it? When it does not, the list is
 *  carried from a host the binding names. A host takes nothing this key signs for the anchor without it. */
export const carryChain = async (zone: string, binding: DeviceBinding, signer: DeviceSigner): Promise<boolean> => {
  const here = await readKeyChain(zone, binding.anchor)
  if (here && here !== 'none' && here.keys.includes(signer.pubkey)) return true
  if (!here) return false
  for (const source of binding.sources) {
    if (source === zone) continue
    const there = await readKeyChain(source, binding.anchor)
    if (!there || there === 'none' || !there.keys.includes(signer.pubkey)) continue
    if (here !== 'none' && there.chain.length <= here.chain.length) continue
    if ((await putKeyChain(zone, binding.anchor, there.chain, signer)).ok) return true
  }
  return false
}

/** Put one record on the zone, unless it already serves it, and read it back. */
const uploadRecord = async (zone: string, bytes: Uint8Array, sig: string, anchor: string, signer: DeviceSigner): Promise<string | null> => {
  const url = `${zoneOrigin(zone)}/${sig}`
  try {
    // `?held`: a host that knows the flag answers a miss 204, not a 404 the
    // console prints as an error — so only a 200 is held.
    const there = await fetch(`${url}?held`, { method: 'HEAD', cache: 'no-store' })
    if (there.status === 200 && !(there.headers.get('content-type') ?? '').toLowerCase().includes('text/html')) return null
  } catch { /* the PUT says whether it is reachable */ }
  try {
    const put = await fetch(url, { method: 'PUT', headers: { Authorization: authFor(signer, url, anchor) }, body: bytes.slice().buffer as ArrayBuffer })
    if (put.status === 401 || put.status === 403) return `${zone} does not take uploads from this browser's key`
    if (!put.ok) return `${zone} refused the showcase (HTTP ${put.status})`
    const back = await fetch(url, { cache: 'no-store' })
    if (!back.ok || await sha(new Uint8Array(await back.arrayBuffer())) !== sig) return `${zone} took the showcase but does not serve it back`
    return null
  } catch { return `${zone} could not be reached` }
}

/** The lineages the anchor's doors open on this zone. */
const openOn = (zone: string, anchor: string, content: Record<string, unknown>): ShowcaseItem[] => {
  const doors = content['doors'] && typeof content['doors'] === 'object' ? content['doors'] as Record<string, unknown> : {}
  return Object.entries(doors)
    .filter(([lineage, listed]) => lineage && lineage.length <= 200 && Array.isArray(listed)
      && listed.some(door => { const name = String(door).toLowerCase(); return name === zone || zone.endsWith(`.${name}`) }))
    .map(([lineage]) => ({ pubkey: anchor, lineage }))
}

type Attempt = OwnerResult | 'stale'

/** One read-switch-sign of the anchor's showcase on the zone. 'stale' when the host holds a newer index
 *  than the one read: read again. */
const attempt = async (request: OwnerToggle, anchor: string, signer: DeviceSigner): Promise<Attempt> => {
  const zone = request.zone
  const item: ShowcaseItem = { pubkey: request.pubkey, lineage: request.lineage }
  const read = await readOwnerIndex(zone, anchor)
  if (!read) return { ok: false, reason: `could not read your index on ${zone}` }
  const content: Record<string, unknown> = read === 'missing' ? { v: HIVE_LINK_VERSION, roots: {} } : read.content
  const roots = content['roots'] && typeof content['roots'] === 'object' ? content['roots'] as Record<string, string> : {}
  const key = showcaseKey(zone)
  const named = String(roots[key] ?? '').toLowerCase()
  let current: ShowcaseRecord | null = null
  if (SIG.test(named)) {
    current = await readShowcaseAtom(zone, named)
    if (!current) return { ok: false, reason: 'could not read the showcase' }
  }
  let next: ShowcaseRecord
  if (current) {
    if (showcasesItem(current, item) === request.on) return { ok: true, changed: false }
    next = toggleShowcaseItem(current, item)
  } else if (request.on) {
    next = { zone, items: [item], domains: [] }
  } else {
    // No record yet: everything published here is shown. Taking one out records the rest.
    const open = openOn(zone, anchor, content)
    if (!open.some(row => row.pubkey === item.pubkey && row.lineage === item.lineage)) return { ok: true, changed: false }
    next = { zone, items: open.filter(row => !(row.pubkey === item.pubkey && row.lineage === item.lineage)), domains: [] }
  }
  const bytes = showcaseBytes(next)
  const sig = await sha(bytes)
  const refused = await uploadRecord(zone, bytes, sig, anchor, signer)
  if (refused) return { ok: false, reason: refused }

  const before = read === 'missing' ? null : read.event
  const event = signer.sign({
    kind: HIVE_INDEX_KIND,
    created_at: Math.max(Math.floor(Date.now() / 1000), Number(before?.['created_at'] ?? 0) + 1),
    tags: [['anchor', anchor], ...(before ? [['prev', String(before['id'] ?? '')]] : [])],
    content: JSON.stringify({ ...content, v: content['v'] ?? HIVE_LINK_VERSION, roots: { ...roots, [key]: sig } }),
  })
  const indexes = await sha('hive:indexes')
  const url = `${zoneOrigin(zone)}/${indexes}/${anchor}`
  const body = JSON.stringify(event)
  try {
    const put = await fetch(url, { method: 'PUT', headers: { Authorization: authFor(signer, url, anchor, await sha(body)), 'Content-Type': 'application/json' }, body })
    if (put.status === 409) return 'stale'
    if (!put.ok) return { ok: false, reason: `${zone} refused the index (${put.status}${put.headers.get('X-Reason') ? `: ${put.headers.get('X-Reason')}` : ''})` }
  } catch { return { ok: false, reason: `${zone} could not be reached` } }
  return { ok: true, changed: true }
}

export type DeviceOwnerDeps = {
  readonly signer?: () => DeviceSigner | null
  readonly binding?: () => Promise<DeviceBinding | null>
}

/** The bridge answered by this browser's own key, for one zone. Hello answers '' — this browser is a
 *  visitor — unless it holds a key, a binding, and the zone holds the anchor's list naming that key. */
export const deviceOwner = (zone: string, deps: DeviceOwnerDeps = {}): OwnerBridge => {
  const signerOf = deps.signer ?? (() => deviceSigner(false))
  const bindingOf = deps.binding ?? readDeviceBinding
  let ready: Promise<{ signer: DeviceSigner; anchor: string } | null> | null = null
  const ensure = () => ready ??= (async () => {
    const signer = signerOf()
    if (!signer) return null
    const binding = await bindingOf()
    if (!binding) return null
    return await carryChain(zone, binding, signer) ? { signer, anchor: binding.anchor } : null
  })().catch(() => null)
  let lane: Promise<unknown> = Promise.resolve()
  return {
    hello: async () => (await ensure())?.anchor ?? '',
    toggle: request => {
      const run = lane.then(async (): Promise<OwnerResult> => {
        const held = await ensure()
        if (!held) return { ok: false, reason: 'this browser is not on your key list here' }
        if (request.zone !== zone || !SIG.test(request.pubkey) || !request.lineage || request.lineage.length > 200) return { ok: false, reason: 'bad request' }
        for (let tries = 0; tries < 2; tries++) {
          const result = await attempt(request, held.anchor, held.signer).catch((): OwnerResult => ({ ok: false, reason: 'failed' }))
          if (result !== 'stale') return result
        }
        return { ok: false, reason: 'your index kept changing underneath; try again' }
      })
      lane = run.catch(() => undefined)
      return run
    },
  }
}

/** The first owner that answers hello is the one that signs: the hive beside the page when there is one,
 *  else this browser's own key. Null when there is neither. */
export const eitherOwner = (...owners: readonly (OwnerBridge | null)[]): OwnerBridge | null => {
  const present = owners.filter((owner): owner is OwnerBridge => !!owner)
  if (!present.length) return null
  let chosen: OwnerBridge | null = null
  return {
    hello: async () => {
      for (const owner of present) {
        const key = await owner.hello().catch(() => '')
        if (key) { chosen = owner; return key }
      }
      return ''
    },
    toggle: request => chosen ? chosen.toggle(request) : Promise.resolve({ ok: false, reason: 'no key of yours answers here' }),
  }
}
