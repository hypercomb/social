// hypercomb-web/src/setup/door-bar.ts
//
// THE SHELL SAYS WHOSE CODE THIS IS. A sandbox door (`try-<change>.<zone>`,
// documentation/module-sandbox.md) runs a PUBLISHER'S package with full page
// power: the bees here are theirs, not yours. So the warning is drawn by the
// SHELL, before any of that code arrives, and not by a bee or a registry-fed
// surface — at a door every module is exactly the code the warning is about.
// It is still a courtesy: code in a page can remove a node from that page.
// The real guards are the host's (a door writes nothing) and, later, a framed
// door on a dedicated domain.
//
// Plain DOM, not Angular: it must stand before bootstrap and depend on
// nothing a package could replace. It reads the door's own /site.json for the
// sandbox's name and publisher and falls back to generic words.

import { I18N_IOC_KEY, sandboxDoorOf, type I18nProvider } from '@hypercomb/core'

/** What a door's /site.json says, every field unchecked until read. */
type DoorSite = { title?: unknown; publisher?: unknown; pubkey?: unknown }

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

// Top-centre, a step under the header — the preview banner's slot. Above the
// reparented Pixi canvas (59989), below all shell chrome (controls 59999,
// header 60000); the controls bar is at the bottom edge, so this never covers
// it. Never takes a click: it is words, nothing to press.
const STYLE = `
.hc-door-bar {
  position: fixed; top: calc(var(--hc-header-anchor, 0px) + 2.27rem); left: 50%; transform: translateX(-50%);
  z-index: 59992; pointer-events: none; max-width: min(46rem, 92vw);
  display: flex; flex-direction: column; align-items: center; gap: 0.1rem;
  padding: 0.25rem 0.7rem; background: rgba(var(--hc-panel-pane), 0.86); backdrop-filter: blur(8px);
  border: 1px solid var(--hc-window-line); border-top: 2px solid var(--hc-status-warn);
  border-radius: var(--hc-radius-floating, 4px); font-size: 0.74rem; line-height: 1.3; text-align: center;
  color: var(--hc-window-ink-plain);
}
.hc-door-bar .quiet { color: var(--hc-window-ink-quiet); font-size: 0.68rem; }
@media (max-width: 599px) { .hc-door-bar { left: 0.6rem; right: 0.6rem; transform: none; max-width: none; } }
`

const say = (key: string, fallback: string, params: Record<string, string> = {}): string => {
  const i18n = (globalThis as { ioc?: { get?: (key: string) => unknown } }).ioc?.get?.(I18N_IOC_KEY) as I18nProvider | undefined
  const value = i18n?.t?.(key, params)
  return value && value !== key ? value : fallback.replace(/\{(\w+)\}/g, (_, name: string) => params[name] ?? '')
}

/** Draw the door bar when this page is a sandbox door; nothing otherwise. */
export const showDoorBar = (): void => {
  const door = sandboxDoorOf(globalThis.location?.hostname ?? '')
  if (!door || typeof document === 'undefined') return
  const style = document.createElement('style')
  style.textContent = STYLE
  const bar = document.createElement('div')
  bar.className = 'hc-door-bar'
  bar.setAttribute('role', 'note')
  bar.setAttribute('data-door-bar', '')
  const line = document.createElement('span')
  const quiet = document.createElement('span')
  quiet.className = 'quiet'
  bar.append(line, quiet)

  let name = door.label
  let publisher = ''
  const render = (): void => {
    line.textContent = say('door.bar', "Sandbox: you are trying {name} — this page runs {publisher}'s code, not your hive.", {
      name, publisher: publisher || say('door.bar.publisher', 'its publisher'),
    })
    quiet.textContent = say('door.bar.prompts', "Don't enter keys or approve signing prompts here. Read, assess and take it from your own hive.")
  }
  render()
  document.head.append(style)
  document.body.append(bar)

  // The name the publisher gave, with the key it signs with beside it — a
  // label is theirs to choose, so it never stands alone.
  void (async () => {
    try {
      const res = await fetch('/site.json', { cache: 'no-store' })
      const site = (res.ok ? await res.json() : null) as DoorSite | null
      if (text(site?.title)) name = text(site?.title)
      const key = text(site?.pubkey).slice(0, 12)
      const label = text(site?.publisher)
      publisher = label && key ? `${label} (${key}…)` : label || (key ? `${key}…` : '')
    } catch { /* the generic words stand */ }
    render()
  })()
}
