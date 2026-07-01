// diamondcoreprocessor.com/sharing/use-live-relay.queen.ts
//
// Hidden slash command `/use-live-relay` — sets the
// `hc:nostrmesh:use-live-relay` localStorage flag. ONE flag, TWO transports:
//
//   1. MESH — NostrMeshDrone's relay seed policy (loadRelays() there).
//   2. BYTES — ContentBroker's HTTP-direct fallback tier
//      (#getFallbackDomains / #liveRelayActive): when the live relay is
//      active the broker also falls back to the beta mirror hosts
//      (jwize.com + pluginthematrix.io/sigs) for ANY sig, so a fresh viewer
//      can resolve a peer's website/resource bytes even when no mesh
//      ['domain'] attribution reached it. sha256 still gates every byte.
//
// Both layers read the SAME flag with the SAME policy:
//
//   '1' → force LIVE_RELAY (wss://jwize.com) + beta byte mirrors on any origin
//   '0' → opt out: real host idles with zero relays, no byte mirrors
//   (unset) → origin default: local origin seeds loopback + no mirrors, real
//             host seeds LIVE_RELAY + beta byte mirrors
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
  readonly description = `Set localStorage['${FLAG_KEY}'] — '1' forces the live relay + beta byte mirrors (jwize.com + pluginthematrix.io/sigs), '0' opts out of both, clear restores the origin default. Takes effect on reload.`
  readonly slashHidden = true

  invoke(args: string): void {
    const arg = (args ?? '').trim().toLowerCase()

    let action: string
    if (arg === '' || arg === 'on' || arg === '1' || arg === 'true') {
      localStorage.setItem(FLAG_KEY, '1')
      action = `set to '1' — live relay + beta byte mirrors forced`
    } else if (arg === 'off' || arg === '0' || arg === 'false') {
      localStorage.setItem(FLAG_KEY, '0')
      action = `set to '0' — live relay + beta byte mirrors opted out`
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
