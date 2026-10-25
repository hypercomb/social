// sharing/qr-code.spec.ts — the encoder, held to a reference encoder module for module.
//
// qr-code.reference.json is the output of the Python `qrcode` package (byte mode, level L): for thirteen
// texts spanning versions 1 to 10, the grid under EVERY one of the eight masks, packed as hex. Our grid,
// forced to each mask, must equal it exactly; the mask we choose by ISO 18004 penalty is then one of those
// proven grids. (The reference scores masks by an older rule, so which mask it would choose can differ
// from ours; every mask is a valid code, and each one is proven here.)

import { describe, expect, it } from 'vitest'
import { QR_MAX_BYTES, qrMatrix, qrSvg } from './qr-code.js'
import reference from './qr-code.reference.json'

type Case = { text: string; version: number; masks: Record<string, string> }
const cases = reference as unknown as Case[]
const size = (version: number): number => 17 + 4 * version
const unpack = (hex: string, version: number): string => BigInt('0x' + hex).toString(2).padStart(size(version) ** 2, '0')
const flat = (modules: boolean[][]): string => modules.map(row => row.map(on => (on ? '1' : '0')).join('')).join('')

describe('qrMatrix — equal to the reference encoder', () => {
  it('has reference cases for versions 1 to 10', () => {
    expect([...new Set(cases.map(item => item.version))].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  })

  for (const item of cases) {
    it(`v${item.version}, all eight masks — ${item.text.slice(0, 24)}…`, () => {
      for (let mask = 0; mask < 8; mask++) {
        const ours = qrMatrix(item.text, mask)!
        expect(ours.version).toBe(item.version)
        expect(flat(ours.modules) === unpack(item.masks[String(mask)]!, item.version), `mask ${mask}`).toBe(true)
      }
    })

    it(`v${item.version}, chosen mask is one of the proven grids — ${item.text.slice(0, 24)}…`, () => {
      const chosen = qrMatrix(item.text)!
      expect(flat(chosen.modules)).toBe(unpack(item.masks[String(chosen.mask)]!, item.version))
    })
  }

  it('refuses what does not fit, and draws an invite-sized link as one SVG path', () => {
    expect(qrMatrix('a'.repeat(QR_MAX_BYTES + 1))).toBeNull()
    expect(qrMatrix('a'.repeat(QR_MAX_BYTES))).not.toBeNull()
    const svg = qrSvg('https://example.com/#invite=example.com/' + 'a'.repeat(64) + '/' + 'b'.repeat(64))!
    expect(svg.startsWith('<svg')).toBe(true)
    expect(svg.match(/<path/g)).toHaveLength(1)
  })
})
