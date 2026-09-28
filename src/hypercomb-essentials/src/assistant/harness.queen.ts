// assistant/harness.queen.ts
//
// THE WORDS (documentation/agent-harness.md, step 4). `harness` lists the
// pool and says which record the device runs under and which the open
// conversation does; `harness use <name>` chooses for the device; `harness
// here <name>` marks the open conversation (`harness here default` takes the
// mark off); `harness import <json>` brings a record in by its bytes;
// `harness show [name]` prints one. Every act has a word; a harness is
// content, so the words act on records by name or signature and never on
// code. Opening a record as a tile (`harness edit`) waits on the tile
// editor's write path and is not here yet.

import { QueenBee, EffectBus, I18N_IOC_KEY, type I18nProvider } from '@hypercomb/core'
import { harness, type HarnessRecord } from './harness.js'

const short = (sig: string): string => sig.slice(0, 12)

export class HarnessQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'assistant'
  readonly command = 'harness'
  override description = 'List the agent harnesses, choose one for the device or this conversation, bring one in'
  override descriptionKey = 'slash.harness'
  override options = ['use <name or signature>', 'here <name or signature>', 'here default', 'show [name]', 'import <json>']
  override examples = [
    { input: '/harness', result: 'Lists the harnesses in the pool and which one runs' },
    { input: '/harness use quiet-reader', result: 'The device runs the agent loop under quiet-reader from now on' },
    { input: '/harness here default', result: 'The open conversation runs under the device\'s harness again' },
  ]

  override slashComplete(args: string): readonly string[] {
    const typed = args.trim().toLowerCase()
    const words = ['use ', 'here ', 'show ', 'import ']
    if (!typed || words.some(word => word.startsWith(typed) && word.trim() !== typed)) {
      return words.filter(word => word.startsWith(typed))
    }
    const [verb = '', rest = ''] = typed.split(/\s+/, 2)
    if (verb === 'use' || verb === 'here' || verb === 'show') {
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
    const [word = '', ...rest] = trimmed.split(/\s+/).filter(Boolean)
    const target = rest.join(' ').trim()

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

    toast(t('harness.usage', 'harness · harness use <name> · harness here <name|default> · harness show [name] · harness import <json>'), 'warning')
  }
}

const _harness = new HarnessQueenBee()
window.ioc.register('@diamondcoreprocessor.com/HarnessQueenBee', _harness)
