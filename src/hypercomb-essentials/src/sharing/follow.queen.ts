// sharing/follow.queen.ts
//
// `follow` — the domains you read from (jwize, 2026-10-07: "from our command
// line we can create a follow behavior that shows participant domains in a
// swarm perhaps as the autocomplete or just have it any time to add your
// hosts").
//
//   follow                   who you follow, and who in the swarm you could
//   follow <domain>          follow a domain — any domain, any time
//   follow off <domain>      stop following it
//
// As you type, it offers the domains participants in the swarm advertise as
// their own host — each one taken from an event that participant's key
// signed (names.service.ts `hint`) — that you do not follow yet.
//
// Following changes only your own install, and an update from a domain you
// follow is taken only when you turn updates on for it
// (documentation/becoming-a-host.md). The list is the `community:hosts`
// pool, written through the hosts window's own effects (`hosts:add`,
// `hosts:remove`), so the window and this word can never disagree.
//
// Not follow.drone.ts: that is following a PARTICIPANT around the hive (you
// go where they go). This is following a DOMAIN (you read what it publishes).

import { EffectBus, QueenBee, get, I18N_IOC_KEY, type I18nProvider } from '@hypercomb/core'
import { hostZone } from './community-hosts.js'
import { nameService } from './names.service.js'

const t = (key: string, fallback: string, params: Record<string, string> = {}): string => {
  const value = get<I18nProvider>(I18N_IOC_KEY)?.t?.(key, params)
  return value && value !== key ? value : fallback.replace(/\{(\w+)\}/g, (_, name: string) => params[name] ?? '')
}

export class FollowQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'sharing'
  readonly command = 'follow'
  override description = 'Follow a domain — read what is published there. Alone, who you follow'
  override descriptionKey = 'slash.follow'
  override options = ['<domain>', 'off <domain>']
  override examples = [
    { input: '/follow hypercomb.com', result: 'You follow hypercomb.com' },
    { input: '/follow off hypercomb.com', result: 'You no longer follow hypercomb.com' },
    { input: '/follow', result: 'Who you follow, and who in the swarm you could' },
  ]

  // A domain is the whole argument: its dots are not a walk.
  override rawArgs = true

  /** The domains you follow, as the hosts window last read them. */
  #followed: readonly string[] = []

  constructor() {
    super()
    EffectBus.on<{ zones?: string[] }>('hosts:render', payload => {
      if (Array.isArray(payload?.zones)) this.#followed = payload.zones
    })
  }

  /** Participants' own hosts in the swarm that you do not follow yet. */
  #inSwarm(): string[] {
    return nameService.advertisedHosts()
      .map(host => hostZone(host))
      .filter((zone): zone is string => !!zone && !this.#followed.includes(zone))
  }

  override slashComplete(args: string): readonly string[] {
    const typed = args.toLowerCase().replace(/^\s+/, '')
    const off = /^off\s+/.test(typed)
    if (off) {
      const word = typed.replace(/^off\s+/, '')
      return this.#followed.filter(zone => zone.startsWith(word) && zone !== word).map(zone => `off ${zone}`)
    }
    const offered = this.#inSwarm().filter(zone => zone.startsWith(typed) && zone !== typed)
    return this.#followed.length && 'off '.startsWith(typed) && typed.length > 0 ? [...offered, 'off '] : offered
  }

  protected async execute(args: string): Promise<void> {
    const text = args.trim()
    const off = /^off\s+/i.test(text)
    const raw = (off ? text.replace(/^off\s+/i, '') : text).trim()
    if (!raw) { this.#say(this.#summary()); return }
    const zone = hostZone(raw)
    if (!zone) {
      this.#say(t('follow.notdomain', '{raw} is not a domain — follow takes one, such as hypercomb.com', { raw }), 'warning')
      return
    }
    if (off) {
      if (!this.#followed.includes(zone)) { this.#say(t('follow.notfollowed', 'You do not follow {zone}', { zone })); return }
      EffectBus.emit('hosts:remove', { zone })
      this.#say(t('follow.stopped', 'You no longer follow {zone}', { zone }), 'success')
      return
    }
    if (this.#followed.includes(zone)) { this.#say(t('follow.already', 'You already follow {zone}', { zone })); return }
    EffectBus.emit('hosts:add', { zone })
    this.#say(t('follow.started', 'You follow {zone}. Its updates reach you only once you turn them on for it.', { zone }), 'success')
  }

  #summary(): string {
    const swarm = this.#inSwarm()
    const following = this.#followed.length
      ? t('follow.list', 'You follow {zones}', { zones: this.#followed.join(', ') })
      : t('follow.none', 'You follow no one yet — follow <domain>')
    return swarm.length
      ? `${following}. ${t('follow.swarm', 'In the swarm: {zones}', { zones: swarm.join(', ') })}`
      : following
  }

  #say(message: string, type = 'info'): void {
    EffectBus.emit('activity:log', { message, icon: '🔗' })
    EffectBus.emit('toast:show', { type, message })
  }
}

const _follow = new FollowQueenBee()
window.ioc.register('@diamondcoreprocessor.com/FollowQueenBee', _follow)
