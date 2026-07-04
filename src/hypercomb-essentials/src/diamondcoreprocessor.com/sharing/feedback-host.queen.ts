// diamondcoreprocessor.com/sharing/feedback-host.queen.ts
//
// Slash command `/feedback-host on|off` — toggle HOST mode on THIS browser:
// subscribe to the FIXED community feedback channel, ingest every participant's
// feedback, and render the aggregated dashboard from it.
//
// Participants do NOT need this — they publish their feedback by default. This
// is the single switch the HOST flips on their own browser to RECEIVE it (the
// loop routine sets the same flag automatically in its renderer). Effect is
// immediate via the drone's enable()/disable() — no reload.
//
//   /feedback-host              → on
//   /feedback-host on|1|true    → on
//   /feedback-host off|0|false  → off

import { EffectBus } from '@hypercomb/core'

const CHANNEL_KEY = '@diamondcoreprocessor.com/FeedbackChannelDrone'
const ENABLED_KEY = 'hc:feedback-channel:enabled'

interface ChannelLike { enable?: (id?: string) => Promise<void>; disable?: () => void }
const chan = (): ChannelLike | undefined =>
  (window as { ioc?: { get?: (k: string) => unknown } }).ioc?.get?.(CHANNEL_KEY) as ChannelLike | undefined

export class FeedbackHostQueenBee {
  readonly command = 'feedback-host'
  readonly description =
    'Toggle HOST mode: receive and aggregate every participant’s feedback into your dashboard. on (default) | off. Participants publish by default and never need this.'

  async invoke(args: string): Promise<void> {
    const arg = (args ?? '').trim().toLowerCase()
    let action: string
    if (arg === '' || arg === 'on' || arg === '1' || arg === 'true') {
      try { await chan()?.enable?.() } catch { try { localStorage.setItem(ENABLED_KEY, 'true') } catch { /* ignore */ } }
      action = 'ON — receiving + aggregating community feedback'
    } else if (arg === 'off' || arg === '0' || arg === 'false') {
      try { chan()?.disable?.() } catch { try { localStorage.setItem(ENABLED_KEY, 'false') } catch { /* ignore */ } }
      action = 'OFF — you still contribute your own feedback, but no longer receive others’'
    } else {
      EffectBus.emit('toast:show', { type: 'warning', title: '/feedback-host', message: `Unrecognized arg "${arg}". Use: on (or no arg), off.`, duration: 5000 })
      return
    }
    EffectBus.emit('toast:show', { type: 'success', title: '/feedback-host', message: `Host mode ${action}.`, duration: 5000 })
  }
}

;(window as { ioc?: { register?: (k: string, v: unknown) => void } }).ioc?.register?.(
  '@diamondcoreprocessor.com/FeedbackHostQueenBee',
  new FeedbackHostQueenBee(),
)
