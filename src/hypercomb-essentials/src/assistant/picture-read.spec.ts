// A picture a model reads is seen: its size and colours in words, and a JPEG
// a model that sees is shown. Nothing is stored.

import { describe, expect, it, vi } from 'vitest'
import { PICTURE_SIDE, pictureType, readPicture } from './picture-read.js'

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0])
const WEBP = new TextEncoder().encode('RIFF\u0000\u0000\u0000\u0000WEBPVP8 ')
const TEXT = new TextEncoder().encode('hello')

describe('a picture read', () => {
  it('knows a picture by its type, or by its first bytes when the store gave none', () => {
    expect(pictureType(TEXT, 'image/png')).toBe('image/png')
    expect(pictureType(PNG, '')).toBe('image/png')
    expect(pictureType(JPEG, 'application/octet-stream')).toBe('image/jpeg')
    expect(pictureType(WEBP, '')).toBe('image/webp')
    expect(pictureType(TEXT, 'application/octet-stream')).toBe('')
    // SVG is text, read as text.
    expect(pictureType(TEXT, 'image/svg+xml')).toBe('')
  })

  it('asks for a JPEG at most PICTURE_SIDE on its longest edge, with the reading', async () => {
    const context = vi.fn(async (_blob: Blob, _options?: { side?: number; maxBase64?: number }) => ({ reading: '1600x900, mostly teal', image: { mime: 'image/jpeg', base64: 'AAAA' }, width: 1600, height: 900 }))
    const picture = await readPicture(PNG, '', context)
    expect(context.mock.calls[0]![1]).toMatchObject({ side: PICTURE_SIDE })
    expect(picture).toEqual({ width: 1600, height: 900, reading: '1600x900, mostly teal', image: { mime: 'image/jpeg', base64: 'AAAA' } })
  })

  it('gives the words alone when no small enough JPEG could be made', async () => {
    const picture = await readPicture(PNG, '', async () => ({ reading: 'large', width: 9000, height: 9000 }))
    expect(picture).toEqual({ width: 9000, height: 9000, reading: 'large' })
  })

  it('is nothing for bytes that are not a picture, or that do not decode here', async () => {
    const context = vi.fn(async () => ({ reading: '' }))
    expect(await readPicture(TEXT, 'text/plain', context)).toBeUndefined()
    expect(context).not.toHaveBeenCalled()
    expect(await readPicture(PNG, '', async () => ({ reading: '' }))).toBeUndefined()
    expect(await readPicture(PNG, '', async () => { throw new Error('no canvas') })).toBeUndefined()
  })
})
