// diamondcoreprocessor.com/dashboard/qa-modal.view.ts
//
// QA Modal — fullscreen-overlay dialog that opens when a tile with a
// `dashboard-q-binding` is clicked. Shows the question, accepts an
// answer, and persists the (question, answer) pair as a
// `kind: 'qa-answer'` optimization in `__optimization__/`. The
// original `kind: 'qa'` optimization (the open Q) is then removed so
// the dashboard's next refresh drops the card.
//
// Notes are NOT written here. The user's raw answer is decoration,
// not canonical content — it lives in the optimization substrate
// until the next codegen pass, where Claude reads pending
// `qa-answer` items, interprets each, and (if warranted) writes a
// note through the state-machine `update(layer)` path as Claude's
// instruction-form interpretation. The `qa-answer` is then cleaned
// up. See `feedback_layer_purity_optimizations_external.md` and
// `project_optimization_substrate.md` in user memory.
//
// Mirrors PhotoView's pattern: DOM-based singleton, registered in IoC,
// mounted on demand, no Angular dependency so it works in any
// ViewMode (hexagons OR website). The user is in hexagons mode the
// majority of the time — that's why the inline `/dashboard` HTML
// cards can't be the only answer surface.

import { EffectBus, I18N_IOC_KEY, type I18nProvider } from '@hypercomb/core'

export type QaBindingPayload = {
  qId: string
  qSig: string
  qPath: readonly string[]
  question: string
}

type StoreLike = {
  putOptimization?(blob: Blob): Promise<string>
  removeOptimization?(sig: string): Promise<boolean>
}

export class QaModalView extends EventTarget {
  #overlay: HTMLDivElement | null = null
  #current: QaBindingPayload | null = null
  #onAfterCommit: ((payload: QaBindingPayload) => void) | null = null

  show(binding: QaBindingPayload, onAfterCommit?: (p: QaBindingPayload) => void): void {
    if (this.#overlay) this.close()
    this.#current = binding
    this.#onAfterCommit = onAfterCommit ?? null

    const overlay = document.createElement('div')
    overlay.setAttribute('data-hc-qa-modal', '')
    Object.assign(overlay.style, {
      position: 'fixed',
      inset: '0',
      zIndex: '60000',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      opacity: '0',
      transition: 'opacity 180ms ease',
    } as CSSStyleDeclaration)

    const backdrop = document.createElement('div')
    Object.assign(backdrop.style, {
      position: 'absolute',
      inset: '0',
      background: 'rgba(0, 0, 0, 0.55)',
      cursor: 'pointer',
    } as CSSStyleDeclaration)
    backdrop.addEventListener('click', () => this.close())
    overlay.appendChild(backdrop)

    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    dialog.setAttribute('aria-modal', 'true')
    Object.assign(dialog.style, {
      position: 'relative',
      width: 'min(640px, 92vw)',
      maxHeight: '82vh',
      padding: '1.4rem 1.4rem 1.1rem',
      background: '#1c1c20',
      color: '#eaeaea',
      border: '1px solid rgba(255,255,255,0.12)',
      borderRadius: '12px',
      boxShadow: '0 18px 48px rgba(0,0,0,0.55)',
      display: 'flex',
      flexDirection: 'column',
      gap: '0.85rem',
      font: '14px/1.45 Inter, system-ui, sans-serif',
    } as CSSStyleDeclaration)
    dialog.addEventListener('click', (e) => e.stopPropagation())

    const closeBtn = document.createElement('button')
    closeBtn.type = 'button'
    closeBtn.setAttribute('aria-label', 'close')
    closeBtn.textContent = '×'
    Object.assign(closeBtn.style, {
      position: 'absolute',
      top: '0.4rem',
      right: '0.55rem',
      width: '2rem',
      height: '2rem',
      border: 'none',
      background: 'transparent',
      color: '#eaeaea',
      fontSize: '1.4rem',
      lineHeight: '1',
      cursor: 'pointer',
      opacity: '0.7',
    } as CSSStyleDeclaration)
    closeBtn.addEventListener('click', () => this.close())
    dialog.appendChild(closeBtn)

    // Source row: the tile this question belongs to, plus quick-nav icons so a
    // host reviewing the question can jump straight to that tile's layer (or
    // open it in a new window) for context without losing the dashboard.
    const sourceRow = document.createElement('div')
    Object.assign(sourceRow.style, {
      display: 'flex',
      alignItems: 'center',
      gap: '0.45rem',
      fontSize: '0.78rem',
      opacity: '0.7',
      letterSpacing: '0.04em',
    } as CSSStyleDeclaration)
    const sourceLabel = document.createElement('span')
    sourceLabel.textContent = binding.qPath.length === 0 ? '/' : '/' + binding.qPath.join('/')
    Object.assign(sourceLabel.style, {
      flex: '1',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
    } as CSSStyleDeclaration)
    sourceRow.appendChild(sourceLabel)

    const routeOf = (segs: readonly string[]): string =>
      location.origin + '/' + segs.map(s => encodeURIComponent(String(s))).join('/')
    const mkNav = (label: string, title: string, onClick: () => void): HTMLButtonElement => {
      const b = document.createElement('button')
      b.type = 'button'
      b.textContent = label
      b.title = title
      Object.assign(b.style, {
        flex: '0 0 auto',
        border: '1px solid rgba(255,255,255,0.16)',
        background: 'rgba(255,255,255,0.04)',
        color: '#eaeaea',
        borderRadius: '5px',
        padding: '0.14rem 0.45rem',
        fontSize: '0.82rem',
        lineHeight: '1',
        cursor: 'pointer',
        opacity: '0.85',
      } as CSSStyleDeclaration)
      b.addEventListener('mouseenter', () => { b.style.opacity = '1'; b.style.background = 'rgba(110,180,255,0.18)' })
      b.addEventListener('mouseleave', () => { b.style.opacity = '0.85'; b.style.background = 'rgba(255,255,255,0.04)' })
      b.addEventListener('click', (e) => { e.stopPropagation(); onClick() })
      return b
    }
    if (binding.qPath.length > 0) {
      sourceRow.appendChild(mkNav('→ tile', 'Go to this tile', () => {
        const nav = get<{ goRaw?: (s: readonly string[]) => void }>('@hypercomb.social/Navigation')
        nav?.goRaw?.(binding.qPath)
        this.close()
      }))
      sourceRow.appendChild(mkNav('↗', 'Open this tile in a new window', () => {
        window.open(routeOf(binding.qPath), '_blank', 'noopener')
      }))
    }
    dialog.appendChild(sourceRow)

    const question = document.createElement('div')
    question.textContent = binding.question
    Object.assign(question.style, {
      fontSize: '1.02rem',
      lineHeight: '1.5',
      padding: '0.65rem 0.8rem',
      background: 'rgba(255, 225, 74, 0.12)',
      border: '1px solid rgba(255, 225, 74, 0.28)',
      borderLeftWidth: '3px',
      borderRadius: '4px 6px 6px 4px',
      whiteSpace: 'pre-wrap',
    } as CSSStyleDeclaration)
    dialog.appendChild(question)

    const input = document.createElement('textarea')
    const i18n = (window as any).ioc?.get?.(I18N_IOC_KEY) as I18nProvider | undefined
    input.placeholder = i18n?.t('dashboard.answer.placeholder') ?? 'type your answer…'
    input.rows = 4
    Object.assign(input.style, {
      width: '100%',
      resize: 'vertical',
      padding: '0.55rem 0.7rem',
      background: 'rgba(0,0,0,0.22)',
      color: 'inherit',
      border: '1px solid rgba(255,255,255,0.1)',
      borderRadius: '6px',
      font: 'inherit',
      lineHeight: '1.45',
      boxSizing: 'border-box',
    } as CSSStyleDeclaration)
    dialog.appendChild(input)

    const status = document.createElement('div')
    Object.assign(status.style, {
      minHeight: '1.1em',
      fontSize: '0.78rem',
      opacity: '0.75',
    } as CSSStyleDeclaration)
    dialog.appendChild(status)

    const actions = document.createElement('div')
    Object.assign(actions.style, {
      display: 'flex',
      justifyContent: 'flex-end',
      gap: '0.6rem',
    } as CSSStyleDeclaration)
    const doneBtn = document.createElement('button')
    doneBtn.type = 'button'
    doneBtn.textContent = i18n?.t('dashboard.done') ?? 'Done'
    Object.assign(doneBtn.style, {
      padding: '0.45rem 1.2rem',
      background: 'rgba(110, 180, 255, 0.22)',
      border: '1px solid rgba(110, 180, 255, 0.55)',
      borderRadius: '6px',
      color: '#d4e6ff',
      fontWeight: '600',
      letterSpacing: '0.02em',
      cursor: 'pointer',
    } as CSSStyleDeclaration)
    actions.appendChild(doneBtn)
    dialog.appendChild(actions)

    overlay.appendChild(dialog)
    document.body.appendChild(overlay)
    this.#overlay = overlay

    requestAnimationFrame(() => { overlay.style.opacity = '1' })
    setTimeout(() => { try { input.focus() } catch { /* ignore */ } }, 60)

    document.addEventListener('keydown', this.#onKeyDown)
    EffectBus.emit('view:active', { active: true, type: 'qa-modal' })

    const setStatus = (msg: string, isErr = false): void => {
      status.textContent = msg
      status.style.color = isErr ? '#ff9b9b' : ''
      status.style.opacity = isErr ? '1' : '0.75'
    }

    doneBtn.addEventListener('click', async () => {
      const text = input.value.trim()
      if (!text) { setStatus('type an answer first', true); input.focus(); return }
      const cur = this.#current
      if (!cur) { setStatus('no question loaded', true); return }
      doneBtn.disabled = true
      input.disabled = true
      setStatus('committing answer…')
      try {
        await this.#commit(cur, text)
        this.#onAfterCommit?.(cur)
        this.close()
      } catch (err) {
        doneBtn.disabled = false
        input.disabled = false
        const msg = err instanceof Error ? err.message : String(err)
        setStatus('failed: ' + msg, true)
      }
    })
  }

  close(): void {
    if (!this.#overlay) return
    const overlay = this.#overlay
    this.#overlay = null
    this.#current = null
    this.#onAfterCommit = null
    overlay.style.opacity = '0'
    overlay.addEventListener('transitionend', () => overlay.remove(), { once: true })
    setTimeout(() => overlay.remove(), 280)
    document.removeEventListener('keydown', this.#onKeyDown)
    EffectBus.emit('view:active', { active: false, type: 'qa-modal' })
  }

  get isOpen(): boolean {
    return this.#overlay !== null
  }

  async #commit(binding: QaBindingPayload, text: string): Promise<void> {
    const store = get<StoreLike>('@hypercomb.social/Store')
    if (!store?.putOptimization) throw new Error('Store.putOptimization unavailable')
    const path = binding.qPath
    if (path.length === 0) throw new Error('missing cell path')

    // 1) Mint a `qa-answer` optimization pairing the question with the
    //    user's raw answer. This is decoration, not canonical content
    //    — it sits in `__optimization__/` until the next codegen pass
    //    reads it, interprets the answer, and (if warranted) writes a
    //    note via the state-machine `update(layer)` path. The note is
    //    Claude's instruction-form interpretation; the user's raw text
    //    is never promoted to a note directly.
    const answer = {
      kind: 'qa-answer',
      appliesTo: path,
      payload: {
        qId: binding.qId,
        qSig: binding.qSig || '',
        question: binding.question,
        answer: text,
        answeredAt: Date.now(),
      },
      mark: 'persistent',
    }
    const blob = new Blob([new TextEncoder().encode(JSON.stringify(answer)) as BlobPart])
    await store.putOptimization(blob)

    // 2) Clean up the original open-Q optimization. Layer's `qa` slot
    //    is no longer the source of truth — Q&A lives only in the
    //    optimization substrate (see layer-purity rule), so a single
    //    `removeOptimization` retires the open question everywhere.
    if (binding.qSig) {
      try { await store.removeOptimization?.(binding.qSig) } catch { /* tolerate */ }
    }
  }

  #onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      this.close()
    }
  }
}

const _qaModalView = new QaModalView()
window.ioc.register('@diamondcoreprocessor.com/QaModalView', _qaModalView)
