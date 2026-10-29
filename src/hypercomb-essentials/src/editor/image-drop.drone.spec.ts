// A picture dropped on a tile becomes the picture that tile wears. The
// overlay clears the landing hex when the drag ends, and that clear happens
// in the capture phase — before this drone can route the files. The release
// hex has to be remembered first.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const intake = vi.hoisted(() => ({
  swap: vi.fn(async () => ({ replaced: true, held: 0 })),
  announce: vi.fn(),
}))
const armed = vi.hoisted(() => ({ arm: vi.fn(async () => {}) }))

vi.mock('../sharing/tile-image-intake.js', () => ({
  swapImagesOnTile: intake.swap,
  announceSwappedImages: intake.announce,
}))
vi.mock('./arm-resource.js', () => ({ armImageBlob: armed.arm }))

const services = vi.hoisted(() => new Map<string, unknown>())
vi.hoisted(() => {
  ;(globalThis as Record<string, unknown>)['get'] = (key: string) => services.get(key)
  ;(window as unknown as { ioc: { get: (key: string) => unknown; register: (key: string, value: unknown) => void } }).ioc = {
    get: (key: string) => services.get(key),
    register: (key: string, value: unknown) => { services.set(key, value) },
  }
})

import { EffectBus } from '@hypercomb/core'
import './image-drop.drone.js'

const nowhere = { q: 0, r: 0, occupied: false, label: null, index: -1, hasImage: false, over: false }
const garden = { q: 1, r: -1, occupied: true, label: 'garden', index: 4, hasImage: true, over: true }

EffectBus.on<{ active?: boolean }>('drop:dragging', (payload) => {
  if (payload?.active === false) EffectBus.emit('drop:target', nowhere)
})

/** jsdom's File has no arrayBuffer(). The drop handler only needs type plus bytes. */
const picture = (name: string): File => {
  const bytes = new Uint8Array([1, 2, 3])
  return { name, type: 'image/png', size: bytes.byteLength, arrayBuffer: async () => bytes.buffer } as File
}

const dropFiles = (files: File[]): Event => {
  const event = new Event('drop', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'dataTransfer', {
    value: {
      types: ['Files'],
      files: Object.assign([...files], { item: (i: number) => files[i] }),
      getData: () => '',
    },
  })
  return event
}

describe('dropping a picture on a tile', () => {
  beforeEach(async () => {
    intake.swap.mockClear()
    intake.announce.mockClear()
    armed.arm.mockClear()
    intake.swap.mockResolvedValue({ replaced: true, held: 0 })
    services.set('@hypercomb.social/Lineage', { explorerSegments: () => ['page'] })
    const drone = services.get('@diamondcoreprocessor.com/ImageDropDrone') as { pulse(grammar: string): Promise<void> }
    await drone.pulse('')
    EffectBus.emit('drop:target', garden)
  })

  it('wears the dropped picture on that tile, even after the drag-end clear', async () => {
    const over = new Event('dragover', { bubbles: true, cancelable: true })
    Object.defineProperty(over, 'dataTransfer', { value: { types: ['Files'], files: [], dropEffect: 'none' } })
    document.body.dispatchEvent(over)
    document.body.dispatchEvent(dropFiles([picture('shot.png')]))
    await vi.waitFor(() => expect(intake.swap).toHaveBeenCalled())
    expect(intake.swap).toHaveBeenCalledWith(['page'], 'garden', [expect.any(Blob)])
    expect(intake.announce).toHaveBeenCalledWith('garden', { replaced: true, held: 0 })
    expect(armed.arm).not.toHaveBeenCalled()
  })

  it('passes every picture in the drop, in order', async () => {
    document.body.dispatchEvent(dropFiles([picture('one.png'), picture('two.png')]))
    await vi.waitFor(() => expect(intake.swap).toHaveBeenCalled())
    const blobs = intake.swap.mock.calls[0]?.[2] as Blob[]
    expect(blobs).toHaveLength(2)
    expect(armed.arm).not.toHaveBeenCalled()
  })

  it('arms a new tile when the drop lands on an empty hex', async () => {
    EffectBus.emit('drop:target', { ...garden, occupied: false, label: null, hasImage: false })
    document.body.dispatchEvent(dropFiles([picture('shot.png')]))
    await vi.waitFor(() => expect(armed.arm).toHaveBeenCalled())
    expect(intake.swap).not.toHaveBeenCalled()
  })
})
