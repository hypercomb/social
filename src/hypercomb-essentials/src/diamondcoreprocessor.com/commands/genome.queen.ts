// /genome — report the exact active-hive closure weight.

import { EffectBus, QueenBee } from '@hypercomb/core'
import { formatGenomeBytes } from '../history/active-genome.js'
import {
  ACTIVE_GENOME_KEY,
  type ActiveGenomeService,
} from '../history/active-genome.service.js'

export class GenomeQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'genome'
  override readonly aliases = ['weight']
  override description = 'Measure the active hive genome: current markers plus every reachable byte'
  override options = ['refresh']
  override examples = [
    { input: '/genome', result: 'Reports the active hive weight and closure counts' },
    { input: '/genome refresh', result: 'Re-reads the active closure now' },
  ]

  protected async execute(args: string): Promise<void> {
    const service = (window.ioc?.get?.(ACTIVE_GENOME_KEY)) as ActiveGenomeService | undefined
    if (!service) {
      EffectBus.emit('toast:show', {
        type: 'warning',
        title: 'Genome unavailable',
        message: 'The active-genome service is not ready.',
      })
      return
    }
    const record = await service.current(args.trim().toLowerCase() === 'refresh')
    if (!record) {
      EffectBus.emit('toast:show', {
        type: 'info',
        title: 'Genome initializing',
        message: 'No history root is readable yet; the passive update remains queued.',
      })
      return
    }

    const bytes = record.totals.activeBytes ?? record.totals.knownBytes
    const current = !service.dirty
    const qualifier = !current
      ? 'last coherent · updating'
      : record.complete
        ? 'active'
      : `known · ${record.missing.length} unresolved`
    const message =
      `${formatGenomeBytes(bytes)} ${qualifier} · ${record.totals.lineages} lineages · ` +
      `${record.totals.objects} unique objects`
    console.info('[genome]', record)
    EffectBus.emit('activity:log', { message, icon: 'genetics' })
    EffectBus.emit('toast:show', {
      type: current && record.complete ? 'success' : current ? 'warning' : 'info',
      title: 'Hive genome',
      message,
    })
  }
}

const _genome = new GenomeQueenBee()
window.ioc.register('@diamondcoreprocessor.com/GenomeQueenBee', _genome)
