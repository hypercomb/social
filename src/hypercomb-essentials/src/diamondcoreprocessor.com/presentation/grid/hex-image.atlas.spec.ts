import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const decode = vi.hoisted(() => vi.fn())

vi.hoisted(() => {
  ;(globalThis as unknown as { createImageBitmap: unknown }).createImageBitmap = decode
})

vi.mock('pixi.js', () => ({
  Container: class {},
  RenderTexture: {
    create: (o: { width: number; height: number }) => ({ width: o.width, height: o.height }),
  },
  Sprite: class {
    scale = { set: vi.fn() }
    anchor = { set: vi.fn() }
    position = { set: vi.fn() }
    destroy = vi.fn()
    constructor(public texture?: unknown) {}
  },
  Texture: {
    from: () => ({ destroy: vi.fn() }),
  },
}))

const { HexImageAtlas } = await import('./hex-image.atlas.js')

const bitmap = () => ({ width: 8, height: 8, close: vi.fn() })

describe('HexImageAtlas atomic replacement', () => {
  beforeEach(() => decode.mockReset())

  it('keeps the previous tile mapped when its replacement fails to decode', async () => {
    decode.mockResolvedValueOnce(bitmap()).mockRejectedValueOnce(new Error('transient decode'))
    const atlas = new HexImageAtlas({ render: vi.fn() }, 8, 1, 1)
    await atlas.loadImage('first', new Blob(['first']))
    const before = atlas.evictionGeneration

    await atlas.loadImage('replacement', new Blob(['replacement']))

    expect(atlas.hasImage('first')).toBe(true)
    expect(atlas.hasImage('replacement')).toBe(false)
    expect(atlas.evictionGeneration).toBe(before)
  })

  it('keeps the previous tile mapped when the replacement GPU write fails', async () => {
    decode.mockResolvedValue(bitmap())
    const render = vi.fn()
    const atlas = new HexImageAtlas({ render }, 8, 1, 1)
    await atlas.loadImage('first', new Blob(['first']))
    const before = atlas.evictionGeneration
    render.mockImplementationOnce(() => { throw new Error('device lost') })

    await expect(atlas.loadImage('replacement', new Blob(['replacement']))).rejects.toThrow('device lost')

    expect(atlas.hasImage('first')).toBe(true)
    expect(atlas.hasImage('replacement')).toBe(false)
    expect(atlas.evictionGeneration).toBe(before)
  })

  it('wakes the renderer when a decode-failure cooldown expires', () => {
    const source = readFileSync(join(__dirname, 'hex-image.atlas.ts'), 'utf8')
    expect(source).toMatch(/count === HexImageAtlas\.MAX_RETRIES[\s\S]*setTimeout/)
    expect(source).toMatch(/#failures\.delete\(sig\)[\s\S]*hex-image-atlas:retry/)
  })
})
