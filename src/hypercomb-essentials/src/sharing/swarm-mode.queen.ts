// sharing/swarm-mode.queen.ts
//
// `/swarm-mode` — how long what you visited stays on the wire. Jaime's ruling
// (2026-09-02): "as soon as you visited the tile once it should be in memory
// for all of the participants until the end of the swarm or leaving and
// coming back" — and a second mode where tiles are ephemeral to the people
// in the same location as you.
//
//   /swarm-mode              say which mode is on
//   /swarm-mode sticky       every page you visit this session stays announced
//                            until you leave the zone (the default)
//   /swarm-mode ephemeral    only the page you are standing on is announced —
//                            what you leave lapses for the people there
//
// The flag is participant-local ('hc:swarm:sticky'), like the public list and
// the hidden lineages; it never enters a layer. SwarmDrone reads it on every
// heartbeat (#refreshVisitedPages) and on every sync (the visited-page record),
// so a switch takes effect within one tick — nothing here reaches into the
// drone.

import { EffectBus } from '@hypercomb/core'

const STICKY_KEY = 'hc:swarm:sticky'

const isSticky = (): boolean => {
  try { return localStorage.getItem(STICKY_KEY) !== '0' } catch { return true }
}

export class SwarmModeQueenBee {
  readonly command = 'swarm-mode'
  readonly description =
    'How long what you visited stays shared in a swarm: /swarm-mode sticky keeps every page you visited announced until you leave (default); /swarm-mode ephemeral announces only where you stand. Bare = show the current mode.'
  readonly slashHidden = false

  invoke(args: string): void {
    const word = (args ?? '').trim().split(/\s+/)[0]?.toLowerCase() ?? ''

    if (word === 'sticky' || word === 'ephemeral') {
      try { localStorage.setItem(STICKY_KEY, word === 'sticky' ? '1' : '0') }
      catch { this.#toast('warning', 'could not persist the mode (private browsing?)'); return }
      this.#toast('success', word === 'sticky'
        ? 'sticky — every page you visit stays announced until you leave the zone'
        : 'ephemeral — only the page you are standing on is announced; what you leave lapses in about 90s')
      return
    }

    if (word) {
      this.#toast('warning', `unknown mode "${word}" — say sticky or ephemeral`)
      return
    }

    this.#toast('info', isSticky()
      ? 'sticky — visited pages stay announced until you leave (say "ephemeral" to announce only where you stand)'
      : 'ephemeral — only where you stand is announced (say "sticky" to keep visited pages announced)')
  }

  #toast(type: string, message: string): void {
    EffectBus.emit('toast:show', { type, title: '/swarm-mode', message, duration: 6000 })
  }
}

;(window as { ioc?: { register?: (k: string, v: unknown) => void } }).ioc?.register?.(
  '@diamondcoreprocessor.com/SwarmModeQueenBee',
  new SwarmModeQueenBee(),
)
