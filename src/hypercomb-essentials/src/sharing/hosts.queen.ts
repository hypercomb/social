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
//
// With no @<host>, the words speak to your public content host.

import { EffectBus, get, I18N_IOC_KEY, type I18nProvider } from '@hypercomb/core'
import { fetchHiveIndex, listedOf, setHostListing } from './hive-pointer.js'

const SYNC_KEY = '@diamondcoreprocessor.com/HostSyncService'
const SIGNER_KEY = '@diamondcoreprocessor.com/NostrSigner'
const WORDS = ['list', 'unlist', 'listed']

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
  readonly options = ['list <meaning> [@<host>]', 'unlist <meaning> [@<host>]', 'listed [@<host>]']

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
