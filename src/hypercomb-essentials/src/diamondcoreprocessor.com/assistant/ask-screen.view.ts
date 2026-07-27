// diamondcoreprocessor.com/assistant/ask-screen.view.ts
//
// ASK SCREEN — the fullscreen REQUEST-REFINEMENT HARNESS behind /opus,
// /sonnet, /haiku (Jaime, 2026-07-25: "we have a conversation and we build
// the request… after we've refined it, that's the note we send").
//
// The mental model: notes are INSTRUCTIONS — the AI routine reads notes and
// acts on them later. So the raw first thought should not become the note;
// this screen is an embedded harness for refining it first:
//
//   DRAFT (top)        — the request being built. THIS is what ships.
//   CONVERSATION (mid) — chat turns with the live responder to refine it.
//                        Turns ride the same kind:'ask' channel with
//                        payload.mode='chat'; replies come back through the
//                        `chat-reply` bridge op → `ask:chat-reply` effect —
//                        never as notes, never raising the note pill.
//   SEND AS NOTE       — commits the refined draft as a note on the chosen
//                        tiles (NotesService, the participant's own write),
//                        where the routine will find it.
//
// Mirrors QaModalView's pattern: DOM singleton, IoC, no Angular; view-mode
// rides the owner-counted ModeRegistry. Cold steel chrome throughout.

import { EffectBus, I18N_IOC_KEY, type I18nProvider } from '@hypercomb/core'

type AskOpenPayload = { model?: string; prefill?: string }
type ChatReplyPayload = { convoId: string; text: string }
type QueenLike = {
  activeModel: string
  submitChat?: (convoId: string, message: string, targets: string[], transcript: ReadonlyArray<{ role: string; text: string }>) => Promise<boolean>
}
type ShowCellLike = { renderedCells?: Map<string, unknown> }
type SelectionLike = { selected: ReadonlySet<string> }
type LineageLike = { explorerSegments?: () => readonly string[] }
type ModeRegistryLike = { enter(mode: string, owner: string): void; exit(mode: string, owner: string): void }
type NotesLike = { addAtSegments?: (segments: readonly string[], cell: string, text: string) => Promise<void> }

const STYLE_ID = 'hc-ask-screen-styles'
const STEEL = '126, 182, 214'
const OWNER = 'ask-screen'

const ioc = <T,>(key: string): T | undefined =>
  (window as unknown as { ioc?: { get?: (k: string) => unknown } }).ioc?.get?.(key) as T | undefined

export class AskScreenView extends EventTarget {
  #overlay: HTMLDivElement | null = null
  #model = 'haiku'
  #convoId = ''
  #chosen = new Set<string>()
  #transcript: Array<{ role: 'user' | 'ai'; text: string }> = []
  #segments: string[] = []
  #thread: HTMLDivElement | null = null
  #draft: HTMLTextAreaElement | null = null
  #thinking: HTMLDivElement | null = null
  #onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') { e.stopPropagation(); this.close() }
  }

  constructor() {
    super()
    EffectBus.on<AskOpenPayload>('ask:open', payload => {
      this.show(String(payload?.model || 'haiku'), String(payload?.prefill ?? ''))
    })
    EffectBus.on<ChatReplyPayload>('ask:chat-reply', payload => {
      if (!this.#overlay || payload?.convoId !== this.#convoId) return
      this.#appendAi(String(payload.text ?? ''))
    })
  }

  #t(key: string, fallback: string): string {
    const i18n = ioc<I18nProvider>(I18N_IOC_KEY)
    const value = i18n?.t?.(key)
    return value && value !== key ? value : fallback
  }

  #setViewMode(active: boolean): void {
    const modes = ioc<ModeRegistryLike>('@diamondcoreprocessor.com/ModeRegistry')
    if (active) modes?.enter('view:active', OWNER)
    else modes?.exit('view:active', OWNER)
  }

  show(model: string, prefill: string): void {
    if (this.#overlay) this.close()
    this.#model = model
    this.#convoId = `convo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    this.#chosen = new Set<string>()
    this.#transcript = []
    this.#ensureStyles()

    const labels = [...(ioc<ShowCellLike>('@diamondcoreprocessor.com/ShowCellDrone')?.renderedCells?.keys() ?? [])]
    const preset = ioc<SelectionLike>('@diamondcoreprocessor.com/SelectionService')?.selected
    for (const label of preset ?? []) if (labels.includes(label)) this.#chosen.add(label)
    this.#segments = (ioc<LineageLike>('@hypercomb.social/Lineage')?.explorerSegments?.() ?? [])
      .map(s => String(s ?? '').trim()).filter(Boolean)
    const atRoot = this.#segments.length === 0

    const overlay = document.createElement('div')
    overlay.className = 'hc-ask'

    // ── header ──
    const head = document.createElement('div')
    head.className = 'hc-ask-head'
    const title = document.createElement('span')
    title.className = 'hc-ask-title'
    title.textContent = this.#t('ask.refine-title', 'Refine the request') + ' · ' + model
    const close = document.createElement('button')
    close.type = 'button'
    close.className = 'hc-ask-close'
    close.textContent = '×'
    close.setAttribute('aria-label', this.#t('ask.cancel', 'Cancel'))
    close.addEventListener('click', () => this.close())
    head.appendChild(title)
    head.appendChild(close)

    // ── the draft: what actually ships ──
    const draftWrap = document.createElement('div')
    draftWrap.className = 'hc-ask-draftwrap'
    const draftLabel = document.createElement('div')
    draftLabel.className = 'hc-ask-label'
    draftLabel.textContent = this.#t('ask.draft-label', 'The request — this is what gets sent as the note')
    const draft = document.createElement('textarea')
    draft.className = 'hc-ask-draft'
    draft.rows = 3
    draft.placeholder = this.#t('ask.draft-placeholder', 'Build the request here…')
    draft.value = prefill
    draftWrap.appendChild(draftLabel)
    draftWrap.appendChild(draft)
    this.#draft = draft

    // ── targets ──
    const chipsWrap = document.createElement('div')
    chipsWrap.className = 'hc-ask-chips'
    const hint = document.createElement('div')
    hint.className = 'hc-ask-hint'
    const refreshHint = (): void => {
      if (this.#chosen.size > 0) hint.textContent = this.#t('ask.hint-chosen', 'The note lands on:') + ' ' + [...this.#chosen].join(', ')
      // At the root with nothing picked the ask is HIVE-WIDE — a legitimate
      // shape ("go through the hive and …"), not an error. It has no single
      // tile to own the answer, so the answer arrives in the feedback window.
      else if (atRoot) hint.textContent = this.#t('ask.hint-hive', 'Nothing picked — this asks about the whole hive; the answer arrives in the feedback window.')
      else hint.textContent = this.#t('ask.hint-page', 'No tiles picked — the note lands on this page.')
    }
    for (const label of labels) {
      const chip = document.createElement('button')
      chip.type = 'button'
      chip.className = 'hc-ask-chip'
      chip.textContent = label
      if (this.#chosen.has(label)) chip.classList.add('on')
      chip.addEventListener('click', () => {
        if (this.#chosen.has(label)) this.#chosen.delete(label)
        else this.#chosen.add(label)
        chip.classList.toggle('on', this.#chosen.has(label))
        refreshHint()
      })
      chipsWrap.appendChild(chip)
    }
    refreshHint()

    // ── conversation thread ──
    const thread = document.createElement('div')
    thread.className = 'hc-ask-thread'
    this.#thread = thread

    // ── chat input ──
    const chatRow = document.createElement('div')
    chatRow.className = 'hc-ask-chatrow'
    const chatInput = document.createElement('textarea')
    chatInput.className = 'hc-ask-chatinput'
    chatInput.rows = 1
    chatInput.placeholder = this.#t('ask.chat-placeholder', 'Talk it through — refine the request above…')
    const send = document.createElement('button')
    send.type = 'button'
    send.className = 'hc-ask-btn'
    send.textContent = this.#t('ask.chat-send', 'Send')
    const doSend = (): void => { void this.#sendChat(chatInput) }
    send.addEventListener('click', doSend)
    chatInput.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doSend() }
    })
    chatRow.appendChild(chatInput)
    chatRow.appendChild(send)

    // ── actions ──
    const actions = document.createElement('div')
    actions.className = 'hc-ask-actions'
    const cancel = document.createElement('button')
    cancel.type = 'button'
    cancel.className = 'hc-ask-btn'
    cancel.textContent = this.#t('ask.cancel', 'Cancel')
    cancel.addEventListener('click', () => this.close())
    const sendNote = document.createElement('button')
    sendNote.type = 'button'
    sendNote.className = 'hc-ask-btn hc-ask-ok'
    sendNote.textContent = this.#t('ask.send-note', 'Send as note')
    sendNote.addEventListener('click', () => { void this.#sendAsNote(sendNote, atRoot) })
    actions.appendChild(cancel)
    actions.appendChild(sendNote)

    overlay.appendChild(head)
    overlay.appendChild(draftWrap)
    overlay.appendChild(chipsWrap)
    overlay.appendChild(hint)
    overlay.appendChild(thread)
    overlay.appendChild(chatRow)
    overlay.appendChild(actions)
    document.body.appendChild(overlay)
    document.addEventListener('keydown', this.#onKey, true)

    this.#overlay = overlay
    this.#setViewMode(true)
    queueMicrotask(() => (prefill ? chatInput : draft).focus())
  }

  #bubble(role: 'user' | 'ai', text: string): HTMLDivElement {
    const b = document.createElement('div')
    b.className = `hc-ask-msg ${role}`
    const body = document.createElement('div')
    body.className = 'hc-ask-msgtext'
    body.textContent = text
    b.appendChild(body)
    if (role === 'ai') {
      const use = document.createElement('button')
      use.type = 'button'
      use.className = 'hc-ask-use'
      use.textContent = this.#t('ask.use-draft', '→ draft')
      use.title = this.#t('ask.use-draft-hint', 'Replace the request draft with this')
      use.addEventListener('click', () => { if (this.#draft) this.#draft.value = text })
      b.appendChild(use)
    }
    return b
  }

  #appendAi(text: string): void {
    this.#thinking?.remove()
    this.#thinking = null
    if (!this.#thread) return
    this.#transcript.push({ role: 'ai', text })
    this.#thread.appendChild(this.#bubble('ai', text))
    this.#thread.scrollTop = this.#thread.scrollHeight
  }

  async #sendChat(input: HTMLTextAreaElement): Promise<void> {
    const message = input.value.trim()
    if (!message || !this.#thread) return
    const queen = ioc<QueenLike>('@diamondcoreprocessor.com/LlmQueenBee')
    if (!queen?.submitChat) {
      EffectBus.emit('toast:show', { type: 'warning', message: 'Ask service unavailable — try again in a moment.' })
      return
    }
    input.value = ''
    this.#transcript.push({ role: 'user', text: message })
    this.#thread.appendChild(this.#bubble('user', message))
    // thinking indicator — the conversation's own feedback (no global pill)
    const think = document.createElement('div')
    think.className = 'hc-ask-msg ai hc-ask-think'
    think.textContent = '…'
    this.#thread.appendChild(think)
    this.#thinking = think
    this.#thread.scrollTop = this.#thread.scrollHeight
    queen.activeModel = this.#model
    const ok = await queen.submitChat(this.#convoId, message, [...this.#chosen], this.#transcript)
    if (!ok) {
      this.#thinking?.remove()
      this.#thinking = null
      EffectBus.emit('toast:show', { type: 'warning', message: 'Could not send — try again.' })
    }
  }

  async #sendAsNote(button: HTMLButtonElement, atRoot: boolean): Promise<void> {
    const text = (this.#draft?.value ?? '').trim()
    if (!text) { this.#draft?.focus(); this.#draft?.classList.add('miss'); setTimeout(() => this.#draft?.classList.remove('miss'), 600); return }

    // HIVE-WIDE: no tile to write a note on, so the refined request is minted
    // as an ASK instead — the responder does the hive work and reports into the
    // feedback window. Same button, honest destination.
    if (atRoot && this.#chosen.size === 0) {
      const queen = ioc<QueenLike & { submitAsk?: (p: string, t: string[]) => Promise<boolean> }>('@diamondcoreprocessor.com/LlmQueenBee')
      if (!queen?.submitAsk) {
        EffectBus.emit('toast:show', { type: 'warning', message: 'Ask service unavailable — try again in a moment.' })
        return
      }
      button.disabled = true
      queen.activeModel = this.#model
      const ok = await queen.submitAsk(text, [])
      if (ok) this.close()
      else button.disabled = false
      return
    }

    const notes = ioc<NotesLike>('@diamondcoreprocessor.com/NotesService')
    if (!notes?.addAtSegments) {
      EffectBus.emit('toast:show', { type: 'warning', message: 'Notes service unavailable — try again in a moment.' })
      return
    }
    button.disabled = true
    try {
      const targets = this.#chosen.size > 0
        ? [...this.#chosen].map(label => ({ parent: this.#segments, cell: label }))
        : [{ parent: this.#segments.slice(0, -1), cell: this.#segments[this.#segments.length - 1] }]
      for (const t of targets) await notes.addAtSegments(t.parent, t.cell, text)
      const where = targets.map(t => t.cell).join(', ')
      EffectBus.emit('toast:show', {
        type: 'success',
        title: this.#t('ask.sent-title', 'Note sent'),
        message: this.#t('ask.sent-body', 'On') + ` ${where} — ` + this.#t('ask.sent-tail', 'the routine will pick it up.'),
      })
      this.close()
    } catch {
      button.disabled = false
      EffectBus.emit('toast:show', { type: 'warning', message: 'Could not write the note — try again.' })
    }
  }

  close(): void {
    document.removeEventListener('keydown', this.#onKey, true)
    this.#overlay?.remove()
    this.#overlay = null
    this.#thread = null
    this.#draft = null
    this.#thinking = null
    this.#convoId = ''
    this.#setViewMode(false)
  }

  #ensureStyles(): void {
    if (document.getElementById(STYLE_ID)) return
    const style = document.createElement('style')
    style.id = STYLE_ID
    style.textContent = `
.hc-ask{position:fixed;inset:0;z-index:100000;display:flex;flex-direction:column;gap:0.7rem;
  background:rgba(6,9,14,0.97);padding:max(0.9rem,env(safe-area-inset-top,0px)) 1.1rem max(0.9rem,env(safe-area-inset-bottom,0px));
  box-sizing:border-box;animation:hc-ask-in 160ms ease;}
.hc-ask-head{display:flex;align-items:center;justify-content:space-between;flex:0 0 auto;}
.hc-ask-title{font-family:var(--hc-mono,monospace);font-size:0.78rem;font-weight:600;letter-spacing:0.12em;
  text-transform:uppercase;color:rgba(${STEEL},0.95);}
.hc-ask-close{width:2.6rem;height:2.6rem;border:none;background:none;color:rgba(245,245,245,0.4);
  font-size:1.5rem;cursor:pointer;border-radius:6px;}
.hc-ask-close:hover{color:whitesmoke;background:rgba(255,255,255,0.07);}
.hc-ask-label{font-size:0.72rem;letter-spacing:0.04em;color:rgba(${STEEL},0.75);margin-bottom:0.3rem;}
.hc-ask-draftwrap{flex:0 0 auto;}
.hc-ask-draft{width:100%;box-sizing:border-box;resize:vertical;min-height:4rem;padding:0.7rem 0.8rem;
  font:inherit;font-size:16px;line-height:1.5;color:whitesmoke;background:rgba(${STEEL},0.07);
  border:1px solid rgba(${STEEL},0.35);border-radius:8px;outline:none;}
.hc-ask-draft:focus{border-color:rgba(${STEEL},0.7);}
.hc-ask-draft.miss{border-color:rgba(226,75,74,0.8);}
.hc-ask-chips{display:flex;flex-wrap:wrap;gap:0.45rem;flex:0 0 auto;max-height:5.4rem;overflow-y:auto;}
.hc-ask-hint{font-size:0.76rem;color:rgba(216,230,238,0.55);flex:0 0 auto;min-height:1.05em;}
.hc-ask-chip{padding:0.45rem 0.85rem;border-radius:999px;border:1px solid rgba(255,255,255,0.14);
  background:rgba(255,255,255,0.04);color:rgba(235,242,248,0.85);font:inherit;font-size:0.85rem;
  cursor:pointer;min-height:2.3rem;transition:background 120ms ease,border-color 120ms ease;}
.hc-ask-chip:hover{border-color:rgba(${STEEL},0.5);}
.hc-ask-chip.on{background:rgba(${STEEL},0.22);border-color:rgba(${STEEL},0.85);color:#eaf5fb;}
.hc-ask-thread{flex:1 1 auto;min-height:0;overflow-y:auto;display:flex;flex-direction:column;gap:0.55rem;
  padding:0.4rem 0.1rem;border-top:1px solid rgba(255,255,255,0.07);border-bottom:1px solid rgba(255,255,255,0.07);}
.hc-ask-msg{max-width:min(46rem,88%);padding:0.6rem 0.8rem;border-radius:10px;font-size:0.92rem;line-height:1.5;
  color:rgba(238,244,250,0.92);position:relative;}
.hc-ask-msg.user{align-self:flex-end;background:rgba(${STEEL},0.16);border:1px solid rgba(${STEEL},0.3);}
.hc-ask-msg.ai{align-self:flex-start;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);}
.hc-ask-msgtext{white-space:pre-wrap;word-break:break-word;}
.hc-ask-think{color:rgba(216,230,238,0.5);letter-spacing:0.2em;animation:hc-ask-pulse 1.2s ease-in-out infinite;}
.hc-ask-use{margin-top:0.45rem;border:1px solid rgba(${STEEL},0.4);background:none;color:rgba(${STEEL},0.9);
  font:inherit;font-size:0.72rem;padding:0.2rem 0.55rem;border-radius:6px;cursor:pointer;}
.hc-ask-use:hover{background:rgba(${STEEL},0.15);}
.hc-ask-chatrow{display:flex;gap:0.55rem;flex:0 0 auto;align-items:flex-end;}
.hc-ask-chatinput{flex:1 1 auto;box-sizing:border-box;resize:none;min-height:2.7rem;max-height:7rem;
  padding:0.6rem 0.8rem;font:inherit;font-size:16px;line-height:1.4;color:whitesmoke;
  background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.12);border-radius:8px;outline:none;}
.hc-ask-chatinput:focus{border-color:rgba(${STEEL},0.55);}
.hc-ask-actions{display:flex;justify-content:flex-end;gap:0.6rem;flex:0 0 auto;}
.hc-ask-btn{min-height:2.6rem;padding:0 1.2rem;border-radius:8px;border:1px solid rgba(255,255,255,0.14);
  background:none;color:rgba(235,242,248,0.85);font:inherit;font-size:0.9rem;cursor:pointer;}
.hc-ask-btn:hover{border-color:rgba(255,255,255,0.3);}
.hc-ask-ok{background:rgba(${STEEL},0.9);border-color:rgba(${STEEL},0.9);color:#0c1118;font-weight:700;}
.hc-ask-ok:hover{background:rgb(${STEEL});}
.hc-ask-ok:disabled{opacity:0.55;cursor:default;}
@keyframes hc-ask-in{from{opacity:0}to{opacity:1}}
@keyframes hc-ask-pulse{0%,100%{opacity:0.4}50%{opacity:1}}
@media (prefers-reduced-motion: reduce){.hc-ask{animation:none;}.hc-ask-think{animation:none;}}
`
    document.head.appendChild(style)
  }
}

// ── registration ────────────────────────────────────────
const _askScreen = new AskScreenView()
window.ioc.register('@diamondcoreprocessor.com/AskScreenView', _askScreen)
