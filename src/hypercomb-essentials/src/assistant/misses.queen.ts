// assistant/misses.queen.ts
//
// `misses` — what the hive was asked for and could not do, most asked-for
// first (machine-misses.ts). Every refused sentence is a behaviour that does
// not exist yet or one that has no machine declaration; this is the list to
// build from.

import { QueenBee, EffectBus, I18N_IOC_KEY, type I18nProvider } from '@hypercomb/core'
import { MACHINE_MISSES_IOC_KEY, listMisses, machineMisses } from './machine-misses.js'

export class MissesQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'misses'
  override description = 'Show what the hive was asked for but could not do'
  override descriptionKey = 'slash.misses'
  override examples = [
    { input: '/misses', result: 'Lists the missing behaviour words, most asked-for first' },
  ]

  protected async execute(): Promise<void> {
    const i18n = window.ioc?.get?.(I18N_IOC_KEY) as I18nProvider | undefined
    const t = (key: string, fallback: string): string => {
      const value = i18n?.t?.(key)
      return value && value !== key ? value : fallback
    }
    const misses = await listMisses()
    if (!misses?.length) {
      EffectBus.emit('toast:show', { type: 'info', message: t('misses.none', 'Nothing has been refused yet.') })
      return
    }
    const lines = misses.slice(0, 6).map(miss => `${miss.verb} × ${miss.count}`)
    EffectBus.emit('toast:show', { type: 'info', message: `${t('misses.header', 'Asked for but not available:')} ${lines.join(' · ')}` })
  }
}

// The misses word owns the record it lists (atomic-modules-plan.md).
window.ioc.register(MACHINE_MISSES_IOC_KEY, machineMisses)

const _misses = new MissesQueenBee()
window.ioc.register('@diamondcoreprocessor.com/MissesQueenBee', _misses)
