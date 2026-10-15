// commands/go.queen.ts
//
// `go` — walk to a tile. The spoken twin of clicking into a hexagon and of the
// back button: the one act every tour of the hive is made of, and until now
// the one a speaker could not say (`into` MOVES the selection; it never walked
// anyone anywhere). See documentation/every-act-has-a-word.md.
//
//   go meetups          a tile on this page
//   go meetups/night-1  down a path from here
//   go /meetups         a path from the root
//   go ..               up one
//   go /                the root
//
// It refuses a place with no tile, rather than opening an empty page that
// looks like a tile that lost its children.

import { QueenBee, EffectBus, type MachineGrammar } from '@hypercomb/core'
import type { HistoryService } from '../history/history.service.js'

type LineageLike = { explorerSegments?: () => readonly string[] }
type NavigationLike = { goRaw?: (segments: readonly string[]) => void }

const get = <T,>(key: string): T | undefined =>
  (window as unknown as { ioc?: { get?: <U>(k: string) => U | undefined } }).ioc?.get?.<T>(key)

/** Where `go <args>` lands, from where you stand. Pure, so a spec can run it. */
export const goTarget = (here: readonly string[], raw: string): string[] => {
  const text = raw.trim()
  let at = text.startsWith('/') ? [] : [...here]
  for (const part of text.split('/').map(s => s.trim()).filter(Boolean)) {
    if (part === '.') continue
    if (part === '..') { at = at.slice(0, -1); continue }
    at.push(part)
  }
  return at
}

export class GoQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'go'
  override description = 'Walk to a tile: a name on this page, a path, .. for up, / for the root'
  override descriptionKey = 'slash.go'
  override options = ['<tile>', '<path>/<tile>', '/<path>', '..', '/']
  override examples = [
    { input: '/go meetups', result: 'You are in the tile "meetups"' },
    { input: '/go ..', result: 'You are one level up' },
    { input: '/go /', result: 'You are at the root of the hive' },
  ]
  override rawArgs = true
  override machine: MachineGrammar = {
    forms: 'go <tile> | go <path> | go .. | go /',
    example: 'go meetups',
    reach: 'additive',
    scope: 'local',
  }

  protected async execute(args: string): Promise<void> {
    const raw = args.trim()
    if (!raw) { this.#say('Go: say where, for example "go meetups", "go .." or "go /"'); return }

    const here = (get<LineageLike>('@hypercomb.social/Lineage')?.explorerSegments?.() ?? []).map(String)
    const target = goTarget(here, raw)

    if (target.length > 0) {
      const history = get<HistoryService>('@diamondcoreprocessor.com/HistoryService')
      const layer = history
        ? await history.currentLayerAt(await history.sign({ explorerSegments: () => target }))
        : null
      if (!layer) { this.#say(`Go: there is no tile at /${target.join('/')}`); return }
    }

    const navigation = get<NavigationLike>('@hypercomb.social/Navigation')
    if (!navigation?.goRaw) { this.#say('Go: navigation is not ready'); return }
    navigation.goRaw(target)
    this.#say(`Go: now at /${target.join('/')}`)
  }

  #say(message: string): void {
    EffectBus.emit('activity:log', { message, icon: '→' })
  }
}

const _go = new GoQueenBee()
window.ioc.register('@diamondcoreprocessor.com/GoQueenBee', _go)
