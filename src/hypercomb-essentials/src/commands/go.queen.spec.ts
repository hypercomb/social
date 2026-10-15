// go.queen.spec.ts — where `go` lands, from where you stand.

import { describe, expect, it } from 'vitest'

;(window as unknown as { ioc: unknown }).ioc = { register: () => void 0, get: () => undefined }
const { goTarget } = await import('./go.queen.js')

describe('go lands where the words say', () => {
  it('a bare name is a tile on this page', () => {
    expect(goTarget(['a'], 'meetups')).toEqual(['a', 'meetups'])
  })
  it('a path walks down from here', () => {
    expect(goTarget(['a'], 'meetups/night-1')).toEqual(['a', 'meetups', 'night-1'])
  })
  it('a leading slash starts at the root', () => {
    expect(goTarget(['a', 'b'], '/meetups')).toEqual(['meetups'])
  })
  it('.. goes up, and never above the root', () => {
    expect(goTarget(['a', 'b'], '..')).toEqual(['a'])
    expect(goTarget([], '../..')).toEqual([])
  })
  it('/ is the root', () => {
    expect(goTarget(['a', 'b'], '/')).toEqual([])
  })
  it('names keep their spelling', () => {
    expect(goTarget([], 'Night One')).toEqual(['Night One'])
  })
})
