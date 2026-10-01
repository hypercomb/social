// assistant/harness.queen.ts
//
// THE WORDS (documentation/agent-harness.md, step 4). `harness` lists the
// pool and says which record the device runs under and which the open
// conversation does; `harness use <name>` chooses for the device; `harness
// here <name>` marks the open conversation (`harness here default` takes the
// mark off); `harness import <json>` brings a record in by its bytes;
// `harness show [name]` prints one. Every act has a word; a harness is
// content, so the words act on records by name or signature and never on
// code. `harness edit [name]` opens a record as a tile whose note is the
// JSON; editing the note is the save (assistant/harness-tiles.ts).

import { QueenBee, EffectBus, I18N_IOC_KEY, type I18nProvider } from '@hypercomb/core'
import { harness, type HarnessRecord } from './harness.js'
import { publishHarness, syncHarnessesFrom, type HarnessPublishDeps } from './harness-network.js'
import { listReceipts, summarizeReceipts } from './agent-receipts.js'
import { openHarnessTile } from './harness-tiles.js'
import { setHiveRoot } from '../sharing/hive-pointer.js'
import { PUBLIC_CONTENT_HOSTS } from '../sharing/hive-link.js'
import { listCommunityHosts } from '../sharing/community-hosts.js'

const short = (sig: string): string => sig.slice(0, 12)

const STORE_KEY = '@hypercomb.social/Store'
const HOST_SYNC_KEY = '@diamondcoreprocessor.com/HostSyncService'
type StoreLike = {
  putResource?(blob: Blob, options?: { emit?: boolean }): Promise<string>
  getResourceLocal?(sig: string): Promise<Blob | null>
  getResource?(sig: string): Promise<Blob | null>
}
type HostSyncLike = {
  publishAtoms?(host: string, sigs: readonly string[], bytesOf: (sig: string) => Promise<Uint8Array | null>):
    Promise<{ ok: true; sent: number; held: number } | { ok: false; error: string }>
}

/** A host as a URL: loopback on http, everything else https. */
const hostUrl = (host: string): string => {
  const bare = host.replace(/^https?:\/\//, '').replace(/\/+$/, '')
  const loopback = /^((?:[a-z0-9-]+\.)*localhost|127(?:\.\d+){3})(:\d{1,5})?$/i.test(bare)
  return `${loopback ? 'http' : 'https'}://${bare}`
}

/** What this hive publishes with: its store to put, its host service to
 *  ship, its key to stamp — the same three the language word uses. */
const publishDeps = (): HarnessPublishDeps | null => {
  const store = window.ioc?.get?.(STORE_KEY) as StoreLike | undefined
  const sync = window.ioc?.get?.(HOST_SYNC_KEY) as HostSyncLike | undefined
  const putResource = store?.putResource?.bind(store)
  const publishAtoms = sync?.publishAtoms?.bind(sync)
  if (!putResource || !publishAtoms) return null
  const bytesOf = async (sig: string): Promise<Uint8Array | null> => {
    const blob = await (store?.getResourceLocal?.(sig).catch(() => null) ?? Promise.resolve(null))
      ?? await (store?.getResource?.(sig).catch(() => null) ?? Promise.resolve(null))
    return blob ? new Uint8Array(await blob.arrayBuffer()) : null
  }
  return {
    put: (text, type) => putResource(new Blob([text], { type }), { emit: false }),
    publish: async (h, sigs) => { const done = await publishAtoms(h, sigs, bytesOf); return done.ok ? { ok: true } : { ok: false, error: done.error } },
    stamp: (h, key, sig) => setHiveRoot(h, key, sig),
  }
}

export class HarnessQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'assistant'
  readonly command = 'harness'
  override description = 'List the agent harnesses, choose one for the device or this conversation, bring one in'
  override descriptionKey = 'slash.harness'
  override options = ['use <name or signature>', 'here <name or signature>', 'here default', 'show [name]', 'edit [name]', 'import <json>', 'offer <name> [@<host>]', 'sync [@<host>]', 'try <name> <request>', 'compare [name]']
  override examples = [
    { input: '/harness', result: 'Lists the harnesses in the pool and which one runs' },
    { input: '/harness use quiet-reader', result: 'The device runs the agent loop under quiet-reader from now on' },
    { input: '/harness here default', result: 'The open conversation runs under the device\'s harness again' },
  ]

  override slashComplete(args: string): readonly string[] {
    const typed = args.trim().toLowerCase()
    const words = ['use ', 'here ', 'show ', 'edit ', 'import ', 'offer ', 'sync ', 'try ', 'compare ']
    if (!typed || words.some(word => word.startsWith(typed) && word.trim() !== typed)) {
      return words.filter(word => word.startsWith(typed))
    }
    const [verb = '', rest = ''] = typed.split(/\s+/, 2)
    if (verb === 'use' || verb === 'here' || verb === 'show' || verb === 'edit' || verb === 'offer' || verb === 'try' || verb === 'compare') {
      const names = [...new Set([...harness.list().map(entry => entry.record.name), 'default'])]
      return names.filter(name => name.startsWith(rest) && name !== rest).map(name => `${verb} ${name}`)
    }
    return []
  }

  protected async execute(args: string): Promise<void> {
    const i18n = window.ioc?.get?.(I18N_IOC_KEY) as I18nProvider | undefined
    const t = (key: string, fallback: string, params?: Record<string, string | number>): string => {
      const value = i18n?.t?.(key, params)
      return value && value !== key ? value : fallback.replace(/\{(\w+)\}/g, (_, name: string) => String(params?.[name] ?? ''))
    }
    const toast = (message: string, type = 'info'): void => { EffectBus.emit('toast:show', { type, message }) }
    const trimmed = args.trim()
    const [word = '', ...restAll] = trimmed.split(/\s+/).filter(Boolean)
    const at = restAll.find(part => part.startsWith('@'))?.slice(1).trim() ?? ''
    const rest = restAll.filter(part => !part.startsWith('@'))
    const target = rest.join(' ').trim()

    if (word === 'try') {
      const [name = '', ...request] = rest
      const asked = request.join(' ').trim()
      if (!name || !asked) { toast(t('harness.usage.try', 'Say which and what: harness try <name> <request>'), 'warning'); return }
      const found = harness.find(name)
      if (!found) { toast(t('harness.unknown', 'No harness called "{name}" in the pool.', { name }), 'warning'); return }
      EffectBus.emit('chat:harness-try', { sig: found.sig, request: asked })
      toast(t('harness.trying', 'Trying {name} ({sig}) on this conversation for one turn; its receipt is filed under it. harness compare reads the receipts.', { name: found.record.name, sig: short(found.sig) }))
      return
    }

    if (word === 'compare') {
      const records = await listReceipts()
      const only = target ? harness.find(target) : undefined
      if (target && !only) { toast(t('harness.unknown', 'No harness called "{name}" in the pool.', { name: target }), 'warning'); return }
      const standings = summarizeReceipts(records).filter(row => !only || row.harness === only.sig)
      if (!standings.length) { toast(t('harness.noreceipts', 'No receipts yet: a turn files one when it ends. harness try <name> <request> runs one under another harness.')); return }
      const nameOf = (sig: string): string => sig ? (harness.find(sig)?.record.name ?? short(sig)) : t('harness.unkeyed', '(no harness)')
      const lines = standings.map(row =>
        `${nameOf(row.harness)}: ${row.answered}/${row.runs} ${t('harness.answered', 'answered')} · ${row.rounds} ${t('harness.rounds', 'rounds')} · ${Math.round(row.tokens / 1000)}k ${t('harness.tokens', 'tokens')} · ${row.seconds}s · ${row.legs} ${t('harness.legs', 'legs')}${row.failed ? ` · ${row.failed} ${t('harness.failed', 'failed')}` : ''}${row.stopped ? ` · ${row.stopped} ${t('harness.stopped', 'stopped')}` : ''}`)
      console.table(standings.map(row => ({ name: nameOf(row.harness), ...row })))
      toast(`${t('harness.compare', 'By receipts (answered turns averaged):')} ${lines.join(' — ')}`)
      return
    }

    if (word === 'offer') {
      if (!target) { toast(t('harness.usage.offer', 'Say which: harness offer <name> [@<host>]'), 'warning'); return }
      const found = harness.find(target)
      if (!found) { toast(t('harness.unknown', 'No harness called "{name}" in the pool.', { name: target }), 'warning'); return }
      const host = at || PUBLIC_CONTENT_HOSTS[0] || ''
      const deps = host ? publishDeps() : null
      if (!deps) { toast(t('harness.unoffered', '{name} was not offered: {reason}', { name: found.record.name, reason: host ? 'the store or the host service is not loaded' : 'no host is configured' }), 'warning'); return }
      const done = await publishHarness(host, found.record, deps)
      if (!done.ok) { toast(t('harness.unoffered', '{name} was not offered: {reason}', { name: found.record.name, reason: done.error }), 'warning'); return }
      toast(t('harness.offered', 'Offered {name} ({sig}) under your key to {host}; the host lists it once its operator says hosts list agent:harness, and anyone who syncs from there holds it until they choose it.', { name: found.record.name, sig: short(done.sig), host }), 'success')
      EffectBus.emit('harness:offered', { name: found.record.name, sig: done.sig, host })
      return
    }

    if (word === 'sync') {
      const hosts = [...new Set([...(at ? [at] : []), ...PUBLIC_CONTENT_HOSTS, ...(await listCommunityHosts().catch(() => []))].filter(Boolean))]
      const imported: string[] = []
      let answered = 0
      let dropped = 0
      for (const h of hosts) {
        const result = await syncHarnessesFrom(hostUrl(h))
        if (!result.answered) continue
        answered++
        dropped += result.dropped
        imported.push(...result.imported.map(entry => entry.name))
      }
      if (!imported.length) { toast(t('harness.nosync', 'No harness found on {hosts} hosts that answered.', { hosts: answered }), answered ? 'info' : 'warning'); return }
      toast(t('harness.synced', 'Synced {count} harness records from {hosts} hosts, held: {names}. Say harness use <name> or harness here <name> to run one.', { count: imported.length, hosts: answered, names: [...new Set(imported)].join(', ') }), 'success')
      EffectBus.emit('harness:synced', { imported, hosts: answered, dropped })
      return
    }

    if (!word || word === 'list') {
      const active = harness.activeSig
      const rows = harness.list().map(entry =>
        `${entry.record.name} ${short(entry.sig)}${entry.sig === active ? ` ${t('harness.active', '(device)')}` : ''}`)
      toast(rows.length
        ? `${t('harness.list', 'Harnesses:')} ${rows.join(' · ')}`
        : t('harness.empty', 'No harness in the pool yet; the shipped default runs.'))
      return
    }

    if (word === 'use') {
      if (!target) { toast(t('harness.usage.use', 'Say which: harness use <name or signature>'), 'warning'); return }
      const found = harness.find(target)
      if (!found) { toast(t('harness.unknown', 'No harness called "{name}" in the pool.', { name: target }), 'warning'); return }
      if (!harness.use(found.sig === harness.defaultSig ? '' : found.sig)) { toast(t('harness.refused', 'That harness could not be chosen.'), 'error'); return }
      toast(t('harness.used', 'The device runs under {name} ({sig}) from the next message.', { name: found.record.name, sig: short(found.sig) }), 'success')
      return
    }

    if (word === 'here') {
      if (!target) { toast(t('harness.usage.here', 'Say which: harness here <name or signature>, or harness here default'), 'warning'); return }
      if (target.toLowerCase() === 'default') {
        EffectBus.emit('chat:harness', { sig: '', scope: 'conversation' })
        toast(t('harness.here.cleared', 'This conversation runs under the device\'s harness again.'), 'success')
        return
      }
      const found = harness.find(target)
      if (!found) { toast(t('harness.unknown', 'No harness called "{name}" in the pool.', { name: target }), 'warning'); return }
      EffectBus.emit('chat:harness', { sig: found.sig, scope: 'conversation' })
      toast(t('harness.here', 'This conversation runs under {name} ({sig}) from the next message.', { name: found.record.name, sig: short(found.sig) }), 'success')
      return
    }

    if (word === 'show') {
      const found = target ? harness.find(target) : { sig: harness.activeSig, record: harness.active }
      if (!found) { toast(t('harness.unknown', 'No harness called "{name}" in the pool.', { name: target }), 'warning'); return }
      console.log(`[harness] ${found.record.name} ${found.sig}\n${JSON.stringify(found.record, null, 2)}`)
      toast(t('harness.shown', '{name} ({sig}) is in the console: leg {rounds} rounds, budget {budget} rounds, reads {reads} per stretch.', {
        name: found.record.name, sig: short(found.sig), rounds: found.record.leg.rounds, budget: found.record.budget.rounds, reads: found.record.reads.roundsWhenAsked,
      }))
      return
    }

    if (word === 'edit') {
      // THE RECORD AS A TILE: its note is the JSON, and editing the note is
      // the save — the changed record lands in the pool under its own
      // signature, held until it is named (assistant/harness-tiles.ts).
      const found = target ? harness.find(target) : { sig: harness.activeSig, record: harness.active }
      if (!found) { toast(t('harness.unknown', 'No harness called "{name}" in the pool.', { name: target }), 'warning'); return }
      const opened = await openHarnessTile(found.record)
      if (!opened.ok) { toast(t('harness.unopened', '{name} was not opened as a tile: {reason}', { name: found.record.name, reason: opened.error }), 'warning'); return }
      toast(t('harness.opened', '{name} is the tile {tile} on this page; its note is the record. Edit the note and the changed record lands in the pool under its own signature — harness use {name} runs it.', { name: opened.name, tile: opened.tile }), 'success')
      return
    }

    if (word === 'import') {
      const json = trimmed.slice(word.length).trim()
      if (!json) { toast(t('harness.usage.import', 'Paste the record: harness import {"kind":"harness@1", ...}'), 'warning'); return }
      let sig: string
      try { sig = await harness.import(json) } catch (error) {
        toast(t('harness.import.refused', 'That record was refused: {reason}', { reason: error instanceof Error ? error.message : String(error) }), 'error')
        return
      }
      const record = harness.find(sig)?.record as HarnessRecord | undefined
      toast(t('harness.imported', '{name} ({sig}) is in the pool; harness use {name} or harness here {name} runs it.', { name: record?.name ?? 'the record', sig: short(sig) }), 'success')
      return
    }

    toast(t('harness.usage', 'harness · harness use <name> · harness here <name|default> · harness show [name] · harness edit [name] · harness import <json>'), 'warning')
  }
}

const _harness = new HarnessQueenBee()
window.ioc.register('@diamondcoreprocessor.com/HarnessQueenBee', _harness)
