import { EffectBus } from '@hypercomb/core'
import { storeImageResources } from '../editor/arm-resource.js'
import {
  readTilePropertiesAt,
  writeTilePropertiesAt,
} from '../editor/tile-properties.js'
import {
  discoverYouTubeMetadata,
  type YouTubeMetadataCandidate,
} from './youtube.js'

const STORAGE_KEY = 'hc:youtube-metadata-queue:v1'
const IOC_KEY = '@diamondcoreprocessor.com/YouTubeMetadataQueue'
const OWNER = 'youtube-metadata-review'
const STYLE_ID = 'hc-youtube-metadata-styles'

type Candidate = YouTubeMetadataCandidate & { adopted?: boolean }

export type YouTubeMetadataQueueEntry = {
  id: string
  segments: string[]
  cell: string
  url: string
  status: 'pending' | 'ready' | 'failed'
  candidates: Candidate[]
  createdAt: number
  updatedAt: number
  error?: string
}

type DecorationService = {
  setTitle?(
    segments: readonly string[],
    text: string,
  ): Promise<'set' | 'cleared' | 'noop' | 'duplicate'>
  addTag?(segments: readonly string[], name: string): Promise<string>
}
type TagRegistry = { ensureLoaded?(): Promise<void>; add?(name: string): Promise<unknown> }
type ModeRegistry = { enter(mode: string, owner: string): void; exit(mode: string, owner: string): void }

const ioc = <T,>(key: string): T | undefined =>
  (window as unknown as { ioc?: { get?: (name: string) => unknown } }).ioc?.get?.(key) as T | undefined

const targetKey = (segments: readonly string[], cell: string): string =>
  [...segments, cell].join('\u0000')

export class YouTubeMetadataQueue extends EventTarget {
  #entries = new Map<string, YouTubeMetadataQueueEntry>()
  #running = new Set<string>()
  #overlay: HTMLDivElement | null = null
  #openId: string | null = null
  #onKey = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return
    event.stopPropagation()
    this.close()
  }

  constructor() {
    super()
    this.#load()
    // The passive review offer: playing a video tile no longer preempts the
    // tap with this screen — a toast offers it instead, and its button lands
    // here (see link-open.worker.ts).
    EffectBus.on<{ id?: unknown }>('youtube-meta:open', payload => {
      const id = typeof payload?.id === 'string' ? payload.id : ''
      if (id) this.open(id)
    })
    queueMicrotask(() => {
      for (const entry of this.#entries.values()) {
        if (entry.status === 'pending') void this.#run(entry.id)
      }
    })
  }

  enqueue(input: { segments: readonly string[]; cell: string; url: string }): string {
    const segments = [...input.segments]
    const key = targetKey(segments, input.cell)
    // A tile has one current link. Retire suggestions discovered for a link
    // that this new drop replaced; their remote references are no longer
    // relevant and no resource bytes have been minted from them.
    for (const [id, entry] of this.#entries) {
      if (targetKey(entry.segments, entry.cell) === key && entry.url !== input.url) {
        this.#entries.delete(id)
      }
    }
    const prior = [...this.#entries.values()].find(entry =>
      targetKey(entry.segments, entry.cell) === key
      && entry.url === input.url
      && entry.status !== 'failed')
    if (prior) {
      this.#save()
      return prior.id
    }

    const id = `youtube-meta:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`
    const now = Date.now()
    this.#entries.set(id, {
      id,
      segments,
      cell: input.cell,
      url: input.url,
      status: 'pending',
      candidates: [],
      createdAt: now,
      updatedAt: now,
    })
    this.#save()
    void this.#run(id)
    return id
  }

  readyForTile(
    segments: readonly string[],
    cell: string,
    url?: string,
  ): YouTubeMetadataQueueEntry | null {
    const key = targetKey(segments, cell)
    return [...this.#entries.values()].find(entry =>
      entry.status === 'ready'
      && targetKey(entry.segments, entry.cell) === key
      && (!url || entry.url === url)) ?? null
  }

  openReadyForTile(segments: readonly string[], cell: string, url?: string): boolean {
    const entry = this.readyForTile(segments, cell, url)
    if (!entry) return false
    this.open(entry.id)
    return true
  }

  open(id: string): void {
    if (!this.#entries.has(id)) return
    this.#openId = id
    this.#render()
  }

  close(): void {
    this.#overlay?.remove()
    this.#overlay = null
    this.#openId = null
    document.removeEventListener('keydown', this.#onKey, true)
    ioc<ModeRegistry>('@diamondcoreprocessor.com/ModeRegistry')?.exit('view:active', OWNER)
  }

  discard(id: string): void {
    this.#entries.delete(id)
    this.#save()
    if (this.#openId === id) this.close()
    // Candidates are remote references until clicked, so discard releases the
    // queue without leaving unreferenced content-addressed blobs behind.
    EffectBus.emit('toast:show', { type: 'info', message: 'YouTube metadata suggestions discarded.' })
  }

  async adopt(id: string, candidateId: string): Promise<void> {
    const entry = this.#entries.get(id)
    const candidate = entry?.candidates.find(item => item.id === candidateId)
    if (!entry || !candidate || candidate.adopted) return

    const fullSegments = [...entry.segments, entry.cell]
    if (candidate.kind === 'title') {
      const decorations = ioc<DecorationService>('@diamondcoreprocessor.com/DecorationService')
      if (!decorations?.setTitle) throw new Error('Title storage is not ready')
      const outcome = await decorations.setTitle(fullSegments, candidate.value)
      if (outcome === 'duplicate') throw new Error('A neighbouring tile already uses that title')
    } else if (candidate.kind === 'keyword') {
      const decorations = ioc<DecorationService>('@diamondcoreprocessor.com/DecorationService')
      if (!decorations?.addTag) throw new Error('Keyword storage is not ready')
      await decorations.addTag(fullSegments, candidate.value)
      const registry = ioc<TagRegistry>('@hypercomb.social/TagRegistry')
      await registry?.ensureLoaded?.()
      await registry?.add?.(candidate.value)
      EffectBus.emit('tags:changed', { updates: [{ cell: entry.cell, tag: candidate.value }] })
    } else {
      await this.#adoptImage(entry, candidate.value)
    }

    candidate.adopted = true
    entry.updatedAt = Date.now()
    this.#save()
    this.#render()
  }

  async #adoptImage(entry: YouTubeMetadataQueueEntry, url: string): Promise<void> {
    const response = await fetch(url)
    if (!response.ok) throw new Error(`Could not fetch image (${response.status})`)
    const resources = await storeImageResources(await response.blob())
    if (!resources) throw new Error('Resource storage is not ready')
    try {
      const existing = await readTilePropertiesAt(entry.segments, entry.cell)
      const oldFlat = existing['flat'] && typeof existing['flat'] === 'object'
        ? existing['flat'] as Record<string, unknown>
        : {}
      const updates: Record<string, unknown> = {
        large: { image: resources.largeSig, x: 0, y: 0, scale: 1 },
        flat: {
          ...oldFlat,
          large: { x: 0, y: 0, scale: 1 },
        },
      }
      if (resources.smallPointSig) updates['small'] = { image: resources.smallPointSig }
      if (resources.smallFlatSig) {
        updates['flat'] = {
          ...(updates['flat'] as Record<string, unknown>),
          small: { image: resources.smallFlatSig },
        }
      }
      // The props index follows via writeTilePropertiesAt's central
      // layer-keyed seed — no location write needed (Phase C sweep,
      // visuals-across-lineages.md).
      await writeTilePropertiesAt(entry.segments, entry.cell, updates)
      EffectBus.emit('tile:saved', { cell: entry.cell, segments: entry.segments })
    } finally {
      if (resources.previewUrl) URL.revokeObjectURL(resources.previewUrl)
    }
  }

  async #run(id: string): Promise<void> {
    if (this.#running.has(id)) return
    const entry = this.#entries.get(id)
    if (!entry) return
    this.#running.add(id)
    EffectBus.emit('agent:start', {
      id,
      behavior: 'youtube-metadata',
      kind: 'script',
      request: `Discover metadata for ${entry.cell}`,
      targets: [entry.cell],
      segments: entry.segments,
    })
    try {
      EffectBus.emit('agent:progress', { id, activity: 'reading YouTube metadata' })
      const result = await discoverYouTubeMetadata(entry.url)
      const current = this.#entries.get(id)
      if (!current) {
        EffectBus.emit('agent:end', { id, ok: true, summary: 'metadata queue item discarded' })
        return
      }
      current.status = 'ready'
      current.candidates = result.candidates
      current.updatedAt = Date.now()
      delete current.error
      this.#save()
      EffectBus.emit('agent:end', {
        id,
        ok: true,
        summary: `${current.candidates.length} metadata suggestions ready`,
      })
      EffectBus.emit('toast:show', {
        type: 'success',
        message: `Metadata ready for ${current.cell}. Click the tile to review it.`,
      })
    } catch (error) {
      const current = this.#entries.get(id)
      if (!current) {
        EffectBus.emit('agent:end', { id, ok: true, summary: 'metadata queue item discarded' })
        return
      }
      current.status = 'failed'
      current.error = String((error as Error)?.message ?? error)
      current.updatedAt = Date.now()
      this.#save()
      EffectBus.emit('agent:end', { id, ok: false, summary: 'YouTube metadata discovery failed' })
      EffectBus.emit('toast:show', {
        type: 'warning',
        message: `Could not discover YouTube metadata for ${entry.cell}.`,
      })
    } finally {
      this.#running.delete(id)
    }
  }

  #load(): void {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as YouTubeMetadataQueueEntry[]
      if (!Array.isArray(parsed)) return
      for (const entry of parsed) {
        if (entry?.id && entry?.cell && entry?.url) this.#entries.set(entry.id, entry)
      }
    } catch { /* corrupt/blocked participant storage starts with an empty queue */ }
  }

  #save(): void {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify([...this.#entries.values()])) } catch { /* memory-only */ }
    this.dispatchEvent(new Event('change'))
  }

  #render(): void {
    const entry = this.#openId ? this.#entries.get(this.#openId) : undefined
    if (!entry) { this.close(); return }
    this.#ensureStyles()
    this.#overlay?.remove()

    const overlay = document.createElement('div')
    overlay.className = 'hc-ymeta'
    const panel = document.createElement('section')
    panel.className = 'hc-ymeta-panel'
    const head = document.createElement('header')
    const heading = document.createElement('div')
    const eyebrow = document.createElement('span')
    eyebrow.textContent = 'YOUTUBE METADATA QUEUE'
    const title = document.createElement('h1')
    title.textContent = entry.cell
    heading.append(eyebrow, title)
    const close = document.createElement('button')
    close.type = 'button'
    close.textContent = '×'
    close.setAttribute('aria-label', 'Close')
    close.addEventListener('click', () => this.close())
    head.append(heading, close)

    const intro = document.createElement('p')
    intro.className = 'hc-ymeta-intro'
    intro.textContent = 'Discovery is complete. Click any suggestion to adopt it into this tile. Images become tile resources; keywords become tile pheromones.'
    const grid = document.createElement('div')
    grid.className = 'hc-ymeta-grid'
    for (const candidate of entry.candidates) {
      const card = document.createElement('button')
      card.type = 'button'
      card.className = `hc-ymeta-card ${candidate.kind}${candidate.adopted ? ' adopted' : ''}`
      card.disabled = candidate.adopted === true
      if (candidate.kind === 'image') {
        const image = document.createElement('img')
        image.src = candidate.previewUrl
        image.alt = ''
        image.loading = 'lazy'
        card.appendChild(image)
      }
      const kind = document.createElement('small')
      kind.textContent = candidate.adopted ? 'ADDED' : candidate.label.toUpperCase()
      const value = document.createElement('strong')
      value.textContent = candidate.value
      card.append(kind, value)
      card.addEventListener('click', () => {
        card.disabled = true
        void this.adopt(entry.id, candidate.id).catch(error => {
          card.disabled = false
          EffectBus.emit('toast:show', {
            type: 'warning',
            message: `Could not adopt metadata: ${String((error as Error)?.message ?? error)}`,
          })
        })
      })
      grid.appendChild(card)
    }

    const actions = document.createElement('footer')
    const discard = document.createElement('button')
    discard.type = 'button'
    discard.className = 'secondary'
    discard.textContent = 'Discard remaining'
    discard.addEventListener('click', () => this.discard(entry.id))
    const watch = document.createElement('button')
    watch.type = 'button'
    watch.className = 'primary'
    watch.textContent = 'Watch video'
    watch.addEventListener('click', () => {
      this.close()
      EffectBus.emit('viewer:open', { kind: 'youtube', url: entry.url })
    })
    actions.append(discard, watch)
    panel.append(head, intro, grid, actions)
    overlay.appendChild(panel)
    document.body.appendChild(overlay)
    this.#overlay = overlay
    document.addEventListener('keydown', this.#onKey, true)
    ioc<ModeRegistry>('@diamondcoreprocessor.com/ModeRegistry')?.enter('view:active', OWNER)
  }

  #ensureStyles(): void {
    if (document.getElementById(STYLE_ID)) return
    const style = document.createElement('style')
    style.id = STYLE_ID
    style.textContent = `
.hc-ymeta{position:fixed;inset:0;z-index:2147482200;display:grid;place-items:center;padding:24px;background:rgba(5,9,13,.88);backdrop-filter:blur(18px);font-family:Inter,system-ui,sans-serif;color:#eaf5fb}
.hc-ymeta-panel{width:min(1040px,100%);max-height:min(840px,calc(100vh - 48px));overflow:auto;padding:28px;border:1px solid rgba(126,182,214,.4);background:#0d151bcc;box-shadow:0 30px 100px #000b}
.hc-ymeta header{display:flex;align-items:flex-start;justify-content:space-between;gap:20px}.hc-ymeta header span,.hc-ymeta-card small{display:block;color:#7eb6d6;font-size:10px;letter-spacing:.16em}.hc-ymeta h1{margin:5px 0 0;font:500 clamp(28px,5vw,48px)/1.05 Georgia,serif}
.hc-ymeta header button{border:0;background:transparent;color:#cce2ee;font-size:30px;cursor:pointer}.hc-ymeta-intro{max-width:720px;color:#9eb4bf;line-height:1.55}
.hc-ymeta-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;margin:28px 0}.hc-ymeta-card{min-height:112px;padding:16px;text-align:left;border:1px solid #2a4655;background:#13222b;color:#eef8fc;cursor:pointer;overflow:hidden}
.hc-ymeta-card:hover{border-color:#7eb6d6;transform:translateY(-1px)}.hc-ymeta-card strong{display:block;margin-top:8px;font-size:14px;line-height:1.35;overflow-wrap:anywhere}.hc-ymeta-card.image{padding:0}.hc-ymeta-card.image img{display:block;width:100%;height:132px;object-fit:cover}.hc-ymeta-card.image small,.hc-ymeta-card.image strong{margin:10px 14px}.hc-ymeta-card.adopted{opacity:.45;cursor:default}
.hc-ymeta footer{display:flex;justify-content:flex-end;gap:10px}.hc-ymeta footer button{padding:11px 18px;border:1px solid #456878;background:#15252e;color:#d8eaf3;cursor:pointer}.hc-ymeta footer .primary{background:#7eb6d6;color:#071017;border-color:#7eb6d6}
@media(max-width:620px){.hc-ymeta{padding:0}.hc-ymeta-panel{max-height:100vh;min-height:100vh;padding:20px}.hc-ymeta-grid{grid-template-columns:1fr 1fr}.hc-ymeta footer{position:sticky;bottom:0;padding-top:14px;background:#0d151b}}
`
    document.head.appendChild(style)
  }
}

const queue = new YouTubeMetadataQueue()
window.ioc.register(IOC_KEY, queue)
