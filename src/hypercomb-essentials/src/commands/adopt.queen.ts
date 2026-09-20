// commands/adopt.queen.ts
//
// THE WORD FOR TAKING A PEER'S TILE. Every act has a word — a behaviour that
// only has a gesture is incomplete. The wand (a click on a shaded tile) and
// the branch door (the tree icon) both had only gestures; this is their word.
//
//   adopt <tile>            take the one tile — what a click on it does
//   adopt <tile> branch     ask, then take it and everything under it — what
//                           the tree icon does (count, provenance, warning)
//
// From a fresh line type it with the slash (`/adopt orchard branch`); in
// command stance the bare words are read like any other behaviour's.
//
// Nothing here is a third adopt path: both forms emit the same `tile:action`
// the overlay emits, so the dialog, the fold and every guard are identical.

import { QueenBee, EffectBus, I18N_IOC_KEY, type I18nProvider } from '@hypercomb/core'

type SwarmAdoptLike = { wandEligible?: (label: string) => boolean }

const SWARM_ADOPT_KEY = '@diamondcoreprocessor.com/SwarmAdoptDrone'

export class AdoptQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'adopt'
  override description = "Take a peer's tile into your hive — the one tile, or with `branch`, everything under it"
  override options = ['<tile>', '<tile> branch']
  override examples = [
    { input: '/adopt orchard', result: 'Takes the tile "orchard" a peer is showing here — just the tile' },
    { input: '/adopt orchard branch', result: 'Asks how many tiles are under "orchard" and who they come from, then takes them all' },
  ]

  protected async execute(args: string): Promise<void> {
    const words = String(args ?? '').trim().split(/\s+/).filter(Boolean)
    const branch = words.length > 1 && words[words.length - 1].toLowerCase() === 'branch'
    const label = (branch ? words.slice(0, -1) : words).join(' ').trim()
    if (!label) {
      throw new Error('adopt needs a tile name — `adopt <tile>` or `adopt <tile> branch`')
    }
    const adopt = get(SWARM_ADOPT_KEY) as SwarmAdoptLike | undefined
    if (!adopt?.wandEligible?.(label)) {
      // Not offered here: not in a swarm, or nobody is showing that tile at
      // this spot. Refuse in words rather than emitting an action nothing will
      // answer — a silent no-op reads as a broken word.
      const i18n = get(I18N_IOC_KEY) as I18nProvider | undefined
      throw new Error(i18n?.t('swarm.adopt-branch.unresolved', { label }) ?? `nobody here is offering “${label}” right now`)
    }
    EffectBus.emit('tile:action', { action: branch ? 'adopt-branch' : 'adopt', label, q: 0, r: 0, index: 0 })
  }
}

const _adopt = new AdoptQueenBee()
window.ioc.register('@diamondcoreprocessor.com/AdoptQueenBee', _adopt)
