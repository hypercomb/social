// references/gather/feed.queen.ts
//
// `/feed <page>` — standing on a group, switch one of its targets on.
//
// Said alone, `/feed` says which targets are on. Every switch is confirmed in
// a toast as well as the activity line.
//
// Said on `people`: `/feed friends`. `friends` is attached if it was not (it
// now gathers from `people`) and switched on: every person added to `people`
// while it is on is also gathered into `friends`. `/feed friends off` switches
// it off. On/off is yours alone and stays as you left it (gather-link.ts);
// nothing goes to every target by itself.

import { EffectBus, QueenBee } from '@hypercomb/core'
import { GATHER_LINK_SERVICE_KEY, type GatherLinkService } from './gather-link.service.js'

type LineageLike = { explorerSegments?: () => readonly string[] }

const parse = (args: string): { name: string; off: boolean } => {
  const words = args.trim().split(/\s+/).filter(Boolean)
  const off = words.length > 1 && words[words.length - 1].toLowerCase() === 'off'
  return { name: (off ? words.slice(0, -1) : words).join(' '), off }
}

export class FeedQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'feed'
  override description = 'On a group, switch a page it feeds on or off'
  override descriptionKey = 'slash.feed'
  override options = ['', '<page>', '<page> off']
  override examples = [
    { input: '/feed', result: 'Says which pages this group is feeding' },
    { input: '/feed friends', result: 'People you add here are also gathered into friends' },
    { input: '/feed friends off', result: 'friends stops receiving what you add here' },
  ]

  override machine = {
    forms: '[<page>] | <page> off',
    bare: true,
    example: '/feed friends',
    reach: 'additive' as const,
    scope: 'page' as const,
    refuse: (): string | undefined => undefined,
  }

  protected async execute(args: string): Promise<void> {
    const { name, off } = parse(args)
    const log = (message: string, type: 'success' | 'info' | 'warning' = 'info'): void => {
      EffectBus.emit('activity:log', { message, icon: 'alt_route' })
      EffectBus.emit('toast:show', { type, message })
    }
    const link = window.ioc.get<GatherLinkService>(GATHER_LINK_SERVICE_KEY)
    const group = [...(window.ioc.get<LineageLike>('@hypercomb.social/Lineage')?.explorerSegments?.() ?? [])]
    if (!link) throw new Error('The link service is unavailable')
    if (group.length === 0) { log('The hive itself feeds nothing — stand on a group first', 'warning'); return }
    const groupName = group[group.length - 1]
    if (!name) {
      const on = (await link.targetsOf(group)).filter(t => t.on).map(t => t.segments[t.segments.length - 1])
      log(on.length ? `${groupName} feeds ${on.join(', ')}` : `${groupName} feeds nothing — /feed <page> switches one on`)
      return
    }

    // An attached target is found by name first — it can live anywhere.
    const wanted = name.toLowerCase()
    const known = (await link.targetsOf(group)).find(t => (t.segments[t.segments.length - 1] ?? '').toLowerCase() === wanted)
    let page = known?.segments ?? null
    if (!page) {
      if (off) { log(`${groupName} does not feed "${name}"`); return }
      page = await link.resolveRoute(name, group)
      if (!page) { log(`No page called "${name}" on this page, at the top, or in Portals`, 'warning'); return }
      const outcome = await link.link(page, group)
      if (!outcome.ok) { log(`"${name}" cannot gather from ${groupName}: ${outcome.reason}`, 'warning'); return }
    }
    await link.setTarget(group, page, !off)
    const pageName = page[page.length - 1]
    log(off
      ? `${groupName} stops feeding "${pageName}"`
      : `${groupName} now feeds "${pageName}" — what you add here is also gathered there`, 'success')
  }
}

const _feed = new FeedQueenBee()
window.ioc.register('@diamondcoreprocessor.com/FeedQueenBee', _feed)
