// sharing/showcase-bridge.ts
//
// THE PAGE AND THE HIVE, ONE DEVICE (jwize 2026-10-25: "whatever you're hosting should be able to have
// that key", "I should be able to manage my showcase on my mobile with the key in my device").
//
// The front door at a participant's host draws the showcase, but it holds no signing code. The hive on
// the same origin has the device's key and the tested writer (`signShowcase`). So the page asks it, over
// a same-origin BroadcastChannel — nothing leaves the device, and a page with no hive beside it simply
// gets no answer and stays what a visitor sees.
//
//   page → { t: 'hello', id }                                hive → { t: 'here', id, pubkey }
//   page → { t: 'toggle', id, zone, pubkey, lineage, on }    hive → { t: 'done', id, ok, changed?, reason? }
//   page → { t: 'view', id, zone, view }                     hive → { t: 'done', id, ok, changed?, reason? }
//   page → { t: 'stage', id, zone, on: [item], off: [item] } hive → { t: 'done', id, ok, changed?, reason? }
//   page → { t: 'publish', id, zone }                        hive → { t: 'done', id, ok, changed?, reason? }
//   page → { t: 'invite', id, zone }                         hive → { t: 'invited', id, ok, link?, until?, code?, reason? }
//
// MIRRORED: hypercomb-shim/src/bootstrap/owner-bridge.ts speaks this; the shim spec holds them together.

import { EffectBus, requestConfirm } from '@hypercomb/core'
import { ROOT_MOVED, fetchHiveIndex } from './hive-pointer.js'
import { allowAnother, publisherKeyHex, type KeysAllowResult } from './key-list.client.js'
import { promoteForCommunity, type CommunityPromotion } from './promote.js'
import { qrSvg } from './qr-code.js'
import {
  parseView, readSignedAt, readSignedShowcase, setView, showcaseKey, showcases, signShowcase, stagedKey, toggleItem, type Showcase, type ShowcaseItem,
} from './showcase-record.js'

export const SHOWCASE_CHANNEL = 'hc:showcase'

const SIG = /^[0-9a-f]{64}$/
const ZONE = /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/

export type ToggleRequest = { readonly zone: string; readonly pubkey: string; readonly lineage: string; readonly on: boolean }
export type ToggleResult = { readonly ok: true; readonly changed: boolean } | { readonly ok: false; readonly reason: string }

export type BridgeDeps = {
  readonly own?: () => Promise<string>
  readonly read?: typeof readSignedShowcase
  readonly sign?: typeof signShowcase
  /** A record and the signature the index names it by (showcase-record.ts readSignedAt), for a compare-and-swap write. */
  readonly readAt?: typeof readSignedAt
  /** Lineages this key publishes on the zone. Null when that list could not be read. */
  readonly published?: (zone: string, pubkey: string) => Promise<readonly ShowcaseItem[] | null>
  /** Optimize one of this key's creations before it goes live (promote.ts promoteForCommunity). */
  readonly promote?: (zone: string, lineage: string) => Promise<CommunityPromotion>
}

/** Lineages whose signed doors name this zone. Null when the index cannot be read.
 *  An absent door is not published here, matching the front door. */
const doorsOnZone = async (zone: string, pubkey: string): Promise<readonly ShowcaseItem[] | null> => {
  const read = await fetchHiveIndex(zone, pubkey)
  if (!read.ok) return null
  const items: ShowcaseItem[] = []
  for (const [lineage, listed] of Object.entries(read.manifest.doors ?? {})) {
    if (!lineage || lineage.length > 200 || /[\s\x00-\x1f\x7f]/.test(lineage)) continue
    const opens = listed.some(door => {
      const name = door.toLowerCase()
      return name === zone || zone.endsWith(`.${name}`)
    })
    if (opens) items.push({ pubkey, lineage })
  }
  return items
}

const signResult = async (record: Showcase, deps: BridgeDeps): Promise<ToggleResult> => {
  const signed = await (deps.sign ?? signShowcase)(record)
  return signed.ok ? { ok: true, changed: true } : { ok: false, reason: signed.reason }
}

/** The key's own creations among `items`, each optimized before it goes live (promote.ts promoteForCommunity). Null
 *  when all are; else why one is not. Another publisher's creation is theirs to promote. */
const optimizeOwn = async (zone: string, items: readonly ShowcaseItem[], own: string, deps: BridgeDeps): Promise<ToggleResult | null> => {
  for (const item of items) {
    if (item.pubkey !== own) continue
    const done = await (deps.promote ?? promoteForCommunity)(zone, item.lineage)
      .catch((): CommunityPromotion => ({ ok: false, reason: `${item.lineage} could not be optimized` }))
    if (!done.ok) return { ok: false, reason: done.reason }
  }
  return null
}

const sameItem = (a: ShowcaseItem, b: ShowcaseItem): boolean => a.pubkey === b.pubkey && a.lineage === b.lineage
const sameSet = (a: readonly ShowcaseItem[], b: readonly ShowcaseItem[]): boolean =>
  a.every(row => b.some(other => sameItem(row, other))) && b.every(row => a.some(other => sameItem(row, other)))
const LINEAGE_OK = (lineage: unknown): lineage is string =>
  typeof lineage === 'string' && lineage.length >= 1 && lineage.length <= 200 && !/[\s\x00-\x1f\x7f]/.test(lineage)
/** The creations a request names, believed only when each names a key and a lineage; null when one does not. */
const itemsOf = (raw: unknown): ShowcaseItem[] | null => {
  if (!Array.isArray(raw) || raw.length > 500) return null
  const items: ShowcaseItem[] = []
  for (const row of raw) {
    const pubkey = String((row as ShowcaseItem | null)?.pubkey ?? '').toLowerCase()
    const lineage = (row as ShowcaseItem | null)?.lineage
    if (!SIG.test(pubkey) || !LINEAGE_OK(lineage)) return null
    items.push({ pubkey, lineage })
  }
  return items
}

/** One record and the signature the index names it by (both null when none is named). `sig` is undefined when the reader
 *  cannot say (a reader injected without it): the write then sets the root whatever it holds, as before. */
type ReadAt = { readonly sig?: string | null; readonly record: Showcase | null }
const readAt = (zone: string, key: string, deps: BridgeDeps): Promise<ReadAt> =>
  deps.readAt ? deps.readAt(zone, key) : deps.read ? deps.read(zone, key).then(record => ({ record })) : readSignedAt(zone, key)

/** What visitors see on `zone` now: the signed showcase (and its signature), else what this key's doors publish there.
 *  Null when it could not be read. */
const visibleNow = async (zone: string, own: string, deps: BridgeDeps): Promise<{ record: Showcase | null; sig?: string | null; items: readonly ShowcaseItem[] } | null> => {
  let read: ReadAt
  try { read = await readAt(zone, showcaseKey(zone), deps) } catch { return null }
  if (read.record) return { record: read.record, sig: read.sig, items: read.record.items }
  const open = await (deps.published ?? doorsOnZone)(zone, own).catch(() => null)
  return open ? { record: null, sig: read.sig, items: open } : null
}

/** How many times a write whose record another device changed meanwhile is read and applied again. */
const MOVED_TRIES = 8

/** OPTIMISTIC, WITH A CHECK (jwize 2026-11-16: "just before updating you check the current head hasn't changed and you
 *  can then update safely"; "if the other tries it sees the changes and adds the difference to the changes already
 *  made … so shouldn't ever fail"). `once` reads, applies its change and signs expecting the record it read; when
 *  another device moved it meanwhile (ROOT_MOVED), it runs again on what is there now, a moment later each time. */
const untilSettled = async (once: () => Promise<ToggleResult>): Promise<ToggleResult> => {
  for (let tries = 0; tries < MOVED_TRIES; tries++) {
    if (tries) await new Promise(settle => setTimeout(settle, 150 * tries + Math.floor(Math.random() * 150)))
    const result = await once()
    if (result.ok || result.reason !== ROOT_MOVED) return result
  }
  return { ok: false, reason: 'your other devices kept changing it; try again' }
}

/**
 * STAGE (jwize 2026-11-15: "you have unlocked them from their domains and staged them for public access"; "local to
 * subdomain or other should be stage"). Creations go into, or back out of, the owners' signed staged list for `zone`
 * (`staged:<zone>`), which every device of theirs reads and writes; what a visitor sees does not change. A zone with
 * nothing staged yet starts from what its visitors see now. The change is a difference (on, off), applied again to
 * whatever another device staged meanwhile. MIRRORED: the shim's device-owner.ts stageChange.
 */
export async function applyStage(request: { readonly zone: string; readonly on: unknown; readonly off: unknown }, deps: BridgeDeps = {}): Promise<ToggleResult> {
  const zone = String(request.zone ?? '').toLowerCase()
  const on = itemsOf(request.on)
  const off = itemsOf(request.off)
  if (!ZONE.test(zone) || !on || !off) return { ok: false, reason: 'bad request' }
  const own = String(await (deps.own ?? (() => publisherKeyHex({ known: true })))().catch(() => '') ?? '').toLowerCase()
  if (!SIG.test(own)) return { ok: false, reason: 'no key on this device' }
  return untilSettled(async () => {
    let staged: ReadAt
    try { staged = await readAt(zone, stagedKey(zone), deps) } catch { return { ok: false, reason: 'could not read what is staged' } }
    let base = staged.record?.items
    if (!base) {
      const now = await visibleNow(zone, own, deps)
      if (!now) return { ok: false, reason: 'could not read what is published here' }
      base = now.items
    }
    const items = [...base.filter(row => !off.some(gone => sameItem(gone, row))), ...on.filter(row => !base!.some(kept => sameItem(kept, row)))]
    if (sameSet(base, items)) return { ok: true, changed: false }
    const signed = await (deps.sign ?? signShowcase)({ zone, items, domains: [] }, stagedKey(zone), staged.sig)
    return signed.ok ? { ok: true, changed: true } : { ok: false, reason: signed.reason }
  })
}

/**
 * PUBLISH, THE ONE FINAL ACT (jwize 2026-11-15: "the community items are compiled and made available for all visitors
 * no matter what computer"). The showcase names exactly what is staged (its look, its domains shown in full and its
 * communities stay, a community losing what left), and each of this key's creations newly going live is optimized
 * first. Nothing staged is nothing to publish. Signed expecting the showcase it read: another device's write meanwhile
 * is read and the publish applied again. MIRRORED: the shim's device-owner.ts publishChange.
 */
export async function applyPublish(request: { readonly zone: string }, deps: BridgeDeps = {}): Promise<ToggleResult> {
  const zone = String(request.zone ?? '').toLowerCase()
  if (!ZONE.test(zone)) return { ok: false, reason: 'bad request' }
  const own = String(await (deps.own ?? (() => publisherKeyHex({ known: true })))().catch(() => '') ?? '').toLowerCase()
  if (!SIG.test(own)) return { ok: false, reason: 'no key on this device' }
  return untilSettled(async () => {
    let staged: Showcase | null
    try { staged = (await readAt(zone, stagedKey(zone), deps)).record } catch { return { ok: false, reason: 'could not read what is staged' } }
    if (!staged) return { ok: true, changed: false }
    const now = await visibleNow(zone, own, deps)
    if (!now) return { ok: false, reason: 'could not read what is published here' }
    if (now.record && sameSet(now.items, staged.items)) return { ok: true, changed: false }
    const refused = await optimizeOwn(zone, staged.items.filter(item => !now.items.some(row => sameItem(row, item))), own, deps)
    if (refused) return refused
    const current = now.record ?? { zone, items: [...now.items], domains: [] }
    const kept = (row: ShowcaseItem): boolean => staged!.items.some(item => sameItem(item, row))
    const signed = await (deps.sign ?? signShowcase)({
      ...current,
      items: [...staged.items],
      ...(current.communities ? { communities: current.communities.map(community => ({ ...community, items: community.items.filter(kept) })) } : {}),
    }, showcaseKey(zone), now.sig)
    return signed.ok ? { ok: true, changed: true } : { ok: false, reason: signed.reason }
  })
}

/** Put one creation into the showcase of `zone`, or take it out, and sign the result. Idempotent: a creation
 *  already in the state asked for changes nothing and signs nothing. A missing showcase is not an empty
 *  one: taking a creation out writes the doors that name this zone, minus that creation. */
export async function applyToggle(request: ToggleRequest, deps: BridgeDeps = {}): Promise<ToggleResult> {
  const zone = String(request.zone ?? '').toLowerCase()
  const lineage = String(request.lineage ?? '')
  const pubkey = String(request.pubkey ?? '').toLowerCase()
  if (!ZONE.test(zone) || !SIG.test(pubkey) || lineage.length < 1 || lineage.length > 200 || /[\s\x00-\x1f\x7f]/.test(lineage)) {
    return { ok: false, reason: 'bad request' }
  }
  const own = String(await (deps.own ?? (() => publisherKeyHex({ known: true })))().catch(() => '') ?? '').toLowerCase()
  if (!SIG.test(own)) return { ok: false, reason: 'no key on this device' }
  const item: ShowcaseItem = { pubkey, lineage }
  let current: Showcase | null
  try {
    current = await (deps.read ?? readSignedShowcase)(zone)
  } catch {
    return { ok: false, reason: 'could not read the showcase' }
  }
  // GOING LIVE IS THE PROMOTE, AND IT OPTIMIZES BY ITSELF (jwize 2026-11-13): one of this key's own creations is
  // minified before the record names it. Another publisher's creation is theirs to promote; taking one out is never gated.
  const optimize = async (): Promise<ToggleResult | null> => {
    if (request.on !== true || pubkey !== own) return null
    return optimizeOwn(zone, [item], own, deps)
  }
  if (current) {
    if (showcases(current, item) === (request.on === true)) return { ok: true, changed: false }
    const refused = await optimize()
    if (refused) return refused
    return signResult(toggleItem(current, item), deps)
  }
  // No record yet. Turning one on starts a showcase that names only that creation.
  if (request.on === true) {
    const refused = await optimize()
    if (refused) return refused
    return signResult(toggleItem({ zone, items: [], domains: [] }, item), deps)
  }
  // Turning one off records everything still published here. An explicit empty record is left alone above.
  let open: readonly ShowcaseItem[] | null
  try {
    open = await (deps.published ?? doorsOnZone)(zone, pubkey)
  } catch {
    return { ok: false, reason: 'could not read what is published here' }
  }
  if (!open) return { ok: false, reason: 'could not read what is published here' }
  if (!open.some(row => row.pubkey === pubkey && row.lineage === lineage)) return { ok: true, changed: false }
  return signResult({
    zone,
    items: open.filter(row => !(row.pubkey === pubkey && row.lineage === lineage)),
    domains: [],
  }, deps)
}

/** Sign the look a visitor is shown on `zone` (jwize 2026-11-10: "if you have your private key you can publish").
 *  Hexagons is the absence of a view. A zone with no record yet keeps showing what this key publishes there: the
 *  record that first names a look names those too. */
export async function applyView(request: { readonly zone: string; readonly view: string }, deps: BridgeDeps = {}): Promise<ToggleResult> {
  const zone = String(request.zone ?? '').toLowerCase()
  const view = parseView(request.view)
  if (!ZONE.test(zone) || !view) return { ok: false, reason: 'bad request' }
  const own = String(await (deps.own ?? (() => publisherKeyHex({ known: true })))().catch(() => '') ?? '').toLowerCase()
  if (!SIG.test(own)) return { ok: false, reason: 'no key on this device' }
  const next = view === 'hex' ? undefined : view
  let current: Showcase | null
  try {
    current = await (deps.read ?? readSignedShowcase)(zone)
  } catch {
    return { ok: false, reason: 'could not read the showcase' }
  }
  if (current) return (current.view ?? undefined) === next ? { ok: true, changed: false } : signResult(setView(current, next), deps)
  if (!next) return { ok: true, changed: false }
  let open: readonly ShowcaseItem[] | null
  try {
    open = await (deps.published ?? doorsOnZone)(zone, own)
  } catch {
    return { ok: false, reason: 'could not read what is published here' }
  }
  if (!open) return { ok: false, reason: 'could not read what is published here' }
  return signResult(setView({ zone, items: [...open], domains: [] }, next), deps)
}

export type InviteResult = { readonly ok: true; readonly link: string; readonly until: number; readonly code?: string } | { readonly ok: false; readonly reason: string }
export type InviteDeps = {
  readonly hosts?: () => Promise<readonly string[]>
  readonly allow?: (hosts: readonly string[], options: { where: string }) => Promise<KeysAllowResult>
  readonly code?: (link: string) => string | null
}

const INVITE_REFUSALS: Record<Extract<KeysAllowResult, { ok: false }>['reason'], string> = {
  'no-signer': 'this hive holds no key',
  'no-host': 'this hive publishes to no host yet',
  'not-listed': 'this device is not on your key list',
  'unreachable': 'your host could not be reached',
  'refused': 'your host refused the invite',
}

/** AN INVITE WITH ONE PRESS (jwize 2026-11-10: "we need a very easy way to allow our phone to promote"). What
 *  `keys allow <zone>` does, asked for by the page beside this hive: an invite written into the owner's key list on
 *  every host they publish to, and the link that spends it — opened on the phone at `zone` — with the same link as a
 *  code for its camera. The key never moves; the invite works once and runs out. */
export async function applyInvite(request: { readonly zone: string }, deps: InviteDeps = {}): Promise<InviteResult> {
  const zone = String(request.zone ?? '').toLowerCase()
  if (!ZONE.test(zone)) return { ok: false, reason: 'bad request' }
  let hosts: readonly string[]
  try {
    hosts = await (deps.hosts ?? (async () => (await import('./keys.queen.js')).keyListHosts()))()
  } catch {
    return { ok: false, reason: 'could not read where this hive publishes' }
  }
  const result = await (deps.allow ?? allowAnother)(hosts, { where: zone })
  if (!result.ok) return { ok: false, reason: result.detail ? `${INVITE_REFUSALS[result.reason]} (${result.detail})` : INVITE_REFUSALS[result.reason] }
  const code = (deps.code ?? (link => qrSvg(link, 'Invite to add a device')))(result.link)
  return { ok: true, link: result.link, until: result.until, ...(code ? { code } : {}) }
}

let started = false

/** Answer the page. Idempotent; a hive without BroadcastChannel answers nothing. */
export function startShowcaseBridge(): void {
  if (started || typeof BroadcastChannel === 'undefined') return
  started = true
  const channel = new BroadcastChannel(SHOWCASE_CHANNEL)
  let lane: Promise<unknown> = Promise.resolve()
  channel.addEventListener('message', event => {
    const message = event.data as Record<string, unknown> | null
    if (!message || typeof message !== 'object' || typeof message['id'] !== 'string') return
    const id = message['id']
    if (message['t'] === 'hello') {
      void publisherKeyHex({ known: true })
        .then(pubkey => { if (SIG.test(pubkey)) channel.postMessage({ t: 'here', id, pubkey }) })
        .catch(() => undefined)
    } else if (message['t'] === 'toggle') {
      // One at a time: each is a read-merge-sign of the same record.
      lane = lane.then(async () => {
        const result = await applyToggle(message as unknown as ToggleRequest).catch((): ToggleResult => ({ ok: false, reason: 'failed' }))
        channel.postMessage({ t: 'done', id, ...result })
      })
    } else if (message['t'] === 'view') {
      lane = lane.then(async () => {
        const result = await applyView(message as unknown as { zone: string; view: string }).catch((): ToggleResult => ({ ok: false, reason: 'failed' }))
        channel.postMessage({ t: 'done', id, ...result })
      })
    } else if (message['t'] === 'stage') {
      lane = lane.then(async () => {
        const result = await applyStage(message as unknown as { zone: string; on: unknown; off: unknown }).catch((): ToggleResult => ({ ok: false, reason: 'failed' }))
        channel.postMessage({ t: 'done', id, ...result })
      })
    } else if (message['t'] === 'publish') {
      lane = lane.then(async () => {
        const result = await applyPublish(message as unknown as { zone: string }).catch((): ToggleResult => ({ ok: false, reason: 'failed' }))
        channel.postMessage({ t: 'done', id, ...result })
      })
    } else if (message['t'] === 'invite') {
      // In the same lane: an invite is one more link in the owner's key list.
      lane = lane.then(async () => {
        const result = await applyInvite(message as unknown as { zone: string }).catch((): InviteResult => ({ ok: false, reason: 'failed' }))
        channel.postMessage({ t: 'invited', id, ...result })
      })
    }
  })
}

// ── a hand-off from a front door that has no hive beside it (showcase-link.ts in the shim) ──

export const PENDING_SHOWCASE_KEY = 'hc:pending-showcase' // mirror of invite-capture.ts
const SHOWCASE_PREFIX = '#showcase='

const fromBase64Url = (text: string): string => {
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'))
  return new TextDecoder().decode(Uint8Array.from(binary, char => char.charCodeAt(0)))
}

/** A back-address worth returning to: https, or this machine's own http. */
const safeBack = (raw: unknown): string => {
  try {
    const url = new URL(String(raw ?? ''))
    return url.protocol === 'https:' || (url.protocol === 'http:' && /^(localhost|127\.\d+\.\d+\.\d+|\[::1\])$/.test(url.hostname)) ? url.href : ''
  } catch { return '' }
}

/** Take the switch a front door handed here: ask once, in words, apply it with this hive's key, go back. */
export async function takePendingShowcase(): Promise<void> {
  let hash = ''
  try { hash = sessionStorage.getItem(PENDING_SHOWCASE_KEY) ?? ''; sessionStorage.removeItem(PENDING_SHOWCASE_KEY) } catch { return }
  if (!hash.startsWith(SHOWCASE_PREFIX)) return
  let request: Record<string, unknown>
  try { request = JSON.parse(fromBase64Url(hash.slice(SHOWCASE_PREFIX.length))) as Record<string, unknown> } catch { return }
  if (!request || request['v'] !== 1) return
  const title = String(request['title'] ?? request['lineage'] ?? '').slice(0, 80)
  const on = request['on'] === true
  const zone = String(request['zone'] ?? '')
  const ok = await requestConfirm({
    title: on ? 'Put it in your showcase?' : 'Take it out of your showcase?',
    message: `${title} — on ${zone}. Only you can do this; it is signed here with your key.`,
    confirmLabel: on ? 'Put it in' : 'Take it out',
    cancelLabel: 'Not now',
  }).catch(() => false)
  if (!ok) return
  const result = await applyToggle({ zone, pubkey: String(request['pubkey'] ?? ''), lineage: String(request['lineage'] ?? ''), on })
  EffectBus.emit('toast:show', result.ok
    ? { type: 'success', message: on ? `${title} is in your showcase.` : `${title} is out of your showcase.` }
    : { type: 'error', message: `Showcase not changed: ${result.reason}` })
  const back = result.ok ? safeBack(request['back']) : ''
  if (back) setTimeout(() => { window.location.assign(back) }, 900)
}

startShowcaseBridge()
// After boot has settled: the hive may not have its key and host sync up the moment this module loads.
if (typeof window !== 'undefined') setTimeout(() => { void takePendingShowcase() }, 2500)
