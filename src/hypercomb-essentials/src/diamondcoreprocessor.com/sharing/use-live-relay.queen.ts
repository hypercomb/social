// diamondcoreprocessor.com/sharing/use-live-relay.queen.ts
//
// Hidden slash command `/use-live-relay` — sets the
// `hc:nostrmesh:use-live-relay` localStorage flag that steers
// NostrMeshDrone's relay seed policy (see loadRelays() there):
//
//   '1' → force LIVE_RELAY (wss://jwize.com) on any origin
//   '0' → opt out: a real host idles with zero relays, no loopback
//   (unset) → origin default: local origin seeds loopback, real host
//             seeds LIVE_RELAY
//
// Usage:
//   /use-live-relay            → '1'
//   /use-live-relay on|1|true  → '1'
//   /use-live-relay off|0|false→ '0'
//   /use-live-relay clear      → remove the flag (origin default)
//
// The flag is read once at NostrMeshDrone construction, so a change
// takes effect on the next reload — the toast says so.
//
// Hidden from autocomplete (slashHidden): dev/ops-only ramp control
// while the shared bootstrap relay rolls out; the user must type it
// in full.

import { EffectBus } from '@hypercomb/core'

const FLAG_KEY = 'hc:nostrmesh:use-live-relay'

export class UseLiveRelayQueenBee {
  readonly command = 'use-live-relay'
  readonly description = `Set localStorage['${FLAG_KEY}'] — '1' forces the live relay, '0' opts out, clear restores the origin default. Takes effect on reload.`
  readonly slashHidden = true

  invoke(args: string): void {
    const arg = (args ?? '').trim().toLowerCase()

    let action: string
    if (arg === '' || arg === 'on' || arg === '1' || arg === 'true') {
      localStorage.setItem(FLAG_KEY, '1')
      action = `set to '1' — live relay forced`
    } else if (arg === 'off' || arg === '0' || arg === 'false') {
      localStorage.setItem(FLAG_KEY, '0')
      action = `set to '0' — live relay opted out`
    } else if (arg === 'clear' || arg === 'reset' || arg === 'default') {
      localStorage.removeItem(FLAG_KEY)
      action = 'cleared — origin default applies'
    } else {
      console.warn(`[use-live-relay] unrecognized arg "${arg}" — expected on|off|clear`)
      EffectBus.emit('toast:show', {
        type: 'warning',
        title: '/use-live-relay',
        message: `Unrecognized arg "${arg}". Use: on (or no arg), off, clear.`,
        duration: 5000,
      })
      return
    }

    console.log(`[use-live-relay] ${FLAG_KEY} ${action}`)
    EffectBus.emit('toast:show', {
      type: 'success',
      title: '/use-live-relay',
      message: `${action}. Reload to apply.`,
      duration: 5000,
    })
  }
}

;(window as { ioc?: { register?: (k: string, v: unknown) => void } }).ioc?.register?.(
  '@diamondcoreprocessor.com/UseLiveRelayQueenBee',
  new UseLiveRelayQueenBee(),
)
