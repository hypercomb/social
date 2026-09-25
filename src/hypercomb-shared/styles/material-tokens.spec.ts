import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const SOURCE = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '_material-tokens.scss'),
  'utf8',
)
const STATIC_CHROME = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'scripts', 'bridge', '_chrome-bytes.cjs'),
  'utf8',
)
const PANEL_IDENTITY = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'ui', '_panel-identity.scss'),
  'utf8',
)

type Rgb = readonly [number, number, number]
type Rgba = readonly [number, number, number, number]

const blockFrom = (source: string, marker: string): string => {
  const markerAt = source.indexOf(marker)
  expect(markerAt, `theme block ${marker}`).toBeGreaterThanOrEqual(0)
  const openAt = source.indexOf('{', markerAt)
  expect(openAt, `opening brace for ${marker}`).toBeGreaterThanOrEqual(0)

  let depth = 0
  for (let at = openAt; at < source.length; at += 1) {
    if (source[at] === '{') depth += 1
    if (source[at] !== '}') continue
    depth -= 1
    if (depth === 0) return source.slice(openAt + 1, at)
  }
  throw new Error(`unterminated theme block ${marker}`)
}

const themeBlock = (marker: string): string => blockFrom(SOURCE, marker)

const hex = (block: string, token: string): Rgb => {
  const match = new RegExp(`--${token}:\\s*#([0-9a-f]{6})`, 'i').exec(block)
  if (!match) throw new Error(`missing hex token --${token}`)
  return [
    Number.parseInt(match[1].slice(0, 2), 16),
    Number.parseInt(match[1].slice(2, 4), 16),
    Number.parseInt(match[1].slice(4, 6), 16),
  ]
}

const LIGHT_BLOCK = themeBlock(':root')

const inheritedValue = (block: string, token: string): string => {
  const pattern = new RegExp(`--${token}:\\s*([^;]+);`, 'i')
  const match = pattern.exec(block) ?? pattern.exec(LIGHT_BLOCK)
  if (!match) throw new Error(`missing token --${token}`)
  return match[1].trim()
}

const declarations = (block: string): Record<string, string> =>
  Object.fromEntries(
    [...block.matchAll(/(--[\w-]+):\s*([^;]+);/g)]
      .map(match => [match[1]!, match[2]!.trim()]),
  )

const inheritedHex = (block: string, token: string): Rgb => {
  const match = /^#([0-9a-f]{6})$/i.exec(inheritedValue(block, token))
  if (!match) throw new Error(`--${token} is not a six-digit hex color`)
  return [
    Number.parseInt(match[1].slice(0, 2), 16),
    Number.parseInt(match[1].slice(2, 4), 16),
    Number.parseInt(match[1].slice(4, 6), 16),
  ]
}

const triple = (block: string, token: string): Rgb => {
  const match = /^(\d+)\s*,\s*(\d+)\s*,\s*(\d+)$/.exec(inheritedValue(block, token))
  if (!match) throw new Error(`--${token} is not an RGB triple`)
  return [+match[1], +match[2], +match[3]]
}

const scalar = (block: string, token: string): number => {
  const value = Number.parseFloat(inheritedValue(block, token))
  if (!Number.isFinite(value)) throw new Error(`--${token} is not numeric`)
  return value
}

const channel = (value: number): number => {
  const srgb = value / 255
  return srgb <= 0.04045
    ? srgb / 12.92
    : ((srgb + 0.055) / 1.055) ** 2.4
}

const luminance = ([red, green, blue]: Rgb): number =>
  0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue)

const contrast = (first: Rgb, second: Rgb): number => {
  const light = Math.max(luminance(first), luminance(second))
  const dark = Math.min(luminance(first), luminance(second))
  return (light + 0.05) / (dark + 0.05)
}

const over = ([red, green, blue, alpha]: Rgba, ground: Rgb): Rgb => [
  red * alpha + ground[0] * (1 - alpha),
  green * alpha + ground[1] * (1 - alpha),
  blue * alpha + ground[2] * (1 - alpha),
]

const THEMES = {
  light: LIGHT_BLOCK,
  dark: themeBlock('@mixin md-dark-tokens'),
  honey: themeBlock('@mixin md-honey-tokens'),
  bloom: themeBlock('@mixin md-bloom-tokens'),
  sherbet: themeBlock('@mixin md-sherbet-tokens'),
}

const SURFACES = [
  'md-surface',
  'md-surface-dim',
  'md-surface-bright',
  'md-surface-c-lowest',
  'md-surface-c-low',
  'md-surface-c',
  'md-surface-c-high',
  'md-surface-c-highest',
] as const

const READABLE_INKS = [
  'md-on-surface',
  'md-on-surface-strong',
  'md-on-surface-var',
  'md-on-surface-faint',
  // These accents are used directly for labels, links and glyphs throughout
  // the shell, so their surface pairing is part of the text contract too.
  'md-primary',
  'md-secondary',
  'md-tertiary',
] as const

const STATUS_INKS = [
  'hc-status-ok',
  'hc-status-warn',
  'hc-status-alert',
  'hc-status-info',
  'hc-status-branch',
  'hc-status-secret',
  'hc-status-solo',
  'hc-status-swarm',
] as const

const CONTAINER_PAIRS = [
  ['md-on-primary', 'md-primary'],
  ['md-on-primary-c', 'md-primary-container'],
  ['md-on-secondary', 'md-secondary'],
  ['md-on-secondary-c', 'md-secondary-c'],
] as const

const STATIC_COLOR_TOKENS = [
  ...SURFACES,
  ...READABLE_INKS,
  'md-on-primary',
  'md-primary-container',
  'md-on-primary-c',
  'md-on-secondary',
  'md-secondary-c',
  'md-on-secondary-c',
  'md-tertiary-c',
] as const

describe('material theme contrast', () => {
  for (const [theme, block] of Object.entries(THEMES)) {
    it(`${theme} keeps every readable role at WCAG AA across its surface ladder`, () => {
      const failures: string[] = []
      for (const inkName of [...READABLE_INKS, ...STATUS_INKS]) {
        const ink = inkName.startsWith('hc-')
          ? inheritedHex(block, inkName)
          : hex(block, inkName)
        for (const surfaceName of SURFACES) {
          const ratio = contrast(ink, hex(block, surfaceName))
          if (ratio < 4.5) failures.push(
            `${theme}: --${inkName} on --${surfaceName} is ${ratio.toFixed(2)}:1`,
          )
        }
      }
      expect(failures, failures.join('\n')).toEqual([])
    })

    it(`${theme} keeps text readable on filled accent controls`, () => {
      for (const [inkName, groundName] of CONTAINER_PAIRS) {
        const ratio = contrast(hex(block, inkName), hex(block, groundName))
        expect(
          ratio,
          `${theme}: --${inkName} on --${groundName} is ${ratio.toFixed(2)}:1`,
        ).toBeGreaterThanOrEqual(4.5)
      }
    })

    it(`${theme} keeps the faint panel and chrome text weights readable`, () => {
      const faintAlpha = scalar(block, 'hc-ink-a-faint')
      const panelPane = triple(block, 'hc-panel-pane')
      const panelInk = triple(block, 'hc-panel-ink')
      const chromeGlass = triple(block, 'hc-chrome-glass')
      const chromeGlassAlpha = scalar(block, 'hc-chrome-glass-a')
      const chromeInk = triple(block, 'hc-chrome-ink')

      for (const surfaceName of SURFACES) {
        const surface = hex(block, surfaceName)
        const panelGround = over([...panelPane, 0.98], surface)
        const panelText = over([...panelInk, faintAlpha], panelGround)
        const panelRatio = contrast(panelText, panelGround)
        expect(
          panelRatio,
          `${theme}: faint panel ink on --${surfaceName} is ${panelRatio.toFixed(2)}:1`,
        ).toBeGreaterThanOrEqual(4.5)

        const chromeGround = over([...chromeGlass, chromeGlassAlpha], surface)
        const chromeText = over([...chromeInk, faintAlpha], chromeGround)
        const chromeRatio = contrast(chromeText, chromeGround)
        expect(
          chromeRatio,
          `${theme}: faint chrome ink on --${surfaceName} is ${chromeRatio.toFixed(2)}:1`,
        ).toBeGreaterThanOrEqual(4.5)
      }
    })
  }

  it('keeps standalone page colors synchronized with the shell palette', () => {
    const standaloneLight = blockFrom(STATIC_CHROME, ':root')
    const standaloneDark = blockFrom(STATIC_CHROME, '[data-theme="dark"]')

    for (const token of STATIC_COLOR_TOKENS) {
      expect(hex(standaloneLight, token), `standalone light --${token}`).toEqual(hex(THEMES.light, token))
      expect(hex(standaloneDark, token), `standalone dark --${token}`).toEqual(hex(THEMES.dark, token))
    }
  })

  it('keeps standalone system-dark tokens synchronized with explicit dark', () => {
    const explicitDark = blockFrom(STATIC_CHROME, '[data-theme="dark"]')
    const darkMedia = blockFrom(STATIC_CHROME, '@media (prefers-color-scheme: dark)')
    const systemDark = blockFrom(darkMedia, ':root:not([data-theme])')

    expect(declarations(systemDark)).toEqual(declarations(explicitDark))
  })

  it('deepens panel identities for the attribute-less system-light theme', () => {
    const systemLight = blockFrom(PANEL_IDENTITY, '@media (prefers-color-scheme: light)')
    expect(systemLight).toContain(':root:not([data-theme])')
    expect(systemLight).toContain(':host-context(:root:not([data-theme]))')
    expect(systemLight.match(/--acc:\s*#\{\$deep\}/g)).toHaveLength(2)
  })
})
