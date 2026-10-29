// Ctrl+V: a selected tile wears the clipboard picture. Otherwise the
// picture is held on the tile under the pointer.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const intake = vi.hoisted(() => ({
  hold: vi.fn(async () => ({ added: 1, total: 1 })),
  announce: vi.fn(),
  replace: vi.fn(async () => true),
  announceReplaced: vi.fn(),
}))

vi.mock('../sharing/tile-image-intake.js', () => ({
  holdImagesOnTile: intake.hold,
  announceHeldImages: intake.announce,
  replaceWornPicture: intake.replace,
  announceReplacedPicture: intake.announceReplaced,
}))

const services = vi.hoisted(() => new Map<string, unknown>())
vi.hoisted(() => {
  ;(globalThis as Record<string, unknown>)['get'] = (key: string) => services.get(key)
  ;(window as unknown as { ioc: { get: (key: string) => unknown; register: () => void } }).ioc = {
    get: (key: string) => services.get(key),
    register: () => {},
  }
})

import { EffectBus } from '@hypercomb/core'
import './image-paste.worker.js'

const pasteImage = (): Event => {
  const file = new File([new Uint8Array([1, 2, 3])], 'shot.png', { type: 'image/png' })
  const event = new Event('paste', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'clipboardData', {
    value: { items: [{ type: 'image/png', getAsFile: () => file }] },
  })
  return event
}

describe('Ctrl+V over a tile', () => {
  beforeEach(() => {
    intake.hold.mockClear()
    intake.announce.mockClear()
    intake.replace.mockClear()
    intake.announceReplaced.mockClear()
    intake.replace.mockResolvedValue(true)
    services.set('@hypercomb.social/Lineage', { explorerSegments: () => ['page'] })
    services.delete('@diamondcoreprocessor.com/SelectionService')
    EffectBus.emit('tile:hover', { label: null })
  })

  it('replaces the picture on the one selected tile, even if the pointer rests elsewhere', async () => {
    services.set('@diamondcoreprocessor.com/SelectionService', { count: 1, active: 'garden' })
    EffectBus.emit('tile:hover', { label: 'meadow' })
    document.body.dispatchEvent(pasteImage())
    await vi.waitFor(() => expect(intake.replace).toHaveBeenCalled())
    expect(intake.replace).toHaveBeenCalledWith(['page'], 'garden', expect.any(Blob))
    expect(intake.announceReplaced).toHaveBeenCalledWith('garden', true)
    expect(intake.hold).not.toHaveBeenCalled()
  })

  it('holds the clipboard picture on the tile under the pointer when nothing is selected', async () => {
    EffectBus.emit('tile:hover', { label: 'garden' })
    document.body.dispatchEvent(pasteImage())
    await vi.waitFor(() => expect(intake.hold).toHaveBeenCalled())
    expect(intake.hold).toHaveBeenCalledWith(['page'], 'garden', [expect.any(Blob)])
    expect(intake.announce).toHaveBeenCalledWith('garden', 1)
    expect(intake.replace).not.toHaveBeenCalled()
  })

  it('holds on the tile under the pointer when more than one tile is selected', async () => {
    services.set('@diamondcoreprocessor.com/SelectionService', { count: 2, active: 'garden' })
    EffectBus.emit('tile:hover', { label: 'meadow' })
    document.body.dispatchEvent(pasteImage())
    await vi.waitFor(() => expect(intake.hold).toHaveBeenCalled())
    expect(intake.hold).toHaveBeenCalledWith(['page'], 'meadow', [expect.any(Blob)])
    expect(intake.replace).not.toHaveBeenCalled()
  })

  it('does not hold a picture when the pointer is not on a tile', () => {
    document.body.dispatchEvent(pasteImage())
    expect(intake.hold).not.toHaveBeenCalled()
  })

  it('leaves a paste in a text field alone', () => {
    EffectBus.emit('tile:hover', { label: 'garden' })
    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()
    input.dispatchEvent(pasteImage())
    expect(intake.hold).not.toHaveBeenCalled()
    input.remove()
  })
})
