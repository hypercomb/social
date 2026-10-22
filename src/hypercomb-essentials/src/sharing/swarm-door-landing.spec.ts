import { describe, expect, it } from 'vitest'
import { landingOrigin } from './swarm-door-landing.js'

const ROOT = 'f'.repeat(64)

describe('landingOrigin — where a room link lands', () => {
  it('lands on the host\'s swarm door when the host opened one', async () => {
    const asked: string[] = []
    const origin = await landingOrigin('hypercomb.com', 'https://hypercomb.io', async (o) => { asked.push(o); return ROOT })
    expect(origin).toBe('https://swarm.hypercomb.com')
    expect(asked).toEqual(['https://swarm.hypercomb.com'])
  })

  it('stays on the sharer\'s page when the host has no swarm door', async () => {
    expect(await landingOrigin('hypercomb.com', 'https://hypercomb.io', async () => null)).toBe('https://hypercomb.io')
  })

  it('a sharer already on a swarm door lands guests where they are, without asking', async () => {
    let asked = false
    const origin = await landingOrigin('hypercomb.com', 'https://swarm.jwize.com', async () => { asked = true; return ROOT })
    expect(origin).toBe('https://swarm.jwize.com')
    expect(asked).toBe(false)
  })

  it('never a loopback host, never an empty one — and the port is not the zone', async () => {
    const yes = async () => ROOT
    expect(await landingOrigin('localhost:7791', 'http://localhost:4251', yes)).toBe('http://localhost:4251')
    expect(await landingOrigin('127.0.0.1', 'http://localhost:4251', yes)).toBe('http://localhost:4251')
    expect(await landingOrigin('', 'https://hypercomb.io', yes)).toBe('https://hypercomb.io')
    expect(await landingOrigin('hypercomb.com:443', 'https://hypercomb.io', yes)).toBe('https://swarm.hypercomb.com')
  })
})
