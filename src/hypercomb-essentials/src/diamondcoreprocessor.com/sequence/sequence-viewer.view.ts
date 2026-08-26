// sequence-viewer.view.ts — the Sequences panel as a framework-free custom
// element: THE FIRST ANGULAR PANEL TO LEAVE THE SHELL (everything-is-a-
// beehavior Phase 2, step C — the gate's proof).
//
// A straight port of shared/ui/sequence-viewer (now deleted): same surface
// name and order band in the shell-surface registry, same effects
// (sequence:view-open/close/selected/select/edit), same width key, same
// launcher id — the participant sees the same panel, delivered as a signed
// module instead of compiled into the shell.
//
// Built on DockedPanelElement (panels/docked-panel.element.ts): lanes,
// session, settings gear, grip and viewport inset all ride the base. Rows
// REBUILD on change (the house pattern — state lives in the service, so
// rebuilding is safe; no reconciler, by doctrine). Its strings ship WITH it
// (sequence-viewer.i18n.ts, extracted from all 14 shell catalogs) and
// register under the 'app' namespace, so every key resolves exactly as
// before — the Phase 2 catalog split, first slice.

import { EffectBus, I18N_IOC_KEY, type I18nProvider } from '@hypercomb/core'
import { DockedPanelElement } from '../panels/docked-panel.element.js'
import { SEQUENCE_VIEWER_TRANSLATIONS } from './sequence-viewer.i18n.js'

const SURFACE_NAME = 'hc-sequence-viewer'

type SequenceSet = { name: string; indexes: number[] }
type SequenceService = EventTarget & { list(): string[]; get(name: string): SequenceSet | null }
type Row = { id: string; name: string; detail: string; builtIn: boolean }

const t = (key: string, fallback: string): string => {
  const i18n = window.ioc?.get?.(I18N_IOC_KEY) as I18nProvider | undefined
  const value = i18n?.t(key)
  return value && value !== key ? value : fallback
}

// The panel's strings travel with it — registered as soon as the i18n
// service is up, under 'app' so the keys resolve exactly as they always did.
window.ioc?.whenReady?.(I18N_IOC_KEY, (i18n) => {
  const provider = i18n as I18nProvider
  for (const [locale, catalog] of Object.entries(SEQUENCE_VIEWER_TRANSLATIONS)) {
    provider.registerTranslations('app', locale, catalog)
  }
})

// ── the styles the Angular SCSS carried, expanded to plain CSS ────────────
// tw.panel(#7eb8a4, right) and tw.header are inlined; the shape ladder stays
// on the :root custom properties (_shape.scss publishes them app-wide).
const CSS = `
${SURFACE_NAME}{position:fixed;right:var(--hc-controls-right,0);top:var(--hc-header-bottom,0);bottom:0;z-index:8100;display:none;flex-direction:column;width:var(--hc-panel-width,370px);color:#e7efec;font:14px/1.4 Inter,system-ui,sans-serif;
  --hc-window-accent:#7eb8a4;--hc-window-radius-control:var(--hc-radius-control);--hc-window-radius-card:var(--hc-radius-card);--hc-window-radius-floating:var(--hc-radius-floating);
  background:rgba(13,15,21,.975);backdrop-filter:blur(14px) saturate(1.04);-webkit-backdrop-filter:blur(14px) saturate(1.04);border-radius:0;font-family:var(--hc-mono,system-ui);color:#eef2f5;outline:none;
  border-right:0;border-left:1px solid rgba(126,184,164,.38);box-shadow:-14px 0 44px rgba(0,0,0,.46),inset 1px 0 rgba(255,255,255,.025)}
${SURFACE_NAME}.open{display:flex}
${SURFACE_NAME} .sequence-header{flex:0 0 auto;box-sizing:border-box;display:flex;align-items:center;gap:.5rem;height:2.875rem;min-height:2.875rem;padding:0 .75rem;line-height:1;background:linear-gradient(180deg,rgba(255,255,255,.018),rgba(255,255,255,.006));justify-content:space-between;border-bottom:1px solid #35564b}
${SURFACE_NAME} .sequence-header>button{box-sizing:border-box;display:inline-grid;place-items:center;min-width:1.75rem;height:1.75rem;padding:0 .25rem;border-radius:var(--hc-radius-control);line-height:1;transition:color 120ms ease,background-color 120ms ease,border-color 120ms ease}
${SURFACE_NAME} .sequence-header>button:hover{background-color:rgba(255,255,255,.055)}
${SURFACE_NAME} .sequence-header>button.close{width:1.75rem;min-width:1.75rem;padding:0;font-size:1.125rem;color:rgba(238,244,248,.62)}
${SURFACE_NAME} .sequence-header>button.close:hover{color:#fff;background-color:rgba(255,255,255,.075)}
${SURFACE_NAME} .sequence-header>div{display:flex;align-items:center;gap:.5rem}
${SURFACE_NAME} .sequence-title{text-transform:uppercase;letter-spacing:.14em;font-size:.72rem;font-weight:800;color:#abd0c3}
${SURFACE_NAME} .sequence-count{padding:.1rem .4rem;border-radius:999px;background:#294b40;font-size:.65rem}
${SURFACE_NAME} .close,${SURFACE_NAME} .edit{border:0;background:transparent;color:#bfd2cb;cursor:pointer}
${SURFACE_NAME} .intro,${SURFACE_NAME} article small{color:#8fa19b}
${SURFACE_NAME} .intro{margin:0;padding:1rem;font-size:.8rem}
${SURFACE_NAME} .list{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain;padding:.7rem}
${SURFACE_NAME} .list article{display:grid;grid-template-columns:2.2rem 1fr auto auto;align-items:center;gap:.65rem;margin-bottom:.55rem;padding:.8rem;border:1px solid #293733;border-radius:var(--hc-radius-card);background:#17201e}
${SURFACE_NAME} .list article.active{border-color:#7eb8a4;box-shadow:inset 3px 0 #7eb8a4}
${SURFACE_NAME} .icon{display:grid;place-items:center;width:2.2rem;height:2.2rem;border-radius:var(--hc-radius-control);background:#22342e;color:#91beae}
${SURFACE_NAME} .list article>div{display:flex;min-width:0;flex-direction:column}
${SURFACE_NAME} .list small{font-size:.7rem}
${SURFACE_NAME} .apply{border:1px solid #4e7668;border-radius:var(--hc-radius-floating);padding:.4rem .55rem;background:#294f42;color:#edf5f2;cursor:pointer}
${SURFACE_NAME} .edit{font-size:1rem}
${SURFACE_NAME} footer{padding:.8rem;border-top:1px solid #293733}
${SURFACE_NAME} footer button{display:flex;align-items:center;justify-content:center;gap:.35rem;width:100%;padding:.6rem;border:1px dashed #527568;border-radius:var(--hc-radius-control);background:transparent;color:#b8cec6;cursor:pointer}
@media(max-width:599px){${SURFACE_NAME}{left:0;right:0;width:auto!important}}
`

let cssInstalled = false
const installCss = (): void => {
  if (cssInstalled) return
  cssInstalled = true
  const style = document.createElement('style')
  style.setAttribute('data-hc-sequence-viewer', '')
  style.textContent = CSS
  document.head.appendChild(style)
}

export class SequenceViewerElement extends DockedPanelElement {

  #active = ''
  #rows: readonly Row[] = []
  #service: SequenceService | null = null
  #offs: Array<() => void> = []
  readonly #changed = (): void => { this.#refresh(); this.#renderRows(); this.#renderCount() }
  #list: HTMLElement | null = null
  #count: HTMLElement | null = null
  #open = false

  constructor() {
    super()
    this.panelId = 'sequence-viewer'
    this.dockSide = 'right'
    this.minWidth = 280
    this.maxWidth = 620
    this.defaultWidth = 370
    this.launcherControlId = 'sequences'
    this.autoActivate = false
    // Put away while the hive is covered; back on the same sequence — park
    // hides without forgetting (the selection and service binding survive).
    this.session = {
      park: () => this.#hide(),
      unpark: () => this.open(),
      close: () => this.close(),
    }
  }

  override connectedCallback(): void {
    super.connectedCallback()
    installCss()
    this.setAttribute('data-consumes-wheel', '')
    this.tabIndex = -1
    this.#offs.push(
      EffectBus.on('sequence:view-open', () => this.open()),
      EffectBus.on('sequence:view-close', () => this.close()),
      EffectBus.on<{ id?: string }>('sequence:selected', ({ id }) => {
        if (!id) return
        this.#active = id
        this.#renderRows()
      }),
    )
  }

  override disconnectedCallback(): void {
    this.#offs.forEach(off => off())
    this.#offs = []
    this.#unbind()
    super.disconnectedCallback()
  }

  open(): void {
    this.#bind()
    this.#refresh()
    this.#open = true
    this.classList.add('open')
    this.setAttribute('aria-label', t('sequences.aria', 'Arrangement sequences'))
    this.activate()   // render + lane + session + gear (rebuild-on-open)
  }

  close(): void { this.#hide() }

  #hide(): void {
    if (!this.#open) return
    this.#open = false
    this.classList.remove('open')
    this.deactivate()
    this.#list = null
    this.#count = null
  }

  protected override closePanel(): void { this.close() }

  protected override renderPanel(): void {
    const header = document.createElement('header')
    header.className = 'sequence-header'
    const title = document.createElement('div')
    const name = document.createElement('span')
    name.className = 'sequence-title'
    name.textContent = t('sequences.title', 'Sequences')
    const count = document.createElement('span')
    count.className = 'sequence-count'
    title.append(name, count)
    const close = document.createElement('button')
    close.type = 'button'
    close.className = 'close mat-sym'
    close.textContent = 'close'
    close.setAttribute('aria-label', t('sequences.close', 'Close'))
    close.addEventListener('click', () => this.close())
    header.append(title, close)

    const intro = document.createElement('p')
    intro.className = 'intro'
    intro.textContent = t('sequences.intro', 'A sequence is a saved arrangement — pick one and drops follow its order.')

    const list = document.createElement('div')
    list.className = 'list'

    const footer = document.createElement('footer')
    const create = document.createElement('button')
    create.type = 'button'
    const plus = document.createElement('span')
    plus.className = 'mat-sym'
    plus.textContent = 'add'
    create.append(plus, document.createTextNode(t('sequences.new', 'New sequence')))
    create.addEventListener('click', () => {
      this.close()
      EffectBus.emit('sequence:edit', { name: 'default' })
    })
    footer.appendChild(create)

    this.append(header, intro, list, footer)
    this.#list = list
    this.#count = count
    this.#renderRows()
    this.#renderCount()
  }

  // ── data ─────────────────────────────────────────────────────────────
  #bind(): void {
    this.#unbind()
    this.#service = window.ioc?.get?.('@diamondcoreprocessor.com/SequenceService') as SequenceService | undefined ?? null
    this.#service?.addEventListener('change', this.#changed)
  }

  #unbind(): void {
    this.#service?.removeEventListener('change', this.#changed)
    this.#service = null
  }

  #refresh(): void {
    const builtIns: Row[] = [
      { id: 'rectangle', name: 'Rectangle', detail: 'A compact, balanced block.', builtIn: true },
      { id: 'flower', name: 'Flowers', detail: 'Clusters of seven around a centre tile.', builtIn: true },
    ]
    const saved = (this.#service?.list() ?? []).map(name => ({
      id: name, name,
      detail: `${this.#service?.get(name)?.indexes.length ?? 0} ordered drop targets`,
      builtIn: false,
    }))
    this.#rows = [...builtIns, ...saved]
  }

  // ── rendering (rebuild on change — the house pattern) ────────────────
  #renderCount(): void {
    if (this.#count) this.#count.textContent = String(this.#rows.filter(r => !r.builtIn).length)
  }

  #renderRows(): void {
    const list = this.#list
    if (!list) return
    list.replaceChildren()
    for (const row of this.#rows) {
      const article = document.createElement('article')
      if (this.#active === row.id) article.classList.add('active')

      const icon = document.createElement('span')
      icon.className = 'mat-sym icon'
      icon.textContent = row.builtIn ? 'auto_awesome_mosaic' : 'schema'

      const text = document.createElement('div')
      const strong = document.createElement('strong')
      strong.textContent = row.name
      const small = document.createElement('small')
      small.textContent = row.detail
      text.append(strong, small)

      const apply = document.createElement('button')
      apply.type = 'button'
      apply.className = 'apply'
      apply.textContent = this.#active === row.id
        ? t('sequences.selected', 'Selected')
        : t('sequences.use', 'Use')
      apply.addEventListener('click', () => {
        EffectBus.emit('sequence:select', { id: row.id })
      })

      article.append(icon, text, apply)

      if (!row.builtIn) {
        const edit = document.createElement('button')
        edit.type = 'button'
        edit.className = 'edit mat-sym'
        edit.textContent = 'edit'
        edit.setAttribute('aria-label', `Edit ${row.name}`)
        edit.addEventListener('click', () => {
          this.close()
          EffectBus.emit('sequence:edit', { name: row.id })
        })
        article.appendChild(edit)
      }
      list.appendChild(article)
    }
  }
}

// ── shell surface registration — the externalization path ────────────────
// Same name, same order band the Angular component held; the module-side
// `element:` shape (documentation/shell-surfaces.md).
window.ioc?.whenReady?.('@hypercomb.social/ShellSurfaceRegistry', (value) => {
  const registry = value as { add(surface: Record<string, unknown>): void }
  if (!customElements.get(SURFACE_NAME)) {
    customElements.define(SURFACE_NAME, SequenceViewerElement)
  }
  registry.add({
    name: SURFACE_NAME,
    owner: '@diamondcoreprocessor.com/SequenceViewerElement',
    element: SURFACE_NAME,
    order: 68,
  })
})
