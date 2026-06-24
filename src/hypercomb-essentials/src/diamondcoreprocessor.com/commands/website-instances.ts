// diamondcoreprocessor.com/commands/website-instances.ts
//
// `/website list` — the build queue: a lineage list of the cells the
// participant has flagged with `/website here` for the next gen pass. A
// flagged cell carries a `visual:website:pending` decoration on its own
// `decorations` slot (an independent, signature-addressed, undoable resource
// — no central map). We discover them by walking the tree and reading each
// cell's decorations; clicking a row's × clears that cell's pending marker,
// clicking its path navigates there.
//
// The panel is a self-contained DOM overlay (no Angular component) — same
// approach as the game overlays — so it needs no web/dev shell parity wiring.
// Clearing a marker only removes the build-intent flag; it never touches any
// already-generated page (that's a `visual:website:page` decoration, a
// different kind).

import { I18N_IOC_KEY, type I18nProvider } from '@hypercomb/core'
import { removeDecoration } from './decoration-manifest.js'
import { WEBSITE_PENDING_KIND } from './website.queen.js'

const STYLE_ID = 'wl-overlay-styles'
function t(key: string, params?: Record<string, string | number>): string {
  const i18n = (window as any).ioc?.get?.(I18N_IOC_KEY) as I18nProvider | undefined
  return i18n?.t(key, params) ?? key
}
const SIG_RE = /^[0-9a-f]{64}$/
/** Depth guard for the queue walk — matches the build drone's MAX_DEPTH. */
const MAX_DEPTH = 24
/** The built-page kind. A cell whose intent has been fulfilled (it now has a
 *  generated page) self-clears from the queue, so a lingering pending marker
 *  is harmless and no decoration-remove op is needed on the build side. */
const WEBSITE_PAGE_KIND = 'visual:website:page'

const get = <T>(key: string): T | undefined =>
  (window as unknown as { ioc?: { get?: (k: string) => unknown } }).ioc?.get?.(key) as T | undefined

export interface WebsiteInstance {
  segments: string[]
  label: string
  /** JSON-encoded segment path — stable row id. */
  key: string
  /** The `visual:website:pending` decoration sig — what removeDecoration drops. */
  sig: string
}

type HistoryServiceLike = {
  sign(l: { explorerSegments?: () => readonly string[] }): Promise<string>
  currentLayerAt(locationSig: string): Promise<{ decorations?: unknown; children?: unknown } | null>
  getLayerBySig(sig: string): Promise<{ name?: unknown } | null>
}
type StoreLike = { getResource(sig: string): Promise<Blob | null> }

// ── enumeration ────────────────────────────────────────────

/** The build queue — cells flagged with `/website here`. Walks the tree from
 *  root via HistoryService, reading each cell's `decorations` slot for a
 *  `visual:website:pending` marker. On-demand (panel open), not a hot path. */
export async function findWebsiteInstances(): Promise<WebsiteInstance[]> {
  const history = get<HistoryServiceLike>('@diamondcoreprocessor.com/HistoryService')
  const store = get<StoreLike>('@hypercomb.social/Store')
  if (!history || !store?.getResource) return []

  const out: WebsiteInstance[] = []
  const visited = new Set<string>()

  const childNames = async (layer: { children?: unknown }): Promise<string[]> => {
    const children = Array.isArray(layer?.children) ? layer.children : []
    const names: string[] = []
    for (const entry of children) {
      const s = String(entry ?? '').trim()
      if (!s) continue
      if (SIG_RE.test(s)) {
        const child = await history.getLayerBySig(s).catch(() => null)
        const n = child?.name
        if (typeof n === 'string' && n) names.push(n)
      } else {
        names.push(s)
      }
    }
    return names
  }

  /** Scan a cell's decorations once: the pending-marker sig (if flagged) and
   *  whether a generated page already exists. A flagged cell that's already
   *  generated is dropped from the queue (intent fulfilled). */
  const scan = async (layer: { decorations?: unknown }): Promise<{ pendingSig: string | null; generated: boolean }> => {
    const decos = Array.isArray(layer?.decorations) ? layer.decorations : []
    let pendingSig: string | null = null
    let generated = false
    for (const entry of decos) {
      const sig = String(entry ?? '')
      if (!SIG_RE.test(sig)) continue
      const blob = await store.getResource(sig).catch(() => null)
      if (!blob) continue
      try {
        const rec = JSON.parse(await blob.text()) as { kind?: string; payload?: { htmlSig?: unknown } }
        if (rec?.kind === WEBSITE_PENDING_KIND) {
          if (!pendingSig) pendingSig = sig
        } else if (rec?.kind === WEBSITE_PAGE_KIND) {
          const htmlSig = rec.payload?.htmlSig
          if (typeof htmlSig === 'string' && SIG_RE.test(htmlSig)) generated = true
        }
      } catch { /* malformed — skip */ }
    }
    return { pendingSig, generated }
  }

  const walk = async (segments: string[], depth: number): Promise<void> => {
    if (depth < 0) return
    const pathKey = segments.join('/')
    if (visited.has(pathKey)) return
    visited.add(pathKey)
    const locSig = await history.sign({ explorerSegments: () => segments }).catch(() => null)
    if (!locSig) return
    const layer = await history.currentLayerAt(locSig).catch(() => null)
    if (!layer) return
    const { pendingSig, generated } = await scan(layer)
    if (pendingSig && !generated) {
      out.push({
        segments: [...segments],
        label: segments.length ? segments[segments.length - 1] : '/',
        key: JSON.stringify(segments),
        sig: pendingSig,
      })
    }
    for (const name of await childNames(layer)) await walk([...segments, name], depth - 1)
  }

  await walk([], MAX_DEPTH)
  return out.sort((a, b) => pathLabel(a.segments).localeCompare(pathLabel(b.segments)))
}

// ── deletion ───────────────────────────────────────────────

/** Clear a cell's build-intent marker: drop its `visual:website:pending`
 *  decoration. Only the flag is removed — any already-generated page
 *  (`visual:website:page`) is a different decoration and is left intact. */
export function deleteWebsiteInstance(inst: WebsiteInstance): void {
  removeDecoration({ sig: inst.sig, segments: inst.segments })
}

// ── panel ──────────────────────────────────────────────────

function pathLabel(segments: readonly string[]): string {
  return segments.length ? '/' + segments.join('/') : '/'
}

/** Open the build-queue panel. Re-scans on open. */
export async function showWebsiteListPanel(): Promise<void> {
  injectStyles()
  document.getElementById('wl-overlay')?.remove() // single instance

  const overlay = document.createElement('div')
  overlay.id = 'wl-overlay'
  overlay.className = 'wl-overlay'
  const close = (): void => overlay.remove()
  overlay.addEventListener('mousedown', e => { if (e.target === overlay) close() })

  const panel = document.createElement('div')
  panel.className = 'wl-panel'
  overlay.appendChild(panel)

  const header = document.createElement('div')
  header.className = 'wl-header'
  const title = document.createElement('span')
  title.className = 'wl-title'
  title.textContent = t('website.queue.title')
  const x = document.createElement('button')
  x.className = 'wl-close'
  x.textContent = '✕'
  x.title = t('website.queue.close-title')
  x.onclick = close
  header.append(title, x)
  panel.appendChild(header)

  const list = document.createElement('div')
  list.className = 'wl-list'
  list.textContent = t('website.queue.loading')
  panel.appendChild(list)

  const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') { e.stopPropagation(); close() } }
  window.addEventListener('keydown', onKey, true)
  const cleanup = new MutationObserver(() => {
    if (!document.body.contains(overlay)) { window.removeEventListener('keydown', onKey, true); cleanup.disconnect() }
  })
  cleanup.observe(document.body, { childList: true })

  document.body.appendChild(overlay)

  const instances = await findWebsiteInstances()
  render(list, title, instances, close)
}

function render(list: HTMLDivElement, title: HTMLSpanElement, instances: WebsiteInstance[], close: () => void): void {
  title.textContent = t('website.queue.title-count', { count: instances.length })
  list.innerHTML = ''
  if (instances.length === 0) {
    const empty = document.createElement('div')
    empty.className = 'wl-empty'
    empty.textContent = t('website.queue.empty')
    list.appendChild(empty)
    return
  }

  for (const inst of instances) {
    const row = document.createElement('div')
    row.className = 'wl-row'

    const link = document.createElement('button')
    link.className = 'wl-path'
    link.title = t('website.queue.goto')
    const lead = document.createElement('span'); lead.className = 'wl-glyph'; lead.textContent = '◆'
    const text = document.createElement('span'); text.textContent = pathLabel(inst.segments)
    link.append(lead, text)
    link.onclick = (): void => {
      const nav = get<{ goRaw?: (s: readonly string[]) => void }>('@hypercomb.social/Navigation')
      nav?.goRaw?.(inst.segments)
      close()
    }

    const del = document.createElement('button')
    del.className = 'wl-x'
    del.textContent = '✕'
    del.title = t('website.queue.remove')
    del.onclick = async (): Promise<void> => {
      del.disabled = true
      row.classList.add('wl-removing')
      try {
        await deleteWebsiteInstance(inst)
        row.remove()
        const remaining = list.querySelectorAll('.wl-row').length
        title.textContent = t('website.queue.title-count', { count: remaining })
        if (remaining === 0) {
          const empty = document.createElement('div')
          empty.className = 'wl-empty'
          empty.textContent = t('website.queue.empty-short')
          list.appendChild(empty)
        }
      } catch (err) {
        console.warn('[/website list] remove failed', err)
        del.disabled = false
        row.classList.remove('wl-removing')
      }
    }

    row.append(link, del)
    list.appendChild(row)
  }
}

function injectStyles(): void {
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = CSS
  document.head.appendChild(style)
}

const CSS = `
.wl-overlay{position:fixed;inset:0;z-index:2147482000;display:flex;align-items:flex-start;
  justify-content:center;padding-top:9vh;background:rgba(6,8,14,.55);backdrop-filter:blur(3px);
  font-family:'Segoe UI',system-ui,sans-serif;animation:wl-in .14s ease both}
@keyframes wl-in{from{opacity:0}to{opacity:1}}
.wl-panel{width:min(560px,92vw);max-height:74vh;display:flex;flex-direction:column;
  background:rgba(14,18,26,.92);border:1px solid rgba(126,182,214,.32);border-radius:12px;
  box-shadow:0 18px 60px rgba(0,0,0,.55);overflow:hidden}
.wl-header{display:flex;align-items:center;gap:.6rem;padding:.7rem .9rem;
  border-bottom:1px solid rgba(126,182,214,.22)}
.wl-title{font-size:.92rem;font-weight:600;letter-spacing:.02em;color:#dfe7ff;flex:1}
.wl-close{width:1.8rem;height:1.8rem;border-radius:50%;border:none;cursor:pointer;
  background:transparent;color:rgba(126,182,214,.7);font-size:.9rem}
.wl-close:hover{background:rgba(126,182,214,.16);color:#fff}
.wl-list{overflow:auto;padding:.4rem;display:flex;flex-direction:column;gap:.2rem}
.wl-empty{padding:1.4rem .8rem;text-align:center;color:#8b93b4;font-size:.85rem}
.wl-row{display:flex;align-items:center;gap:.4rem;padding:.1rem;border-radius:7px;
  transition:background .12s ease,opacity .12s ease}
.wl-row:hover{background:rgba(126,182,214,.08)}
.wl-row.wl-removing{opacity:.4}
.wl-path{flex:1;display:flex;align-items:center;gap:.45rem;min-width:0;text-align:left;
  background:transparent;border:none;cursor:pointer;color:#cdd6f4;font-size:.85rem;
  padding:.45rem .5rem;border-radius:6px;font-family:ui-monospace,'Cascadia Code',monospace}
.wl-path:hover{color:#fff}
.wl-path span:last-child{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.wl-glyph{color:rgba(126,182,214,.65);font-size:.7rem;flex-shrink:0}
.wl-x{flex-shrink:0;width:1.9rem;height:1.9rem;border-radius:6px;border:none;cursor:pointer;
  background:transparent;color:rgba(255,120,120,.65);font-size:.85rem;
  transition:background .12s ease,color .12s ease}
.wl-x:hover{background:rgba(255,80,80,.18);color:#ff9a9a}
.wl-x:disabled{opacity:.4;cursor:default}
`
