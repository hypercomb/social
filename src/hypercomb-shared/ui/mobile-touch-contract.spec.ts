// Mobile usability ratchet for the standalone surfaces that do not inherit
// the docked toolwindow's phone contract. These are source assertions on
// purpose: component SCSS is compiled behind Angular's scoped attributes, so
// jsdom cannot truthfully report the resulting media-query geometry.

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const read = (...parts: string[]): string => readFileSync(join(here, ...parts), 'utf8')

const devIndex = read('..', '..', 'hypercomb-dev', 'src', 'index.html')
const webIndex = read('..', '..', 'hypercomb-web', 'src', 'index.html')
const tileEditor = read('tile-editor', 'tile-editor.component.scss')
const contactForm = read('contact-card', 'contact-form.component.scss')
const iconPicker = read('icon-picker', 'icon-picker.component.scss')
const docsOverlay = read('docs-overlay', 'docs-overlay.component.scss')
const headerBar = read('_header-bar.scss')
const controlsBar = read('controls-bar', 'controls-bar.component.ts')
const tiles = (...parts: string[]): string => read('..', '..', 'hypercomb-essentials', 'src', 'presentation', 'tiles', ...parts)
const layerDeck = tiles('layer-deck.drone.ts')
const postitView = tiles('postit-view.drone.ts')
const publicationsView = tiles('publications-view.drone.ts')
const squareTileView = tiles('square-tile-view.drone.ts')
const slidesView = tiles('slides-view.drone.ts')

const phoneBlock = (source: string): string => {
  const marker = '@media (max-width: 599px), (max-height: 449px)'
  const at = source.lastIndexOf(marker)
  expect(at).toBeGreaterThanOrEqual(0)
  return source.slice(at)
}

describe('mobile touch contracts', () => {
  it('keeps both app shells zoomable while preserving safe-area and keyboard behavior', () => {
    for (const shell of [devIndex, webIndex]) {
      const viewport = shell.match(/<meta\s+name="viewport"\s+content="([^"]+)"/)?.[1] ?? ''
      expect(viewport).toContain('width=device-width')
      expect(viewport).toContain('viewport-fit=cover')
      expect(viewport).toContain('interactive-widget=resizes-content')
      expect(viewport).not.toMatch(/(?:maximum-scale\s*=\s*1|user-scalable\s*=\s*no)/i)
      expect(shell).toContain('browser zoom remains user-controlled')
    }
  })

  it('keeps the late-authored Q&A editor at 16px and its submit action thumb-sized', () => {
    expect(tileEditor).toMatch(/@include phone\s*\{[\s\S]*\.qa-answer-input\s*\{\s*font-size:\s*16px;/)
    expect(tileEditor).toMatch(/\.qa-submit\s*\{\s*min-width:\s*44px;\s*min-height:\s*44px;/)
  })

  it('stacks contact fields and floors fields and actions in the either-axis phone block', () => {
    const mobile = phoneBlock(contactForm)
    expect(mobile).toMatch(/\.contact-row\s*\{\s*flex-direction:\s*column;/)
    expect(mobile).toMatch(/input,\s*\n\s*textarea\s*\{[\s\S]*font-size:\s*16px;/)
    expect(mobile).toMatch(/\.contact-form-header\s*>\s*\.contact-form-close,\s*\n\s*\.contact-btn\s*\{\s*min-width:\s*44px;\s*min-height:\s*44px;/)
    expect(mobile).toContain('env(safe-area-inset-left, 0px)')
    expect(mobile).toContain('env(safe-area-inset-right, 0px)')
  })

  it('floors icon search, close, clear, and picker cells in the either-axis phone block', () => {
    const mobile = phoneBlock(iconPicker)
    expect(mobile).toMatch(/\.ip-search\s*\{\s*font-size:\s*16px;/)
    expect(mobile).toMatch(/\.ip-close,\s*\n\s*\.ip-search-clear\s*\{[\s\S]*min-width:\s*44px;[\s\S]*min-height:\s*44px;/)
    expect(mobile).toMatch(/\.ip-hex\s*\{\s*width:\s*3rem;\s*height:\s*3\.25rem;/)
    expect(mobile).toContain('env(safe-area-inset-left, 0px)')
    expect(mobile).toContain('env(safe-area-inset-right, 0px)')
  })

  it('exposes pin/unpin from the phone layer deck through the single persisted-state owner', () => {
    expect(layerDeck).toMatch(/action:\s*'pin'[\s\S]*EffectBus\.emitTransient\('viewport:pin-toggle'/)
    expect(controlsBar).toMatch(/EffectBus\.on\('viewport:pin-toggle',\s*\(\)\s*=>\s*this\.togglePin\(\)\)/)
    expect(layerDeck).toContain('const LANES_DEFAULT = 2')
    expect(controlsBar).toContain('readonly laneCount = signal(2)')
  })

  it('keeps view exits thumb-sized and square captions readable on phones', () => {
    expect(postitView).toMatch(/\.postit-close\{[^}]*width:2\.75rem;height:2\.75rem/)
    expect(publicationsView).toMatch(/\.pv-close\{[^}]*width:2\.75rem;height:2\.75rem/)
    expect(squareTileView).toMatch(/\.wv-close\{[^}]*width:2\.75rem;height:2\.75rem/)
    expect(postitView).toContain('@media(hover:none),(pointer:coarse){.postit-close{opacity:1}}')
    expect(publicationsView).toContain('@media(hover:none),(pointer:coarse){.pv-close{opacity:1}}')
    expect(squareTileView).toContain('@media(hover:none),(pointer:coarse){.wv-close{opacity:1}}')
    expect(squareTileView).toMatch(/@media\(max-width:560px\)[\s\S]*\.wv-caption\{font-size:\.85rem;/)
    expect(squareTileView).toMatch(/\.wv-fold\{width:2\.75rem;height:2\.75rem;/)
  })

  it('gives each slides pager dot a 44px hit box without enlarging its visual mark', () => {
    expect(slidesView).toMatch(/pointer-events:none;padding:/)
    expect(slidesView).toMatch(/flex:0 0 44px;width:44px;height:44px;/)
    expect(slidesView).toMatch(/background:transparent;pointer-events:auto;/)
    expect(slidesView).toMatch(/display:block;width:9px;height:9px;border-radius:50%/)
    expect(slidesView).toContain("dot.setAttribute('aria-label', `Go to slide ${i + 1} of ${n}`)")
  })

  it('covers narrow and short docs layouts with 16px fields and 44px actions', () => {
    const marker = '@media (max-width: 600px), (max-height: 449px)'
    const at = docsOverlay.lastIndexOf(marker)
    expect(at).toBeGreaterThanOrEqual(0)
    const mobile = docsOverlay.slice(at)
    expect(docsOverlay).toMatch(/\.sidebar-filter input\s*\{\s*min-height:\s*44px;\s*font-size:\s*16px;/)
    expect(docsOverlay).toMatch(/\.sidebar-toggle,[\s\S]*\.close-btn\s*\{[\s\S]*min-width:\s*44px;[\s\S]*min-height:\s*44px;/)
    expect(docsOverlay).toMatch(/\.back-btn,[\s\S]*\.nav-item\s*\{\s*min-height:\s*44px;/)
    expect(mobile).toContain('env(safe-area-inset-top, 0px)')
    expect(mobile).toContain('env(safe-area-inset-right, 0px)')
    expect(mobile).toContain('env(safe-area-inset-bottom, 0px)')
    expect(mobile).toContain('env(safe-area-inset-left, 0px)')
  })

  it('reserves the portrait safe top once on the measured outer header', () => {
    expect(headerBar).toMatch(/@media \(max-width: \$bp-phone-max\) and \(orientation: portrait\)[\s\S]*?\.header-bar\s*\{[\s\S]*?padding-top:\s*var\(--hc-safe-top/)
    expect(headerBar.match(/padding-top:\s*var\(--hc-safe-top/g)).toHaveLength(1)
    expect(headerBar).toMatch(/@media \(max-height: 449px\) and \(orientation: landscape\)[\s\S]*?\.header-bar\.input-open\s*\{[\s\S]*?padding-left:\s*env\(safe-area-inset-left/)
  })
})
