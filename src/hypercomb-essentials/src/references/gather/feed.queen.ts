// references/gather/feed.queen.ts
//
// `/feed <page>` — standing on a group, switch one of its targets on.
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
  override options = ['<page>', '<page> off']
  override examples = [
    { input: '/feed friends', result: 'People you add here are also gathered into friends' },
    { input: '/feed friends off', result: 'friends stops receiving what you add here' },
  ]

  override machine = {
    forms: '<page> | <page> off',
    example: '/feed friends',
    reach: 'additive' as const,
    scope: 'page' as const,
    refuse: (args: string): string | undefined =>
      parse(args).name ? undefined : '/feed needs the name of a page',
  }

  protected async execute(args: string): Promise<void> {
    const { name, off } = parse(args)
    const log = (message: string): void => { EffectBus.emit('activity:log', { message, icon: 'alt_route' }) }
    if (!name) { log('Feed — say which page: feed <page>'); return }
    const link = window.ioc.get<GatherLinkService>(GATHER_LINK_SERVICE_KEY)
    const group = [...(window.ioc.get<LineageLike>('@hypercomb.social/Lineage')?.explorerSegments?.() ?? [])]
    if (!link) throw new Error('The link service is unavailable')
    if (group.length === 0) { log('The hive itself feeds nothing — stand on a group first'); return }
    const groupName = group[group.length - 1]

    // An attached target is found by name first — it can live anywhere.
    const wanted = name.toLowerCase()
    const known = (await link.targetsOf(group)).find(t => (t.segments[t.segments.length - 1] ?? '').toLowerCase() === wanted)
    let page = known?.segments ?? null
    if (!page) {
      if (off) { log(`${groupName} does not feed "${name}"`); return }
      page = await link.resolveRoute(name, group)
      if (!page || !await link.attach(page, group)) { log(`No page called "${name}" can gather from ${groupName}`); return }
    }
    await link.setTarget(group, page, !off)
    const pageName = page[page.length - 1]
    log(off
      ? `${groupName} stops feeding "${pageName}"`
      : `${groupName} feeds "${pageName}" — what you add here is also gathered there`)
  }
}

const _feed = new FeedQueenBee()
window.ioc.register('@diamondcoreprocessor.com/FeedQueenBee', _feed)
