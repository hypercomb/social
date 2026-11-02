import { describe, expect, it } from 'vitest'
import { SCOUT_MAX_OFFERS, scout, type ScoutRead } from './scout.js'

const sig = (n: number): string => n.toString(16).padStart(64, '0')

/** Hosts as pools: host → meaning → member signatures. */
const world = (hosts: Record<string, Record<string, string[]>>) => {
  const asked: string[] = []
  const read: ScoutRead = async (host, meaning) => { asked.push(`${host} ${meaning}`); return hosts[host]?.[meaning] ?? [] }
  return { asked, read, followed: async () => Object.keys(hosts).filter(h => !h.startsWith('stranger')) }
}

describe('a scout reads pools and brings back offers', () => {
  it('ranks a signature in several of the task pools above one in a single pool', async () => {
    const w = world({
      'a.example': { 'style:christmas': [sig(1), sig(2)], 'theme:dark': [sig(1)] },
      'b.example': { 'style:christmas': [sig(3)], 'theme:dark': [sig(1), sig(3)] },
    })
    const offers = await scout(['style:christmas', 'theme:dark'], w)
    expect(offers.map(o => o.sig)).toEqual([sig(1), sig(3), sig(2)])
    expect(offers[0]).toEqual({ sig: sig(1), meanings: ['style:christmas', 'theme:dark'], hosts: ['a.example', 'b.example'] })
  })

  it('reads only followed hosts, and only the meanings it was given', async () => {
    const w = world({ 'a.example': { 'x:y': [sig(1)] }, 'stranger.example': { 'x:y': [sig(9)] } })
    const offers = await scout(['x:y'], w)
    expect(w.asked).toEqual(['a.example x:y'])
    expect(offers.map(o => o.sig)).toEqual([sig(1)])
  })

  it('keeps only what the interest set allows', async () => {
    const w = world({ 'a.example': { 'x:y': [sig(1), sig(2)] } })
    const offers = await scout(['x:y'], { ...w, allows: async c => c.sig !== sig(1) })
    expect(offers.map(o => o.sig)).toEqual([sig(2)])
  })

  it('says nothing when there is nothing, and never reads without a meaning or a host', async () => {
    const w = world({ 'a.example': {} })
    expect(await scout(['x:y'], w)).toEqual([])
    expect(await scout([' ', ''], w)).toEqual([])
    expect(await scout(['x:y'], { ...w, followed: async () => [] })).toEqual([])
    expect(w.asked).toEqual(['a.example x:y'])
  })

  it('caps the offers it brings back', async () => {
    const many = Array.from({ length: SCOUT_MAX_OFFERS + 10 }, (_, k) => sig(k + 1))
    const offers = await scout(['x:y'], world({ 'a.example': { 'x:y': many } }))
    expect(offers.length).toBe(SCOUT_MAX_OFFERS)
  })
})
