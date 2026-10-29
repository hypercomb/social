// A Comfy picture dropped on a tile lands on THAT tile. Ending the drag tells
// the overlay the pointer has left, and the overlay answers with a nowhere
// target before the drop handler can read it. The hex is remembered first.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const services = vi.hoisted(() => new Map<string, unknown>())
vi.hoisted(() => {
  ;(globalThis as Record<string, unknown>)['get'] = (key: string) => services.get(key)
  ;(window as unknown as { ioc: { get: (key: string) => unknown; register: (key: string, value: unknown) => void } }).ioc = {
    get: (key: string) => services.get(key),
    register: (key: string, value: unknown) => { services.set(key, value) },
  }
})

import { EffectBus } from '@hypercomb/core'
import { comfyService } from './comfy.service.js'
import './comfy.drone.js'

const RESULT = 'application/x-hc-comfy-result'
const picture = {
  largeSig: 'a'.repeat(64),
  smallPointSig: null,
  smallFlatSig: null,
  previewUrl: '',
  file: { filename: 'picture.png', subfolder: '', type: 'output' as const },
  seed: 1,
  workflowId: 'klein-tile',
}
const nowhere = { occupied: false, label: null, over: false }

EffectBus.on<{ active?: boolean }>('drop:dragging', (payload) => {
  if (payload?.active === false) EffectBus.emit('drop:target', nowhere)
})

const dropResult = (): Event => {
  const event = new Event('drop', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'dataTransfer', {
    value: { types: [RESULT], getData: (type: string) => type === RESULT ? '0' : '', files: [] },
  })
  return event
}

describe('a Comfy picture dropped on the hive', () => {
  beforeEach(() => {
    vi.spyOn(comfyService, 'results', 'get').mockReturnValue([picture] as never)
    vi.spyOn(comfyService, 'attach').mockReturnValue(true)
  })

  it('wears the picture on the tile under the pointer, even after the drag-end clear', () => {
    EffectBus.emit('drop:target', { occupied: true, label: 'garden', over: true })
    document.body.dispatchEvent(dropResult())
    expect(comfyService.attach).toHaveBeenCalledWith(picture, 'garden')
  })

  it('does not pick a tile the pointer has left', () => {
    EffectBus.emit('drop:target', { occupied: true, label: 'garden', over: false })
    document.body.dispatchEvent(dropResult())
    expect(comfyService.attach).toHaveBeenCalledWith(picture, undefined)
  })

  it('leaves an empty hex to the selection, the same as a click', () => {
    EffectBus.emit('drop:target', { occupied: false, label: null, over: true })
    document.body.dispatchEvent(dropResult())
    expect(comfyService.attach).toHaveBeenCalledWith(picture, undefined)
  })
})
