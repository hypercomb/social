// notes/note-lines-view.drone.ts
//
// THE LINES VIEW — the swarm room as note lines instead of hexagons
// (jwize 2026-10-13). Same swarm, same acts, different surface:
//
//   * everyone in the room shares the notes they hold on the page — the
//     page's word carries their REFERENCES (SwarmLayerPayload.notes); a note
//     is a file, fetched by signature from whoever holds it;
//   * each line wears the colour of the participant who brought it in;
//   * the top says the room in counts — people, lines, yours, still to take;
//   * TAKE collects a line (the same signature onto your page — shared, never
//     copied); leaving the room takes your untaken lines with you, as it
//     takes your tiles;
//   * the line at the bottom writes a note on the page; Enter sends and keeps
//     the line open.
//
// A view mode like the tree or the slides (`lines`, opened with the `lines`
// word): a fixed host above the Pixi layer, owner-counted `view:active`, zero
// shell edits. Exits: Escape, right-click, the close button, or `lines off`.
// It writes nothing but the notes a participant writes or takes, through the
// notes service — never a store of its own.

import { Drone, EffectBus, I18N_IOC_KEY, type I18nProvider } from '@hypercomb/core'
import { foldNoteLines, participantColor, LINES_VIEW, type NoteLine, type NoteLineCounts } from './note-lines.js'
import { isCellPublic, setCellPublic } from '../presentation/tiles/tile-public.js'
import { isJoinedHere } from '../sharing/membership.js'

const Z_BASE = 59988
const STYLE_ID = 'hc-note-lines-css'
const HOST_ID = 'hc-note-lines-host'
/** Peer bytes asked at once — a late joiner meets a whole lecture. */
const FETCH_PARALLEL = 6
const FETCH_TIMEOUT_MS = 8_000

type ViewModeShape = EventTarget & { mode: string; setMode(next: string): void }
type ModeRegistryShape = { enter(mode: string, owner: string): void; exit(mode: string, owner: string): void }
type LineageShape = EventTarget & { explorerSegments?: () => readonly string[] }
type NoteShape = { id: string; text: string }
type NotesShape = {
  getNotesAtSegments(segments: readonly string[]): Promise<NoteShape[]>
  readNote(sig: string): Promise<NoteShape | null>
  addAtSegments(parent: readonly string[], label: string, text: string): Promise<void>
  takeAtSegments(parent: readonly string[], label: string, sigs: readonly string[]): Promise<string[]>
}
type SwarmShape = {
  peerNotesAtCurrentSig?: () => readonly { sig: string; peerPubkey: string }[]
  participantsInZone?: () => readonly string[]
  labelFor?: (pubkey: string) => string
}
type BrokerShape ={ fetchBySig?: (sig: string, type: 'resource', timeoutMs?: number) => Promise<Uint8Array | null> }

const get = <T>(key: string): T | undefined =>
  (window as { ioc?: { get?: <V>(k: string) => V | undefined } }).ioc?.get?.<T>(key)

export class NoteLinesViewDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override description = 'The swarm room as note lines — everyone\'s notes on this page, coloured by who brought them, take to collect'

  protected override deps = { lineage: '@hypercomb.social/Lineage' }
  protected override listens = ['swarm:peers-changed', 'swarm:roster-changed', 'swarm:label-changed', 'notes:changed']
  protected override emits = ['view:active', 'tile:public-changed']

  #bound = false
  #viewActive = false
  #host: HTMLElement | null = null
  #list: HTMLElement | null = null
  #counts: HTMLElement | null = null
  #title: HTMLElement | null = null
  #hint: HTMLElement | null = null
  #takeAll: HTMLButtonElement | null = null
  #field: HTMLInputElement | null = null

  #refreshTimer: ReturnType<typeof setTimeout> | null = null
  #refreshSeq = 0
  /** Per page, the order lines were first seen in and who brought each —
   *  a line never moves and never changes colour once it has a place. */
  #pageKey = ''
  #firstSeen = new Map<string, number>()
  #firstHolder = new Map<string, string>()
  #texts = new Map<string, string>()
  #fetching = new Set<string>()
  #fetchQueue: string[] = []
  #lines: NoteLine[] = []

  protected override heartbeat = async (): Promise<void> => {
    if (!this.#bound) {
      this.#bound = true
      this.#vm()?.addEventListener('change', this.#sync)
      this.resolve<LineageShape>('lineage')?.addEventListener?.('change', this.#onLineage)
      for (const effect of ['swarm:peers-changed', 'swarm:roster-changed', 'swarm:label-changed', 'notes:changed']) {
        this.onEffect(effect, () => this.#scheduleRefresh())
      }
      window.addEventListener('keydown', this.#onKeyDown, true)
      window.addEventListener('contextmenu', this.#onContextMenu, true)
    }
    this.#sync()
  }

  protected override dispose(): void {
    this.#vm()?.removeEventListener('change', this.#sync)
    this.resolve<LineageShape>('lineage')?.removeEventListener?.('change', this.#onLineage)
    window.removeEventListener('keydown', this.#onKeyDown, true)
    window.removeEventListener('contextmenu', this.#onContextMenu, true)
    this.#teardown()
  }

  // ── lifecycle ───────────────────────────────────────────────

  readonly #sync = (): void => {
    if (this.#vm()?.mode !== LINES_VIEW) { this.#teardown(); return }
    if (!this.#host) this.#mount()
    this.#scheduleRefresh(0)
  }

  readonly #onLineage = (): void => {
    if (this.#vm()?.mode === LINES_VIEW) this.#scheduleRefresh(0)
  }

  readonly #onKeyDown = (e: KeyboardEvent): void => {
    if (this.#vm()?.mode !== LINES_VIEW || e.key !== 'Escape') return
    e.preventDefault()
    e.stopImmediatePropagation()
    if (document.activeElement === this.#field && this.#field?.value) { this.#field.value = ''; return }
    this.#vm()?.setMode('hexagons')
  }

  readonly #onContextMenu = (e: MouseEvent): void => {
    const vm = this.#vm()
    if (!vm || vm.mode !== LINES_VIEW) return
    e.preventDefault()
    const gesture = get<{ backOutOfView?(peel: () => void): void }>('@diamondcoreprocessor.com/BackGesture')
    const peel = (): void => vm.setMode('hexagons')
    if (gesture?.backOutOfView) gesture.backOutOfView(peel)
    else peel()
  }

  #scheduleRefresh(delay = 150): void {
    if (this.#vm()?.mode !== LINES_VIEW) return
    if (this.#refreshTimer) clearTimeout(this.#refreshTimer)
    this.#refreshTimer = setTimeout(() => { this.#refreshTimer = null; void this.#refresh() }, delay)
  }

  // ── read ────────────────────────────────────────────────────

  async #refresh(): Promise<void> {
    const seq = ++this.#refreshSeq
    const segments = this.#segments()
    const key = segments.join('/')
    if (key !== this.#pageKey) {
      this.#pageKey = key
      this.#firstSeen.clear()
      this.#firstHolder.clear()
      this.#fetchQueue = []
    }
    const notes = get<NotesShape>('@diamondcoreprocessor.com/NotesService')
    const swarm = get<SwarmShape>('@diamondcoreprocessor.com/SwarmDrone')
    let own: NoteShape[] = []
    if (segments.length > 0 && notes) {
      try { own = await notes.getNotesAtSegments(segments) } catch { own = [] }
    }
    if (seq !== this.#refreshSeq) return
    for (const n of own) this.#texts.set(n.id, n.text)
    const peers = segments.length > 0 && isJoinedHere() ? (swarm?.peerNotesAtCurrentSig?.() ?? []) : []
    const { lines, counts } = foldNoteLines({
      own: own.map(n => n.id),
      peers,
      firstSeen: this.#firstSeen,
      firstHolder: this.#firstHolder,
      texts: this.#texts,
      peopleHere: isJoinedHere() ? (swarm?.participantsInZone?.() ?? []).length : 0,
      now: Date.now(),
    })
    this.#lines = lines
    this.#render(segments, lines, counts)
    for (const line of lines) if (line.text === null) this.#want(line.sig)
  }

  /** A line whose bytes are not here: read it locally, else ask the room. */
  #want(sig: string): void {
    if (this.#fetching.has(sig) || this.#fetchQueue.includes(sig)) return
    this.#fetchQueue.push(sig)
    this.#pump()
  }

  #pump(): void {
    while (this.#fetching.size < FETCH_PARALLEL && this.#fetchQueue.length > 0) {
      const sig = this.#fetchQueue.shift()!
      this.#fetching.add(sig)
      void this.#resolveText(sig).finally(() => {
        this.#fetching.delete(sig)
        this.#pump()
      })
    }
  }

  async #resolveText(sig: string): Promise<void> {
    const notes = get<NotesShape>('@diamondcoreprocessor.com/NotesService')
    if (!notes) return
    let note = await notes.readNote(sig).catch(() => null)
    if (!note) {
      const broker = get<BrokerShape>('@diamondcoreprocessor.com/ContentBrokerDrone')
      const bytes = await broker?.fetchBySig?.(sig, 'resource', FETCH_TIMEOUT_MS).catch(() => null)
      if (bytes) note = await notes.readNote(sig).catch(() => null)
    }
    if (note) {
      this.#texts.set(sig, note.text)
      this.#scheduleRefresh()
    }
  }

  // ── acts ────────────────────────────────────────────────────

  async #write(text: string): Promise<void> {
    const segments = this.#segments()
    const notes = get<NotesShape>('@diamondcoreprocessor.com/NotesService')
    if (!notes || segments.length === 0 || !text.trim()) return
    // Your FIRST note on a page, written in the swarm, shares the page — write
    // and share by default, as a tile made in the swarm is. Nothing private
    // rides along: you had no notes here. A page that already holds your
    // notes keeps whatever you chose; its hint offers the share.
    const location = '/' + segments.slice(0, -1).join('/')
    const first = isJoinedHere() && !isCellPublic(location, segments[segments.length - 1])
      && (await notes.getNotesAtSegments(segments).catch(() => [{ id: '', text: '' }])).length === 0
    await notes.addAtSegments(segments.slice(0, -1), segments[segments.length - 1], text.trim())
    if (first) this.#share()
  }

  async #take(sigs: readonly string[]): Promise<void> {
    const segments = this.#segments()
    const notes = get<NotesShape>('@diamondcoreprocessor.com/NotesService')
    if (!notes || segments.length === 0) return
    await Promise.all(sigs.filter(sig => !this.#texts.has(sig)).map(sig => this.#resolveText(sig)))
    const missing = await notes.takeAtSegments(segments.slice(0, -1), segments[segments.length - 1], sigs).catch(() => [...sigs])
    if (missing.length > 0) this.#say(this.#t('lines.take-missing', 'Some lines have not arrived yet — try again in a moment.'))
  }

  #share(): void {
    const segments = this.#segments()
    if (segments.length === 0) return
    const location = '/' + segments.slice(0, -1).join('/')
    const label = segments[segments.length - 1]
    setCellPublic(location, label, true)
    EffectBus.emit('tile:public-changed', { cell: label, location, public: true })
    this.#scheduleRefresh(0)
  }

  // ── paint ───────────────────────────────────────────────────

  #mount(): void {
    installNoteLinesCss()
    const host = document.createElement('div')
    host.id = HOST_ID
    host.setAttribute('data-consumes-wheel', '')
    host.style.cssText =
      'position:fixed;top:0;bottom:0;left:var(--hc-inset-left,0px);right:var(--hc-inset-right,0px);' +
      `z-index:${Z_BASE};`
    host.innerHTML = `
      <div class="hc-nl-head">
        <div class="hc-nl-title"></div>
        <div class="hc-nl-counts" aria-live="polite"></div>
        <button type="button" class="hc-nl-btn hc-nl-takeall"></button>
        <button type="button" class="hc-nl-btn hc-nl-close" aria-label="close">✕</button>
      </div>
      <div class="hc-nl-hint"></div>
      <ol class="hc-nl-list"></ol>
      <form class="hc-nl-form"><input class="hc-nl-field" type="text" autocomplete="off" enterkeyhint="send" /></form>`
    document.body.appendChild(host)
    this.#host = host
    this.#title = host.querySelector('.hc-nl-title')
    this.#counts = host.querySelector('.hc-nl-counts')
    this.#hint = host.querySelector('.hc-nl-hint')
    this.#list = host.querySelector('.hc-nl-list')
    this.#takeAll = host.querySelector('.hc-nl-takeall')
    this.#field = host.querySelector('.hc-nl-field')
    this.#field!.placeholder = this.#t('lines.placeholder', 'Write a note — Enter shares it')
    this.#takeAll!.textContent = this.#t('lines.take-all', 'Take all')
    host.querySelector('.hc-nl-close')!.addEventListener('click', () => this.#vm()?.setMode('hexagons'))
    this.#takeAll!.addEventListener('click', () => {
      void this.#take(this.#lines.filter(l => !l.mine).map(l => l.sig))
    })
    host.querySelector('.hc-nl-form')!.addEventListener('submit', (e) => {
      e.preventDefault()
      const text = this.#field?.value ?? ''
      if (this.#field) this.#field.value = ''
      void this.#write(text)
    })
    this.#list!.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-take]')
      if (btn?.dataset['take']) void this.#take([btn.dataset['take']])
    })
    this.#hint!.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('[data-share]')) this.#share()
    })
    this.#setViewActive(true)
    this.#field!.focus()
  }

  #render(segments: readonly string[], lines: readonly NoteLine[], counts: NoteLineCounts): void {
    if (!this.#host || !this.#list) return
    const page = segments[segments.length - 1] ?? ''
    this.#title!.textContent = page || this.#t('lines.title', 'Lines')
    this.#counts!.textContent = this.#countsText(counts)
    this.#takeAll!.hidden = counts.open === 0
    this.#field!.disabled = segments.length === 0

    // What the page needs before it can be a room.
    const hint = this.#hint!
    if (segments.length === 0) {
      hint.textContent = this.#t('lines.no-page', 'Stand on a page to take notes there — every note is shared on the page you stand on.')
    } else if (!isCellPublic('/' + segments.slice(0, -1).join('/'), page)) {
      hint.innerHTML = ''
      hint.append(this.#t('lines.private', 'This page is private — your notes stay on this device. '))
      const share = document.createElement('button')
      share.type = 'button'
      share.className = 'hc-nl-btn'
      share.setAttribute('data-share', '')
      share.textContent = this.#t('lines.share', 'Share notes here')
      hint.append(share)
    } else if (!isJoinedHere()) {
      hint.textContent = this.#t('lines.not-joined', 'Not in a swarm — join one and these lines are shared with the room.')
    } else {
      hint.textContent = ''
    }
    hint.hidden = hint.textContent === '' && hint.childElementCount === 0

    const atBottom = this.#list.scrollHeight - this.#list.scrollTop - this.#list.clientHeight < 24
    const swarm = get<SwarmShape>('@diamondcoreprocessor.com/SwarmDrone')
    const byLabel = (pk: string): string => pk === ''
      ? this.#t('lines.you', 'you')
      : (swarm?.labelFor?.(pk) || pk.slice(0, 8))
    const frag = document.createDocumentFragment()
    for (const line of lines) {
      const li = document.createElement('li')
      li.className = 'hc-nl-line' + (line.mine ? ' is-mine' : '') + (line.text === null ? ' is-pending' : '')
      li.style.setProperty('--hc-nl-by', participantColor(line.by))
      const text = document.createElement('span')
      text.className = 'hc-nl-text'
      text.textContent = line.text ?? '…'
      const meta = document.createElement('span')
      meta.className = 'hc-nl-meta'
      const who = document.createElement('span')
      who.className = 'hc-nl-who'
      who.textContent = byLabel(line.by)
      meta.append(who)
      if (line.holders.length > 1) {
        const held = document.createElement('span')
        held.className = 'hc-nl-held'
        held.title = line.holders.map(byLabel).join(', ')
        held.textContent = `×${line.holders.length}`
        meta.append(held)
      }
      if (!line.mine) {
        const take = document.createElement('button')
        take.type = 'button'
        take.className = 'hc-nl-btn hc-nl-take'
        take.dataset['take'] = line.sig
        take.textContent = this.#t('lines.take', 'Take')
        meta.append(take)
      }
      li.append(text, meta)
      frag.append(li)
    }
    if (lines.length === 0) {
      const li = document.createElement('li')
      li.className = 'hc-nl-empty'
      li.textContent = this.#t('lines.empty', 'No lines yet. Write the first one below.')
      frag.append(li)
    }
    this.#list.replaceChildren(frag)
    if (atBottom) this.#list.scrollTop = this.#list.scrollHeight
  }

  #countsText(c: NoteLineCounts): string {
    const parts = [
      this.#plural('lines.people', c.people, '{n} person', '{n} people'),
      this.#plural('lines.lines', c.lines, '{n} line', '{n} lines'),
      this.#t('lines.yours', '{n} yours', { n: c.mine }),
    ]
    if (c.open > 0) parts.push(this.#t('lines.open', '{n} to take', { n: c.open }))
    return parts.join(' · ')
  }

  #teardown(): void {
    if (this.#refreshTimer) { clearTimeout(this.#refreshTimer); this.#refreshTimer = null }
    this.#refreshSeq++
    this.#host?.remove()
    this.#host = this.#list = this.#counts = this.#title = this.#hint = null
    this.#takeAll = null
    this.#field = null
    if (this.#viewActive) this.#setViewActive(false)
  }

  #setViewActive(active: boolean): void {
    if (this.#viewActive === active) return
    this.#viewActive = active
    const modes = get<ModeRegistryShape>('@diamondcoreprocessor.com/ModeRegistry')
    if (active) modes?.enter('view:active', 'note-lines')
    else modes?.exit('view:active', 'note-lines')
  }

  // ── reads ───────────────────────────────────────────────────

  #vm(): ViewModeShape | undefined {
    return get<ViewModeShape>('@hypercomb.social/ViewMode')
  }

  #segments(): string[] {
    try {
      return (this.resolve<LineageShape>('lineage')?.explorerSegments?.() ?? [])
        .map(s => String(s ?? '').trim()).filter(Boolean)
    } catch { return [] }
  }

  #say(message: string): void {
    EffectBus.emit('toast:show', { type: 'info', message })
  }

  #t(key: string, fallback: string, params?: Record<string, string | number>): string {
    const value = get<I18nProvider>(I18N_IOC_KEY)?.t?.(key, params)
    if (value && value !== key) return value
    if (!params) return fallback
    return fallback.replace(/\{(\w+)\}/g, (whole, token: string) => token in params ? String(params[token]) : whole)
  }

  #plural(key: string, count: number, one: string, other: string): string {
    return this.#t(key, count === 1 ? one : other, { count, n: count })
  }
}

/** One stylesheet, installed once, on the chrome's own tokens so the lines
 *  follow the theme the rest of the shell follows. */
function installNoteLinesCss(): void {
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  const H = '#' + HOST_ID
  style.textContent = `
${H}{display:flex;flex-direction:column;box-sizing:border-box;background:rgb(var(--hc-chrome-glass,250,251,253));color:rgba(var(--hc-chrome-ink,26,33,48),var(--hc-ink-a-plain,0.92));font-family:var(--hc-read,var(--hc-font,system-ui,sans-serif));font-size:1rem;}
${H} .hc-nl-head{display:flex;align-items:center;gap:0.75rem;padding:0.75rem max(1rem,env(safe-area-inset-right,0px)) 0.6rem max(1rem,env(safe-area-inset-left,0px));border-bottom:1px solid rgba(var(--hc-chrome-rule,62,74,94),0.2);flex-wrap:wrap;}
${H} .hc-nl-title{font-weight:600;font-size:1.1rem;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
${H} .hc-nl-counts{flex:1;min-width:0;font-size:0.85rem;color:rgba(var(--hc-chrome-ink,26,33,48),var(--hc-ink-a-quiet,0.62));font-variant-numeric:tabular-nums;}
${H} .hc-nl-btn{appearance:none;border:1px solid rgba(var(--hc-chrome-rule,62,74,94),0.3);background:none;color:inherit;font:inherit;font-size:0.85rem;padding:0.25rem 0.6rem;border-radius:var(--hc-radius-control,2px);cursor:pointer;}
${H} .hc-nl-btn:hover{border-color:rgba(var(--hc-chrome-accent,20,96,180),0.7);color:rgba(var(--hc-chrome-accent,20,96,180),0.95);}
${H} .hc-nl-hint{padding:0.5rem 1rem;font-size:0.85rem;color:rgba(var(--hc-chrome-ink,26,33,48),var(--hc-ink-a-quiet,0.62));background:rgba(var(--hc-chrome-rule,62,74,94),0.06);}
${H} .hc-nl-hint[hidden]{display:none;}
${H} .hc-nl-hint .hc-nl-btn{margin-left:0.4rem;}
${H} .hc-nl-list{flex:1;overflow-y:auto;overscroll-behavior:contain;margin:0;padding:0.4rem 0;list-style:none;}
${H} .hc-nl-line{display:flex;align-items:baseline;gap:0.75rem;padding:0.45rem max(1rem,env(safe-area-inset-right,0px)) 0.45rem max(0.85rem,env(safe-area-inset-left,0px));border-left:3px solid var(--hc-nl-by);margin-left:0.15rem;}
${H} .hc-nl-line:hover{background:rgba(var(--hc-chrome-rule,62,74,94),0.05);}
${H} .hc-nl-line.is-pending .hc-nl-text{color:rgba(var(--hc-chrome-ink,26,33,48),0.35);}
${H} .hc-nl-text{flex:1;min-width:0;line-height:1.4;overflow-wrap:anywhere;}
${H} .hc-nl-meta{display:flex;align-items:baseline;gap:0.5rem;flex:none;font-size:0.78rem;color:rgba(var(--hc-chrome-ink,26,33,48),var(--hc-ink-a-quiet,0.62));}
${H} .hc-nl-who{color:var(--hc-nl-by);font-weight:600;max-width:9rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
${H} .hc-nl-held{font-variant-numeric:tabular-nums;}
${H} .hc-nl-take{font-size:0.78rem;padding:0.1rem 0.5rem;}
${H} .hc-nl-empty{padding:2rem 1rem;text-align:center;color:rgba(var(--hc-chrome-ink,26,33,48),var(--hc-ink-a-quiet,0.62));}
${H} .hc-nl-form{padding:0.6rem max(1rem,env(safe-area-inset-right,0px)) max(0.8rem,env(safe-area-inset-bottom,0px)) max(1rem,env(safe-area-inset-left,0px));border-top:1px solid rgba(var(--hc-chrome-rule,62,74,94),0.2);}
${H} .hc-nl-field{width:100%;box-sizing:border-box;min-height:2.75rem;padding:0 0.9rem;font:inherit;color:inherit;background:rgba(var(--hc-chrome-rule,62,74,94),0.06);border:1.5px solid rgba(var(--hc-chrome-rule,62,74,94),0.3);border-radius:var(--hc-radius-control,2px);outline:none;}
${H} .hc-nl-field:focus{border-color:rgba(var(--hc-chrome-accent,20,96,180),0.8);}
`
  document.head.appendChild(style)
}

const _noteLines = new NoteLinesViewDrone()
window.ioc.register('@diamondcoreprocessor.com/NoteLinesViewDrone', _noteLines)
