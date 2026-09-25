// hypercomb-shared/core/theme.service.spec.ts
//
// Guards the one drift the hive cannot notice on its own. An embedded website
// page writes `<html data-theme>` DIRECTLY — its pre-paint script and its
// in-page light/dark toggle both do a raw setAttribute — and the base token set
// in _material-tokens.scss is the LIGHT one (dark is the `[data-theme="dark"]`
// override). So a stamp left behind after the page unmounts paints the whole
// hive cream. reassert() is what hands the attribute back to its owner.

import { beforeEach, describe, expect, it, vi } from 'vitest'

// The service self-registers in IoC at module load via the `register` global
// that ioc.web installs in the shell. Stub it so the module can be imported
// standalone.
;(globalThis as { register?: unknown }).register = (): void => {}

type Subject = {
  theme: string
  reassert(): boolean
  setTheme(name: string): void
  registerTheme(name: string, tokens: Record<string, string>): void
}

const load = async (stored: string | null): Promise<Subject> => {
  vi.resetModules()
  localStorage.clear()
  if (stored !== null) localStorage.setItem('hc:theme', stored)
  document.documentElement.removeAttribute('data-theme')
  const mod = await import('./theme.service.js')
  return new mod.ThemeService()
}

describe('ThemeService.reassert', () => {

  beforeEach(() => {
    document.documentElement.removeAttribute('data-theme')
  })

  it('takes the attribute back after a page stamps its own theme onto it', async () => {
    const svc = await load('dark')
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')

    // a website page's pre-paint script / theme toggle
    document.documentElement.setAttribute('data-theme', 'light')

    expect(svc.reassert()).toBe(true)
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
  })

  it('reports no drift when the attribute already matches — no needless repaint', async () => {
    const svc = await load('dark')
    expect(svc.reassert()).toBe(false)
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
  })

  it('defaults to honey when the participant has never chosen', async () => {
    const svc = await load(null)
    document.documentElement.setAttribute('data-theme', 'light')
    expect(svc.reassert()).toBe(true)
    expect(document.documentElement.getAttribute('data-theme')).toBe('honey')
  })

  it("restores 'system' by REMOVING the attribute, not by writing a name", async () => {
    const svc = await load('system')
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
    expect(document.documentElement.hasAttribute('data-hc-theme-mood')).toBe(false)

    document.documentElement.setAttribute('data-theme', 'light')

    expect(svc.reassert()).toBe(true)
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
    expect(document.documentElement.hasAttribute('data-hc-theme-mood')).toBe(false)
  })

  it('keeps an explicit light choice — it re-asserts the PARTICIPANT, not dark', async () => {
    const svc = await load('light')
    document.documentElement.setAttribute('data-theme', 'dark')
    expect(svc.reassert()).toBe(true)
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
  })

  it('uses a registered theme’s declared mood for panel contrast', async () => {
    const svc = await load(null)
    svc.registerTheme('orchid', { '--md-is-light': '1' })
    svc.setTheme('orchid')
    expect(document.documentElement.getAttribute('data-hc-theme-mood')).toBe('light')

    svc.registerTheme('orchid', { '--md-is-light': '0' })
    expect(document.documentElement.getAttribute('data-hc-theme-mood')).toBe('dark')
  })

  it('repairs a missing panel mood even when the theme name still matches', async () => {
    const svc = await load(null)
    svc.registerTheme('orchid', { '--md-is-light': '1' })
    svc.setTheme('orchid')
    document.documentElement.removeAttribute('data-hc-theme-mood')

    expect(svc.reassert()).toBe(true)
    expect(document.documentElement.getAttribute('data-hc-theme-mood')).toBe('light')
  })
})
