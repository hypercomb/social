// code-reach.spec.ts — the fast half of the draft audit: what a change newly
// reaches, the same answer every time, with nothing hiding in a comment.

import { describe, expect, it } from 'vitest'
import { newReaches, reachesOf, reachPhrase } from './code-reach.js'

describe('what code reaches', () => {
  it('finds each kind of reach, and nothing in plain code', () => {
    expect(reachesOf('const rooms = walls.map(wall => wall.length)')).toEqual([])
    expect(reachesOf('await fetch(url)')).toEqual(['network'])
    expect(reachesOf('localStorage.getItem("x")')).toEqual(['storage'])
    expect(reachesOf('ioc.get("@hypercomb.social/SecretStore")')).toEqual(['secrets'])
    expect(reachesOf('new Function("return 1")')).toEqual(['eval'])
    expect(reachesOf('window.open(link)')).toEqual(['escape'])
    expect(reachesOf('atob(payload)')).toEqual(['disguise'])
  })

  it('reads comments too: a comment trick is not a way past it', () => {
    expect(reachesOf('// fetch(everything)')).toEqual(['network'])
  })

  it('treats an import it cannot read as text run as code, and a plain one as nothing', () => {
    expect(reachesOf('await import("./rooms.js")')).toEqual([])
    expect(reachesOf('await import(where)')).toEqual(['eval'])
    expect(reachesOf('await import(`./${where}.js`)')).toEqual(['eval'])
  })

  it('sees reaching round a name as disguise', () => {
    expect(reachesOf('globalThis["fe" + "tch"](url)')).toEqual(['disguise'])
  })
})

describe('what a change newly reaches', () => {
  it('lists only what the old code did not reach', () => {
    expect(newReaches('var rooms = "remembered";', 'var rooms = localStorage.getItem("rooms");')).toEqual(['storage'])
    expect(newReaches('const a = await fetch(first)', 'const a = await fetch(first); const b = await fetch(second)')).toEqual([])
  })

  it('counts an address the old code never named, even where it already used the network', () => {
    const before = 'await fetch("https://hypercomb.io/content")'
    expect(newReaches(before, `${before}; await fetch("https://elsewhere.example/steal")`)).toEqual(['network'])
    expect(newReaches(before, before.replace('content', 'other'))).toEqual([])
  })

  it('says the list as a phrase', () => {
    expect(reachPhrase(['network'])).toBe('the network')
    expect(reachPhrase(['network', 'storage', 'secrets'])).toBe('the network, stored data and secrets and keys')
  })
})
