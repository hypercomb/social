import { describe, expect, it } from 'vitest'
import { moleculeAddress } from '@hypercomb/core'
import { MAX_PICTURE_ROOTS, isPicturesKey, pictureRootsOf as walk, picturesKey, picturesPoolAddress } from './picture-pools.js'
import { imagePropsOf } from './peer-images.js'

const pictureRootsOf = (sealed: string, read: Parameters<typeof walk>[1]) => walk(sealed, read, props => !!imagePropsOf(props))

const sig = (n: number): string => n.toString(16).padStart(64, '0')

/** A published branch held in memory: signature → JSON document. */
const reader = (docs: Record<string, Record<string, unknown>>) =>
  async (s: string): Promise<Record<string, unknown> | null> => docs[s] ?? null

describe('picture pools — pictures travel only through hosts', () => {
  it('keys a name by its molecule address, never the name itself', async () => {
    const key = await picturesKey('Garden')
    expect(key).toBe(`pictures:${await moleculeAddress('Garden')}`)
    expect(key).not.toContain('Garden')
    expect(isPicturesKey(key!)).toBe(true)
    expect(isPicturesKey('pictures:garden')).toBe(false)
    expect(await picturesKey('')).toBeNull()
  })

  it('the pool a host lists is the key itself, signed — never the name pool', async () => {
    const address = await picturesPoolAddress('garden')
    expect(address).toMatch(/^[0-9a-f]{64}$/)
    expect(address).not.toBe(await moleculeAddress('garden'))
  })

  it('offers every pictured tile of the branch, under its name, naming its own layer', async () => {
    const docs = {
      [sig(1)]: { name: 'garden', children: [sig(2), sig(3)], properties: [sig(10)] },
      [sig(10)]: { small: { image: sig(100) } },
      [sig(2)]: { name: 'rose', properties: [sig(20)] },
      [sig(20)]: { imageSig: sig(200) },
      // a tile with no picture is not offered
      [sig(3)]: { name: 'shed', properties: [sig(30)], children: [sig(4)] },
      [sig(30)]: { link: 'https://example.com' },
      // but its pictured children still are
      [sig(4)]: { name: 'tulip', properties: [sig(40)] },
      [sig(40)]: { large: { image: sig(400) } },
    }
    const roots = await pictureRootsOf(sig(1), reader(docs))
    expect(roots).toEqual({
      [(await picturesKey('garden'))!]: sig(1),
      [(await picturesKey('rose'))!]: sig(2),
      [(await picturesKey('tulip'))!]: sig(4),
    })
  })

  it('reads a hive\'s properties THROUGH the Life Primitive envelope, as the hive writes them', async () => {
    const docs = {
      [sig(1)]: { name: 'protocol', properties: [sig(10)] },
      // what a hive actually publishes: an envelope naming the properties
      [sig(10)]: { meta: 1, resource: sig(11), relation: 'properties' },
      [sig(11)]: { small: { image: sig(100) }, flat: { small: { image: sig(101) } } },
    }
    expect(await pictureRootsOf(sig(1), reader(docs))).toEqual({ [(await picturesKey('protocol'))!]: sig(1) })
  })

  it('the tile nearest the branch root keeps a name worn twice', async () => {
    const docs = {
      [sig(1)]: { name: 'top', children: [sig(2), sig(3)] },
      [sig(2)]: { name: 'rose', properties: [sig(20)], children: [sig(4)] },
      [sig(3)]: { name: 'other' },
      [sig(4)]: { name: 'rose', properties: [sig(20)] },
      [sig(20)]: { imageSig: sig(200) },
    }
    const roots = await pictureRootsOf(sig(1), reader(docs))
    expect(roots).toEqual({ [(await picturesKey('rose'))!]: sig(2) })
  })

  it('a branch of many tiles offers at most MAX_PICTURE_ROOTS, and a malformed head offers none', async () => {
    const children = Array.from({ length: MAX_PICTURE_ROOTS + 20 }, (_, i) => sig(1000 + i))
    const docs: Record<string, Record<string, unknown>> = { [sig(1)]: { name: 'many', children }, [sig(20)]: { imageSig: sig(200) } }
    children.forEach((child, i) => { docs[child] = { name: `tile-${i}`, properties: [sig(20)] } })
    expect(Object.keys(await pictureRootsOf(sig(1), reader(docs)))).toHaveLength(MAX_PICTURE_ROOTS)
    expect(await pictureRootsOf('not-a-sig', reader(docs))).toEqual({})
  })
})
