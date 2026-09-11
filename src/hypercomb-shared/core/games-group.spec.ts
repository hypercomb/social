// hypercomb-shared/core/games-group.spec.ts
//
// A switched-off game is HIDDEN on /games, never removed. The page's children
// are derived from members(), so a game missing from members() is a cell the
// reconcile drops — and no undo brings it back (2026-09-10: three games
// vanished from Jaime's /games page after their lights went out). These pin
// the two halves of the fix: dormant stays a member, and unhiding its tile on
// the page turns the light back on.

import { beforeEach, describe, expect, it } from 'vitest'
import { EffectBus } from '@hypercomb/core'
import { groupRegistry } from './group-registry'
import './games-group'

const ON_KEY = 'hc:behavior-global-on'
const lit = (): string[] => JSON.parse(localStorage.getItem(ON_KEY) ?? '[]')

const game = (id: string, label: string) => ({
  genotype: 'game',
  gameId: id,
  gameLabel: label,
  gameIcon: 'sports_esports',
  get gameDormant(): boolean { return !lit().includes(`game:${id}`) },
  get behaviorKind(): string { return `game:${id}` },
})

const lineage = { segments: ['games'] as string[], explorerSegments(): string[] { return this.segments } }
window.ioc.register('@test/Lineage-games-group', lineage)
window.ioc.register('@hypercomb.social/Lineage', lineage)
window.ioc.register('@test/ArkanoidDrone', game('arkanoid', 'Arkanoid'))
window.ioc.register('@test/SolomonDrone', game('solomon', "Solomon's Key"))

const members = () => groupRegistry.get('games')!.members()

describe('games launch group — off is hidden, never gone', () => {
  beforeEach(() => {
    localStorage.setItem(ON_KEY, JSON.stringify(['game:solomon']))
    lineage.segments = ['games']
  })

  it('keeps a switched-off game as a member, flagged dormant', () => {
    const byLabel = new Map(members().map(m => [m.label, m]))
    expect([...byLabel.keys()].sort()).toEqual(['Arkanoid', "Solomon's Key"])
    expect(byLabel.get('Arkanoid')?.dormant).toBe(true)
    expect(byLabel.get("Solomon's Key")?.dormant).toBeUndefined()
  })

  it('unhiding a dormant game tile on /games relights its behaviour', () => {
    EffectBus.emit('tile:unhidden', { cell: 'Arkanoid', location: '/games' })
    expect(lit()).toContain('game:arkanoid')
    expect(members().find(m => m.label === 'Arkanoid')?.dormant).toBeUndefined()
  })

  it('a typed unhide (normalized cell name) relights it too', () => {
    // `/hide ~Solomon's Key` arrives as the cell, not the label as drawn.
    localStorage.setItem(ON_KEY, JSON.stringify([]))
    EffectBus.emit('tile:unhidden', { cell: 'solomons-key', location: '/games' })
    expect(lit()).toContain('game:solomon')
  })

  it('an unhide anywhere else leaves the roster alone', () => {
    lineage.segments = ['somewhere']
    EffectBus.emit('tile:unhidden', { cell: 'Arkanoid', location: '/somewhere' })
    expect(lit()).toEqual(['game:solomon'])
  })
})
