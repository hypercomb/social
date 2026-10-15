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
// Idempotent by asking first, because a toggle answering to two different
// words would make `join` LEAVE a participant who was already in. The answer
// is THIS tab's membership (membership.ts), never the origin-wide flag a
// second tab can rewrite.
//
// A TAB WITH NO MEETING OF ITS OWN IS ASKED (D5, 2026-10-10). The origin-wide
// room and secret only PRE-FILL a new tab: on a returning device they are
// last week's meeting, and `join` there used to go straight back in without
// a word. Unless this tab joined or chose a zone itself (`ownZone`), `join`
// opens the selector pre-filled — one tap to START, no round trip. Asked
// here as well as at the shell's guard, so a shell older than that guard
// asks too.

import { QueenBee, EffectBus, I18N_IOC_KEY, type I18nProvider } from '@hypercomb/core'
import { isJoinedHere, ownZone } from './membership.js'

const inSwarm = (): boolean => isJoinedHere()

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
    { input: '/join', result: 'Joins the swarm in the zone this tab is in; a tab with none of its own opens the selector, pre-filled' },
    { input: '/join downtown downtown hypercomb.com', result: 'Meets in that location with that secret at that host, and joins — no selector' },
    { input: '/join mynewroom mynewpass', result: 'A new location and secret at the host this tab already meets at, and joins' },
  ]
  // The values are the zone's identity as typed (the room folds case itself).
  override rawArgs = true

  protected async execute(args: string): Promise<void> {
    // WITH VALUES (jwize, 2026-10-12: "when the values are set you can just
    // say join … or you can use those overrides"): location, secret and an
    // optional host — the same one step as /use-live-relay and the selector's
    // START, so all three leave the tab in the same room. Never the selector
    // unless a value is missing.
    if (String(args ?? '').trim()) {
      const step = (window as { ioc?: { get?: (k: string) => unknown } }).ioc?.get?.('@diamondcoreprocessor.com/UseLiveRelayQueenBee') as { invoke?: (a: string) => void } | undefined
      if (step?.invoke) { step.invoke(args); return }
    }
    if (inSwarm()) { say('swarm.join.already', 'you are already in the swarm here') ; return }
    if (!ownZone()) { EffectBus.emit('mesh:open-modal', { join: true }) ; return }
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
