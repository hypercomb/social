import type { BriefAffordance } from './tile-brief.js'
import { briefText } from './tile-brief.js'

export type SquareTileMenuOptions = {
  title: string
  actions: readonly BriefAffordance[]
  onClose: () => void
  onDetails: () => void
}

const element = <K extends keyof HTMLElementTagNameMap>(
  tag: K, className: string, text?: string,
): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag)
  node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

const button = (className: string, label: string): HTMLButtonElement => {
  const node = element('button', className)
  node.type = 'button'
  node.title = label
  node.setAttribute('aria-label', label)
  return node
}

/** The controller positions this panel over a neighbour and owns dismissal.
 *  Native buttons retain their usual Tab/Enter behaviour inside the panel. */
export function buildSquareTileMenuPanel(options: SquareTileMenuOptions): HTMLElement {
  const panel = element('aside', 'wv-menu')
  const optionsLabel = briefText('square-tile.menu.options', 'Tile options')
  panel.setAttribute('aria-label', options.title ? `${optionsLabel}: ${options.title}` : optionsLabel)

  const head = element('header', 'wv-menu-head')
  const title = element('h3', 'wv-menu-title', options.title || optionsLabel)
  title.title = options.title || optionsLabel
  const close = button('wv-menu-close', briefText('square-tile.menu.close', 'Close tile options'))
  const closeMark = element('span', 'wv-menu-close-mark', '\u00d7')
  closeMark.setAttribute('aria-hidden', 'true')
  close.appendChild(closeMark)
  close.onclick = () => options.onClose()
  head.append(title, close)
  panel.appendChild(head)

  const scroll = element('div', 'wv-menu-scroll')
  const ordinary = options.actions.filter(action => !action.destructive)
  const destructive = options.actions.filter(action => action.destructive)
  if (ordinary.length) {
    const grid = element('div', 'wv-menu-actions')
    for (const action of ordinary) grid.appendChild(actionButton(action, options.onClose))
    scroll.appendChild(grid)
  }
  if (destructive.length) {
    const grid = element('div', 'wv-menu-actions wv-menu-danger')
    grid.setAttribute('role', 'group')
    grid.setAttribute('aria-label', briefText('square-tile.menu.destructive', 'Destructive tile actions'))
    for (const action of destructive) grid.appendChild(actionButton(action, options.onClose))
    scroll.appendChild(grid)
  }
  if (!options.actions.length) {
    scroll.appendChild(element('p', 'wv-menu-empty', briefText('square-tile.menu.empty', 'No tile actions available')))
  }
  panel.appendChild(scroll)

  const details = button('wv-menu-details', briefText('square-tile.menu.details', 'Tile details'))
  details.textContent = briefText('square-tile.menu.details.short', 'Details')
  details.onclick = () => options.onDetails()
  panel.appendChild(details)
  return panel
}

function actionButton(action: BriefAffordance, onClose: () => void): HTMLButtonElement {
  const node = button('wv-menu-action', action.label)
  node.dataset['action'] = action.name
  node.disabled = action.inert
  if (action.destructive) node.setAttribute('data-danger', '')
  const icon = element('span', 'wv-menu-icon')
  icon.setAttribute('aria-hidden', 'true')
  // Trusted provider SVG, shared with the hexagon band and tile brief.
  icon.innerHTML = action.svgMarkup
  const svg = icon.querySelector('svg')
  if (svg) {
    svg.setAttribute('width', '100%')
    svg.setAttribute('height', '100%')
    svg.setAttribute('fill', 'currentColor')
    svg.setAttribute('focusable', 'false')
  }
  node.append(icon, element('span', 'wv-menu-action-label', action.label))
  node.onclick = () => {
    if (action.inert) return
    onClose()
    action.run()
  }
  return node
}

export const SQUARE_TILE_MENU_CSS = `
.hc-square-tile-view .wv-menu{position:absolute;top:0;z-index:5;display:flex;flex-direction:column;
 box-sizing:border-box;min-width:0;padding:6px;background:#fffdf7;border:1px solid #b8933f;
 box-shadow:0 2px 3px rgba(58,42,28,.1),0 18px 34px -14px rgba(58,42,28,.35);
 overflow:hidden;color:#3a2a1c;text-align:left;cursor:default}
.hc-square-tile-view .wv-menu *{box-sizing:border-box}
.hc-square-tile-view .wv-menu .wv-menu-head{display:flex;align-items:center;gap:4px;flex:none;min-width:0;padding:0 0 4px 3px}
.hc-square-tile-view .wv-menu .wv-menu-title{flex:1;min-width:0;margin:0;overflow:hidden;text-overflow:ellipsis;
 white-space:nowrap;font:italic 700 .84rem/1.2 Georgia,'Times New Roman',serif;color:#3a2a1c}
.hc-square-tile-view .wv-menu button{font-family:Georgia,'Times New Roman',serif;cursor:pointer}
.hc-square-tile-view .wv-menu .wv-menu-close{display:flex;align-items:center;justify-content:center;flex:0 0 28px;
 width:28px;height:28px;padding:0;border:0;border-radius:3px;background:none;color:#7a6444;font-size:1.25rem;line-height:1}
.hc-square-tile-view .wv-menu .wv-menu-scroll{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain;
 scrollbar-width:thin;scrollbar-color:rgba(184,147,63,.55) transparent;padding:2px}
.hc-square-tile-view .wv-menu .wv-menu-actions{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,4rem),1fr));gap:3px}
.hc-square-tile-view .wv-menu .wv-menu-action{display:flex;flex-direction:column;align-items:center;justify-content:center;
 gap:4px;min-width:0;min-height:46px;padding:6px 3px;background:none;border:1px solid transparent;border-radius:3px;
 color:#5c4630;transition:background .14s ease,color .14s ease}
.hc-square-tile-view .wv-menu .wv-menu-icon{display:flex;align-items:center;justify-content:center;flex:none;width:19px;height:19px}
.hc-square-tile-view .wv-menu .wv-menu-icon svg{display:block;width:100%;height:100%}
.hc-square-tile-view .wv-menu .wv-menu-action-label{max-width:100%;font:600 .64rem/1.2 Georgia,'Times New Roman',serif;
 overflow-wrap:anywhere;text-align:center}
.hc-square-tile-view .wv-menu .wv-menu-danger{margin-top:6px;padding-top:6px;border-top:1px solid rgba(141,74,47,.22)}
.hc-square-tile-view .wv-menu .wv-menu-action[data-danger]{color:#8d4a2f}
.hc-square-tile-view .wv-menu .wv-menu-action:disabled{opacity:.4;cursor:default}
.hc-square-tile-view .wv-menu .wv-menu-action:hover:not(:disabled),
.hc-square-tile-view .wv-menu .wv-menu-close:hover{background:rgba(184,147,63,.14);color:#3a2a1c}
.hc-square-tile-view .wv-menu .wv-menu-action[data-danger]:hover:not(:disabled){background:rgba(141,74,47,.1);color:#813b24}
.hc-square-tile-view .wv-menu button:focus-visible{outline:2px solid #8a6a1a;outline-offset:-2px}
.hc-square-tile-view .wv-menu .wv-menu-details{flex:none;width:100%;min-height:29px;margin-top:4px;padding:5px;
 border:0;border-top:1px solid rgba(184,147,63,.35);border-radius:0;background:none;color:#785919;
 font:600 .68rem/1.2 Georgia,'Times New Roman',serif;letter-spacing:.08em}
.hc-square-tile-view .wv-menu .wv-menu-details:hover{background:rgba(184,147,63,.14)}
.hc-square-tile-view .wv-menu .wv-menu-empty{margin:5px 2px;color:#8a7657;font:italic .74rem/1.4 Georgia,serif}
@media(prefers-reduced-motion:reduce){.hc-square-tile-view .wv-menu .wv-menu-action{transition:none}}
`
