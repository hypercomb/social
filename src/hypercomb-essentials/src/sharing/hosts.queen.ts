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
//   hosts reach [@<host>]           THE OPERATOR'S WALK before head only goes
//                                   on (hosted-tenants.md §4): every index the
//                                   host holds has its reach marked servable and
//                                   shared, one signed POST /reach per index,
//                                   until the host says there is no next one
//
// With no @<host>, the words speak to your public content host.

import { EffectBus, get, I18N_IOC_KEY, SignatureService, type I18nProvider } from '@hypercomb/core'
import { clearHiveRoot, fetchHiveIndex, listedOf, nip98Header, setHiveRoot, setHostListing } from './hive-pointer.js'
import { addCommunityHost, hostArtifactSig, hostZone } from './community-hosts.js'
import { publishWelcome, readOwnWelcome, welcomeZone } from './host-welcome.js'
import { publisherKeyHex } from './key-list.client.js'

const SYNC_KEY = '@diamondcoreprocessor.com/HostSyncService'
const SIGNER_KEY = '@diamondcoreprocessor.com/NostrSigner'
const WORDS = ['list', 'unlist', 'listed', 'welcome', 'follow', 'unfollow', 'following', 'reach']
/** One walk asks at most this many indexes — a host never answers forever. */
const REACH_CALLS_MAX = 10_000

type SyncLike = { publicHostDomain?: () => string }
type SignerLike = { getPublicKeyHex?: () => Promise<string | null> } & Partial<Parameters<typeof nip98Header>[0]>

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
  readonly options = ['list <meaning> [@<host>]', 'unlist <meaning> [@<host>]', 'listed [@<host>]', 'follow <door> [@<host>]', 'unfollow <door> [@<host>]', 'following [@<host>]', 'welcome <zone> <title> [| <tagline>] [@<host>]', 'reach [@<host>]']

  slashComplete(args: string): readonly string[] {
    const q = args.toLowerCase().trim()
    return WORDS.map(w => w + ' ').filter(w => w.startsWith(q) && w.trim() !== q)
  }

  async invoke(args: string): Promise<void> {
    const parts = args.trim().split(/\s+/).filter(Boolean)
    const word = (parts[0] ?? '').toLowerCase()
    if (!WORDS.includes(word)) { EffectBus.emit('hosts:view-toggle', {}); return }

    // A host is a name, never a path: the slash form can hand `@x/hosts` back
    // (the word appended as a route), so the name ends at the first slash.
    const host = parts.find(p => p.startsWith('@'))?.slice(1).split('/')[0].toLowerCase()
      || String(get<SyncLike>(SYNC_KEY)?.publicHostDomain?.() ?? '').trim().toLowerCase()
    if (!host) { toast(t('hosts.nohost', 'No public host is configured — say @<host>.'), 'warning'); return }

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

    if (word === 'reach') { await reachWalk(host); return }

    if (word === 'following') {
      const pubkey = await publisherKeyHex()
      if (!pubkey) { toast(t('hosts.nosigner', 'A signing key is required.'), 'warning'); return }
      const read = await fetchHiveIndex(host, pubkey)
      const zones = read.ok ? Object.keys(read.manifest.roots ?? {}).filter(k => k.startsWith('follow:')).map(k => k.slice('follow:'.length)) : []
      toast(zones.length
        ? t('hosts.following', '{host} follows: {zones}', { host, zones: zones.join(', ') })
        : t('hosts.followingnone', '{host} follows no other door yet.', { host }))
      return
    }

    if (word === 'listed') {
      const pubkey = await publisherKeyHex()
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

/** `hosts reach` — the operator's walk (worker POST /reach): one held index per
 *  signed call, `{after}` the cursor the host gave back, until `next` is null.
 *  Only a key the host names as its operator is answered; anyone else gets the
 *  host's refusal, said as it was given. Nothing here withdraws anything — the
 *  walk only marks what every index reaches as servable and shared. */
export async function reachWalk(host: string, io: {
  fetch?: typeof fetch
  sign?: (url: string, body: string) => Promise<string | null>
  say?: (message: string, type?: string) => void
} = {}): Promise<{ walked: number; complete: boolean; error?: string }> {
  const say = io.say ?? toast
  const doFetch = io.fetch ?? ((url, init) => fetch(url, init))
  const sign = io.sign ?? (async (url: string, body: string) => {
    const signer = get<SignerLike>(SIGNER_KEY)
    if (!signer?.signEvent) return null
    return nip98Header(signer as Parameters<typeof nip98Header>[0], url, 'POST',
      await SignatureService.sign(new TextEncoder().encode(body).buffer as ArrayBuffer))
  })
  const url = `${/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host) ? 'http' : 'https'}://${host}/reach`
  let after: string | null = ''
  let walked = 0
  let complete = true
  say(t('hosts.reach-start', 'Walking every index {host} holds…', { host }))
  for (let calls = 0; after !== null && calls < REACH_CALLS_MAX; calls++) {
    const body = JSON.stringify(after ? { after } : {})
    const auth = await sign(url, body)
    if (!auth) {
      const error = t('hosts.reach-nosigner', "No signer is unlocked here — the walk is signed by this host's operator key.")
      say(error, 'warning'); return { walked, complete: false, error }
    }
    let answer: { walked?: string | null; complete?: boolean; next?: string | null }
    try {
      const res = await doFetch(url, { method: 'POST', headers: { Authorization: auth, 'Content-Type': 'application/json' }, body })
      if (!res.ok) {
        const error = t('hosts.reach-refused', '{host} refused the walk ({status}): {reason}', { host, status: String(res.status), reason: (await res.text()).slice(0, 200) })
        say(error, 'warning'); return { walked, complete: false, error }
      }
      answer = await res.json()
    } catch (err) {
      const error = t('hosts.reach-unreachable', '{host} did not answer the walk: {reason}', { host, reason: String((err as Error)?.message ?? err) })
      say(error, 'warning'); return { walked, complete: false, error }
    }
    if (answer.walked) walked++
    if (answer.complete === false) complete = false
    after = answer.next ?? null
  }
  say(complete
    ? t('hosts.reach-done', '{host}: {count} index(es) walked — head only can go on.', { host, count: String(walked) })
    : t('hosts.reach-partial', '{host}: {count} index(es) walked, but at least one was too large to walk whole — say it again before head only goes on.', { host, count: String(walked) }),
    complete ? 'success' : 'warning')
  return { walked, complete }
}
