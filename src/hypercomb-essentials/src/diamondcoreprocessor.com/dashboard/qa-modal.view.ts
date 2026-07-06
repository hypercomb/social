// diamondcoreprocessor.com/dashboard/qa-modal.view.ts
//
// QA Modal — fullscreen-overlay dialog that opens when a tile with a
// `dashboard-q-binding` is clicked. Shows the question, accepts an
// answer, and persists the (question, answer) pair as a
// `kind: 'qa-answer'` optimization in the sign('optimization') pool (via
// Store.putOptimization; legacy `__optimization__/` is a read-fallback). The
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
//
// LOOK: cold / clean chrome — steel accent (126,182,214), a glass
// backdrop, no warm highlights, gentle scale-in. The question's
// category (its qPath root) surfaces as an indicator pill, echoing
// the dashboard's island grouping.

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

const STYLE_ID = 'hc-qa-modal-styles'

/** Steel chrome accent, shared with the rest of the cold UI. */
const STEEL = '126, 182, 214'

export class QaModalView extends EventTarget {
  #overlay: HTMLDivElement | null = null
  #current: QaBindingPayload | null = null
  #onAfterCommit: ((payload: QaBindingPayload) => void) | null = null

  show(binding: QaBindingPayload, onAfterCommit?: (p: QaBindingPayload) => void): void {
    if (this.#overlay) this.close()
    this.#current = binding
    this.#onAfterCommit = onAfterCommit ?? null
    this.#ensureStyles()

    const i18n = (window as any).ioc?.get?.(I18N_IOC_KEY) as I18nProvider | undefined

    const overlay = document.createElement('div')
    overlay.className = 'hc-qa'
    overlay.setAttribute('data-hc-qa-modal', '')

    const backdrop = document.createElement('div')
    backdrop.className = 'hc-qa__backdrop'
    backdrop.addEventListener('click', () => this.close())
    overlay.appendChild(backdrop)

    const dialog = document.createElement('div')
    dialog.className = 'hc-qa__dialog'
    dialog.setAttribute('role', 'dialog')
    dialog.setAttribute('aria-modal', 'true')
    dialog.addEventListener('click', (e) => e.stopPropagation())

    const closeBtn = document.createElement('button')
    closeBtn.type = 'button'
    closeBtn.className = 'hc-qa__close'
    closeBtn.setAttribute('aria-label', 'close')
    closeBtn.textContent = '×'
    closeBtn.addEventListener('click', () => this.close())
    dialog.appendChild(closeBtn)

    // ── header: category pill + source path + quick-nav ─────────────────
    const header = document.createElement('div')
    header.className = 'hc-qa__header'

    // The question's category = the root of its path (games / websites /
    // feedback …) — the same key the dashboard groups islands by. A
    // path-less question is a general one.
    const category = binding.qPath.length ? String(binding.qPath[0]) : 'general'
    const pill = document.createElement('span')
    pill.className = 'hc-qa__pill'
    pill.textContent = category
    header.appendChild(pill)

    const sourceLabel = document.createElement('span')
    sourceLabel.className = 'hc-qa__source'
    sourceLabel.textContent = binding.qPath.length === 0 ? '/' : '/' + binding.qPath.join('/')
    sourceLabel.title = sourceLabel.textContent
    header.appendChild(sourceLabel)

    const routeOf = (segs: readonly string[]): string =>
      location.origin + '/' + segs.map(s => encodeURIComponent(String(s))).join('/')
    const mkNav = (label: string, title: string, onClick: () => void): HTMLButtonElement => {
      const b = document.createElement('button')
      b.type = 'button'
      b.className = 'hc-qa__nav'
      b.textContent = label
      b.title = title
      b.addEventListener('click', (e) => { e.stopPropagation(); onClick() })
      return b
    }
    if (binding.qPath.length > 0) {
      header.appendChild(mkNav('→ tile', 'Go to this tile', () => {
        const nav = get<{ goRaw?: (s: readonly string[]) => void }>('@hypercomb.social/Navigation')
        nav?.goRaw?.(binding.qPath)
        this.close()
      }))
      header.appendChild(mkNav('↗', 'Open this tile in a new window', () => {
        window.open(routeOf(binding.qPath), '_blank', 'noopener')
      }))
    }
    dialog.appendChild(header)

    // ── the question ────────────────────────────────────────────────────
    const question = document.createElement('div')
    question.className = 'hc-qa__question'
    question.textContent = binding.question
    dialog.appendChild(question)

    // ── answer ──────────────────────────────────────────────────────────
    const input = document.createElement('textarea')
    input.className = 'hc-qa__input'
    input.placeholder = i18n?.t('dashboard.answer.placeholder') ?? 'type your answer…'
    input.rows = 4
    dialog.appendChild(input)

    // ── footer: keyboard hint + Done ────────────────────────────────────
    const status = document.createElement('div')
    status.className = 'hc-qa__status'
    const isMac = /Mac|iP(hone|ad)/.test(navigator.platform)
    const submitHint = (isMac ? '⌘' : 'Ctrl') + ' + Enter to submit'
    status.textContent = submitHint
    status.dataset['hint'] = '1'

    const actions = document.createElement('div')
    actions.className = 'hc-qa__actions'
    const doneBtn = document.createElement('button')
    doneBtn.type = 'button'
    doneBtn.className = 'hc-qa__done'
    doneBtn.textContent = i18n?.t('dashboard.done') ?? 'Done'
    actions.appendChild(doneBtn)

    const footer = document.createElement('div')
    footer.className = 'hc-qa__footer'
    footer.appendChild(status)
    footer.appendChild(actions)
    dialog.appendChild(footer)

    overlay.appendChild(dialog)
    document.body.appendChild(overlay)
    this.#overlay = overlay

    requestAnimationFrame(() => { overlay.classList.add('hc-qa--in') })
    setTimeout(() => { try { input.focus() } catch { /* ignore */ } }, 60)

    document.addEventListener('keydown', this.#onKeyDown)
    EffectBus.emit('view:active', { active: true, type: 'qa-modal' })

    const setStatus = (msg: string, isErr = false): void => {
      status.textContent = msg
      delete status.dataset['hint']
      status.classList.toggle('hc-qa__status--err', isErr)
    }
    const resetHint = (): void => {
      status.textContent = submitHint
      status.dataset['hint'] = '1'
      status.classList.remove('hc-qa__status--err')
    }

    const submit = async (): Promise<void> => {
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
    }

    doneBtn.addEventListener('click', () => void submit())
    // Cmd/Ctrl + Enter submits from the textarea; typing clears a stale error.
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void submit() }
    })
    input.addEventListener('input', () => { if (!status.dataset['hint']) resetHint() })
  }

  close(): void {
    if (!this.#overlay) return
    const overlay = this.#overlay
    this.#overlay = null
    this.#current = null
    this.#onAfterCommit = null
    overlay.classList.remove('hc-qa--in')
    overlay.addEventListener('transitionend', () => overlay.remove(), { once: true })
    setTimeout(() => overlay.remove(), 280)
    document.removeEventListener('keydown', this.#onKeyDown)
    EffectBus.emit('view:active', { active: false, type: 'qa-modal' })
  }

  get isOpen(): boolean {
    return this.#overlay !== null
  }

  /** Inject the modal stylesheet once. Kept as a <style> (not inline) so
   *  hover/focus states and the scale-in keyframe can be expressed cleanly;
   *  every rule is scoped under `.hc-qa` so nothing leaks. */
  #ensureStyles(): void {
    if (document.getElementById(STYLE_ID)) return
    const style = document.createElement('style')
    style.id = STYLE_ID
    style.textContent = `
.hc-qa {
  position: fixed; inset: 0; z-index: 60000;
  display: flex; align-items: center; justify-content: center;
  opacity: 0; transition: opacity 180ms ease;
}
.hc-qa.hc-qa--in { opacity: 1; }
.hc-qa__backdrop {
  position: absolute; inset: 0; cursor: pointer;
  background: rgba(8, 12, 16, 0.62);
  backdrop-filter: blur(6px) saturate(0.9);
  -webkit-backdrop-filter: blur(6px) saturate(0.9);
}
.hc-qa__dialog {
  position: relative; width: min(560px, 92vw); max-height: 82vh;
  padding: 1.35rem 1.4rem 1.15rem; box-sizing: border-box;
  display: flex; flex-direction: column; gap: 0.9rem;
  color: #e6edf2;
  font: 14px/1.5 Inter, system-ui, sans-serif;
  background: linear-gradient(180deg, #191c22 0%, #15171c 100%);
  border: 1px solid rgba(${STEEL}, 0.22);
  border-radius: 14px;
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(0,0,0,0.4);
  overflow: hidden;
  transform: translateY(6px) scale(0.985);
  transition: transform 200ms cubic-bezier(0.2, 0.8, 0.2, 1);
}
.hc-qa.hc-qa--in .hc-qa__dialog { transform: translateY(0) scale(1); }
/* thin steel accent line along the top edge */
.hc-qa__dialog::before {
  content: ''; position: absolute; top: 0; left: 0; right: 0; height: 2px;
  background: linear-gradient(90deg, transparent, rgba(${STEEL}, 0.75), transparent);
}
.hc-qa__close {
  position: absolute; top: 0.55rem; right: 0.6rem;
  width: 1.9rem; height: 1.9rem; border: none; background: transparent;
  color: #9aa7b2; font-size: 1.35rem; line-height: 1; cursor: pointer;
  border-radius: 6px; transition: color 120ms ease, background 120ms ease;
}
.hc-qa__close:hover { color: #e6edf2; background: rgba(255,255,255,0.06); }
.hc-qa__header {
  display: flex; align-items: center; gap: 0.5rem;
  padding-right: 2rem; min-width: 0;
}
.hc-qa__pill {
  flex: 0 0 auto; font-size: 0.66rem; font-weight: 600;
  text-transform: uppercase; letter-spacing: 0.08em;
  padding: 0.2rem 0.55rem; border-radius: 999px;
  color: #bcdcee;
  background: rgba(${STEEL}, 0.14);
  border: 1px solid rgba(${STEEL}, 0.34);
}
.hc-qa__source {
  flex: 1 1 auto; min-width: 0;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-size: 0.76rem; color: #8b98a4; letter-spacing: 0.02em;
}
.hc-qa__nav {
  flex: 0 0 auto; cursor: pointer;
  border: 1px solid rgba(${STEEL}, 0.24);
  background: rgba(${STEEL}, 0.06);
  color: #c6d3dc; border-radius: 6px;
  padding: 0.18rem 0.5rem; font-size: 0.78rem; line-height: 1;
  transition: background 120ms ease, border-color 120ms ease, color 120ms ease;
}
.hc-qa__nav:hover {
  background: rgba(${STEEL}, 0.2); border-color: rgba(${STEEL}, 0.5); color: #eaf3f8;
}
.hc-qa__question {
  font-size: 1.06rem; line-height: 1.5; color: #f0f4f7;
  padding: 0.8rem 0.95rem; white-space: pre-wrap;
  background: rgba(${STEEL}, 0.07);
  border: 1px solid rgba(${STEEL}, 0.16);
  border-left: 3px solid rgba(${STEEL}, 0.7);
  border-radius: 4px 8px 8px 4px;
}
.hc-qa__input {
  width: 100%; box-sizing: border-box; resize: vertical; min-height: 5.5rem;
  padding: 0.65rem 0.75rem; color: inherit; font: inherit; line-height: 1.5;
  background: rgba(0, 0, 0, 0.28);
  border: 1px solid rgba(255, 255, 255, 0.09);
  border-radius: 8px;
  transition: border-color 130ms ease, box-shadow 130ms ease, background 130ms ease;
}
.hc-qa__input::placeholder { color: #6f7c88; }
.hc-qa__input:focus {
  outline: none; background: rgba(0, 0, 0, 0.34);
  border-color: rgba(${STEEL}, 0.6);
  box-shadow: 0 0 0 3px rgba(${STEEL}, 0.14);
}
.hc-qa__footer {
  display: flex; align-items: center; justify-content: space-between; gap: 0.75rem;
}
.hc-qa__status {
  flex: 1 1 auto; min-height: 1.1em; font-size: 0.75rem;
  color: #6f7c88; letter-spacing: 0.02em;
}
.hc-qa__status--err { color: #ff9b9b !important; }
.hc-qa__actions { flex: 0 0 auto; display: flex; gap: 0.6rem; }
.hc-qa__done {
  padding: 0.5rem 1.35rem; cursor: pointer;
  color: #eaf4fa; font-weight: 600; letter-spacing: 0.02em; font-size: 0.9rem;
  background: rgba(${STEEL}, 0.18);
  border: 1px solid rgba(${STEEL}, 0.55);
  border-radius: 8px;
  transition: background 130ms ease, border-color 130ms ease, transform 80ms ease;
}
.hc-qa__done:hover { background: rgba(${STEEL}, 0.3); border-color: rgba(${STEEL}, 0.8); }
.hc-qa__done:active { transform: translateY(1px); }
.hc-qa__done:disabled { opacity: 0.5; cursor: default; }
@media (prefers-reduced-motion: reduce) {
  .hc-qa, .hc-qa__dialog { transition: none; }
}
`
    document.head.appendChild(style)
  }

  async #commit(binding: QaBindingPayload, text: string): Promise<void> {
    const store = get<StoreLike>('@hypercomb.social/Store')
    if (!store?.putOptimization) throw new Error('Store.putOptimization unavailable')
    const path = binding.qPath
    if (path.length === 0) throw new Error('missing cell path')

    // 1) Mint a `qa-answer` optimization pairing the question with the
    //    user's raw answer. This is decoration, not canonical content
    //    — it sits in the sign('optimization') pool until the next codegen pass
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
