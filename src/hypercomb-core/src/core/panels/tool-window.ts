// hypercomb-core/src/core/panels/tool-window.ts
//
// THE TOOL WINDOW'S BASE LAYER, framework-free — what every window is before
// it is any particular window (documentation/tool-window-chrome.md):
//
//   the shell     the material, the edge, the shadow, the phone sheet
//   the header    identity (title) → the window's own controls → the gear
//                 (injected by DockedPanel) → the close button, LAST
//   the body      the scrolling region a window fills with its own slice
//   the session   park / unpark / dismiss / close, so Escape reaches it
//                 through the one policy (tool-windows.ts), never a listener
//                 of its own
//   the place     docked (lane, width, grip, gear, reserved edge: DockedPanel)
//                 or floating (placed by the window itself)
//
// The Angular windows get the same thing from `_toolwindow.scss` and the
// `hcDockedPanel` / `hcDockInset` directives. A framework-free window — a
// behaviour loaded from the hive, which cannot `@use` a stylesheet — used to
// restate it by hand, with dark literals that stayed dark in the light theme,
// and its own Escape listener. It mounts this instead, and adds only its
// slice: the body, its controls, its dismiss steps.
//
// Layers compose, they do not inherit: a window takes this base and any of
// the slices beside it (a searchable list, sections) as it needs them.

import { I18N_IOC_KEY, type I18nProvider } from '../../i18n.types.js'
import { attachDockedPanel, type DockedPanel, type DockedPanelOptions } from './docked-panel.js'
import { holdWindow, type WindowSession } from './window-session.js'
import { PHONE_QUERY } from './breakpoints.js'

export type Rgb = readonly [number, number, number]

// ── the words ────────────────────────────────────────────────────────────────

/** The translation for `key`, else `fallback` with `{name}` filled from
 *  `params`. Every framework-free window used to carry its own copy. */
export const translateOr = (key: string, fallback: string, params?: Record<string, string | number>): string => {
  const fill = (text: string): string =>
    params ? text.replace(/\{(\w+)\}/g, (whole, name: string) => String(params[name] ?? whole)) : text
  try {
    const i18n = (globalThis as { ioc?: { get?: (k: string) => unknown } }).ioc?.get?.(I18N_IOC_KEY) as I18nProvider | undefined
    const text = i18n?.t?.(key, params)
    return text && text !== key ? text : fill(fallback)
  } catch { return fill(fallback) }
}

// ── the accent ───────────────────────────────────────────────────────────────

/** WCAG relative luminance of an sRGB triple, 0..1. */
const luminance = ([r, g, b]: Rgb): number => {
  const lin = (c: number): number => { const v = c / 255; return v > 0.03928 ? ((v + 0.055) / 1.055) ** 2.4 : v / 12.92 }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

const toHsl = ([r, g, b]: Rgb): [number, number, number] => {
  const [R, G, B] = [r / 255, g / 255, b / 255]
  const max = Math.max(R, G, B), min = Math.min(R, G, B), l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  const h = max === R ? (G - B) / d + (G < B ? 6 : 0) : max === G ? (B - R) / d + 2 : (R - G) / d + 4
  return [h / 6, s, l]
}

const toRgb = ([h, s, l]: [number, number, number]): [number, number, number] => {
  if (s === 0) return [l * 255, l * 255, l * 255]
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q
  const hue = (t: number): number => {
    if (t < 0) t += 1
    if (t > 1) t -= 1
    if (t < 1 / 6) return p + (q - p) * 6 * t
    if (t < 1 / 2) return q
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
    return p
  }
  return [hue(h + 1 / 3) * 255, hue(h) * 255, hue(h - 1 / 3) * 255]
}

/** The same hue, taken down until it reads on a light pane — the Sass
 *  `deepen()` in `_panel-identity.scss`, step for step: lightness scaled by
 *  −10% until relative luminance is at or under 0.12, at most 24 steps. */
export const deepenAccent = (accent: Rgb): Rgb => {
  let out: [number, number, number] = [accent[0], accent[1], accent[2]]
  for (let step = 0; step < 24 && luminance(out) > 0.12; step++) {
    const [h, s, l] = toHsl(out)
    out = toRgb([h, s, l * 0.9])
  }
  return [Math.round(out[0]), Math.round(out[1]), Math.round(out[2])]
}

// ── the stylesheet ───────────────────────────────────────────────────────────

export const TOOL_WINDOW_STYLE_ID = 'hc-tool-window-style'
const BRIGHT = ['light', 'honey', 'bloom', 'sherbet'].map(theme => `[data-theme="${theme}"] .hc-tw`).join(', ')

/** The shared chrome, once per document. Built from the theme's own roles
 *  (`--hc-panel-*`, `--hc-window-*`), so it follows every theme. */
export function installToolWindowStyles(): void {
  if (typeof document === 'undefined' || document.getElementById(TOOL_WINDOW_STYLE_ID)) return
  const style = document.createElement('style')
  style.id = TOOL_WINDOW_STYLE_ID
  style.textContent = `
.hc-tw {
  --hc-window-accent: rgb(var(--acc));
  --hc-window-accent-quiet: rgb(var(--acc));
  --hc-window-wash: rgba(var(--acc), 0.10);
  --hc-window-wash-strong: rgba(var(--acc), 0.20);
  --hc-window-edge: rgba(var(--acc), 0.28);
  --hc-window-edge-firm: rgba(var(--acc), 0.62);
  --hc-window-on-accent: rgb(var(--hc-panel-pane));
  --acc: var(--hc-tw-acc);
  box-sizing: border-box; display: flex; flex-direction: column;
  z-index: 100002; overflow: hidden; outline: none;
  font-family: var(--hc-mono, system-ui);
  font-size: calc(0.8125rem * var(--hc-panel-scale, 1)); line-height: 1.45;
  color: var(--hc-panel-text);
}
${BRIGHT} { --acc: var(--hc-tw-acc-deep); }
@media (prefers-color-scheme: light) { :root:not([data-theme]) .hc-tw { --acc: var(--hc-tw-acc-deep); } }
.hc-tw[hidden] { display: none !important; }
.hc-tw[data-hc-placement="docked"] {
  position: fixed; bottom: 0;
  top: max(calc(2.3rem * var(--hc-header-zoom, 1.0)), var(--hc-header-anchor, 0px));
  min-width: 260px; max-width: calc(100vw - 1.5rem);
  background: rgba(var(--hc-panel-pane), 0.975);
  backdrop-filter: blur(14px) saturate(1.04); -webkit-backdrop-filter: blur(14px) saturate(1.04);
  border: 0; border-radius: 0;
}
.hc-tw[data-hc-placement="docked"][data-hc-side="right"] {
  right: var(--hc-controls-right, 0px);
  border-left: 1px solid rgba(var(--acc), 0.38);
  box-shadow: -14px 0 44px rgba(var(--hc-panel-shadow), 0.46), inset 1px 0 rgba(var(--hc-panel-sheen), 0.025);
}
.hc-tw[data-hc-placement="docked"][data-hc-side="left"] {
  left: var(--hc-controls-left, 0px);
  border-right: 1px solid rgba(var(--acc), 0.38);
  box-shadow: 14px 0 44px rgba(var(--hc-panel-shadow), 0.46), inset -1px 0 rgba(var(--hc-panel-sheen), 0.025);
}
.hc-tw[data-hc-placement="floating"] {
  position: fixed;
  background: rgba(var(--hc-panel-pane), 0.98);
  border: 1px solid rgba(var(--acc), 0.38); border-radius: var(--hc-radius-floating, 6px);
  box-shadow: 0 18px 54px rgba(var(--hc-panel-shadow), 0.55), inset 0 1px rgba(var(--hc-panel-sheen), 0.03);
}
@media ${PHONE_QUERY} {
  .hc-tw[data-hc-placement="docked"] {
    top: auto !important; left: 0 !important; right: 0 !important;
    bottom: calc(max(var(--hc-controls-bottom, 0px), var(--hc-safe-bottom, 0px)) + var(--hc-mobile-row-lift, 0px)) !important;
    width: auto !important; min-width: 0 !important; max-width: none !important;
    max-height: min(62dvh, 30rem);
    border-right: 0 !important; border-left: var(--hc-controls-left, 0px) solid transparent !important;
    border-top: 1px solid rgba(var(--acc), 0.5);
    border-radius: var(--hc-radius-floating, 6px) var(--hc-radius-floating, 6px) 0 0;
    background-clip: padding-box; clip-path: inset(-4rem 0 0 var(--hc-controls-left, 0px));
    box-shadow: 0 -10px 40px rgba(var(--hc-panel-shadow), 0.55), 0 0 0 1px rgba(var(--acc), 0.06) inset;
    font-size: calc(1rem * max(1, var(--hc-panel-scale, 1))) !important;
  }
  .hc-tw button { min-block-size: 44px; }
  .hc-tw .hc-tw-close { min-inline-size: 44px !important; }
  .hc-tw input, .hc-tw select, .hc-tw textarea { font-size: max(1em, 16px) !important; }
  .hc-tw [data-hc-grip] { display: none !important; }
}
.hc-tw-head {
  flex: 0 0 auto; box-sizing: border-box; display: flex; align-items: center; gap: 0.5rem;
  height: 2.875rem; min-height: 2.875rem; padding: 0 0.75rem; line-height: 1;
  border-bottom: 1px solid var(--hc-window-edge);
  background: linear-gradient(180deg, rgba(var(--hc-panel-sheen), 0.018), rgba(var(--hc-panel-sheen), 0.006));
}
.hc-tw-head > button {
  box-sizing: border-box; display: inline-grid; place-items: center;
  min-width: 1.75rem; height: 1.75rem; padding: 0 0.25rem;
  border: 0; border-radius: var(--hc-radius-control, 2px); background: none;
  color: inherit; font: inherit; line-height: 1; cursor: pointer;
  transition: color 120ms ease, background-color 120ms ease, border-color 120ms ease;
}
.hc-tw-head > button:hover { background-color: rgba(var(--hc-panel-ink), 0.055); }
.hc-tw-head > button:focus-visible { outline: 1px solid color-mix(in srgb, var(--hc-window-accent) 72%, white); outline-offset: 1px; }
.hc-tw-title {
  flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-weight: 600; font-size: 0.9em; letter-spacing: 0.05em; color: var(--hc-window-accent);
}
.hc-tw-actions { display: flex; align-items: center; gap: 0.25rem; }
.hc-tw-actions:empty { display: none; }
/* A window with controls in its header: the title keeps its words (up to
   half the header) and the controls take what is left, shrinking first. */
.hc-tw-head:has(> .hc-tw-actions:not(:empty)) > .hc-tw-title { flex: 0 0 auto; max-width: 50%; }
.hc-tw-actions:not(:empty) { flex: 1 1 0; min-width: 0; }
.hc-tw-head > .hc-tw-close {
  width: 1.75rem; min-width: 1.75rem; padding: 0; font-size: 1.125rem; color: var(--hc-window-ink-faint);
}
.hc-tw-head > .hc-tw-close:hover { color: var(--hc-panel-text); background-color: rgba(var(--hc-panel-ink), 0.075); }
.hc-tw-body { flex: 1 1 auto; min-height: 0; overflow-y: auto; overflow-x: hidden; padding: 0.7rem 0.75rem 1.2rem; }
.hc-tw-body > p { margin: 0 0 0.5rem; line-height: 1.55; }
.hc-tw-quiet { color: var(--hc-window-ink-faint); font-size: 0.85em; }
.hc-tw-card {
  margin: 0.6rem 0; padding: 0.5rem 0.55rem;
  border: 1px solid var(--hc-window-edge); border-radius: var(--hc-radius-card, 3px);
  background: rgba(var(--hc-panel-ink), 0.02);
}
.hc-tw-button {
  padding: 0.35rem 0.5rem; background: rgba(var(--hc-panel-ink), 0.06);
  border: 1px solid var(--hc-window-edge); border-radius: var(--hc-radius-control, 2px);
  color: inherit; font: inherit; font-size: 0.85em; letter-spacing: 0.05em; cursor: pointer;
}
.hc-tw-button:hover:not(:disabled) { border-color: var(--hc-window-edge-firm); }
.hc-tw-button:disabled { opacity: 0.45; cursor: default; }
.hc-tw-button.is-primary { border-color: var(--hc-window-edge-firm); }
.hc-tw-said { margin-top: 0.6rem; padding: 0.45rem 0.55rem; font-size: 0.88em; border: 1px solid var(--hc-window-edge); border-radius: var(--hc-radius-control, 2px); }
.hc-tw-said.is-ok { border-color: var(--hc-window-edge-firm); }
.hc-tw-said.is-quiet { color: var(--hc-window-ink-faint); }
.hc-tw-said.is-bad { border-color: rgba(214, 126, 126, 0.75); }
`
  document.head.appendChild(style)
}

// ── the window ───────────────────────────────────────────────────────────────

export interface ToolWindowOptions {
  /** Stable id: the session, the lane, the remembered width. */
  id: string
  title: string
  /** The window's identity colour, as an sRGB triple. Deepened automatically
   *  on the bright themes. */
  accent: Rgb
  /** Docked (default) takes a place in the lane beside the controls; floating
   *  is placed by the window itself (its own class positions it). */
  placement?: 'docked' | 'floating'
  side?: 'left' | 'right'
  minWidth?: number
  maxWidth?: number
  defaultWidth?: number
  /** The window's own class on the root, for its slice's styles. */
  className?: string
  /** One Escape step inside the window (drop a pick, leave a drill-down):
   *  true when it consumed the press. The policy calls it; the window never
   *  listens for Escape itself. */
  dismiss?: () => boolean
  /** The window's close verb: the × and the policy's close both call it. */
  onClose: () => void
  /** Acts on whatever else is open, so the one-window rule lets it stay. */
  companion?: boolean
  /** Anything else `DockedPanel` takes (launcher, own settings, pairing). */
  docked?: Omit<DockedPanelOptions, 'id' | 'dockSide' | 'minWidth' | 'maxWidth' | 'defaultWidth' | 'hcSession' | 'onClose'>
}

export interface ToolWindow {
  readonly root: HTMLElement
  readonly header: HTMLElement
  /** The window's own header controls go here: after the title, before the
   *  gear and the close. */
  readonly actions: HTMLElement
  readonly body: HTMLElement
  readonly session: WindowSession
  readonly panel: DockedPanel | null
  setTitle(text: string): void
  /** Take the window off screen and out of the session and lane. */
  dispose(): void
}

/** Build a tool window inside `host` and join it to the session (and, docked,
 *  to the lane). Park and unpark keep every piece of state: they only hide it. */
export function mountToolWindow(host: HTMLElement, options: ToolWindowOptions): ToolWindow {
  installToolWindowStyles()
  const placement = options.placement ?? 'docked'
  const side = options.side ?? 'right'

  const root = document.createElement('aside')
  root.className = options.className ? `hc-tw ${options.className}` : 'hc-tw'
  root.dataset['hcPlacement'] = placement
  root.dataset['hcSide'] = side
  root.setAttribute('role', 'dialog')
  root.setAttribute('aria-label', options.title)
  root.setAttribute('data-consumes-wheel', '')
  root.tabIndex = -1
  const [r, g, b] = options.accent
  const deep = deepenAccent(options.accent)
  root.style.setProperty('--hc-tw-acc', `${r}, ${g}, ${b}`)
  root.style.setProperty('--hc-tw-acc-deep', `${deep[0]}, ${deep[1]}, ${deep[2]}`)
  if (placement === 'docked' && options.defaultWidth) root.style.width = `${options.defaultWidth}px`

  const header = document.createElement('header')
  header.className = 'hc-tw-head'
  const title = document.createElement('span')
  title.className = 'hc-tw-title'
  title.textContent = options.title
  const actions = document.createElement('div')
  actions.className = 'hc-tw-actions'
  const close = document.createElement('button')
  close.type = 'button'
  close.className = 'hc-tw-close'
  close.textContent = '×'
  const closeLabel = translateOr('panel.close', 'Close')
  close.setAttribute('aria-label', closeLabel)
  close.title = closeLabel
  close.addEventListener('click', () => options.onClose())
  header.append(title, actions, close)

  const body = document.createElement('div')
  body.className = 'hc-tw-body'
  root.append(header, body)
  host.appendChild(root)

  let panel: DockedPanel | null = null
  let release: (() => void) | null = null
  // Showing: docked, a place in the lane (and the session, the one-window
  // rule, the reserved edge — all DockedPanel's); floating, the session only,
  // since it sits outside the lane and the one-window rule.
  const show = (): void => {
    root.hidden = false
    if (placement === 'docked') {
      panel = attachDockedPanel(root, {
        ...options.docked,
        id: options.id,
        dockSide: side,
        ...(options.minWidth ? { minWidth: options.minWidth } : {}),
        ...(options.maxWidth ? { maxWidth: options.maxWidth } : {}),
        ...(options.defaultWidth ? { defaultWidth: options.defaultWidth } : {}),
        hcSession: session,
        onClose: options.onClose,
      })
    } else {
      release = holdWindow(options.id, session, () => root)
    }
  }
  // Parked: off screen and out of the lane, so no neighbour is held inward by
  // a window nobody can see. Everything the window holds stays in its DOM;
  // the parked list keeps the session that brings it back.
  const hide = (): void => {
    root.hidden = true
    panel?.dispose()
    panel = null
    release?.()
    release = null
  }

  const session: WindowSession = {
    park: hide,
    unpark: () => { if (root.hidden) show() },
    ...(options.dismiss ? { dismiss: options.dismiss } : {}),
    close: () => options.onClose(),
    ...(options.companion ? { companion: true } : {}),
  }
  show()

  return {
    root, header, actions, body, session,
    get panel() { return panel },
    setTitle: (text: string) => { title.textContent = text; root.setAttribute('aria-label', text) },
    dispose: () => {
      hide()
      root.remove()
    },
  }
}
