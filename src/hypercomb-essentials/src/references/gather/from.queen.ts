// references/gather/from.queen.ts
//
// `/from <group>` — this page gathers from that group.
//
// Said on `friends`: `/from people`. From then on a tile made on `friends` is
// made in `people` and shown here as a reference, and `people` lists `friends`
// among its targets. `/from people off` ends the link; nothing already gathered
// is touched. The link is a mark the page wears (gather-link.ts).

import { EffectBus, QueenBee } from '@hypercomb/core'
import { GATHER_LINK_SERVICE_KEY, type GatherLinkService } from './gather-link.service.js'

type LineageLike = { explorerSegments?: () => readonly string[] }

const parse = (args: string): { name: string; off: boolean } => {
  const words = args.trim().split(/\s+/).filter(Boolean)
  const off = words.length > 1 && words[words.length - 1].toLowerCase() === 'off'
  return { name: (off ? words.slice(0, -1) : words).join(' '), off }
}

export class FromQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'from'
  override description = 'Gather this page from a group — what you make here is made in the group'
  override descriptionKey = 'slash.from'
  override options = ['<group>', '<group> off']
  override examples = [
    { input: '/from people', result: 'This page gathers from people: a tile made here is made in people and shown here' },
    { input: '/from people off', result: 'This page stops gathering from people' },
  ]

  override machine = {
    forms: '<group> | <group> off',
    example: '/from people',
    reach: 'additive' as const,
    scope: 'page' as const,
    refuse: (args: string): string | undefined =>
      parse(args).name ? undefined : '/from needs the name of a group',
  }

  protected async execute(args: string): Promise<void> {
    const { name, off } = parse(args)
    const log = (message: string): void => { EffectBus.emit('activity:log', { message, icon: 'link' }) }
    if (!name) { log('From — say which group: from <group>'); return }
    const link = window.ioc.get<GatherLinkService>(GATHER_LINK_SERVICE_KEY)
    const here = [...(window.ioc.get<LineageLike>('@hypercomb.social/Lineage')?.explorerSegments?.() ?? [])]
    if (!link) throw new Error('The link service is unavailable')
    if (here.length === 0) { log('The hive itself gathers from nothing — stand on a page first'); return }
    const group = await link.resolveRoute(name, here)
    if (!group) { log(`No group called "${name}" on this page, at the top, or in Portals`); return }
    const page = here[here.length - 1]
    const groupName = group[group.length - 1]
    if (off) {
      log(await link.detach(here, group)
        ? `"${page}" no longer gathers from ${groupName}`
        : `"${page}" was not gathering from ${groupName}`)
      return
    }
    log(await link.attach(here, group)
      ? `"${page}" gathers from ${groupName} — what you make here is made in ${groupName}`
      : `"${page}" cannot gather from ${groupName}`)
  }
}

const _from = new FromQueenBee()
window.ioc.register('@diamondcoreprocessor.com/FromQueenBee', _from)
