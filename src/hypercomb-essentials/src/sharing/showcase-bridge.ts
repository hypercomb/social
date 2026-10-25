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

startShowcaseBridge()
