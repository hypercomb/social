// references/gather/gather-link.drone.ts
//
// THE LINK YOU CAN SEE. Two lights on the command line, both producer-owned:
//
//   on a linked page  — "from people": what you make here is made in people.
//                       Click → go to people.
//   on a group        — "feeding friends, family": the targets that are ON,
//                       the pages what you add here is also gathered into.
//
// Absent while there is nothing to say (no light until a link exists). The
// lights follow the page, the links, and the on/off switches.

import { Drone, EffectBus, I18N_IOC_KEY, type I18nProvider } from '@hypercomb/core'
import { GATHER_LINK_SERVICE_KEY, GatherLinkService } from './gather-link.service.js'

const FROM_KEY = 'gather:from'
const FEED_KEY = 'gather:feed'

type LineageLike = EventTarget & { explorerSegments?: () => readonly string[] }

const t = (key: string, fallback: string, params?: Record<string, string>): string => {
  const value = window.ioc.get<I18nProvider>(I18N_IOC_KEY)?.t(key, params)
  let text = value && value !== key ? value : fallback
  for (const [k, v] of Object.entries(params ?? {})) text = text.replace(`{${k}}`, v)
  return text
}

const leaf = (route: readonly string[]): string => route[route.length - 1] ?? ''

export class GatherLinkDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'references'
  override description = 'shows which group a page gathers from, and which pages a group is feeding'

  protected override listens = ['indicator:query', 'indicator:activate', 'gather:links-changed', 'gather:targets-changed', 'navigation:guard-end']
  protected override emits = ['indicator:set', 'indicator:clear']

  #initialized = false
  #generation = 0
  #fromGroup: readonly string[] | null = null

  protected override heartbeat = async (): Promise<void> => {
    if (this.#initialized) return
    this.#initialized = true
    window.ioc.get<LineageLike>('@hypercomb.social/Lineage')?.addEventListener('change', () => { void this.#sync() })
    this.onEffect('gather:links-changed', () => { void this.#sync() })
    this.onEffect('gather:targets-changed', () => { void this.#sync() })
    this.onEffect('indicator:query', () => { void this.#sync() })
    // Once a page has landed its layers are warm. A boot or deep link answers
    // the first ask from a cold hive — empty, which would leave the light off.
    this.onEffect('navigation:guard-end', () => { void this.#sync() })
    this.onEffect<{ key: string }>('indicator:activate', ({ key }) => {
      if (key !== FROM_KEY || !this.#fromGroup) return
      window.ioc.get<{ goRaw?(s: readonly string[]): void }>('@hypercomb.social/Navigation')?.goRaw?.([...this.#fromGroup])
    })
    await this.#sync()
  }

  async #sync(): Promise<void> {
    const generation = ++this.#generation
    const link = window.ioc.get<GatherLinkService>(GATHER_LINK_SERVICE_KEY)
    const here = [...(window.ioc.get<LineageLike>('@hypercomb.social/Lineage')?.explorerSegments?.() ?? [])]
    if (!link || here.length === 0) { this.#clear(); return }
    const [groups, targets] = await Promise.all([
      link.groupsOf(here).catch(() => [] as string[][]),
      link.targetsOf(here).catch(() => []),
    ])
    // A later page (or switch) has already answered — never paint a stale one.
    if (generation !== this.#generation) return

    this.#fromGroup = groups[0] ?? null
    if (groups.length > 0) {
      EffectBus.emit('indicator:set', {
        key: FROM_KEY,
        icon: 'link',
        label: t('gather.from', 'from {groups}', { groups: groups.map(leaf).join(', ') }),
        dismissable: false,
        actionable: true,
      })
    } else EffectBus.emit('indicator:clear', { key: FROM_KEY })

    const on = targets.filter(target => target.on)
    if (on.length > 0) {
      EffectBus.emit('indicator:set', {
        key: FEED_KEY,
        icon: 'alt_route',
        label: t('gather.feeding', 'feeding {pages}', { pages: on.map(target => leaf(target.segments)).join(', ') }),
        dismissable: false,
      })
    } else EffectBus.emit('indicator:clear', { key: FEED_KEY })
  }

  #clear(): void {
    this.#fromGroup = null
    EffectBus.emit('indicator:clear', { key: FROM_KEY })
    EffectBus.emit('indicator:clear', { key: FEED_KEY })
  }
}

// The bee wires its dependency: the link door every word, window and the
// create path resolve by key.
window.ioc.register(GATHER_LINK_SERVICE_KEY, new GatherLinkService())
const _gatherLink = new GatherLinkDrone()
window.ioc.register('@diamondcoreprocessor.com/GatherLinkDrone', _gatherLink)
