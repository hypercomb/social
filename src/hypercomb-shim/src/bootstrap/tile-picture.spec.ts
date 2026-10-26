import { afterEach, expect, it, vi } from 'vitest'
import { webcrypto } from 'node:crypto'

const subtle = (globalThis.crypto?.subtle ?? webcrypto.subtle) as SubtleCrypto
const hex = async (bytes: Uint8Array): Promise<string> =>
  [...new Uint8Array(await subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('')
const text = (value: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(value))
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])

/** A host heap: signature → bytes, answered at `<origin>/<sig>`. */
const heap = new Map<string, Uint8Array>()
const put = async (bytes: Uint8Array): Promise<string> => { const sig = await hex(bytes); heap.set(sig, bytes); return sig }
const envelope = async (resource: string, relation: string): Promise<string> => put(text({ meta: 1, resource, relation }))

const load = async () => {
  vi.resetModules()
  if (!globalThis.crypto?.subtle) vi.stubGlobal('crypto', webcrypto)
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const bytes = heap.get(String(url).split('/').pop() ?? '')
    return bytes ? new Response(bytes) : new Response('not here', { status: 404 })
  }))
  const urls: Blob[] = []
  URL.createObjectURL = vi.fn((blob: Blob) => { urls.push(blob); return `blob:${urls.length}` })
  return { ...(await import('./tile-picture')), urls }
}

afterEach(() => { heap.clear(); vi.unstubAllGlobals() })

/** A published head whose properties wear `props`, each reference through an envelope. */
const publish = async (props: Record<string, unknown>): Promise<string> => {
  const propsSig = await envelope(await put(text(props)), 'properties')
  return put(text({ name: 'creation', children: [], decorations: [], properties: [propsSig] }))
}

it('reads the picture a creation wears: head layer → properties → picture, one envelope hop each', async () => {
  const picture = await envelope(await put(PNG), 'image')
  const head = await publish({ small: { image: picture } })
  const { tilePicture, urls } = await load()
  expect(await tilePicture(head, ['https://door.example'])).toBe('blob:1')
  expect(urls[0]!.type).toBe('image/png')
})

it('prefers the chosen original over the capture', async () => {
  const original = await envelope(await put(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 9, 9])), 'image')
  const capture = await envelope(await put(PNG), 'image')
  const head = await publish({ small: { image: capture }, large: { image: original } })
  const { tilePicture, urls } = await load()
  await tilePicture(head, ['https://door.example'])
  expect(urls[0]!.type).toBe('image/jpeg')
})

it('answers null for a tile with no picture, an unknown head, or bytes that are not an image', async () => {
  const bare = await publish({ index: 3 })
  const notImage = await publish({ small: { image: await put(text({ nope: true })) } })
  const { tilePicture } = await load()
  expect(await tilePicture(bare, ['https://door.example'])).toBeNull()
  expect(await tilePicture('f'.repeat(64), ['https://door.example'])).toBeNull()
  expect(await tilePicture('not-a-signature', ['https://door.example'])).toBeNull()
  expect(await tilePicture(notImage, ['https://door.example'])).toBeNull()
})

it('keeps only bytes whose hash is the signature asked for', async () => {
  const picture = await envelope(await put(PNG), 'image')
  const head = await publish({ small: { image: picture } })
  // A door that answers the picture's address with other bytes.
  const real = heap.get(picture)!
  heap.set(picture, text({ meta: 1, resource: 'a'.repeat(64), relation: 'image' }))
  const { tilePicture } = await load()
  expect(await tilePicture(head, ['https://door.example'])).toBeNull()
  heap.set(picture, real)
})

/** A layer with children (each one envelope hop to a layer) and its own properties. */
const layerWith = async (props: Record<string, unknown>, children: string[] = []): Promise<string> => {
  const propsSig = await envelope(await put(text(props)), 'properties')
  const kids: string[] = []
  for (const child of children) kids.push(await put(text({ meta: 1, layer: child, relation: 'children' })))
  return put(text({ name: 'tile', children: kids, decorations: [], properties: [propsSig] }))
}

it('inherits the first child\'s picture when the tile has none of its own', async () => {
  const picture = await envelope(await put(PNG), 'image')
  const empty = await layerWith({ index: 1 })
  const dressed = await layerWith({ small: { image: picture } })
  const head = await layerWith({ index: 0 }, [empty, dressed])
  const { tilePicture, urls } = await load()
  expect(await tilePicture(head, ['https://door.example'])).toBe('blob:1')
  expect(urls[0]!.type).toBe('image/png')
})

it('prefers its own picture to any child\'s, and a nearer child to a deeper one', async () => {
  const own = await envelope(await put(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 9, 9])), 'image')
  const child = await envelope(await put(PNG), 'image')
  const deep = await envelope(await put(new Uint8Array([0x47, 0x49, 0x46, 0x38, 1, 1, 1, 1])), 'image')
  const withOwn = await layerWith({ small: { image: own } }, [await layerWith({ small: { image: child } })])
  const viaChild = await layerWith({}, [await layerWith({}, [await layerWith({ small: { image: deep } })]), await layerWith({ small: { image: child } })])
  const { tilePicture, urls } = await load()
  await tilePicture(withOwn, ['https://door.example'])
  expect(urls[0]!.type).toBe('image/jpeg')
  await tilePicture(viaChild, ['https://door.example'])
  expect(urls[1]!.type).toBe('image/png')   // the child one level down, not the grandchild's gif
})

it('stays null — the generated cover — when nothing below it wears a picture, and does not loop on a cycle', async () => {
  const leaf = await layerWith({ index: 2 })
  const head = await layerWith({ index: 0 }, [leaf, leaf])
  const { tilePicture } = await load()
  expect(await tilePicture(head, ['https://door.example'])).toBeNull()
})
