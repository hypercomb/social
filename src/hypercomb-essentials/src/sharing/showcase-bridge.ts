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
//   page → { t: 'invite', id, zone }                         hive → { t: 'invited', id, ok, link?, until?, code?, reason? }
//
// MIRRORED: hypercomb-shim/src/bootstrap/owner-bridge.ts speaks this; the shim spec holds them together.

import { EffectBus, requestConfirm } from '@hypercomb/core'
import { fetchHiveIndex } from './hive-pointer.js'
import { allowAnother, publisherKeyHex, type KeysAllowResult } from './key-list.client.js'
import { qrSvg } from './qr-code.js'
import { parseView, readSignedShowcase, setView, showcases, signShowcase, toggleItem, type Showcase, type ShowcaseItem } from './showcase-record.js'

export const SHOWCASE_CHANNEL = 'hc:showcase'

const SIG = /^[0-9a-f]{64}$/
const ZONE = /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/

export type ToggleRequest = { readonly zone: string; readonly pubkey: string; readonly lineage: string; readonly on: boolean }
export type ToggleResult = { readonly ok: true; readonly changed: boolean } | { readonly ok: false; readonly reason: string }

export type BridgeDeps = {
  readonly own?: () => Promise<string>
  readonly read?: typeof readSignedShowcase
  readonly sign?: typeof signShowcase
  /** Lineages this key publishes on the zone. Null when that list could not be read. */
  readonly published?: (zone: string, pubkey: string) => Promise<readonly ShowcaseItem[] | null>
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
  if (current) {
    if (showcases(current, item) === (request.on === true)) return { ok: true, changed: false }
    return signResult(toggleItem(current, item), deps)
  }
  // No record yet. Turning one on starts a showcase that names only that creation.
  if (request.on === true) return signResult(toggleItem({ zone, items: [], domains: [] }, item), deps)
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
