// sharing/scout.queen.ts
//
//   scout <meaning> [<meaning> …]   read those pools on the hosts you follow
//                                   and say what several of them hold
//
// The word over scout.ts: read-only, participant-only (no machine block), and
// its answer is a line of offers in the activity log. Nothing is taken or
// written; replicating an offer into the workbench is a separate act.

import { EffectBus, QueenBee } from '@hypercomb/core'
import { scout } from './scout.js'

const SHOWN = 5

export class ScoutQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'sharing'
  readonly command = 'scout'
  override description = 'Read pools on the hosts you follow and bring back what several of them hold'
  override descriptionKey = 'slash.scout'
  override options = ['<meaning> [<meaning> …]']
  override examples = [
    { input: '/scout style:christmas theme:dark', result: 'Lists signatures found in both pools across your followed hosts' },
  ]
  // Meanings carry colons; the line is theirs verbatim.
  override rawArgs = true

  protected async execute(args: string): Promise<void> {
    const meanings = String(args ?? '').split(/\s+/).filter(Boolean)
    if (!meanings.length) {
      EffectBus.emit('activity:log', { message: 'scout what? name the pools: scout style:christmas theme:dark', icon: '⬡' })
      return
    }
    const offers = await scout(meanings)
    const message = offers.length
      ? `scout found ${offers.length}: ` + offers.slice(0, SHOWN)
        .map(o => `${o.sig.slice(0, 12)} (${o.meanings.length}/${meanings.length} pools, ${o.hosts.length} ${o.hosts.length === 1 ? 'host' : 'hosts'})`).join(' · ')
      : 'scout found nothing on the hosts you follow'
    EffectBus.emit('activity:log', { message, icon: '⬡' })
  }
}

const _scout = new ScoutQueenBee()
window.ioc.register('@diamondcoreprocessor.com/ScoutQueenBee', _scout)
