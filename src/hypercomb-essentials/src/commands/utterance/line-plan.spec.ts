// line-plan.spec.ts — the preview says what the door will do, or it lies.
//
// A fixed census and the real pure reader; the grant is handed in so no test
// reads storage.

import { describe, expect, it } from 'vitest'
import { DEFAULT_MACHINE_GRANT, type MachineGrant } from '@hypercomb/core'
import { planLine, planOwnLine, type PlanEntry } from './line-plan.js'
import { readUtterance } from './utterance-reading.js'

const CENSUS: readonly PlanEntry[] = [
  { name: 'go', description: 'Walk the hive to a path', options: ['<path>'] },
  { name: 'create', aliases: ['new'], description: 'Make a tile here', options: ['<name>'] },
  { name: 'website', description: 'Dress a tile as a page', rawArgs: true },
  { name: 'record', description: 'Record the meeting' },
  { name: 'images', description: 'Room pictures' },
  { name: 'lightbox', aliases: ['images'], description: 'Picture lightbox' },
]

const deps = (grant: MachineGrant = { ...DEFAULT_MACHINE_GRANT, granted: [] }) => ({
  census: CENSUS,
  read: (text: string) => readUtterance(text, CENSUS),
  grant,
})

describe('planLine', () => {
  it('a slash line is one word and exactly the arguments it is handed', () => {
    const plan = planLine('/go /protocol/intro', deps())
    expect(plan.kind).toBe('word')
    expect(plan.steps).toEqual([{ command: 'go', args: '/protocol/intro', description: 'Walk the hive to a path' }])
    expect(plan.refused).toBeUndefined()
  })

  it('an alias resolves to its behaviour and keeps the word said', () => {
    const plan = planLine('/new apple', deps())
    expect(plan.steps[0]).toMatchObject({ command: 'create', said: 'new', args: 'apple' })
  })

  it('a word that keeps its arguments is a word line even without its slash', () => {
    const plan = planLine('website page 3fa9 and record', deps())
    expect(plan.kind).toBe('word')
    expect(plan.steps).toEqual([{ command: 'website', args: 'page 3fa9 and record', description: 'Dress a tile as a page' }])
  })

  it('a sentence runs every word it names, in word order, with what the reader hands it', () => {
    const plan = planLine('go /intro and record', deps())
    expect(plan.kind).toBe('sentence')
    expect(plan.steps.map(s => [s.command, s.args])).toEqual([['go', 'intro'], ['record', '']])
    expect(plan.spans?.some(s => s.role === 'residue' && s.text === 'and')).toBe(true)
  })

  it('a word two behaviours claim runs nothing and names the claimants', () => {
    const plan = planLine('record images', deps())
    expect(plan.ambiguous?.word).toBe('images')
    expect(plan.ambiguous?.candidates).toEqual(['images', 'lightbox'])
  })

  it('a sentence that names nothing and speaks no structure is refused', () => {
    const plan = planLine('please make it nicer', deps())
    expect(plan.kind).toBe('inert')
    expect(plan.refused).toMatch(/nothing will run/)
  })

  it('structural grammar goes to the line itself', () => {
    expect(planLine('[a, b]', deps()).kind).toBe('structure')
    expect(planLine('docs/guides', deps()).kind).toBe('structure')
  })

  it('the participant\'s grant refuses before anything runs', () => {
    const plan = planLine('go /intro', deps({ ...DEFAULT_MACHINE_GRANT, reach: 'none', granted: [] }))
    expect(plan.refused).toMatch(/grants a machine nothing/)
  })

  it('the participant\'s own line is read by stance, with no grant gate', () => {
    const none = { ...deps(), grant: { ...DEFAULT_MACHINE_GRANT, reach: 'none' as const, granted: [] } }
    const sentence = planOwnLine('go /intro and record', '/go /intro and record', 'command', none)
    expect(sentence.kind).toBe('sentence')
    expect(sentence.refused).toBeUndefined()
    expect(sentence.steps.map(s => s.command)).toEqual(['go', 'record'])
    expect(planOwnLine('/go /x', '/go /x', 'command', none)).toMatchObject({ kind: 'word', steps: [{ command: 'go', args: '/x' }] })
    expect(planOwnLine('apple', 'apple', 'tiles', none).kind).toBe('tiles')
    expect(planOwnLine('apple', 'apple', 'find', none).kind).toBe('find')
    expect(planOwnLine('please be nice', '/please be nice', 'command', none)).toMatchObject({ kind: 'inert' })
    expect(planOwnLine('[a, b]', '[a, b]', 'command', none).kind).toBe('structure')
  })

  it('a destructive word on your own line asks first', () => {
    const census: PlanEntry[] = [...CENSUS, { name: 'remove', description: 'Remove tiles', machine: { reach: 'destructive' } }]
    const plan = planOwnLine('/remove a', '/remove a', 'command', { ...deps(), census })
    expect(plan.steps[0]).toMatchObject({ command: 'remove', confirms: true })
  })

  it('an unknown slash word is planned for the line, not hidden', () => {
    const plan = planLine('/zzz', deps())
    expect(plan.steps).toEqual([{ command: 'zzz', args: '', description: '', unknown: true }])
  })
})
