// sharing/swarm-join.queen.ts
//
// THE WORDS FOR BEING IN A SWARM — `join` and `leave`.
//
// Until now the only ways in were a keyboard shortcut (ctrl+shift+P) and the
// mesh control. Nothing can be done without a beehavior; an act with no word
// is a bug, and this was the most important act in the swarm. It cost a whole
// evening: a hive sat with `hc:mesh-public: "false"` and no composed zone
// signature while its crumb read "public · humble slope · secure" — because
// that "public" is WORLD mode (every tile navigable) and the zone's word
// pair, not membership. Everything downstream was empty and correct: no sig,
// no subscription, no peers, no tiles, and nothing anywhere said "you never
// joined".
//
// ONE DOOR. Both words emit the same `keymap:invoke mesh.togglePublic` the
// control and the shortcut emit, so the zone guard lives in exactly one place
// (runtime-initializer): going public with a half-set zone opens the selector
// instead of producing a hive that looks joined and is deaf and mute. Leaving
// is never gated — the safe direction always works.
//
// Idempotent by reading the flag first, because a toggle answering to two
// different words would make `join` LEAVE a participant who was already in.

import { QueenBee, EffectBus, I18N_IOC_KEY, type I18nProvider } from '@hypercomb/core'

const MESH_PUBLIC_KEY = 'hc:mesh-public'

const inSwarm = (): boolean => {
  try { return localStorage.getItem(MESH_PUBLIC_KEY) === 'true' } catch { return false }
}

const say = (key: string, fallback: string): void => {
  const i18n = (window as { ioc?: { get?: (k: string) => unknown } }).ioc?.get?.(I18N_IOC_KEY) as I18nProvider | undefined
  EffectBus.emit('activity:log', { message: i18n?.t(key) ?? fallback, icon: '✦' })
}

/** The one gesture. The guard, the selector and the flag all live behind it. */
const toggle = (): void => {
  EffectBus.emit('keymap:invoke', { cmd: 'mesh.togglePublic', binding: null, event: null })
}

export class JoinQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'join'
  override description = 'Join the swarm here — your public tiles are offered, and other participants appear'
  override descriptionKey = 'slash.join'
  override examples = [
    { input: '/join', result: 'Joins the swarm for this zone; asks for a room and secret when one is missing' },
  ]

  protected async execute(): Promise<void> {
    if (inSwarm()) { say('swarm.join.already', 'you are already in the swarm here') ; return }
    toggle()
  }
}

export class LeaveQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'leave'
  override description = 'Leave the swarm — stop offering your tiles and stop seeing other participants'
  override descriptionKey = 'slash.leave'
  override examples = [
    { input: '/leave', result: 'Leaves the swarm; your hive and its tiles are untouched' },
  ]

  protected async execute(): Promise<void> {
    if (!inSwarm()) { say('swarm.leave.already', 'you are not in a swarm') ; return }
    toggle()
  }
}

const _join = new JoinQueenBee()
const _leave = new LeaveQueenBee()
window.ioc.register('@diamondcoreprocessor.com/JoinQueenBee', _join)
window.ioc.register('@diamondcoreprocessor.com/LeaveQueenBee', _leave)
