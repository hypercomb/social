// sharing/landing-capture.ts
//
// THE LANDING PICTURE. A published site opened onto a black cover for
// seconds while the visitor's browser installed and evaluated the engine
// ("they seem broken when you get there" — jwize, 2026-09-24). The publisher
// has the creation on screen at the moment they publish, so the publish
// takes a picture of it: the Pixi canvas composited with the DOM tile names
// (tile-name.drone.ts draws the names as spans over the canvas — the canvas
// alone is a hive with no words). The bytes become an ordinary resource,
// ride the same drain as the closure, and the signed index names them under
// `landing[lineageKey]`. The door serves that picture INSIDE the loading
// cover, so the visitor sees the site at HTML-parse time and the engine
// hydrates behind it.
//
// A TAKEOVER VIEW (a website page over the hexagons, body.hc-view-covered)
// is DOM the canvas never held, so its landing is not a picture but the PAGE
// ITSELF: the mounted cell page's bytes with their `resource:` refs rewritten
// to heap URLs, exactly as the site view mounts them. The door frames that
// HTML inside the cover, sandboxed, so the visitor reads the real page while
// the engine loads.
//
// A derived record, never truth: nothing reads it back but the cover, and a
// publish that cannot take the picture is still a publish.

import { get, RESOURCE_URL_PREFIX, SITE_VIEW_IOC_KEY } from '@hypercomb/core'
import { rewritePageRefs } from './decoration-closure.js'

const PIXI_HOST_KEY = '@diamondcoreprocessor.com/PixiHostWorker'
const NAVIGATION_KEY = '@hypercomb.social/Navigation'
const STORE_KEY = '@hypercomb.social/Store'
/** Longest edge of the shipped picture. A hive is flat colour; WebP at this
 *  size lands well under 200 KB and is on screen before the pack arrives. */
const MAX_EDGE = 1600
const QUALITY = 0.82

interface PixiHostLike {
  app?: {
    canvas?: HTMLCanvasElement
    render?: () => void
  }
}
interface NavigationLike { segments?: () => string[] }
interface SiteViewLike { mountedPageSig?: string }
interface StoreLike { getResource?: (sig: string) => Promise<Blob | null> }

/** What the publish ships: the bytes and the NAME that declares their
 *  presentation type on the heap (`/<sig>/landing.webp`, `/<sig>/landing.html`
 *  — a suffix picks the MIME, the sig alone names the bytes). */
export interface Landing { blob: Blob; name: 'landing.webp' | 'landing.html' }

const clean = (s: unknown): string => String(s ?? '').trim().toLowerCase()

/** True when the location on screen IS the branch — the only time the
 *  picture would show what the visitor lands on. */
export function isOnScreen(segments: readonly string[]): boolean {
  const navigation = get<NavigationLike>(NAVIGATION_KEY)
  const here = (navigation?.segments?.() ?? []).map(clean).filter(Boolean)
  const wanted = segments.map(clean).filter(Boolean)
  return wanted.length > 0 && here.length === wanted.length && here.every((s, i) => s === wanted[i])
}

/** Draw every visible tile name at its on-screen box. The spans sit in a
 *  world div carrying the camera as a CSS matrix, so their bounding rects
 *  are already in screen space; the scale between layout and screen comes
 *  from the rect against the untransformed offset size. */
function drawNames(ctx: CanvasRenderingContext2D, canvasRect: DOMRect, ratio: number): void {
  const spans = document.querySelectorAll<HTMLElement>('.hc-tile-names .hc-tile-name-text')
  for (const span of spans) {
    const rect = span.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0 || !span.offsetWidth) continue
    if (rect.right < canvasRect.left || rect.left > canvasRect.right
      || rect.bottom < canvasRect.top || rect.top > canvasRect.bottom) continue
    const style = getComputedStyle(span)
    if (style.visibility === 'hidden' || Number(style.opacity) === 0) continue
    const scale = rect.width / span.offsetWidth
    const px = parseFloat(style.fontSize) * scale * ratio
    if (!(px > 0.5)) continue
    ctx.save()
    ctx.font = `${style.fontStyle} ${style.fontWeight} ${px}px ${style.fontFamily}`
    ctx.fillStyle = style.color
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const spacing = parseFloat(style.letterSpacing)
    if (Number.isFinite(spacing) && 'letterSpacing' in ctx) {
      (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${spacing * scale * ratio}px`
    }
    const x = (rect.left - canvasRect.left + rect.width / 2) * ratio
    const y = (rect.top - canvasRect.top + rect.height / 2) * ratio
    ctx.fillText(span.textContent ?? '', x, y, rect.width * ratio)
    ctx.restore()
  }
}

/** The page a takeover view has on screen, as standalone HTML, or null
 *  when no page is mounted or its bytes cannot be read. */
async function capturePage(): Promise<Landing | null> {
  const pageSig = String(get<SiteViewLike>(SITE_VIEW_IOC_KEY)?.mountedPageSig ?? '')
  if (!/^[0-9a-f]{64}$/.test(pageSig)) return null
  const bytes = await get<StoreLike>(STORE_KEY)?.getResource?.(pageSig)
  if (!bytes) return null
  const html = rewritePageRefs(await bytes.text(), RESOURCE_URL_PREFIX)
  return { blob: new Blob([html], { type: 'text/html' }), name: 'landing.html' }
}

/** What is on screen, or null when there is nothing to take: no canvas, a
 *  takeover view with no page mounted, or a browser that cannot encode.
 *  Never throws. */
export async function captureLanding(): Promise<Landing | null> {
  try {
    if (document.body.classList.contains('hc-view-covered')) return await capturePage()
    const app = get<PixiHostLike>(PIXI_HOST_KEY)?.app
    const source = app?.canvas
    if (!source || !source.width || !source.height) return null
    const canvasRect = source.getBoundingClientRect()
    if (canvasRect.width <= 0 || canvasRect.height <= 0) return null

    const shrink = Math.min(1, MAX_EDGE / Math.max(canvasRect.width, canvasRect.height))
    const ratio = shrink
    const out = document.createElement('canvas')
    out.width = Math.max(1, Math.round(canvasRect.width * ratio))
    out.height = Math.max(1, Math.round(canvasRect.height * ratio))
    const ctx = out.getContext('2d')
    if (!ctx) return null

    // The ground: what the participant sees behind a transparent canvas.
    ctx.fillStyle = getComputedStyle(document.body).backgroundColor || '#08090c'
    ctx.fillRect(0, 0, out.width, out.height)
    // A fresh frame drawn in THIS task, so the WebGL buffer is still there
    // to copy — no preserveDrawingBuffer needed.
    app.render?.()
    ctx.drawImage(source, 0, 0, out.width, out.height)
    drawNames(ctx, canvasRect, ratio)

    const blob = await new Promise<Blob | null>(resolve => {
      out.toBlob(picture => resolve(picture), 'image/webp', QUALITY)
    })
    return blob && blob.size > 0 ? { blob, name: 'landing.webp' } : null
  } catch {
    return null
  }
}
