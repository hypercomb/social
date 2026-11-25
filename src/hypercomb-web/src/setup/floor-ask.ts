// hypercomb-web/src/setup/floor-ask.ts
//
// THE FLOOR ASKS (codex T4: never push updates; the participant takes one).
// A package below the floor cannot draw its own update offer — that is the
// whole reason the floor exists — so the SHELL asks, in plain DOM that depends
// on nothing a package could replace (the door bar's pattern, door-bar.ts).
//
// The answer is the participant's alone. Yes takes the current version and
// reloads onto it; Not now leaves everything as it is for this page, and the
// next boot asks again. Nothing is written for a decline.

import { I18N_IOC_KEY, type I18nProvider } from '@hypercomb/core'

/** Why the floor found the package below it (package-floor.ts). */
export type FloorReason = 'door' | 'membership' | 'meeting point'

// Top-centre, a step under the header — the door bar's slot. Above the Pixi
// canvas (59989), below the shell chrome (controls 59999, header 60000).
const STYLE = `
.hc-floor-ask {
  position: fixed; top: calc(var(--hc-header-anchor, 0px) + 2.27rem); left: 50%; transform: translateX(-50%);
  z-index: 59992; max-width: min(34rem, 92vw);
  display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 0.35rem 0.7rem;
  padding: 0.4rem 0.75rem; background: rgba(var(--hc-panel-pane), 0.92); backdrop-filter: blur(8px);
  border: 1px solid var(--hc-window-line); border-top: 2px solid var(--hc-status-warn);
  border-radius: var(--hc-radius-floating, 4px); font-size: 0.78rem; line-height: 1.35; text-align: center;
  color: var(--hc-window-ink-plain);
}
.hc-floor-ask .actions { display: flex; gap: 0.4rem; }
.hc-floor-ask button {
  font: inherit; padding: 0.15rem 0.6rem; border-radius: var(--hc-radius-floating, 4px); cursor: pointer;
  border: 1px solid var(--hc-window-line); background: transparent; color: var(--hc-window-ink-plain);
}
.hc-floor-ask button[data-take] { border-color: var(--hc-status-warn); }
@media (max-width: 599px) { .hc-floor-ask { left: 0.6rem; right: 0.6rem; transform: none; max-width: none; } }
`

const say = (key: string, fallback: string): string => {
  const i18n = (globalThis as { ioc?: { get?: (key: string) => unknown } }).ioc?.get?.(I18N_IOC_KEY) as I18nProvider | undefined
  const value = i18n?.t?.(key)
  return value && value !== key ? value : fallback
}

/** Ask whether to take the current version. Resolves true only on the
 *  participant's yes; false on Not now, or when there is no page to ask on. */
export const askFloorUpdate = (reason: FloorReason): Promise<boolean> => new Promise(resolve => {
  if (typeof document === 'undefined' || !document.body) { resolve(false); return }
  const style = document.createElement('style')
  style.textContent = STYLE
  const bar = document.createElement('div')
  bar.className = 'hc-floor-ask'
  bar.setAttribute('role', 'dialog')
  bar.setAttribute('aria-modal', 'false')
  bar.setAttribute('data-floor-ask', '')
  const line = document.createElement('span')
  line.id = 'hc-floor-ask-line'
  bar.setAttribute('aria-labelledby', line.id)
  line.textContent = reason === 'door'
    ? say('floor.ask.door', 'This version of Hypercomb is too old to update itself. Take the current version? The page reloads onto it.')
    : say('floor.ask.meeting', 'This version of Hypercomb is too old to meet updated devices. Take the current version? The page reloads onto it.')
  const actions = document.createElement('span')
  actions.className = 'actions'
  const answer = (take: boolean): void => {
    bar.remove()
    style.remove()
    resolve(take)
  }
  const take = document.createElement('button')
  take.type = 'button'
  take.setAttribute('data-take', '')
  take.textContent = say('floor.ask.take', 'Update')
  take.addEventListener('click', () => answer(true))
  const later = document.createElement('button')
  later.type = 'button'
  later.setAttribute('data-later', '')
  later.textContent = say('floor.ask.later', 'Not now')
  later.addEventListener('click', () => answer(false))
  actions.append(take, later)
  bar.append(line, actions)
  document.head.append(style)
  document.body.append(bar)
})
