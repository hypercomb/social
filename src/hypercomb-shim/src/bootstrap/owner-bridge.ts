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
// MIRRORED: hypercomb-essentials/src/sharing/showcase-bridge.ts is the other end of this protocol.

export const SHOWCASE_CHANNEL = 'hc:showcase'

export type OwnerToggle = { readonly zone: string; readonly pubkey: string; readonly lineage: string; readonly on: boolean }
export type OwnerResult = { readonly ok: true; readonly changed: boolean } | { readonly ok: false; readonly reason: string }

export type OwnerBridge = {
  /** The key of the hive beside this page, or '' when there is none (or it did not answer in time). */
  readonly hello: () => Promise<string>
  readonly toggle: (request: OwnerToggle) => Promise<OwnerResult>
}

const SIG = /^[0-9a-f]{64}$/

/** The bridge, or null where this browser has no BroadcastChannel. */
export const ownerBridge = (waitMs = 1500, settleMs = 30_000): OwnerBridge | null => {
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
  }
}
