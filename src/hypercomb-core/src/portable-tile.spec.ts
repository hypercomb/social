import { describe, expect, it, vi } from 'vitest'
import {
  PORTABLE_TILE_MIME,
  portableTileSignatureFromTypes,
  portableTileSignatureType,
  writePortableTileTransfer,
} from './portable-tile.js'

const SIG = 'a'.repeat(64)

describe('portable tile transfer', () => {
  it('exposes the signature through the dragover-readable MIME type list', () => {
    const type = portableTileSignatureType(SIG)
    expect(type).toBe(`application/x-hypercomb-tile-sig-${SIG}`)
    expect(portableTileSignatureFromTypes(['text/plain', type!])).toBe(SIG)
  })

  it('writes a rich payload and a plain signature fallback', () => {
    const setData = vi.fn()
    expect(writePortableTileTransfer({ setData }, { name: 'tile', path: '/tile', sig: SIG })).toBe(true)
    expect(setData).toHaveBeenCalledWith(PORTABLE_TILE_MIME, expect.stringContaining(`"sig":"${SIG}"`))
    expect(setData).toHaveBeenCalledWith('text/plain', SIG)
  })

  it('refuses values that are not signatures', () => {
    expect(portableTileSignatureType('/local/path')).toBeNull()
    expect(portableTileSignatureFromTypes(['application/x-hypercomb-tile-sig-nope'])).toBeNull()
  })
})

