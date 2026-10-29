import { describe, expect, it, vi } from 'vitest'
import { EffectBus } from '@hypercomb/core'
import { cellsToPaint, comfyService } from './comfy.service.js'

const picture = {
  largeSig: 'a'.repeat(64),
  smallPointSig: null,
  smallFlatSig: null,
  previewUrl: '',
  file: { filename: 'picture.png', subfolder: '', type: 'output' as const },
  seed: 1,
  workflowId: 'klein-tile',
}

describe('a picture needs a name', () => {
  it('refuses a blank name and a reserved word before any tile is made', async () => {
    const created: string[] = []
    const spy = vi.spyOn(EffectBus, 'emitTransient').mockImplementation((effect, payload) => {
      if (effect === 'command:create-cells') created.push(String((payload as { name?: string }).name ?? ''))
    })
    try {
      expect(await comfyService.placeNamed(0, '   ')).toBe(false)
      expect(await comfyService.placeNamed(0, 'bees')).toBe(false)
      expect(created).toEqual([])
    } finally {
      spy.mockRestore()
    }
  })
})

describe('cellsToPaint', () => {
  it('paints every selected tile when the run is making pictures for the hive', () => {
    expect(cellsToPaint(true, ['lantern', 'fog'])).toEqual(['lantern', 'fog'])
  })

  it('makes new tiles when nothing is selected', () => {
    expect(cellsToPaint(true, [])).toEqual([])
    expect(cellsToPaint(true, ['', '  '])).toEqual([])
  })

  it('leaves a caller that is not making tiles alone', () => {
    expect(cellsToPaint(false, ['lantern'])).toEqual([])
  })
})

describe('a picture landing', () => {
  it('drops that tile from the selection and leaves the others', () => {
    const removed: string[] = []
    const previous = window.ioc
    window.ioc = {
      get: (key: string) => key.endsWith('SelectionService')
        ? { remove: (label: string) => { removed.push(label) } }
        : undefined,
    } as unknown as typeof window.ioc
    try {
      const landed = comfyService.attach(picture, 'lantern')
      expect(landed).toBe(true)
      expect(removed).toEqual(['lantern'])
    } finally {
      window.ioc = previous
    }
  })

  it('names the generation on the attach when the picture has one', () => {
    const previous = window.ioc
    window.ioc = { get: () => undefined } as unknown as typeof window.ioc
    const emitted: Array<Record<string, unknown>> = []
    const spy = vi.spyOn(EffectBus, 'emit').mockImplementation((effect, payload) => {
      if (effect === 'cell:attach-resource') emitted.push(payload as Record<string, unknown>)
    })
    try {
      const generationSig = 'b'.repeat(64)
      comfyService.attach({ ...picture, generationSig }, 'lantern')
      expect(emitted.at(-1)).toMatchObject({ cell: 'lantern', type: 'image', generationSig })
      comfyService.attach(picture, 'lantern')
      expect(emitted.at(-1)).not.toHaveProperty('generationSig')
    } finally {
      spy.mockRestore()
      window.ioc = previous
    }
  })
})
