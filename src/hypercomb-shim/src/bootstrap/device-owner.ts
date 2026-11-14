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

import { SignatureService, deriveMinifiedLayer, minifyModuleBody, nip98Authorization, nip98Template, ownedMinifyTool } from '@hypercomb/core'
import { readDeviceBinding, type DeviceBinding } from './device-binding'
import { putKeyChain, readKeyChain } from './device-invite'
import { deviceSigner, type DeviceSigner } from './device-key'
import type { OwnerBridge, OwnerResult, OwnerToggle, OwnerView } from './owner-bridge'
import {
  parseView, readOwnerIndex, readShowcaseAtom, showcaseBytes, showcaseKey, showcasesItem, toggleShowcaseItem, zoneOrigin,
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

/** Does the zone serve the atom `sig`? Null when it could not be asked. `?held`: a host that knows the
 *  flag answers a miss 204, not a 404 the console prints as an error — so only a 200 is held, and an
 *  HTML answer is a page standing in for a miss. */
export const heldOn = async (zone: string, sig: string): Promise<boolean | null> => {
  try {
    const there = await fetch(`${zoneOrigin(zone)}/${sig}?held`, { method: 'HEAD', cache: 'no-store' })
    return there.status === 200 && !(there.headers.get('content-type') ?? '').toLowerCase().includes('text/html')
  } catch { return null }
}

/** Put one atom on the zone as the anchor's, unless it already serves it, and read it back: its bytes
 *  hashed ('bytes'), or only that it is held now ('held', for a closure of many, where the host hashed
 *  the body against its name before it wrote). Null when the zone serves it; else the reason, in words
 *  that name it `what`. */
export const uploadAtom = async (
  zone: string, bytes: Uint8Array, sig: string, anchor: string, signer: DeviceSigner,
  what = 'the showcase', readBack: 'bytes' | 'held' = 'bytes',
): Promise<string | null> => {
  const url = `${zoneOrigin(zone)}/${sig}`
  // A host that could not be asked is not one that holds it: the PUT says whether it is reachable.
  if (await heldOn(zone, sig)) return null
  try {
    const put = await fetch(url, { method: 'PUT', headers: { Authorization: authFor(signer, url, anchor) }, body: bytes.slice().buffer as ArrayBuffer })
    if (put.status === 401 || put.status === 403) return `${zone} does not take uploads from this browser's key`
    if (!put.ok) return `${zone} refused ${what} (HTTP ${put.status})`
    if (readBack === 'held') return await heldOn(zone, sig) ? null : `${zone} took ${what} but does not serve it back`
    const back = await fetch(url, { cache: 'no-store' })
    if (!back.ok || await sha(new Uint8Array(await back.arrayBuffer())) !== sig) return `${zone} took ${what} but does not serve it back`
    return null
  } catch { return `${zone} could not be reached` }
}

/** The anchor's next index, signed by this browser's key: `content` as given, tagged as the anchor's and
 *  as following `before` (the index it replaces, read fresh), so the host takes it as the anchor's and two
 *  places writing at once cannot drop each other's change. Never dated before what it follows. */
export const signIndex = (
  signer: DeviceSigner, anchor: string, before: Record<string, unknown> | null, content: Record<string, unknown>,
): Record<string, unknown> => signer.sign({
  kind: HIVE_INDEX_KIND,
  created_at: Math.max(Math.floor(Date.now() / 1000), Number(before?.['created_at'] ?? 0) + 1),
  tags: [['anchor', anchor], ...(before ? [['prev', String(before['id'] ?? '')]] : [])],
  content: JSON.stringify({ ...content, v: content['v'] ?? HIVE_LINK_VERSION }),
})

/** PUT a signed index on the zone. Null when it took it; 'stale' when it holds a newer index than the one
 *  this followed (read again and sign again); else the reason, in words. */
export const putIndex = async (zone: string, anchor: string, event: Record<string, unknown>, signer: DeviceSigner): Promise<null | 'stale' | string> => {
  const indexes = await sha('hive:indexes')
  const url = `${zoneOrigin(zone)}/${indexes}/${anchor}`
  const body = JSON.stringify(event)
  try {
    const put = await fetch(url, { method: 'PUT', headers: { Authorization: authFor(signer, url, anchor, await sha(body)), 'Content-Type': 'application/json' }, body })
    if (put.status === 409) return 'stale'
    if (!put.ok) return `${zone} refused the index (${put.status}${put.headers.get('X-Reason') ? `: ${put.headers.get('X-Reason')}` : ''})`
  } catch { return `${zone} could not be reached` }
  return null
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

/** The index key a branch's promotion is named under. MIRRORED: essentials sharing/promote.ts promotedPointer. */
export const promotedPointer = (lineage: string): string => `promoted:${lineage}`

/** The promotion record, canonical. MIRRORED: essentials sharing/promote.ts promotionRecord. A phone sends no
 *  arrival plan (it is read from the hive's own tiles), so it names only the minified derivation. */
export const promotionRecord = (head: string, derivation: string): string =>
  JSON.stringify({ v: 1, kind: 'promote', head, arrival: null, derivation })

const promotes = (text: string | null, head: string): boolean => {
  try {
    const record = JSON.parse(text ?? '') as { kind?: unknown; head?: unknown; arrival?: unknown; derivation?: unknown }
    return record?.kind === 'promote' && record.head === head && (record.arrival !== null || record.derivation !== null)
  } catch { return false }
}

/** The bytes the zone serves at `sig`, or null. An HTML answer is a page standing in for a miss. */
const servedBytes = async (zone: string, sig: string): Promise<Uint8Array | null> => {
  try {
    const response = await fetch(`${zoneOrigin(zone)}/${sig}`)
    if (!response.ok || (response.headers.get('content-type') ?? '').toLowerCase().includes('text/html')) return null
    return new Uint8Array(await response.arrayBuffer())
  } catch { return null }
}

/**
 * GOING LIVE IS THE PROMOTE, FROM A PHONE TOO (jwize 2026-11-13: "from a mobile point of view enter then click
 * manage, turn on all the stuff. Then it is in community which you then turn on some items (the minification)").
 * The head the anchor published here is minified from the bytes the zone already serves, the derived files and
 * the record go up as the anchor's, and the record's signature is returned for the same index write that puts the
 * tile in the showcase. Null when that head is already promoted. The readable layers stay where they are.
 */
export const promoteHere = async (
  zone: string, lineage: string, roots: Readonly<Record<string, string>>, anchor: string, signer: DeviceSigner,
): Promise<{ readonly ok: true; readonly record: string | null } | { readonly ok: false; readonly reason: string }> => {
  const head = String(roots[lineage] ?? '').toLowerCase()
  if (!SIG.test(head)) return { ok: false, reason: `${lineage} is not published on ${zone} yet` }
  const named = String(roots[promotedPointer(lineage)] ?? '').toLowerCase()
  if (SIG.test(named)) {
    const bytes = await servedBytes(zone, named)
    if (promotes(bytes ? new TextDecoder().decode(bytes) : null, head)) return { ok: true, record: null }
  }
  let tree: Awaited<ReturnType<typeof deriveMinifiedLayer>>
  try {
    tree = await deriveMinifiedLayer(head, sig => servedBytes(zone, sig), async body => minifyModuleBody(body), await ownedMinifyTool())
  } catch (error) {
    return { ok: false, reason: `${lineage} could not be optimized (${error instanceof Error ? error.message : 'unreadable'})` }
  }
  const files = new Map(tree.files)
  files.set(tree.derivation.sig, tree.derivation.bytes)
  files.set(tree.membership.dialect, tree.membership.dialectBytes)
  const recordBytes = new TextEncoder().encode(promotionRecord(head, tree.derivation.sig))
  const record = await sha(recordBytes)
  files.set(record, recordBytes)
  for (const [sig, bytes] of files) {
    const refused = await uploadAtom(zone, bytes, sig, anchor, signer, `the optimized ${lineage}`, 'held')
    if (refused) return { ok: false, reason: refused }
  }
  return { ok: true, record }
}

/** What a change makes of the record: the next one, or null when it changes nothing. `open` is what the anchor's doors
 *  publish here — what a zone with no record yet is showing. */
type Change = (current: ShowcaseRecord | null, open: () => ShowcaseItem[]) => ShowcaseRecord | null

const toggleChange = (request: OwnerToggle): Change => (current, open) => {
  const zone = request.zone
  const item: ShowcaseItem = { pubkey: request.pubkey, lineage: request.lineage }
  if (current) return showcasesItem(current, item) === request.on ? null : toggleShowcaseItem(current, item)
  if (request.on) return { zone, items: [item], domains: [] }
  // No record yet: everything published here is shown. Taking one out records the rest.
  const shown = open()
  if (!shown.some(row => row.pubkey === item.pubkey && row.lineage === item.lineage)) return null
  return { zone, items: shown.filter(row => !(row.pubkey === item.pubkey && row.lineage === item.lineage)), domains: [] }
}

/** The look everyone is shown. Hexagons is the absence of a view. A zone with no record yet keeps showing what it
 *  publishes: the record that first names a look names those too. */
const viewChange = (request: OwnerView): Change => (current, open) => {
  const view = parseView(request.view)
  const next = view && view !== 'hex' ? view : undefined
  if ((current?.view ?? undefined) === next) return null
  const { view: _gone, ...rest } = current ?? { zone: request.zone, items: open(), domains: [] as string[] }
  return next ? { ...rest, view: next } : rest
}

/** One read-change-sign of the anchor's showcase on the zone. 'stale' when the host holds a newer index
 *  than the one read: read again. */
const attempt = async (zone: string, change: Change, anchor: string, signer: DeviceSigner, live?: OwnerToggle): Promise<Attempt> => {
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
  const next = change(current, () => openOn(zone, anchor, content))
  if (!next) return { ok: true, changed: false }
  // One of the anchor's own creations going live is optimized first, and named in the same index write.
  const extra: Record<string, string> = {}
  if (live?.on && live.pubkey === anchor) {
    const promoted = await promoteHere(zone, live.lineage, roots, anchor, signer)
    if (!promoted.ok) return { ok: false, reason: promoted.reason }
    if (promoted.record) extra[promotedPointer(live.lineage)] = promoted.record
  }
  const bytes = showcaseBytes(next)
  const sig = await sha(bytes)
  const refused = await uploadAtom(zone, bytes, sig, anchor, signer)
  if (refused) return { ok: false, reason: refused }

  const before = read === 'missing' ? null : read.event
  const put = await putIndex(zone, anchor, signIndex(signer, anchor, before, { ...content, roots: { ...roots, ...extra, [key]: sig } }), signer)
  if (put === 'stale') return 'stale'
  if (put) return { ok: false, reason: put }
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
  // One at a time: each is a read-change-sign of the same record.
  const act = (valid: boolean, change: Change, live?: OwnerToggle): Promise<OwnerResult> => {
    const run = lane.then(async (): Promise<OwnerResult> => {
      const held = await ensure()
      if (!held) return { ok: false, reason: 'this browser is not on your key list here' }
      if (!valid) return { ok: false, reason: 'bad request' }
      for (let tries = 0; tries < 2; tries++) {
        const result = await attempt(zone, change, held.anchor, held.signer, live).catch((): OwnerResult => ({ ok: false, reason: 'failed' }))
        if (result !== 'stale') return result
      }
      return { ok: false, reason: 'your index kept changing underneath; try again' }
    })
    lane = run.catch(() => undefined)
    return run
  }
  return {
    hello: async () => (await ensure())?.anchor ?? '',
    toggle: request => act(request.zone === zone && SIG.test(request.pubkey) && !!request.lineage && request.lineage.length <= 200, toggleChange(request), request),
    view: request => act(request.zone === zone && !!parseView(request.view), viewChange(request)),
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
    view: request => chosen?.view ? chosen.view(request) : Promise.resolve({ ok: false, reason: 'no key of yours answers here' }),
    // Only a hive hands out invites; where the one that answered cannot, the page is told so.
    invite: request => chosen?.invite ? chosen.invite(request) : Promise.resolve({ ok: false, reason: 'only your hive can invite a phone' }),
  }
}
