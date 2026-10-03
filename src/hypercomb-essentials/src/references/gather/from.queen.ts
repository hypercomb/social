// references/gather/from.queen.ts
//
// `/from <group>` — this page gathers from that group.
//
// Said alone, `/from` says what this page is linked to — nothing included.
// Every change is confirmed in a toast, not only the activity line: a link you
// cannot see being made is a link you cannot trust (jwize, 2026-09-23).
//
// Said on `friends`: `/from people`. From then on a tile made on `friends` is
// made in `people` and shown here as a reference, and `people` lists `friends`
// among its targets. `/from people off` ends the link; nothing already gathered
// is touched. The link is a mark the page wears (gather-link.ts).
//
// `/from people gather jaime gerry` links the page (if it is not yet) and
// gathers those of its own tiles into people — the word for what the Review
// window does. Said with no names it gathers every tile of the page's own.
// Nothing is deleted: each page copy stays one step back in its history.

import { EffectBus, I18N_IOC_KEY, QueenBee, type I18nProvider } from '@hypercomb/core'
import { GATHER_LINK_SERVICE_KEY, type GatherLinkService } from './gather-link.service.js'

type LineageLike = { explorerSegments?: () => readonly string[] }

const parse = (args: string): { name: string; off: boolean; gather: string[] | null } => {
  const words = args.trim().split(/\s+/).filter(Boolean)
  const at = words.findIndex((word, i) => i > 0 && word.toLowerCase() === 'gather')
  if (at > 0) return { name: words.slice(0, at).join(' '), off: false, gather: words.slice(at + 1) }
  const off = words.length > 1 && words[words.length - 1].toLowerCase() === 'off'
  return { name: (off ? words.slice(0, -1) : words).join(' '), off, gather: null }
}

export class FromQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'from'
  override description = 'Gather this page from a group — what you make here is made in the group'
  override descriptionKey = 'slash.from'
  override options = ['', '<group>', '<group> off', '<group> gather [<tile>…]']
  override examples = [
    { input: '/from', result: 'Says which group this page gathers from, if any' },
    { input: '/from people', result: 'This page gathers from people: a tile made here is made in people and shown here' },
    { input: '/from people off', result: 'This page stops gathering from people' },
    { input: '/from people gather jaime gerry', result: 'jaime and gerry move into people; this page shows them as references' },
    { input: '/from people gather', result: 'Every tile of this page\'s own is gathered into people' },
  ]

  /** EDITING, not additive (declarations audit, 2026-10-01): `<group> off`
   *  detaches an existing link. Not destructive: nothing gathered is touched,
   *  and saying `/from <group>` again restores the link exactly. */
  override machine = {
    forms: '[<group>] | <group> off | <group> gather [<tile>…]',
    bare: true,
    example: '/from people',
    reach: 'editing' as const,
    scope: 'page' as const,
    refuse: (): string | undefined => undefined,
  }

  protected async execute(args: string): Promise<void> {
    const { name, off, gather } = parse(args)
    const log = (message: string, type: 'success' | 'info' | 'warning' = 'info'): void => {
      EffectBus.emit('activity:log', { message, icon: 'link' })
      EffectBus.emit('toast:show', { type, message })
    }
    const link = window.ioc.get<GatherLinkService>(GATHER_LINK_SERVICE_KEY)
    const here = [...(window.ioc.get<LineageLike>('@hypercomb.social/Lineage')?.explorerSegments?.() ?? [])]
    if (!link) throw new Error('The link service is unavailable')
    if (here.length === 0) { log('The hive itself gathers from nothing — stand on a page first', 'warning'); return }
    if (!name) {
      const groups = await link.groupsOf(here)
      const current = here[here.length - 1]
      log(groups.length
        ? `"${current}" gathers from ${groups.map(g => g[g.length - 1]).join(', ')}`
        : `"${current}" gathers from nothing — /from <group> links it`)
      return
    }
    const group = await link.resolveRoute(name, here)
    if (!group) { log(`No group called "${name}" on this page, at the top, or in Portals`, 'warning'); return }
    const page = here[here.length - 1]
    const groupName = group[group.length - 1]
    if (off) {
      if (await link.detach(here, group)) log(`"${page}" no longer gathers from ${groupName}`, 'success')
      else log(`"${page}" was not gathering from ${groupName}`)
      return
    }
    if (gather) {
      const linkedAlready = (await link.groupsOf(here)).some(g => g.join('/') === group.join('/'))
      if (!linkedAlready) {
        const outcome = await link.link(here, group)
        if (!outcome.ok) { log(`"${page}" cannot gather from ${groupName}: ${outcome.reason}`, 'warning'); return }
        log(`"${page}" now gathers from ${groupName}`, 'success')
      }
      const own = (await link.review(here).catch(() => null))?.tiles.map(tile => tile.name) ?? []
      const wanted = gather.length ? gather : own
      const unknown = wanted.filter(tile => !own.includes(tile))
      const names = wanted.filter(tile => own.includes(tile))
      const done = names.length ? await link.gatherOwn(here, names).catch(() => [] as string[]) : []
      const missed = names.filter(tile => !done.includes(tile))
      const parts = [
        done.length ? `${done.join(', ')} → ${groupName} — "${page}" shows ${done.length === 1 ? 'it' : 'them'} as references` : '',
        missed.length ? `not gathered: ${missed.join(', ')}` : '',
        unknown.length ? `not a tile of "${page}"'s own: ${unknown.join(', ')}` : '',
      ].filter(Boolean)
      const type = done.length === 0 ? 'warning' : missed.length || unknown.length ? 'info' : 'success'
      log(parts.join('; ') || `"${page}" has no tiles of its own to gather`, type)
      return
    }
    const outcome = await link.link(here, group)
    if (outcome.ok) {
      const linked = outcome.group[outcome.group.length - 1]
      log(`"${page}" now gathers from ${linked} — what you make here is made in ${linked}`, 'success')
      // Linking changes where NEW tiles go. The page's own tiles are asked
      // about, never gathered silently: the toast opens the review.
      const own = (await link.review(here).catch(() => null))?.tiles.length ?? 0
      if (own > 0) {
        const i18n = window.ioc.get<I18nProvider>(I18N_IOC_KEY)
        const say = (key: string, fallback: string, params?: Record<string, string | number>): string => {
          const value = i18n?.t(key, params)
          return value && value !== key ? value : fallback
        }
        EffectBus.emit('toast:show', {
          type: 'tip',
          message: say('gather.review-offer', `"${page}" has ${own} tiles of its own — review which to gather into ${linked}`, { page, count: own, group: linked }),
          actionLabel: say('references.review', 'Review'),
          actionEffect: 'references:manage',
          duration: 0,
        })
      }
    } else log(`"${page}" cannot gather from ${groupName}: ${outcome.reason}`, 'warning')
  }
}

const _from = new FromQueenBee()
window.ioc.register('@diamondcoreprocessor.com/FromQueenBee', _from)
