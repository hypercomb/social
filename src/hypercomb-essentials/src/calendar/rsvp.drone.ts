// calendar/rsvp.drone.ts
//
// THE PAGE'S ONE WRITE (documentation/calendar-events.md). A website page
// offers "Join the meeting": it names the meeting and the name its reader
// chose and dispatches `hc:rsvp` on the document. This bee hears it, signs the
// claim with this shell's own key, writes it to the meeting's host as the
// member of sign('rsvp:<event>') named by its own hash, and answers on the
// document — `hc:rsvp:done` with the receipt (the member's name, which anyone
// can read back at /<pool>/<member>) or `hc:rsvp:error` with the reason.
//
// The page keeps its own look; this bee has none. On a published door the
// host is the page's own origin — a visitor reads and writes there alone
// (hypercomb-web setup/readonly-network.ts admits exactly this write). In a
// hive it is the door the meeting names, and that host's CORS takes it.

import { Drone } from '@hypercomb/core'
import { RSVP_NAME_MAX, rsvpPoolAddress, rsvpTemplate, type Going } from './event.js'
import { hostBase } from '../sharing/derivation-attestation.js'

export const RSVP_ASK = 'hc:rsvp'
export const RSVP_DONE = 'hc:rsvp:done'
export const RSVP_ERROR = 'hc:rsvp:error'

const SIG_RE = /^[a-f0-9]{64}$/

export interface RsvpAsk {
  /** The meeting record's signature. */
  readonly event: string
  /** The door its list lives on; the page's own origin when absent. */
  readonly host?: string
  readonly name: string
  readonly going?: Going
}

export type RsvpOutcome =
  | { ok: true; event: string; pool: string; member: string; name: string; going: Going; host: string }
  | { ok: false; event: string; reason: string }

type SignerShape = { signEvent: (evt: Record<string, unknown>) => Promise<Record<string, unknown>> }

const get = <T>(key: string): T | undefined =>
  (globalThis as { ioc?: { get?: <V>(k: string) => V | undefined } }).ioc?.get?.<T>(key)

export class RsvpDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override description = 'Join a meeting from its page: signs your claim, writes it to the meeting\'s host, and hands the page its receipt'
  protected override deps = { signer: '@diamondcoreprocessor.com/NostrSigner' }

  readonly #onAsk = (e: Event): void => { void this.join((e as CustomEvent<RsvpAsk>).detail) }

  constructor() {
    super()
    if (typeof document !== 'undefined') document.addEventListener(RSVP_ASK, this.#onAsk)
  }

  protected override dispose(): void {
    if (typeof document !== 'undefined') document.removeEventListener(RSVP_ASK, this.#onAsk)
  }

  /** Sign and write one claim; the outcome is returned AND said on the document. */
  async join(ask: RsvpAsk | undefined): Promise<RsvpOutcome> {
    const event = String(ask?.event ?? '').toLowerCase()
    const outcome = await this.#join(event, ask)
    if (typeof document !== 'undefined') {
      document.dispatchEvent(new CustomEvent(outcome.ok ? RSVP_DONE : RSVP_ERROR, { detail: outcome }))
    }
    return outcome
  }

  async #join(event: string, ask: RsvpAsk | undefined): Promise<RsvpOutcome> {
    if (!SIG_RE.test(event)) return { ok: false, event, reason: 'name the meeting by its signature' }
    const name = String(ask?.name ?? '').trim()
    if (!name) return { ok: false, event, reason: 'say who is coming' }
    if (name.length > RSVP_NAME_MAX) return { ok: false, event, reason: `a name is at most ${RSVP_NAME_MAX} characters` }
    const going: Going = ask?.going === 'no' ? 'no' : 'yes'
    const signer = get<SignerShape>(this.deps.signer)
    if (!signer?.signEvent) return { ok: false, event, reason: 'no signer here' }
    const pool = await rsvpPoolAddress(event)
    let signed: Record<string, unknown>
    try { signed = await signer.signEvent(rsvpTemplate(pool, event, name, going)) } catch (error) {
      return { ok: false, event, reason: `the claim was not signed: ${(error as Error)?.message ?? error}` }
    }
    const bytes = new TextEncoder().encode(JSON.stringify(signed))
    const member = await (await import('@hypercomb/core')).SignatureService.sign(bytes.buffer as ArrayBuffer)
    const said = String(ask?.host ?? '').trim().replace(/^https?:\/\//, '').replace(/\/+$/, '').toLowerCase()
    const here = typeof location !== 'undefined' ? location : null
    const host = said || here?.host || ''
    const base = here && (!said || said === here.host.toLowerCase()) ? here.origin : hostBase(said)
    let res: Response
    try {
      res = await fetch(`${base}/${pool}/${member}`, { method: 'PUT', body: bytes, headers: { 'content-type': 'application/json' } })
    } catch (error) {
      return { ok: false, event, reason: `${host} could not be reached: ${(error as Error)?.message ?? error}` }
    }
    if (res.status !== 201 && res.status !== 200) {
      const why = (res.headers.get('x-reason') || (await res.text().catch(() => '')) || `HTTP ${res.status}`).trim()
      return { ok: false, event, reason: why }
    }
    return { ok: true, event, pool, member, name, going, host }
  }
}

const _rsvp = new RsvpDrone()
window.ioc.register('@diamondcoreprocessor.com/RsvpDrone', _rsvp)
