// permit.queen.spec.ts — `permit`: one reading of the line, ids that keep
// their case, refusals that say why, and the word acting on the hive's own
// groups so the Execution queue judges by what was said.

import { describe, expect, it, vi } from 'vitest'
import { EffectBus } from '@hypercomb/core'

vi.hoisted(() => {
  ;(globalThis as unknown as { window: { ioc?: unknown } }).window.ioc = {
    register: () => { /* noop */ },
    get: () => undefined,
    whenReady: () => { /* noop */ },
    onRegister: () => () => { /* noop */ },
    list: () => [],
  }
})

const { PermitQueenBee, readPermit } = await import('./permit.queen.js')
const { permitGroups } = await import('./permit-groups.js')
const { executionQueue } = await import('./execution-queue.js')

type Runnable = { execute(args: string): Promise<void> }
const queen = new PermitQueenBee() as unknown as Runnable
const said: string[] = []
EffectBus.on<{ message?: string }>('activity:log', payload => { if (payload?.message) said.push(payload.message) })
const say = async (line: string): Promise<string[]> => { said.length = 0; await queen.execute(line); return [...said] }

describe('reading a permit line', () => {
  it('lists, shows, and sets policy', () => {
    expect(readPermit('')).toEqual({ show: 'all' })
    expect(readPermit('Hermes')).toEqual({ show: 'group', name: 'hermes' })
    expect(readPermit('hermes manual')).toEqual({ policy: 'hermes', mode: 'manual' })
    expect(readPermit('hermes everything')).toEqual({ policy: 'hermes', mode: 'everything' })
    expect(readPermit('hermes additive READ')).toEqual({ policy: 'hermes', mode: 'auto', kinds: ['read', 'additive'] })
    expect(readPermit('hermes auto read')).toEqual({ policy: 'hermes', mode: 'auto', kinds: ['read'] })
  })

  it('adds and drops by id, keeping its case', () => {
    expect(readPermit('hermes add model NousResearch/Hermes-4-70B')).toEqual({ add: 'hermes', facet: 'model', label: 'NousResearch/Hermes-4-70B' })
    expect(readPermit('managers add conversation chat:tile:/::job-1')).toEqual({ add: 'managers', facet: 'conversation', label: 'chat:tile:/::job-1' })
    expect(readPermit('hermes drop hermes-local')).toEqual({ drop: 'hermes', label: 'hermes-local' })
    expect(readPermit('hermes dissolve')).toEqual({ dissolve: 'hermes' })
  })

  it('refuses, saying why', () => {
    expect(readPermit('hermes add code managers')).toHaveProperty('refuse')
    expect(readPermit('hermes add tile x')).toHaveProperty('refuse')
    expect(readPermit('hermes add provider')).toHaveProperty('refuse')
    expect(readPermit('hermes add conversation this')).toHaveProperty('refuse')
    expect(readPermit('hermes drop')).toHaveProperty('refuse')
    expect(readPermit('hermes writes')).toHaveProperty('refuse')
    expect(readPermit('hermes auto')).toHaveProperty('refuse')
  })
})

describe('the word', () => {
  it('lists every group, everyone first', async () => {
    const lines = await say('')
    expect(lines[0]).toMatch(/^Permit — everyone: every kind runs on arrival · whatever no group names/)
    expect(lines.some(line => line.startsWith('Permit — held: nothing runs by itself'))).toBe(true)
  })

  it('puts a provider in a group the queue then judges by', async () => {
    const added = await say('hermes add provider hermes-local')
    expect(added[0]).toBe('Permit — hermes: nothing runs by itself · provider hermes-local')
    expect(added[1]).toMatch(/no provider called hermes-local is on this device/)
    expect(await say('hermes read')).toEqual(['Permit — hermes: read run on arrival · provider hermes-local'])
    const ask = { convoId: 'c1', providerId: 'hermes-local', model: 'hermes-4', lines: ['/x'], needsGrant: false }
    executionQueue.request({ ...ask, kind: 'additive' })
    expect(executionQueue.requests()[0]).toMatchObject({ state: 'waiting', group: 'hermes' })
    executionQueue.request({ ...ask, kind: 'read' })
    expect(executionQueue.requests()[0]).toMatchObject({ auto: true, group: 'hermes' })
    expect((await say('hermes'))[0]).toMatch(/ran 1 by policy this session$/)
  })

  it('holds a dropped actor and releases it only from held', async () => {
    expect((await say('hermes drop hermes-local'))[0]).toMatch(/hermes-local is held/)
    expect(permitGroups.groupOf('provider', 'hermes-local')?.name).toBe('held')
    expect((await say('other add provider hermes-local'))[0]).toMatch(/is held; permit held drop hermes-local releases it first/)
    expect((await say('held drop hermes-local'))[0]).toMatch(/released; it runs as everyone again/)
    expect(permitGroups.groupOf('provider', 'hermes-local')).toBeUndefined()
  })

  it('refuses the built-ins what would widen them', async () => {
    expect((await say('everyone add provider p'))[0]).toMatch(/everyone takes no members/)
    expect((await say('held everything'))[0]).toMatch(/held runs nothing by itself/)
    expect((await say('everyone dissolve'))[0]).toMatch(/built in and stays/)
    expect((await say('trusted read'))[0]).toMatch(/kept for the chat window/)
  })

  it('everyone is the Execution window\'s own policy', async () => {
    await say('everyone read additive')
    expect(executionQueue.mode()).toBe('auto')
    expect(executionQueue.autoKinds()).toEqual(['read', 'additive'])
    await say('everyone everything')
    expect(executionQueue.mode()).toBe('everything')
  })
})
