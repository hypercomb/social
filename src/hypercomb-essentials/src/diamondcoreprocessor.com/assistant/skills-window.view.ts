// diamondcoreprocessor.com/assistant/skills-window.view.ts
//
// SKILLS WINDOW — the library of what Claude can be taught to do.
//
// Opened by `/skills` (or the `skills:open` effect). Reads the skill census
// that lives IN THE HIVE at behaviors/assistant/skills — four groups (hive,
// anthropic, harness, community), community fanning into ten domains — and
// presents it as a searchable toolwindow. Every entry is a lazy-load POINTER:
// the tile's note (what it does, why it ranks, where it lives) loads only
// when a row is expanded, and nothing is ever installed from here directly.
//
// The "use" action opens the ASK SCREEN prefilled with the skill's address,
// so the request lands on the bridge and the answering session imports that
// one skill at that moment — the lazy-load contract, made clickable.
//
// A panel, not a takeover — cold chrome, DOM singleton, no Angular; the
// same shape as agent-panel.view.
import { EffectBus, I18N_IOC_KEY, type I18nProvider } from '@hypercomb/core'
import type { HistoryService } from '../history/history.service.js'
import { inflate } from '../history/inflate.js'

const STYLE_ID = 'hc-skills-styles'
const STEEL = '126, 182, 214'
const WIDTH_KEY = 'hc:skills-window-width'
const MIN_WIDTH = 320
const ROOT = ['behaviors', 'assistant', 'skills'] as const

const ioc = <T,>(key: string): T | undefined =>
  (window as unknown as { ioc?: { get?: (k: string) => unknown } }).ioc?.get?.(key) as T | undefined

type NotesLike = { getNotesAtSegments?: (s: readonly string[]) => Promise<unknown[]> }
type NavigationLike = { goRaw?: (s: readonly string[]) => void }

type SkillEntry = {
  name: string
  segments: string[]
  note: string | null          // null = not loaded yet
  children: SkillEntry[] | null // null = not loaded; [] = leaf
}

const noteText = (items: unknown[]): string =>
  items.map(item => {
    const o = item as { text?: unknown; body?: unknown }
    return String(o?.text ?? o?.body ?? '')
  }).filter(Boolean).join('\n\n')

export class SkillsWindowView extends EventTarget {
  #panel: HTMLDivElement | null = null
  #body: HTMLDivElement | null = null
  #search = ''
  #root: SkillEntry | null = null
  #expanded = new Set<string>()
  #resizeCleanup: (() => void) | null = null

  #onKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && this.#panel) { event.stopPropagation(); this.close() }
  }

  constructor() {
    super()
    EffectBus.on('skills:open', () => { void this.open() })
  }

  #t(key: string, fallback: string): string {
    const value = ioc<I18nProvider>(I18N_IOC_KEY)?.t?.(key)
    return value && value !== key ? value : fallback
  }

  async open(): Promise<void> {
    if (this.#panel) { this.close(); return }
    this.#ensureStyles()

    const panel = document.createElement('div')
    panel.className = 'hc-skills'
    const savedWidth = Number.parseFloat(localStorage.getItem(WIDTH_KEY) ?? '')
    if (Number.isFinite(savedWidth)) panel.style.width = `${Math.max(MIN_WIDTH, savedWidth)}px`

    const resize = document.createElement('div')
    resize.className = 'hc-skills-resize'
    resize.setAttribute('aria-hidden', 'true')
    resize.addEventListener('pointerdown', event => this.#beginResize(event))

    const head = document.createElement('div')
    head.className = 'hc-skills-head'
    const title = document.createElement('div')
    title.className = 'hc-skills-title'
    title.textContent = this.#t('skills.title', 'Skills')
    const close = document.createElement('button')
    close.type = 'button'
    close.className = 'hc-skills-close'
    close.textContent = '×'
    close.setAttribute('aria-label', this.#t('skills.close', 'Close'))
    close.addEventListener('click', () => this.close())
    head.append(title, close)

    const search = document.createElement('input')
    search.className = 'hc-skills-search'
    search.type = 'search'
    search.placeholder = this.#t('skills.search', 'Search skills…')
    search.addEventListener('input', () => {
      this.#search = search.value.trim().toLowerCase()
      void this.#render()
    })

    const body = document.createElement('div')
    body.className = 'hc-skills-body'
    this.#body = body

    panel.append(resize, head, search, body)
    document.body.appendChild(panel)
    this.#panel = panel
    document.addEventListener('keydown', this.#onKey, true)

    body.textContent = this.#t('skills.loading', 'Reading the census…')
    this.#root = await this.#load([...ROOT])
    await this.#render()
  }

  // ── census reads (all from the hive, lazily) ─────────────────────────────

  async #load(segments: string[]): Promise<SkillEntry | null> {
    const history = ioc<HistoryService>('@diamondcoreprocessor.com/HistoryService')
    if (!history) return null
    try {
      const locationSig = await history.sign({ explorerSegments: () => segments })
      const layer = await history.currentLayerAt(locationSig)
      if (!layer) return null
      const inflated = await inflate(layer) as { children?: Array<{ name?: string }> }
      const children = (inflated.children ?? [])
        .map(c => String(c?.name ?? ''))
        .filter(Boolean)
        .map(name => ({ name, segments: [...segments, name], note: null, children: null }) as SkillEntry)
      return { name: segments[segments.length - 1], segments, note: null, children }
    } catch { return null }
  }

  async #ensureChildren(entry: SkillEntry): Promise<void> {
    if (entry.children !== null) return
    const loaded = await this.#load(entry.segments)
    entry.children = loaded?.children ?? []
  }

  async #ensureNote(entry: SkillEntry): Promise<void> {
    if (entry.note !== null) return
    const notes = ioc<NotesLike>('@diamondcoreprocessor.com/NotesService')
    try {
      const items = await notes?.getNotesAtSegments?.(entry.segments) ?? []
      entry.note = noteText(items)
    } catch { entry.note = '' }
  }

  // Search needs children + notes of everything under a group — load on demand,
  // once, and only when the user actually searches.
  async #deepLoad(entry: SkillEntry): Promise<void> {
    await this.#ensureChildren(entry)
    for (const child of entry.children ?? []) {
      await this.#ensureNote(child)
      await this.#ensureChildren(child)
      for (const leaf of child.children ?? []) await this.#ensureNote(leaf)
    }
  }

  // ── rendering ────────────────────────────────────────────────────────────

  #render = async (): Promise<void> => {
    const body = this.#body
    const root = this.#root
    if (!body) return
    body.textContent = ''
    if (!root?.children?.length) {
      body.textContent = this.#t('skills.empty', 'No skill census found — run the skills mirror first.')
      return
    }
    if (this.#search) {
      for (const group of root.children) await this.#deepLoad(group)
      const hits: SkillEntry[] = []
      const matches = (e: SkillEntry): boolean =>
        e.name.toLowerCase().includes(this.#search) || (e.note ?? '').toLowerCase().includes(this.#search)
      for (const group of root.children)
        for (const mid of group.children ?? []) {
          if ((mid.children ?? []).length === 0 && matches(mid)) hits.push(mid)
          for (const leaf of mid.children ?? []) if (matches(leaf)) hits.push(leaf)
        }
      if (!hits.length) {
        body.textContent = this.#t('skills.no-results', 'Nothing matches.')
        return
      }
      for (const hit of hits) body.appendChild(this.#skillRow(hit))
      return
    }
    for (const group of root.children) body.appendChild(await this.#groupSection(group))
  }

  async #groupSection(entry: SkillEntry): Promise<HTMLElement> {
    const wrap = document.createElement('div')
    wrap.className = 'hc-skills-group'
    const key = entry.segments.join('/')
    const open = this.#expanded.has(key)
    const head = document.createElement('button')
    head.type = 'button'
    head.className = 'hc-skills-grouphead'
    head.setAttribute('aria-expanded', String(open))
    head.textContent = `${open ? '▾' : '▸'} ${entry.name}`
    head.addEventListener('click', () => {
      if (this.#expanded.has(key)) this.#expanded.delete(key)
      else this.#expanded.add(key)
      void this.#render()
    })
    wrap.appendChild(head)
    if (open) {
      await this.#ensureChildren(entry)
      for (const child of entry.children ?? []) {
        await this.#ensureChildren(child)
        // A child with children of its own is a domain (community); a bare
        // child is a skill. Domains nest one more level, skills are rows.
        if ((child.children ?? []).length > 0) wrap.appendChild(await this.#groupSection(child))
        else wrap.appendChild(this.#skillRow(child))
      }
    }
    return wrap
  }

  #skillRow(entry: SkillEntry): HTMLElement {
    const key = entry.segments.join('/')
    const open = this.#expanded.has(key)
    const wrap = document.createElement('div')
    wrap.className = 'hc-skills-skill'
    const row = document.createElement('div')
    row.className = 'hc-skills-row'
    const name = document.createElement('button')
    name.type = 'button'
    name.className = 'hc-skills-name'
    name.textContent = entry.name
    name.setAttribute('aria-expanded', String(open))
    name.addEventListener('click', () => {
      if (this.#expanded.has(key)) { this.#expanded.delete(key); void this.#render(); return }
      this.#expanded.add(key)
      void this.#ensureNote(entry).then(() => this.#render())
    })
    const use = document.createElement('button')
    use.type = 'button'
    use.className = 'hc-skills-use'
    use.textContent = this.#t('skills.use', 'use')
    use.title = this.#t('skills.use-title', 'Ask a session to use this skill')
    use.addEventListener('click', () => {
      // The lazy-load contract, made clickable: the ask names the skill tile,
      // the answering session imports that one skill and applies it.
      EffectBus.emit('ask:open', {
        model: 'opus',
        prefill: `Use the "${entry.name}" skill (see /${entry.segments.join('/')}) to: `,
      })
      this.close()
    })
    const go = document.createElement('button')
    go.type = 'button'
    go.className = 'hc-skills-go'
    go.textContent = this.#t('skills.go', 'go')
    go.title = this.#t('skills.go-title', 'Go to this skill’s tile')
    go.addEventListener('click', () => {
      ioc<NavigationLike>('@hypercomb.social/Navigation')?.goRaw?.(entry.segments)
      this.close()
    })
    row.append(name, use, go)
    wrap.appendChild(row)
    if (open) {
      const note = document.createElement('div')
      note.className = 'hc-skills-note'
      note.textContent = entry.note === null
        ? this.#t('skills.loading-note', '…')
        : (entry.note || this.#t('skills.no-note', 'No note on this tile.'))
      wrap.appendChild(note)
    }
    return wrap
  }

  close(): void {
    document.removeEventListener('keydown', this.#onKey, true)
    this.#resizeCleanup?.()
    this.#resizeCleanup = null
    this.#panel?.remove()
    this.#panel = null
    this.#body = null
  }

  #beginResize(event: PointerEvent): void {
    const panel = this.#panel
    if (!panel) return
    event.preventDefault()
    const startX = event.clientX
    const startWidth = panel.getBoundingClientRect().width
    const move = (next: PointerEvent): void => {
      const right = Math.max(16, window.innerWidth - panel.getBoundingClientRect().right)
      const maxWidth = Math.max(MIN_WIDTH, window.innerWidth - right - 16)
      const width = Math.min(maxWidth, Math.max(MIN_WIDTH, startWidth + startX - next.clientX))
      panel.style.width = `${width}px`
    }
    const finish = (): void => {
      localStorage.setItem(WIDTH_KEY, String(Math.round(panel.getBoundingClientRect().width)))
      window.removeEventListener('pointermove', move, true)
      window.removeEventListener('pointerup', finish, true)
      window.removeEventListener('pointercancel', finish, true)
      this.#resizeCleanup = null
    }
    this.#resizeCleanup?.()
    this.#resizeCleanup = finish
    window.addEventListener('pointermove', move, true)
    window.addEventListener('pointerup', finish, true)
    window.addEventListener('pointercancel', finish, true)
  }

  #ensureStyles(): void {
    if (document.getElementById(STYLE_ID)) return
    const style = document.createElement('style')
    style.id = STYLE_ID
    style.textContent = `
.hc-skills{position:fixed;z-index:99999;display:flex;flex-direction:column;gap:0.55rem;
  right:calc(var(--hc-controls-right, 0px) + 1rem);bottom:1rem;width:min(24rem,calc(100vw - 2rem));
  max-height:min(34rem,75vh);padding:0.75rem 0.85rem;box-sizing:border-box;
  background:rgba(6,9,14,0.96);border:1px solid rgba(${STEEL},0.35);border-radius:var(--hc-radius-floating, 4px);}
.hc-skills-resize{position:absolute;z-index:1;inset:0 auto 0 -0.35rem;width:0.7rem;cursor:ew-resize;}
.hc-skills-resize::after{content:"";position:absolute;top:42%;bottom:42%;left:0.25rem;
  border-left:1px solid rgba(${STEEL},0.42);}
.hc-skills-head{display:flex;align-items:center;gap:0.5rem;flex:0 0 auto;}
.hc-skills-title{flex:1 1 auto;font-family:var(--hc-mono,monospace);font-size:0.76rem;font-weight:600;
  letter-spacing:0.1em;text-transform:uppercase;color:rgba(${STEEL},0.95);}
.hc-skills-close{width:2rem;height:2rem;border:none;background:none;color:rgba(245,245,245,0.4);
  font-size:1.3rem;line-height:1;cursor:pointer;border-radius:var(--hc-radius-control, 2px);}
.hc-skills-close:hover{color:whitesmoke;background:rgba(255,255,255,0.07);}
.hc-skills-search{flex:0 0 auto;box-sizing:border-box;padding:0.45rem 0.6rem;font:inherit;font-size:16px;
  color:whitesmoke;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.12);
  border-radius:var(--hc-radius-control, 2px);outline:none;}
.hc-skills-search:focus{border-color:rgba(${STEEL},0.55);}
.hc-skills-body{flex:1 1 auto;min-height:0;overflow-y:auto;display:flex;flex-direction:column;gap:0.3rem;
  font-size:0.85rem;color:rgba(238,244,250,0.9);}
.hc-skills-group{display:flex;flex-direction:column;gap:0.2rem;margin-left:0.15rem;}
.hc-skills-group .hc-skills-group{margin-left:0.9rem;}
.hc-skills-grouphead{border:0;background:none;text-align:left;font:inherit;font-size:0.78rem;
  letter-spacing:0.06em;text-transform:uppercase;color:rgba(${STEEL},0.75);cursor:pointer;
  padding:0.25rem 0.2rem;border-radius:4px;}
.hc-skills-grouphead:hover{background:rgba(255,255,255,0.055);}
.hc-skills-skill{margin-left:0.9rem;}
.hc-skills-row{display:flex;align-items:center;gap:0.4rem;}
.hc-skills-name{flex:1 1 auto;min-width:0;border:0;background:none;text-align:left;font:inherit;
  color:rgba(238,244,250,0.88);cursor:pointer;padding:0.18rem 0.2rem;border-radius:4px;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.hc-skills-name:hover{background:rgba(255,255,255,0.055);}
.hc-skills-use,.hc-skills-go{flex:0 0 auto;border:1px solid rgba(${STEEL},0.35);background:none;
  color:rgba(${STEEL},0.85);font:inherit;font-size:0.68rem;letter-spacing:0.06em;text-transform:uppercase;
  padding:0.08rem 0.45rem;border-radius:999px;cursor:pointer;}
.hc-skills-use:hover,.hc-skills-go:hover{background:rgba(${STEEL},0.16);}
.hc-skills-note{margin:0.15rem 0 0.35rem 0.4rem;padding-left:0.5rem;font-size:0.78rem;line-height:1.45;
  color:rgba(216,230,238,0.62);white-space:pre-wrap;word-break:break-word;
  border-left:1px solid rgba(${STEEL},0.25);}
`
    document.head.appendChild(style)
  }
}

// ── slash behaviour: /skills toggles the window ─────────────────────────────
type SlashRegistrar = { addProvider?: (provider: unknown) => void }

const _skillsWindow = new SkillsWindowView()
window.ioc.register('@diamondcoreprocessor.com/SkillsWindowView', _skillsWindow)

window.ioc.whenReady?.('@diamondcoreprocessor.com/SlashBehaviourDrone', (drone: SlashRegistrar) => {
  drone.addProvider?.({
    name: 'skills-provider',
    priority: 100,
    behaviours: [
      { name: 'skills', description: 'Browse the skill library', descriptionKey: 'slash.skills',
        examples: [{ input: '/skills', result: 'Opens the skills window' }] },
    ],
    execute: () => { EffectBus.emit('skills:open', {}) },
  })
})
