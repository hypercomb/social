// The faces the package carries stay in step with the shells' canonical
// fonts (scripts/fetch-fonts.cjs). The build signs the files; no signature
// lives in source (doctrine: no hardcoded 64-hex signatures).
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PACKAGE_FONTS } from './package-fonts'
// @ts-expect-error — a plain ESM script, no declarations
import { readPackageFonts, FONTS_DIR } from '../../../scripts/package-fonts.mjs'

describe('package fonts', () => {
  it('matches the faces the generator reads from the canonical fonts.css', () => {
    expect(PACKAGE_FONTS).toEqual(readPackageFonts())
  })

  it('names only files the canonical fonts directory holds', () => {
    for (const font of PACKAGE_FONTS) expect(existsSync(resolve(FONTS_DIR, font.file)), font.file).toBe(true)
  })

  it('carries only what the minimal host does not ship', () => {
    for (const font of PACKAGE_FONTS) {
      expect(font.family === 'Material Symbols Outlined' || (font.family === 'Source Serif 4' && font.style === 'italic')).toBe(true)
    }
  })
})
