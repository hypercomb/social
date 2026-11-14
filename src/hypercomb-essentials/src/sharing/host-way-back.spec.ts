// sharing/host-way-back.spec.ts
//
// THE WAY BACK STAYS (documentation/beehaviors-and-packages.md, 2026-11-14).
// Beehaviors refuses to darken `beehaviors`, `behavior`, `help`, `create`,
// `undo` and `redo`; the hosts desk used to let the package carrying them go
// off whole, taking away the window that would turn it back on. A package's
// layer docs name each bee's word, so the desk reads them, its own and every
// layer beneath, before it lets a path go off.

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { InstallNode } from '@hypercomb/core'
import type { BeeDoc } from './bee-meta'
import { wayBackBeneath } from './host-directory.view'
import { ALWAYS_LIT_WORDS, PACKAGE_WAY_BACK_WORDS } from '../commands/word-enablement'

const sig = (n: number): string => n.toString(16).padStart(64, '0')

const node = (path: string, layerSig: string, bees: string[] = []): InstallNode =>
  ({ path, name: path.slice(path.lastIndexOf('/') + 1), layerSig, bees, children: [], description: '', base: layerSig })

const doc = (command = '', aliases: string[] = []): BeeDoc =>
  ({ className: 'X', kind: 'queen', description: '', listens: [], emits: [], command, aliases })

// commands { beehaviors, mail } · history { undo } · games { arkanoid } · sharing/hosts
const nodes = [
  node('commands', 'L-commands', [sig(1), sig(2)]),
  node('history', 'L-history', [sig(3)]),
  node('games', 'L-games', []),
  node('games/arkanoid', 'L-arkanoid', [sig(4)]),
  node('sharing', 'L-sharing', []),
  node('sharing/hosts', 'L-hosts', [sig(5)]),
]
const docs = new Map<string, ReadonlyMap<string, BeeDoc>>([
  ['L-commands', new Map([[sig(1), doc('beehaviors')], [sig(2), doc('mail')]])],
  ['L-history', new Map([[sig(3), doc('undo')]])],
  ['L-arkanoid', new Map([[sig(4), doc('arkanoid')]])],
  ['L-hosts', new Map([[sig(5), doc('hosts')]])],
])
const read = (layer: string) => docs.get(layer)

describe('the way back on the hosts desk', () => {
  it('names the way-back words a package carries, from its own layer docs', () => {
    expect(wayBackBeneath('commands', nodes, read)).toEqual({ words: ['beehaviors'], unread: [] })
    expect(wayBackBeneath('history', nodes, read)).toEqual({ words: ['undo'], unread: [] })
  })

  it('reads beneath the path too, because a path switched off takes everything under it', () => {
    expect(wayBackBeneath('sharing', nodes, read).words).toEqual(['hosts'])
  })

  it('lets a package with none of them go off', () => {
    expect(wayBackBeneath('games', nodes, read)).toEqual({ words: [], unread: [] })
    expect(wayBackBeneath('games/arkanoid', nodes, read)).toEqual({ words: [], unread: [] })
  })

  it('reads an alias as the word it answers', () => {
    const aliased = new Map([['L-commands', new Map([[sig(1), doc('roster', ['Beehaviors'])]])]])
    expect(wayBackBeneath('commands', nodes.slice(0, 1), layer => aliased.get(layer)).words).toEqual(['beehaviors'])
  })

  it('cannot call a path safe while a layer beneath it is unread', () => {
    const partial = (layer: string) => layer === 'L-hosts' ? undefined : docs.get(layer)
    expect(wayBackBeneath('sharing', nodes, partial)).toEqual({ words: [], unread: ['L-hosts'] })
  })

  it('never reads the root as a package', () => {
    expect(wayBackBeneath('', nodes, read)).toEqual({ words: [], unread: [] })
  })

  it('keeps one list: the words that cannot go dark, and the desk\'s own word', () => {
    expect([...PACKAGE_WAY_BACK_WORDS].sort()).toEqual([...ALWAYS_LIT_WORDS, 'hosts'].sort())
  })

  it('refuses at the bulb and at the door alike', () => {
    const view = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'host-directory.view.ts'), 'utf8')
    const at = view.indexOf('#switchable(row: DirectoryRow)')
    const switchable = view.slice(at, at + 1500)
    expect(switchable).toMatch(/this\.#wayBack\(row\.path\)/)
    const toggle = view.slice(view.indexOf('async #toggle(row: DirectoryRow)'))
    expect(toggle.slice(0, 600)).toMatch(/this\.#wayBack\(row\.path\)/)
  })
})
