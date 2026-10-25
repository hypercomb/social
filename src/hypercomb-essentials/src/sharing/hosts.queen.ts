// sharing/hosts.queen.ts
//
// `/hosts` — the hosts you carry.
//
// Companion to `/publish`, with a clean ownership boundary. Publish is
// branch-scoped: where this branch goes and what the world serves. Hosts is
// the durable directory: which domains you carry and which packages they
// offer, before any branch chooses a destination.
//
//   hosts                           toggle the host directory panel
//   hosts list <meaning> [@<host>]  a host you operate LISTS that pool in
//                                   public, past the host contract's floor —
//                                   signed into your index as `listed`
//                                   (hypercomb-relay/host-listing.js)
//   hosts unlist <meaning> [@<host>]  withdraw it; the bytes stay, the listing goes
//   hosts listed [@<host>]          what your index on the host declares
//   hosts follow <door> [@<host>]   THE HOST NETWORK FOR MEETINGS: the doors of
//                                   the host you speak for follow that door —
//                                   its meetings show on your calendar, their
//                                   lists open on your doors, and every door
//                                   keeps the whole list (calendar-events.md).
//                                   Signed into your index as follow:<door>.
//   hosts unfollow <door> [@<host>] stop following it
//   hosts following [@<host>]       which doors your host follows
//   hosts welcome <zone> <title> [| <tagline>] [@<host>]
//                                   what a front door calls itself: a signed
//                                   card in the pool sign('welcome:<zone>')
//                                   (host-welcome.ts) — a link to the zone
//                                   previews under this title
//
// With no @<host>, the words speak to your public content host.

import { EffectBus, get, I18N_IOC_KEY, type I18nProvider } from '@hypercomb/core'
import { clearHiveRoot, fetchHiveIndex, listedOf, setHiveRoot, setHostListing } from './hive-pointer.js'
import { addCommunityHost, hostArtifactSig, hostZone } from './community-hosts.js'
import { publishWelcome, readOwnWelcome, welcomeZone } from './host-welcome.js'

const SYNC_KEY = '@diamondcoreprocessor.com/HostSyncService'
const SIGNER_KEY = '@diamondcoreprocessor.com/NostrSigner'
const WORDS = ['list', 'unlist', 'listed', 'welcome', 'follow', 'unfollow', 'following']

type SyncLike = { publicHostDomain?: () => string }
type SignerLike = { getPublicKeyHex?: () => Promise<string | null> }

const toast = (message: string, type = 'info'): void => { EffectBus.emit('toast:show', { type, message }) }
const t = (key: string, fallback: string, params: Record<string, string> = {}): string => {
  const value = get<I18nProvider>(I18N_IOC_KEY)?.t?.(key, params)
  return value && value !== key ? value : fallback.replace(/\{(\w+)\}/g, (_, name: string) => params[name] ?? '')
}

export class HostsQueenBee {
  readonly command = 'hosts'
  readonly description =
    'Open your host directory — add or remove a host, inspect its packages, and add one to your hive. Publish uses this directory for branch destinations.'
  readonly descriptionKey = 'slash.hosts'
  // A card's title keeps its case ("Plugin the Matrix"); every sub-word and zone
  // below is folded where it is read.
  readonly rawArgs = true
  readonly options = ['list <meaning> [@<host>]', 'unlist <meaning> [@<host>]', 'listed [@<host>]', 'follow <door> [@<host>]', 'unfollow <door> [@<host>]', 'following [@<host>]', 'welcome <zone> <title> [| <tagline>] [@<host>]']

  slashComplete(args: string): readonly string[] {
    const q = args.toLowerCase().trim()
    return WORDS.map(w => w + ' ').filter(w => w.startsWith(q) && w.trim() !== q)
  }

  async invoke(args: string): Promise<void> {
    const parts = args.trim().split(/\s+/).filter(Boolean)
    const word = (parts[0] ?? '').toLowerCase()
    if (!WORDS.includes(word)) { EffectBus.emit('hosts:view-toggle', {}); return }

    const host = parts.find(p => p.startsWith('@'))?.slice(1)
      || String(get<SyncLike>(SYNC_KEY)?.publicHostDomain?.() ?? '').trim().toLowerCase()
    if (!host) { toast(t('hosts.nohost', 'No public host is configured — add one in hosts, or say @<host>.'), 'warning'); return }

    if (word === 'welcome') {
      const rest = parts.slice(1).filter(p => !p.startsWith('@'))
      const zone = welcomeZone(rest[0])
      const [title = '', tagline = ''] = rest.slice(1).join(' ').split('|').map(part => part.trim())
      if (!zone || !title) { toast(t('hosts.welcomesay', 'Say hosts welcome <zone> <title> | <tagline>, such as hosts welcome example.com Example | What it is.'), 'warning'); return }
      // A new title keeps the room the card carries (room host) — and a card
      // that could not be read is never written over blind.
      const own = await readOwnWelcome(host, zone)
      if (own.state === 'unknown') { toast(t('hosts.welcomeunread', 'The card for {zone} could not be read ({reason}) — nothing was changed.', { zone, reason: own.reason }), 'warning'); return }
      const done = await publishWelcome(host, zone, title, tagline, own.state === 'card' ? own.card.swarm : '')
      if (!done.ok) { toast(t('hosts.welcomefailed', 'The card for {zone} was not published: {reason}', { zone, reason: done.reason }), 'warning'); return }
      toast(t('hosts.welcomed', '{zone} now goes by "{title}".', { zone, title }), 'success')
      return
    }

    if (word === 'follow' || word === 'unfollow') {
      const zone = hostZone(parts.slice(1).find(p => !p.startsWith('@')) ?? '')
      if (!zone) { toast(t('hosts.followsay', 'Say hosts {word} <door>, such as hosts follow meetups.example.com.', { word }), 'warning'); return }
      // The worker follows only a public dotted hostname (publicHostName): a
      // port, a loopback name or a bare address would sign a follow no door
      // ever honours, so it is refused here instead of toasting success
      // (audit 2026-10-23).
      if (zone.includes(':') || !zone.includes('.') || /^\d+(\.\d+){3}$/.test(zone)) {
        toast(t('hosts.followpublic', '{zone} is not a public hostname — a door is followed by its dotted domain name, without a port.', { zone }), 'warning')
        return
      }
      const key = `follow:${zone}`
      const on = word === 'follow'
      const done = on ? await setHiveRoot(host, key, await hostArtifactSig(zone)) : await clearHiveRoot(host, key)
      if (!done.ok) {
        toast(t('hosts.followfailed', '{host} did not take it: {reason}', { host, reason: String(done.reason ?? 'refused') }), 'warning')
        return
      }
      // Your hive carries the door too, so `event list` reads its calendar.
      if (on) await addCommunityHost(zone).catch(() => '')
      toast(on
        ? t('hosts.followed', '{host} follows {zone}: its meetings show on your calendar, and every door keeps their whole list.', { host, zone })
        : t('hosts.unfollowed', '{host} no longer follows {zone}.', { host, zone }), 'success')
      EffectBus.emit('hosts:followed', { host, zone, on })
      return
    }

    if (word === 'following') {
      const pubkey = String(await get<SignerLike>(SIGNER_KEY)?.getPublicKeyHex?.().catch(() => null) ?? '').toLowerCase()
      if (!pubkey) { toast(t('hosts.nosigner', 'A signing key is required.'), 'warning'); return }
      const read = await fetchHiveIndex(host, pubkey)
      const zones = read.ok ? Object.keys(read.manifest.roots ?? {}).filter(k => k.startsWith('follow:')).map(k => k.slice('follow:'.length)) : []
      toast(zones.length
        ? t('hosts.following', '{host} follows: {zones}', { host, zones: zones.join(', ') })
        : t('hosts.followingnone', '{host} follows no other door yet.', { host }))
      return
    }

    if (word === 'listed') {
      const pubkey = String(await get<SignerLike>(SIGNER_KEY)?.getPublicKeyHex?.().catch(() => null) ?? '').toLowerCase()
      if (!pubkey) { toast(t('hosts.nosigner', 'A signing key is required.'), 'warning'); return }
      const read = await fetchHiveIndex(host, pubkey)
      const listed = read.ok ? listedOf(read.manifest.signedContent) : []
      toast(listed.length
        ? t('hosts.listed', '{host} is asked to list: {meanings}', { host, meanings: listed.join(', ') })
        : t('hosts.listednone', 'Your index on {host} lists nothing past the floor.', { host }))
      return
    }

    const meaning = parts.slice(1).find(p => !p.startsWith('@')) ?? ''
    if (!meaning) { toast(t('hosts.saymeaning', 'Say hosts {word} <meaning>, such as hypercomb:windows.', { word }), 'warning'); return }
    const on = word === 'list'
    const done = await setHostListing(host, meaning, on)
    if (!done.ok) { toast(on
      ? t('hosts.listfailed', '{meaning} was not listed on {host}: {reason}', { meaning, host, reason: done.reason })
      : t('hosts.unlistfailed', '{meaning} was not unlisted on {host}: {reason}', { meaning, host, reason: done.reason }), 'warning'); return }
    const params = { meaning, host }
    toast(done.reason === 'unchanged'
      ? (on ? t('hosts.alreadylisted', '{meaning} was already listed on {host}.', params) : t('hosts.alreadyunlisted', '{meaning} was already not listed on {host}.', params))
      : (on ? t('hosts.nowlisted', '{host} now lists {meaning} for anyone who asks.', params) : t('hosts.nowunlisted', '{host} no longer lists {meaning}.', params)), 'success')
    EffectBus.emit('hosts:listed', { host, listed: done.listed })
  }
}

const _hosts = new HostsQueenBee()
window.ioc.register('@diamondcoreprocessor.com/HostsQueenBee', _hosts)
