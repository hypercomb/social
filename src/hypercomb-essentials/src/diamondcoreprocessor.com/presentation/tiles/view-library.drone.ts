// Evidence Atlas + Knowledge Studio: two trusted projections over one reader.

import { Drone } from '@hypercomb/core'
import { childNamesOf } from '../../history/layer-placement.js'
import { tagsForLabel, titleForLabel } from '../../commands/decoration-kind-index.js'
import { isFeatureHidden } from '../../sharing/feature-hidden.js'
import type { Note } from '../../notes/notes.drone.js'
import {
  EVIDENCE_ATLAS_KIND, EVIDENCE_ATLAS_VIEW,
  KNOWLEDGE_STUDIO_KIND, KNOWLEDGE_STUDIO_VIEW,
} from '../../commands/view-library.queen.js'

type Surface = typeof EVIDENCE_ATLAS_VIEW | typeof KNOWLEDGE_STUDIO_VIEW
type VM = EventTarget & { mode: string; setMode(next: string): void }
type History = {
  sign(l: { explorerSegments?: () => readonly string[] }): Promise<string>
  currentLayerAt(sig: string): Promise<Record<string, unknown> | null>
  getLayerBySig(sig: string): Promise<Record<string, unknown> | null>
  commitLayer(sig: string, layer: Record<string, unknown>): Promise<string>
}
type Notes = { getNotesAtSegments(s: readonly string[]): Promise<Note[]> }
type Item = { title: string; tags: string[]; notes: Note[] }
type Role = 'question' | 'answer' | 'decision' | 'risk' | 'evidence' | 'context'

export class ViewLibraryDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'presentation'
  override description = 'Evidence Atlas and Knowledge Studio document projections.'
  #host: HTMLElement | null = null
  #bound = false
  #active = false
  #token = 0
  #targetSegments: string[] | null = null

  protected override heartbeat = async (): Promise<void> => {
    if (!this.#bound) {
      this.#vm()?.addEventListener('change', this.#refresh)
      window.addEventListener('keydown', this.#key, true)
      this.onEffect('notes:changed', this.#refresh)
      this.onEffect('decorations:changed', this.#refresh)
      this.onEffect('cell:added', this.#refresh)
      this.onEffect('cell:removed', this.#refresh)
      this.onEffect<{ view?: string; segments?: string[] }>('view:open-for-tile', payload => {
        const view = payload?.view
        if (view !== EVIDENCE_ATLAS_VIEW && view !== KNOWLEDGE_STUDIO_VIEW) return
        this.#targetSegments = (payload.segments ?? []).map(String).filter(Boolean)
        this.#vm()?.setMode(view)
        void this.#render()
      })
      this.#bound = true
    }
    await this.#render()
  }

  protected override dispose(): void {
    this.#vm()?.removeEventListener('change', this.#refresh)
    window.removeEventListener('keydown', this.#key, true)
    this.#close()
  }

  readonly #refresh = (): void => { void this.#render() }
  readonly #key = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape' || !this.#surface()) return
    e.preventDefault(); e.stopImmediatePropagation(); this.#vm()?.setMode('hexagons')
  }
  #vm(): VM | undefined { return window.ioc?.get<VM>('@hypercomb.social/ViewMode') }
  #surface(): Surface | null {
    const mode = this.#vm()?.mode
    return mode === EVIDENCE_ATLAS_VIEW || mode === KNOWLEDGE_STUDIO_VIEW ? mode : null
  }

  async #render(): Promise<void> {
    const token = ++this.#token
    const surface = this.#surface()
    if (!surface) { this.#targetSegments = null; this.#close(); return }
    const lineage = window.ioc?.get<{ explorerSegments?: () => readonly string[] }>('@hypercomb.social/Lineage')
    const segments = this.#targetSegments
      ? [...this.#targetSegments]
      : [...(lineage?.explorerSegments?.() ?? [])]
    const kind = surface === EVIDENCE_ATLAS_VIEW ? EVIDENCE_ATLAS_KIND : KNOWLEDGE_STUDIO_KIND
    if (await isFeatureHidden(segments, kind)) { this.#close(); return }
    const items = await this.#read(segments)
    if (token !== this.#token || this.#surface() !== surface) return
    this.#close()
    if (surface === EVIDENCE_ATLAS_VIEW) this.#atlas(segments, items)
    else this.#studio(segments, items)
    this.#setActive(true)
  }

  async #read(segments: readonly string[]): Promise<Item[]> {
    const history = window.ioc?.get<History>('@diamondcoreprocessor.com/HistoryService')
    const notes = window.ioc?.get<Notes>('@diamondcoreprocessor.com/NotesService')
    if (!history || !notes) return []
    const sig = await history.sign({ explorerSegments: () => segments })
    const layer = await history.currentLayerAt(sig)
    if (!layer) return []
    const names = await childNamesOf(history, layer as Parameters<typeof childNamesOf>[1])
    return Promise.all(names.map(async name => ({
      title: titleForLabel(name, navigator.language) || name,
      tags: [...tagsForLabel(name)],
      notes: await notes.getNotesAtSegments([...segments, name]),
    })))
  }

  #atlas(segments: readonly string[], items: readonly Item[]): void {
    const host = this.#shell('atlas', 'EVIDENCE ATLAS')
    const root = document.createElement('main'); root.className = 'atlas-main'
    const title = this.#title(segments, 'Evidence Atlas')
    const all = items.flatMap(item => this.#flatten(item.notes).map(note => ({ item, note, role: this.#role(note, item.tags) })))
    root.append(this.#heading(title, `${all.length} observations across ${items.length} categories`))
    const summary = document.createElement('section'); summary.className = 'atlas-summary'
    ;(['evidence', 'question', 'answer', 'decision', 'risk'] as Role[]).forEach(role => {
      const card = this.#el('div', 'atlas-stat', '')
      card.append(this.#el('strong', '', String(all.filter(x => x.role === role).length)), this.#el('span', '', role))
      summary.append(card)
    })
    root.append(summary)
    const lanes = document.createElement('section'); lanes.className = 'atlas-lanes'
    ;(['question', 'evidence', 'answer', 'decision', 'risk', 'context'] as Role[]).forEach(role => {
      const lane = this.#el('section', `atlas-lane role-${role}`, '')
      lane.append(this.#el('h2', '', role))
      const matches = all.filter(x => x.role === role)
      matches.forEach(({ item, note }) => {
        const card = this.#el('article', 'atlas-card', '')
        card.append(this.#el('small', '', item.title), this.#el('p', '', note.text))
        const tags = this.#el('div', 'atlas-tags', '')
        item.tags.forEach(tag => tags.append(this.#el('span', '', tag)))
        card.append(tags); lane.append(card)
      })
      if (!matches.length) lane.append(this.#el('p', 'empty', 'Nothing classified here yet.'))
      lanes.append(lane)
    })
    root.append(lanes); host.append(root); document.body.append(host); this.#host = host
  }

  #studio(segments: readonly string[], items: readonly Item[]): void {
    const host = this.#shell('studio', 'KNOWLEDGE STUDIO')
    const root = document.createElement('main'); root.className = 'studio-main'
    root.append(this.#heading(this.#title(segments, 'Knowledge Studio'), `${items.length} scenes · guided reading mode`))
    const rail = this.#el('nav', 'studio-rail', '')
    items.forEach((item, i) => {
      const a = document.createElement('a'); a.href = `#scene-${i}`; a.textContent = `${i + 1}. ${item.title}`; rail.append(a)
    })
    root.append(rail)
    items.forEach((item, i) => {
      const scene = this.#el('section', `studio-scene scene-${i % 3}`, ''); scene.id = `scene-${i}`
      const head = this.#el('header', '', '')
      head.append(this.#el('span', 'scene-number', String(i + 1).padStart(2, '0')), this.#el('h2', '', item.title))
      const tags = this.#el('div', 'studio-tags', '')
      item.tags.forEach(tag => tags.append(this.#el('span', '', tag))); head.append(tags); scene.append(head)
      const notes = this.#flatten(item.notes)
      notes.forEach((note, n) => {
        const card = this.#el(n === 0 ? 'blockquote' : 'article', n === 0 ? 'scene-lead' : 'scene-note', '')
        card.append(this.#el('p', '', note.text)); scene.append(card)
      })
      if (!notes.length) scene.append(this.#el('p', 'empty', 'This scene is waiting for its first note.'))
      root.append(scene)
    })
    host.append(root); document.body.append(host); this.#host = host
  }

  #shell(name: string, label: string): HTMLElement {
    const host = this.#el('section', `hc-view-library ${name}`, '')
    host.innerHTML = `<style>${CSS}</style>`
    const bar = this.#el('header', 'library-bar', '')
    bar.append(this.#el('span', '', label))
    const close = this.#el('button', '', '×') as HTMLButtonElement
    close.type = 'button'; close.onclick = () => this.#vm()?.setMode('hexagons'); bar.append(close); host.append(bar)
    return host
  }
  #heading(title: string, subtitle: string): HTMLElement {
    const h = this.#el('header', 'library-heading', '')
    h.append(this.#el('h1', '', title), this.#el('p', '', subtitle)); return h
  }
  #title(segments: readonly string[], fallback: string): string {
    const raw = segments.at(-1); return raw ? titleForLabel(raw, navigator.language) || raw : fallback
  }
  #flatten(notes: readonly Note[]): Note[] { return notes.flatMap(note => [note, ...this.#flatten(note.children)]) }
  #role(note: Note, tags: readonly string[]): Role {
    const s = [note.mark, ...tags].join(' ').toLowerCase()
    if (s.includes('question') || note.text.trim().endsWith('?')) return 'question'
    if (s.includes('answer') || s.includes('response')) return 'answer'
    if (s.includes('decision') || s.includes('gavel')) return 'decision'
    if (s.includes('risk') || s.includes('warning')) return 'risk'
    if (s.includes('evidence') || s.includes('source') || s.includes('proof')) return 'evidence'
    return 'context'
  }
  #el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text: string): HTMLElementTagNameMap[K] {
    const el = document.createElement(tag); if (cls) el.className = cls; el.textContent = text; return el
  }
  #close(): void { this.#host?.remove(); this.#host = null; this.#setActive(false) }
  #setActive(active: boolean): void {
    if (active === this.#active) return; this.#active = active
    const modes = window.ioc?.get<{ enter(m: string, o: string): void; exit(m: string, o: string): void }>('@diamondcoreprocessor.com/ModeRegistry')
    if (active) modes?.enter('view:active', 'view-library'); else modes?.exit('view:active', 'view-library')
  }
}

const CSS = `
.hc-view-library{position:fixed;inset:0;z-index:150;overflow:auto;background:#101615;color:#e9eeeb;font:15px/1.55 Inter,system-ui,sans-serif}.library-bar{position:sticky;top:0;z-index:4;display:flex;justify-content:space-between;align-items:center;height:52px;padding:0 24px;background:rgba(10,15,14,.94);letter-spacing:.18em;font-size:10px}.library-bar button{border:0;background:none;color:inherit;font-size:28px;cursor:pointer}.library-heading{padding:70px 0 34px}.library-heading h1{margin:0;font:500 clamp(42px,7vw,76px)/1 Georgia,serif;letter-spacing:-.04em}.library-heading p{color:#93a39e}
.atlas-main,.studio-main{width:min(1400px,calc(100% - 40px));margin:auto}.atlas-summary{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin-bottom:42px}.atlas-stat{padding:20px;background:#192320;border:1px solid #2c3a36}.atlas-stat strong{display:block;font:38px Georgia,serif}.atlas-stat span{text-transform:uppercase;color:#83a297;font-size:10px;letter-spacing:.12em}.atlas-lanes{display:grid;grid-template-columns:repeat(3,1fr);gap:18px;padding-bottom:70px}.atlas-lane{min-height:180px;padding:18px;background:#141d1b;border-top:3px solid #718f85}.atlas-lane h2{text-transform:uppercase;font-size:11px;letter-spacing:.15em}.atlas-card{margin:12px 0;padding:16px;background:#202b28}.atlas-card small{color:#83a297}.atlas-card p{white-space:pre-wrap}.atlas-tags,.studio-tags{display:flex;gap:5px;flex-wrap:wrap}.atlas-tags span,.studio-tags span{padding:2px 7px;border:1px solid #42554f;border-radius:20px;font-size:9px}.role-question{border-color:#62a7d2}.role-risk{border-color:#d18668}.role-decision{border-color:#d1ae68}.empty{color:#74827e;font-style:italic}
.studio{background:#e8e2d8;color:#1d2422}.studio .library-bar{color:#eef3f0}.studio-main{width:min(1060px,calc(100% - 36px))}.studio-rail{position:sticky;top:52px;z-index:2;display:flex;gap:18px;overflow:auto;padding:14px 0;background:#e8e2d8}.studio-rail a{color:#435e55;text-decoration:none;white-space:nowrap}.studio-scene{min-height:60vh;margin:22px 0 70px;padding:clamp(28px,6vw,72px);background:#fff;box-shadow:0 18px 70px #453e3420}.studio-scene>header{display:grid;grid-template-columns:52px 1fr}.scene-number{color:#678278}.studio-scene h2{margin:0;font:500 clamp(34px,5vw,58px)/1 Georgia,serif}.studio-tags{grid-column:2;margin-top:15px}.scene-lead{max-width:800px;margin:70px 0 40px;font:28px/1.4 Georgia,serif;border-left:4px solid #66877b;padding-left:28px}.scene-note{max-width:720px;margin:24px 0 0 52px}.scene-1{background:#17221f;color:#edf2ef}.scene-2{border-top:10px solid #b57952}
@media(max-width:760px){.atlas-summary{grid-template-columns:repeat(2,1fr)}.atlas-lanes{grid-template-columns:1fr}.studio-scene{min-height:0}.scene-note{margin-left:0}}
@media print{.hc-view-library{position:static;overflow:visible}.library-bar,.studio-rail{display:none}.atlas-lanes{grid-template-columns:1fr 1fr}.studio-scene{break-after:page;box-shadow:none}}
`

const _library = new ViewLibraryDrone()
window.ioc.register('@diamondcoreprocessor.com/ViewLibraryDrone', _library)
