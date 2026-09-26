// sharing/arrival.queen.ts
//
// `arrival` — what a published branch's first view needs, and nothing more.
//
//   arrival <lineage> <Class…>   the arrival loads these bees (and what they
//                                declare they read); the rest wake when the
//                                reader steps into the hive
//   arrival <lineage> none       withdraw it — the whole package loads again
//
// The act itself lives in arrival-plan-publish.ts, shared with the Publish
// window's Optimize section.

import { EffectBus, QueenBee } from '@hypercomb/core'
import { PUBLIC_CONTENT_HOSTS } from './hive-link.js'
import { publishArrivalPlan, withdrawArrivalPlan } from './arrival-plan-publish.js'

const say = (type: string, message: string): void => {
  EffectBus.emit('toast:show', { type, title: 'arrival', message, duration: 6000 })
}

/** A lineage as the signed index keys it: lower-case segments joined by `/`. */
const lineageOf = (raw: string): string =>
  raw.trim().toLowerCase().split('/').map(s => s.trim()).filter(Boolean).join('/')

export class ArrivalQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'arrival'
  override description = 'Name what a published branch\'s first view loads — the rest waits until the reader steps into the hive'
  override examples = [
    { input: 'arrival revolucion ViewBee WebsiteQueenBee SiteViewDrone', result: 'revolucion arrives on three bees' },
    { input: 'arrival revolucion none', result: 'revolucion loads its whole package again' },
  ]

  protected async execute(args: string): Promise<void> {
    const [branch = '', ...names] = args.trim().split(/\s+/).filter(Boolean)
    const lineage = lineageOf(branch)
    const host = PUBLIC_CONTENT_HOSTS[0] ?? ''
    if (!lineage || !host) { say('warning', 'Name the branch and the bees: "arrival revolucion ViewBee SiteViewDrone".'); return }
    const withdraw = names.length === 1 && names[0]!.toLowerCase() === 'none'
    const result = withdraw ? await withdrawArrivalPlan(host, lineage) : await publishArrivalPlan(host, lineage, names)
    if (!result.ok) { say('error', `${lineage}: ${result.reason}`); return }
    say('success', withdraw ? `${lineage} loads its whole package again.` : `${lineage} arrives on its plan; the rest wakes in the hive.`)
  }
}

const _arrival = new ArrivalQueenBee()
window.ioc.register('@diamondcoreprocessor.com/ArrivalQueenBee', _arrival)
