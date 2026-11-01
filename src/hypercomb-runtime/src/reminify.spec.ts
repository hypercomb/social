// @vitest-environment node
// A changed registration derives a minified root beside the readable one.
// The same package is not walked twice, and a record already in the pool is not walked at all.

import { describe, expect, it } from 'vitest'
import { SignatureService } from '@hypercomb/core'
import { projectRegistration, reminifyRegistered, reminifyRegistration } from './reminify'

const encode = (text: string): Uint8Array => new TextEncoder().encode(text)
const sign = (bytes: Uint8Array): Promise<string> =>
  SignatureService.sign(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)

describe('reminifyRegistered', () => {
  it('derives a new root, then skips a second walk when those bytes are already held', async () => {
    const bee = encode('export const value = 1;  \n')
    const beeSig = await sign(bee)
    const layer = encode(JSON.stringify({ name: 'root', cells: [], bees: [beeSig], dependencies: [] }))
    const root = await sign(layer)
    const heap = new Map<string, Uint8Array>([[beeSig, bee], [root, layer]])
    let beeReads = 0
    const io = {
      read: async (sig: string) => {
        if (sig === beeSig) beeReads += 1
        return heap.get(sig) ?? null
      },
      write: async (sig: string, bytes: Uint8Array) => { heap.set(sig, bytes) },
    }
    const first = await reminifyRegistered(root, io)
    expect(first?.skipped).toBe(false)
    expect(first?.root).toMatch(/^[a-f0-9]{64}$/)
    expect(first?.root).not.toBe(root)
    expect(first?.pool).toBe(`derived:${root}`)
    const walked = beeReads
    expect(walked).toBeGreaterThan(0)
    const second = await reminifyRegistered(root, io)
    expect(second).toEqual(first)
    expect(beeReads).toBe(walked)
  })

  it('treats a recalled record as already done', async () => {
    const prior = 'a'.repeat(64)
    const root = 'b'.repeat(64)
    let reads = 0
    const result = await reminifyRegistered(root, {
      read: async () => { reads += 1; return null },
      recall: async () => prior,
    })
    expect(result).toMatchObject({ root: '', derivation: prior, skipped: true, pool: `derived:${root}` })
    expect(reads).toBe(0)
    const again = await reminifyRegistered(root, {
      read: async () => { reads += 1; return null },
      recall: async () => { throw new Error('recall should not run again') },
    })
    expect(again?.skipped).toBe(true)
    expect(reads).toBe(0)
  })

  it('reminifies the behaviors a host pick left on, and leaves an off behavior unread', async () => {
    const on = encode('export const on = 1;\n')
    const off = encode('export const off = 1;\n')
    const picked = encode('export const picked = 1;\n')
    const onSig = await sign(on)
    const offSig = await sign(off)
    const pickedSig = await sign(picked)
    const onLayer = encode(JSON.stringify({ name: 'solomon', cells: [], bees: [onSig], dependencies: [] }))
    const offLayer = encode(JSON.stringify({ name: 'arkanoid', cells: [], bees: [offSig], dependencies: [] }))
    const pickedLayer = encode(JSON.stringify({ name: 'arkanoid', cells: [], bees: [pickedSig], dependencies: [] }))
    const onLayerSig = await sign(onLayer)
    const offLayerSig = await sign(offLayer)
    const pickedLayerSig = await sign(pickedLayer)
    const rootLayer = encode(JSON.stringify({
      name: 'root',
      cells: [offLayerSig, onLayerSig],
      bees: [],
      criticalBees: [offSig, onSig],
      dependencies: [],
    }))
    const root = await sign(rootLayer)
    const held = new Map<string, Uint8Array>([
      [onSig, on], [offSig, off], [pickedSig, picked],
      [onLayerSig, onLayer], [offLayerSig, offLayer], [pickedLayerSig, pickedLayer],
      [root, rootLayer],
    ])
    const read = async (sig: string) => held.get(sig) ?? null
    let offReads = 0
    const watching = async (sig: string) => {
      if (sig === offSig) offReads += 1
      return read(sig)
    }
    const turnedOff = await projectRegistration(root, read, { picks: {}, off: new Set(['arkanoid']) })
    expect(turnedOff).not.toBeNull()
    expect(turnedOff!.root).not.toBe(root)
    const projected = JSON.parse(new TextDecoder().decode(turnedOff!.files.get(turnedOff!.root)!)) as { cells: string[]; criticalBees: string[] }
    expect(projected.cells).toEqual([onLayerSig])
    expect(projected.criticalBees).toEqual([onSig])

    const minified = await reminifyRegistration(root, { picks: {}, off: new Set(['arkanoid']) }, {
      read: watching,
      write: async (sig, bytes) => { held.set(sig, bytes) },
    })
    expect(minified?.skipped).toBe(false)
    expect(minified?.root).toMatch(/^[a-f0-9]{64}$/)
    expect(minified?.pool).toBe(`derived:${turnedOff!.root}`)
    expect(offReads).toBe(0)

    const choice = await projectRegistration(root, read, {
      picks: { arkanoid: { layer: pickedLayerSig } },
      off: new Set(),
    })
    const chosen = JSON.parse(new TextDecoder().decode(choice!.files.get(choice!.root)!)) as { cells: string[] }
    expect(chosen.cells).toContain(pickedLayerSig)
    expect(chosen.cells).not.toContain(offLayerSig)
  })
})
