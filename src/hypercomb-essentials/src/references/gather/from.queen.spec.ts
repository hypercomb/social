// from.queen.spec.ts — `/from <group> gather [<tile>…]`: the word for what the
// Review window does. It links first when the page is not linked yet, gathers
// the named tiles of the page's own (all of them when none are named), and
// says what it could not gather.

import { beforeEach, describe, expect, it } from 'vitest'
import { EffectBus } from '@hypercomb/core'

const held = new Map<string, unknown>()
;(window as unknown as { ioc: unknown }).ioc = {
  register: (key: string, value: unknown) => { held.set(key, value) },
  get: (key: string) => held.get(key),
  list: () => [...held.keys()],
  whenReady: () => void 0,
  onRegister: () => void 0,
}

const { FromQueenBee } = await import('./from.queen.js')
const { GATHER_LINK_SERVICE_KEY } = await import('./gather-link.service.js')

const calls: { link: string[][]; gather: string[][] } = { link: [], gather: [] }
let linked: string[][] = []
const toasts: { type: string; message: string }[] = []
EffectBus.on('toast:show', (t: { type: string; message: string }) => { toasts.push(t) })

beforeEach(() => {
  calls.link = []; calls.gather = []; linked = []; toasts.length = 0
  held.set('@hypercomb.social/Lineage', { explorerSegments: () => ['team'] })
  held.set(GATHER_LINK_SERVICE_KEY, {
    groupsOf: async () => linked,
    resolveRoute: async (name: string) => [name],
    link: async (_page: string[], group: string[]) => { calls.link.push(group); linked = [group]; return { ok: true, group } },
    review: async () => ({ group: ['people'], tiles: [{ name: 'jaime' }, { name: 'gerry' }, { name: 'resume' }] }),
    gatherOwn: async (_page: string[], names: string[]) => { calls.gather.push(names); return names.filter(n => n !== 'resume') },
  })
})

const say = (args: string) => new FromQueenBee().invoke(args)
const last = () => toasts[toasts.length - 1]

describe('/from <group> gather', () => {
  it('links an unlinked page, then gathers the named tiles', async () => {
    await say('people gather jaime gerry')
    expect(calls.link).toEqual([['people']])
    expect(calls.gather).toEqual([['jaime', 'gerry']])
    expect(last()?.type).toBe('success')
  })

  it('does not link again when the page already gathers from the group', async () => {
    linked = [['people']]
    await say('people gather jaime')
    expect(calls.link).toEqual([])
    expect(calls.gather).toEqual([['jaime']])
  })

  it('gathers every own tile when none are named, and says which it could not', async () => {
    linked = [['people']]
    await say('people gather')
    expect(calls.gather).toEqual([['jaime', 'gerry', 'resume']])
    expect(last()?.type).toBe('info')
    expect(last()?.message).toContain('not gathered: resume')
  })

  it('names a tile that is not the page\'s own instead of gathering it', async () => {
    linked = [['people']]
    await say('people gather jaime nobody')
    expect(calls.gather).toEqual([['jaime']])
    expect(last()?.message).toContain('nobody')
  })

  it('plain `/from people` still only links', async () => {
    await say('people')
    expect(calls.link).toEqual([['people']])
    expect(calls.gather).toEqual([])
  })
})
