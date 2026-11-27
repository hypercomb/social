// pools/pool-node.spec.ts
import { describe, expect, it } from 'vitest'
import { poolNodeInitials, poolNodeKey, poolNodeTitle, uniquePoolNodes, type PoolNode } from './pool-node.js'

const KEY = '3d6d3327d9ef901fb14c5a11471ed78bb8fc592433d8e1234e503f42817b38ec'
const person = (name?: string): PoolNode => ({ kind: 'participant', id: KEY, ...(name !== undefined ? { name } : {}) })
const domain = (id: string): PoolNode => ({ kind: 'domain', id })

describe('a chip', () => {
  it('shows a participant by the initials of their name', () => {
    expect(poolNodeInitials(person('Ana Maria Lopez'))).toBe('AL')
    expect(poolNodeInitials(person('jaime'))).toBe('JA')
    expect(poolNodeInitials(person('  rosanna   b. '))).toBe('RB')
    expect(poolNodeInitials(person('J'))).toBe('J')
    expect(poolNodeInitials(person('émilie zola'))).toBe('ÉZ')
    expect(poolNodeInitials(person('田中 太郎'))).toBe('田太')
  })

  it('shows a participant with no name by the start of their key', () => {
    expect(poolNodeInitials(person())).toBe('3D')
    expect(poolNodeInitials(person('   '))).toBe('3D')
    expect(poolNodeInitials(person('!!!'))).toBe('3D')
  })

  it('shows a domain by its name, never by its ending', () => {
    expect(poolNodeInitials(domain('jwize.com'))).toBe('JW')
    expect(poolNodeInitials(domain('my-kitchen.org'))).toBe('MK')
    expect(poolNodeInitials(domain('meetups.jwize.com'))).toBe('MJ')
    expect(poolNodeInitials(domain('localhost:4291'))).toBe('L4')
    expect(poolNodeInitials(domain('localhost'))).toBe('LO')
  })
})

describe('a hover', () => {
  it('says the domain, or the participant as they named themselves', () => {
    expect(poolNodeTitle(domain('jwize.com'))).toBe('jwize.com')
    expect(poolNodeTitle(person('Ana Maria Lopez'))).toBe('Ana Maria Lopez')
    expect(poolNodeTitle(person())).toBe('3d6d3327…')
    expect(poolNodeTitle(person('  '))).toBe('3d6d3327…')
  })
})

describe('a set of nodes', () => {
  it('keeps a domain and a participant apart even when their ids read alike', () => {
    expect(poolNodeKey(domain('a'))).not.toBe(poolNodeKey({ kind: 'participant', id: 'a' }))
  })

  it('holds each node once, in the order first seen, and takes a name that arrives later', () => {
    const nodes = uniquePoolNodes([person(), domain('jwize.com'), person('Ana'), domain('jwize.com'), { ...person(), you: true }])
    expect(nodes).toHaveLength(2)
    expect(nodes[0]).toMatchObject({ kind: 'participant', name: 'Ana', you: true })
    expect(nodes[1]).toEqual(domain('jwize.com'))
  })
})
