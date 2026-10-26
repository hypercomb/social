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
//
// MIRRORED: hypercomb-shim/src/bootstrap/owner-bridge.ts speaks this; the shim spec holds them together.

import { EffectBus, requestConfirm } from '@hypercomb/core'
import { publisherKeyHex } from './key-list.client.js'
import { readSignedShowcase, showcases, signShowcase, toggleItem, type ShowcaseItem } from './showcase-record.js'

export const SHOWCASE_CHANNEL = 'hc:showcase'

const SIG = /^[0-9a-f]{64}$/
const ZONE = /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/

export type ToggleRequest = { readonly zone: string; readonly pubkey: string; readonly lineage: string; readonly on: boolean }
export type ToggleResult = { readonly ok: true; readonly changed: boolean } | { readonly ok: false; readonly reason: string }

export type BridgeDeps = {
  readonly own?: () => Promise<string>
  readonly read?: typeof readSignedShowcase
  readonly sign?: typeof signShowcase
}

/** Put one creation into the showcase of `zone`, or take it out, and sign the result. Idempotent: a creation
 *  already in the state asked for changes nothing and signs nothing. */
export async function applyToggle(request: ToggleRequest, deps: BridgeDeps = {}): Promise<ToggleResult> {
  const zone = String(request.zone ?? '').toLowerCase()
  const lineage = String(request.lineage ?? '')
  const pubkey = String(request.pubkey ?? '').toLowerCase()
  if (!ZONE.test(zone) || !SIG.test(pubkey) || !lineage || lineage.length > 200 || lineage.includes('/')) return { ok: false, reason: 'bad request' }
  const own = String(await (deps.own ?? (() => publisherKeyHex({ known: true })))().catch(() => '') ?? '').toLowerCase()
  if (!SIG.test(own)) return { ok: false, reason: 'no key on this device' }
  const item: ShowcaseItem = { pubkey, lineage }
  const current = await (deps.read ?? readSignedShowcase)(zone)
  if (showcases(current, item) === (request.on === true)) return { ok: true, changed: false }
  const signed = await (deps.sign ?? signShowcase)(toggleItem(current, item))
  return signed.ok ? { ok: true, changed: true } : { ok: false, reason: signed.reason }
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
