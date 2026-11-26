// Where a read found a signature: one map per page, told to the broker,
// asked by take. Attribution only.

import { afterEach, describe, expect, it } from 'vitest'
import { forgetFoundHosts, foundHostsOf, headsInDocument, noteFoundAt } from './found-hosts.js'

const A = 'a'.repeat(64)
const B = 'b'.repeat(64)

afterEach(() => { forgetFoundHosts(); delete (globalThis as { ioc?: unknown }).ioc })

describe('found hosts', () => {
  it('keeps the first hosts first, adds new ones after, and hints the broker each note, never teaching it a host', () => {
    const noted: [string, string[]][] = []
    const learned: string[] = []
    ;(globalThis as { ioc?: unknown }).ioc = { get: () => ({
      hintDomainsForSig: (sig: string, hosts: string[]) => { noted.push([sig, hosts]) },
      // The durable half: persisted, sent to the service worker, announced.
      noteDomainsForSig: (sig: string) => { learned.push(sig) },
    }) }
    noteFoundAt(A.toUpperCase(), ['One.Example', 'two.example'])
    noteFoundAt(A, ['two.example', 'three.example'])
    expect(foundHostsOf(A)).toEqual(['one.example', 'two.example', 'three.example'])
    expect(noted).toEqual([[A, ['one.example', 'two.example']], [A, ['two.example', 'three.example']]])
    expect(learned).toEqual([])
  })

  it('notes nothing for a name that is not a signature, or with no host', () => {
    noteFoundAt('abc', ['one.example'])
    noteFoundAt(B, ['', 'has space', 'evil/path'])
    expect(foundHostsOf('abc')).toEqual([])
    expect(foundHostsOf(B)).toEqual([])
  })

  it('reads the heads a ledger names, and no other signature', () => {
    const ledger = JSON.stringify({ sites: [{ lineage: 'x', publishers: [{ pubkey: B, head: A }, { pubkey: B, head: null }] }], root: B })
    expect(headsInDocument(ledger).sort()).toEqual([A, B])
    expect(headsInDocument('not json')).toEqual([])
  })
})
