// diamondcoreprocessor.com/sharing/subscribe-consent.drone.ts
//
// Bridges the mesh `swarm:subscribe-request-received` event to the
// user-facing toast surface. Renders a Material-combo consent toast
// with Accept / No thanks buttons. Accept calls
// swarm.acceptSubscribeRequest(pubkey); No thanks calls
// swarm.declineSubscribeRequest(pubkey). Both decisions persist
// across reloads so the toast doesn't re-prompt for the same peer.
//
// Why a separate drone (vs inlining in swarm.drone): the swarm holds
// the data primitives (mesh subs, channel sigs, accept/decline lists).
// The user-facing surface — exactly which UI fires, with what copy,
// in what variant — is presentation. A small drone bridging the two
// keeps each side small. It also makes the toast pluggable: a
// different shell could swap this drone for a modal dialog without
// touching the swarm.
//
// Lifecycle:
//   1. Mesh receives a kind-30205 event addressed to my request sig
//   2. SwarmDrone#onSubscribeRequest decodes + checks pre-decisions
//   3. emits 'swarm:subscribe-request-received' (skipped for pre-
//      declined; tagged preApproved for pre-allowed)
//   4. THIS drone catches it, emits 'toast:show' with two actions
//      bound to 'swarm:consent-accept' / 'swarm:consent-decline'
//   5. ToastDrone renders the combo; click triggers the matching
//      effect; THIS drone catches those effects and calls the
//      swarm's accept / decline methods with the pubkey

import { Drone, EffectBus } from '@hypercomb/core'
import type { ToastRequest } from '../commands/toast.drone.js'

const SWARM_DRONE_KEY = '@diamondcoreprocessor.com/SwarmDrone'
const I18N_KEY = '@hypercomb.social/I18n'

interface SwarmConsentApi {
  acceptSubscribeRequest: (pubkey: string) => void
  declineSubscribeRequest: (pubkey: string) => void
}

interface I18nLike {
  t: (key: string, params?: Record<string, unknown>) => string
}

interface SubscribeRequestPayload {
  requesterPubkey: string
  requesterLabel?: string
  preApproved?: boolean
}

interface ConsentDecisionPayload { pubkey: string }

export class SubscribeConsentDrone extends Drone {

  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'sharing'

  public override description =
    'Surfaces a Material-combo Accept / No thanks toast when a peer asks to subscribe to the user\'s hive. Both decisions persist via SwarmDrone\'s subscribe-allowed / subscribe-declined lists.'

  protected override listens: string[] = [
    'swarm:subscribe-request-received',
    'swarm:consent-accept',
    'swarm:consent-decline',
  ]
  protected override emits: string[] = ['toast:show']

  #initialized = false

  protected override sense = () => true
  protected override heartbeat = async (): Promise<void> => {
    if (this.#initialized) return
    this.#initialized = true

    this.onEffect<SubscribeRequestPayload>(
      'swarm:subscribe-request-received',
      (payload) => this.#showConsentToast(payload),
    )

    // Action targets — the toast emits these via the per-action effect
    // binding (see #showConsentToast).
    this.onEffect<ConsentDecisionPayload>('swarm:consent-accept', (p) => {
      const swarm = (window as { ioc?: { get: (k: string) => unknown } }).ioc?.get?.(SWARM_DRONE_KEY) as SwarmConsentApi | undefined
      swarm?.acceptSubscribeRequest?.(String(p?.pubkey ?? ''))
    })
    this.onEffect<ConsentDecisionPayload>('swarm:consent-decline', (p) => {
      const swarm = (window as { ioc?: { get: (k: string) => unknown } }).ioc?.get?.(SWARM_DRONE_KEY) as SwarmConsentApi | undefined
      swarm?.declineSubscribeRequest?.(String(p?.pubkey ?? ''))
    })
  }

  #showConsentToast = (payload: SubscribeRequestPayload): void => {
    const pubkey = String(payload?.requesterPubkey ?? '').trim().toLowerCase()
    if (!/^[0-9a-f]{64}$/.test(pubkey)) return

    const label = String(payload?.requesterLabel ?? '').trim().slice(0, 64)
    const i18n = (window as { ioc?: { get: (k: string) => unknown } }).ioc?.get?.(I18N_KEY) as I18nLike | undefined
    const requester = label || `${pubkey.slice(0, 8)}…`

    if (payload?.preApproved) {
      // Already on the allowlist — non-modal info, no buttons. Lets
      // the user see "X subscribed" without re-prompting consent.
      EffectBus.emit('toast:show', {
        type: 'info',
        title: i18n?.t('swarm.consent.info-title') ?? 'New subscriber',
        message: i18n?.t('swarm.consent.info-message', { requester }) ?? `${requester} subscribed to your hive`,
        duration: 4000,
      } as ToastRequest)
      return
    }

    // First-time consent prompt: Material combo with Accept / No thanks.
    EffectBus.emit('toast:show', {
      type: 'info',
      title: i18n?.t('swarm.consent.title') ?? 'Subscribe request',
      message: i18n?.t('swarm.consent.message', { requester }) ?? `${requester} wants to subscribe to your hive`,
      duration: 0,  // sticky — user must decide or dismiss
      actions: [
        {
          label: i18n?.t('swarm.consent.accept') ?? 'Accept',
          effect: 'swarm:consent-accept',
          payload: { pubkey },
          kind: 'primary',
        },
        {
          label: i18n?.t('swarm.consent.decline') ?? 'No thanks',
          effect: 'swarm:consent-decline',
          payload: { pubkey },
          kind: 'secondary',
        },
      ],
    } as ToastRequest)
  }
}

const _consent = new SubscribeConsentDrone()
window.ioc.register('@diamondcoreprocessor.com/SubscribeConsentDrone', _consent)
