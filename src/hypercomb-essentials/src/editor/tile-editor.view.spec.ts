// The tile editor view: how it joins the shell, and the touch and material
// contracts its stylesheet has to keep. (The Q&A 16px / 44px assertions that
// lived in hypercomb-shared/ui/mobile-touch-contract.spec.ts moved here with
// the editor.)

import { describe, expect, it, vi } from 'vitest'

const registry = vi.hoisted(() => ({
  added: [] as unknown[],
  surfaces: [] as { name: string; component?: unknown }[],
}))
const services = vi.hoisted(() => new Map<string, unknown>())

vi.hoisted(() => {
  ;(window as unknown as { ioc: unknown }).ioc = {
    get: (key: string) => services.get(key),
    register: (key: string, value: unknown) => services.set(key, value),
    whenReady: (key: string, callback: (value: unknown) => void) => {
      if (key !== '@hypercomb.social/ShellSurfaceRegistry') return
      callback({ add: (surface: unknown) => registry.added.push(surface), all: () => registry.surfaces })
    },
  }
})

import { installTileEditorStyles, TILE_EDITOR_SURFACE } from './tile-editor.styles.js'
// The editor's bee adds the view to the shell and registers its IoC face
// (atomic-modules-plan.md); the view module itself registers nothing.
import './tile-editor.drone.js'

describe('tile editor view — joining the shell', () => {
  it('contributes a framework-free element through the shell surface registry', () => {
    expect(registry.added).toEqual([{
      name: 'hc-tile-editor',
      owner: '@diamondcoreprocessor.com/TileEditorView',
      element: 'hc-tile-editor',
      order: 220,
    }])
    // The element is defined by the first edit, not at boot
    // (tile-editor.lazy.spec.ts).
    expect(customElements.get(TILE_EDITOR_SURFACE)).toBeUndefined()
  })

  it('answers the Escape cascade through its IoC face even before it mounts', () => {
    const view = services.get('@diamondcoreprocessor.com/TileEditorView') as { dismissInner(): boolean }
    expect(view.dismissInner()).toBe(false)
  })
})

describe('tile editor view — stylesheet contracts', () => {
  installTileEditorStyles()
  const css = document.getElementById('hc-tile-editor-style')?.textContent ?? ''

  it('floors the title at 16px on touch so iOS never zooms, and actions at 44px', () => {
    const coarse = css.slice(css.indexOf('@media (pointer: coarse)'))
    expect(coarse).toMatch(/\.te-title\{font-size:max\(16px, 1em\);min-height:44px;\}/)
    expect(coarse).toMatch(/\.te-icon-btn,[^{]*\{min-width:44px;min-height:44px;\}/)
    // the narrow arrangement gives the same floors with no pointer query
    expect(css).toMatch(/\[data-layout="narrow"\] \.te-title\{font-size:max\(16px, 1em\);\}/)
    expect(css).toMatch(/\[data-layout="narrow"\] \.te-icon-btn,[^{]*\{min-width:44px;min-height:44px;\}/)
  })

  it('is one opaque desk: the page ground, no border, no shadow, no backdrop filter', () => {
    const start = css.indexOf(' .te-panel{')
    const pane = css.slice(start, css.indexOf('}', start))
    expect(pane).toContain('background:var(--md-surface,#0d151e)')
    expect(pane).not.toMatch(/\bborder\s*:/)
    expect(pane).not.toMatch(/box-shadow/)
    expect(css).not.toMatch(/backdrop-filter/)
  })

  it('is the Notes and Chat box: above the command palette, the shell rail left outside it', () => {
    const start = css.indexOf(' .te-panel{')
    const pane = css.slice(start, css.indexOf('}', start))
    expect(pane).toContain('z-index:60001')
    expect(pane).toContain('left:var(--hc-controls-left,0px)!important')
    // the docked-panel primitive writes these inline; the stylesheet wins
    expect(pane).toMatch(/right:[^;]*!important/)
    expect(pane).toContain('width:auto!important')
    expect(pane).toContain('max-width:none!important')
    expect(css).not.toContain('100002')
  })

  it('takes its identity deep under a bright look, and honours reduced motion', () => {
    expect(css).toMatch(/\[data-theme="light"\][^{]*\.te-panel\{--acc:116, 81, 39;\}/)
    expect(css).toContain('@media (prefers-reduced-motion: reduce)')
  })
})
