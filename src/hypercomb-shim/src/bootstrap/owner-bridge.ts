// hypercomb-shim/src/bootstrap/owner-bridge.ts
//
// THE PAGE ASKS THE HIVE BESIDE IT (jwize 2026-10-25: "whatever you're hosting should be able to have
// that key"; "I should be able to manage my showcase on my mobile with the key in my device").
//
// A front door holds no key and no signing code. A hive on the SAME origin does — it is the participant's
// own host — and listens on a same-origin BroadcastChannel. The page says hello; if a hive answers, this
// device is its owner's and a tap on a tile may put it into the showcase or take it out. Nothing leaves
// the device, and with no hive beside the page nobody answers and the page stays what a visitor sees.
//
// The one exception (jwize 2026-11-04): a browser that accepted its owner's invite holds its OWN key, and
// answers this same bridge itself — device-owner.ts. A visitor still holds nothing.
//
// MIRRORED: hypercomb-essentials/src/sharing/showcase-bridge.ts is the other end of this protocol.
//
// The hive alone can hand out an invite ('invite' → 'invited'): the link `keys allow` makes, asked for with one press.

export const SHOWCASE_CHANNEL = 'hc:showcase'

export type OwnerToggle = { readonly zone: string; readonly pubkey: string; readonly lineage: string; readonly on: boolean }
/** How the zone's page is drawn for everyone: one of the showcase's views, by name. */
export type OwnerView = { readonly zone: string; readonly view: string }
/** An invite for another device of the owner's: the link that spends it, when it runs out (unix seconds), and the link
 *  as a code a camera reads (an SVG), when the hive could draw one. */
export type OwnerInvite = { readonly ok: true; readonly link: string; readonly until: number; readonly code?: string } | { readonly ok: false; readonly reason: string }
export type OwnerResult = { readonly ok: true; readonly changed: boolean } | { readonly ok: false; readonly reason: string }

export type OwnerBridge = {
  /** The key of the hive beside this page, or '' when there is none (or it did not answer in time). */
  readonly hello: () => Promise<string>
  readonly toggle: (request: OwnerToggle) => Promise<OwnerResult>
  /** Sign the look a visitor is shown. Absent where the owner cannot (an older hive simply never answers). */
  readonly view?: (request: OwnerView) => Promise<OwnerResult>
  /** Ask the hive for an invite that lets a phone publish for its owner on this zone. Absent where there is no hive. */
  readonly invite?: (request: { readonly zone: string }) => Promise<OwnerInvite>
}

const SIG = /^[0-9a-f]{64}$/

/** The bridge, or null where this browser has no BroadcastChannel. */
export const ownerBridge = (waitMs = 1500, settleMs = 30_000, viewMs = 10_000): OwnerBridge | null => {
  if (typeof BroadcastChannel === 'undefined') return null
  const channel = new BroadcastChannel(SHOWCASE_CHANNEL)
  let ids = 0
  const ask = <T>(message: Record<string, unknown>, answer: string, within: number, fallback: T, read: (data: Record<string, unknown>) => T): Promise<T> =>
    new Promise(resolve => {
      const id = `${Date.now().toString(36)}-${ids++}`
      const done = (value: T): void => { clearTimeout(timer); channel.removeEventListener('message', onMessage); resolve(value) }
      const onMessage = (event: MessageEvent): void => {
        const data = event.data as Record<string, unknown> | null
        if (data && data['id'] === id && data['t'] === answer) done(read(data))
      }
      const timer = setTimeout(() => done(fallback), within)
      channel.addEventListener('message', onMessage)
      channel.postMessage({ ...message, id })
    })
  return {
    hello: () => ask({ t: 'hello' }, 'here', waitMs, '', data => (typeof data['pubkey'] === 'string' && SIG.test(data['pubkey']) ? data['pubkey'] : '')),
    toggle: request => ask<OwnerResult>({ t: 'toggle', ...request }, 'done', settleMs, { ok: false, reason: 'the hive did not answer' },
      data => (data['ok'] === true ? { ok: true, changed: data['changed'] === true } : { ok: false, reason: String(data['reason'] ?? 'refused') })),
    view: request => ask<OwnerResult>({ t: 'view', ...request }, 'done', viewMs, { ok: false, reason: 'the hive did not answer' },
      data => (data['ok'] === true ? { ok: true, changed: data['changed'] === true } : { ok: false, reason: String(data['reason'] ?? 'refused') })),
    invite: request => ask<OwnerInvite>({ t: 'invite', ...request }, 'invited', settleMs, { ok: false, reason: 'the hive did not answer' }, data => {
      const link = typeof data['link'] === 'string' ? data['link'] : ''
      const until = Number(data['until'])
      if (data['ok'] !== true) return { ok: false, reason: String(data['reason'] ?? 'refused') }
      // Believed only as an https link that carries an invite, and a code only as an SVG of a sane size.
      if (!/^https:\/\/[a-z0-9.-]+(?::\d{1,5})?\/#invite=[^\s]{1,400}$/i.test(link) || !Number.isFinite(until)) return { ok: false, reason: 'the hive answered with no invite' }
      const code = typeof data['code'] === 'string' && data['code'].startsWith('<svg') && data['code'].length < 200_000 ? data['code'] : undefined
      return { ok: true, link, until, ...(code ? { code } : {}) }
    }),
  }
}
