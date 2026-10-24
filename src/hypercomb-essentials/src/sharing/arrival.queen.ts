// sharing/arrival.queen.ts
//
// `arrival` — what a published branch's first view needs, and nothing more.
//
//   arrival <lineage> <Class…> @<host>
//                                the arrival loads these bees (and what they
//                                declare they read); the rest wake when the
//                                reader steps into the hive
//   arrival <lineage> none @<host>
//                                withdraw it — the whole package loads again
//
// The plan is signed into your index on the host you NAME: there is no default
// host (jwize 2026-10-11), so a word with no @<host> sends nothing.
//
// The act itself lives in arrival-plan-publish.ts, shared with the Publish
// window's Optimize section.

import { EffectBus, I18N_IOC_KEY, QueenBee, get, type I18nProvider } from '@hypercomb/core'
import { zoneDoor } from './zone-door.js'
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
    { input: 'arrival revolucion ViewBee WebsiteQueenBee SiteViewDrone @example.com', result: 'revolucion arrives on three bees' },
    { input: 'arrival revolucion none @example.com', result: 'revolucion loads its whole package again' },
  ]

  // A bee is named by its class, and a class has capitals: read as plain
  // language the line is lowered first, and the plan it signed named
  // `siteviewdrone`, which no class answers (meetups 8897c004, jaime-weise
  // f74b18b2 — every bee of the package loaded). The whole line is this word's.
  override rawArgs = true

  protected async execute(args: string): Promise<void> {
    const parts = args.trim().split(/\s+/).filter(Boolean)
    // @<host> may stand anywhere; it is never a bee.
    const host = zoneDoor(parts.find(part => part.startsWith('@'))?.slice(1) ?? '')
    const [branch = '', ...names] = parts.filter(part => !part.startsWith('@'))
    const lineage = lineageOf(branch)
    if (!lineage || !host) {
      const said = get<I18nProvider>(I18N_IOC_KEY)?.t?.('arrival.usage')
      say('warning', said && said !== 'arrival.usage' ? said : 'Name the branch, the bees and the host: arrival revolucion ViewBee SiteViewDrone @example.com.')
      return
    }
    const withdraw = names.length === 1 && names[0]!.toLowerCase() === 'none'
    const result = withdraw ? await withdrawArrivalPlan(host, lineage) : await publishArrivalPlan(host, lineage, names)
    if (!result.ok) { say('error', `${lineage}: ${result.reason}`); return }
    say('success', withdraw ? `${lineage} loads its whole package again.` : `${lineage} arrives on its plan; the rest wakes in the hive.`)
  }
}

const _arrival = new ArrivalQueenBee()
window.ioc.register('@diamondcoreprocessor.com/ArrivalQueenBee', _arrival)
