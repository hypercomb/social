/// <reference types="node" />
// @vitest-environment node
//
// spots.spec.ts — THE APP'S LANDING SPOTS, on the living primitive. The root
// names a spot through a meta envelope; the spot's beehaviors are the members
// of `<spot>:beehaviors`; each behaviour carries its bee and its source, so
// the hive can be drilled from the spot down to the code.

import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@hypercomb/runtime/acquire', () => ({
  selfBases: () => ['https://origin.test'],
  fetchAcross: () => async (sig: string) => {
    const bytes = origin.get(`/${sig}`)
    return bytes ? new Uint8Array(bytes) : null
  },
}))
vi.mock('@hypercomb/runtime/host-packages', () => ({ hostBases: () => [] }))
vi.mock('@hypercomb/runtime/host-zones', () => ({ DEFAULT_HOST_ZONES: [] }))

const { beehaviorsOf, holdSpots, registerSpots, SPOTS_KEY } = await import('./spots')

const sha = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex')
const origin = new Map<string, Uint8Array>()
const put = (value: unknown): string => {
  const bytes = new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value))
  const sig = sha(bytes)
  origin.set(`/${sig}`, bytes)
  return sig
}
const meta = (payload: Record<string, unknown>) => put({ meta: 1, ...payload })

/** A device: layers at the flat root, bees in their pool, pools as directories. */
const device = () => {
  const root = new Map<string, Uint8Array>(), bees = new Map<string, Uint8Array>(), pools = new Map<string, Map<string, Uint8Array>>()
  const dir = (files: Map<string, Uint8Array>) => ({
    async *entries() { for (const [name, bytes] of files) yield [name, { kind: 'file', getFile: async () => new Blob([bytes as BlobPart]) }] },
    getFileHandle: async (name: string) => ({ createWritable: async () => ({ write: async (b: Uint8Array) => { files.set(name, new Uint8Array(b)) }, close: async () => {} }) }),
  })
  return {
    root, bees, pools,
    store: {
      getLayerPoolBytes: async (sig: string) => root.get(sig) ?? null,
      writeLayerBytes: async (sig: string, bytes: ArrayBuffer) => { if (sha(new Uint8Array(bytes)) === sig) root.set(sig, new Uint8Array(bytes)) },
      getBeeBytes: async (sig: string) => bees.get(sig) ?? null,
      writeBeeBytes: async (sig: string, bytes: Uint8Array) => { if (sha(bytes) === sig) bees.set(sig, bytes) },
      getPool: async (meaning: string) => { if (!pools.has(meaning)) pools.set(meaning, new Map()); return dir(pools.get(meaning)!) },
    },
  }
}

let here: ReturnType<typeof device>
const services = new Map<string, unknown>()
let hostRoot = '', beeSig = '', poolSig = '', memberSig = ''

beforeEach(() => {
  origin.clear(); services.clear()
  here = device()
  ;(globalThis as any).window = globalThis
  ;(globalThis as any).ioc = { get: (key: string) => key === '@hypercomb.social/Store' ? here.store : services.get(key), register: (key: string, value: unknown) => services.set(key, value) }
  // The behaviour `lineage`: its bee, and its source as a child node.
  beeSig = put('export const lineage = 1')
  const source = put({ name: 'src/core/lineage.ts', content: meta({ resource: put('export class Lineage {}'), relation: 'content' }) })
  const behaviour = put({ name: 'lineage', bee: meta({ bee: beeSig, relation: 'bee' }), children: [meta({ layer: source, relation: 'children' })] })
  const member = new TextEncoder().encode(JSON.stringify({ meta: 1, layer: behaviour, relation: 'beehavior', root: 'lineage' }))
  memberSig = sha(member)
  poolSig = sha(beehaviorsOf('lineage'))
  origin.set(`/${poolSig}/`, new TextEncoder().encode(memberSig))
  origin.set(`/${poolSig}/${memberSig}`, member)
  hostRoot = put({ name: 'root', cells: [meta({ layer: put({ name: 'lineage' }), relation: 'cells', root: 'lineage' })], bees: [], bootBees: [] })
  ;(globalThis as any).fetch = async (url: string) => {
    const bytes = origin.get(new URL(url).pathname)
    return bytes ? new Response(bytes as BodyInit) : new Response('', { status: 404 })
  }
})

describe('landing spots', () => {
  it('resolves a spot the root names, its pool read from a host and held here', async () => {
    const spots = await holdSpots(hostRoot)
    expect(spots).toEqual([{ name: 'lineage', meaning: 'lineage:beehaviors', behaviours: [expect.objectContaining({ name: 'lineage', bee: beeSig })] }])
    expect(here.bees.has(beeSig)).toBe(true)
    expect([...here.pools.get('lineage:beehaviors')!.keys()]).toEqual([memberSig])

    // The next boot reads the pool from the device: no host is asked.
    origin.delete(`/${poolSig}/`)
    expect((await holdSpots(hostRoot))[0]!.behaviours.map(b => b.name)).toEqual(['lineage'])
  })

  it('refuses a pool member that does not hash to its name', async () => {
    origin.set(`/${poolSig}/${memberSig}`, new TextEncoder().encode('{"meta":1,"layer":"forged"}'))
    expect((await holdSpots(hostRoot))[0]!.behaviours).toEqual([])
    expect(here.pools.get('lineage:beehaviors')!.size).toBe(0)
  })

  it('drills down from a spot to the source of a behaviour', async () => {
    registerSpots(await holdSpots(hostRoot))
    const port = services.get(SPOTS_KEY) as { source(spot: string, behaviour: string): Promise<{ path: string; text: string }[]> }
    expect(await port.source('lineage', 'lineage')).toEqual([{ path: 'src/core/lineage.ts', text: 'export class Lineage {}' }])
  })
})
