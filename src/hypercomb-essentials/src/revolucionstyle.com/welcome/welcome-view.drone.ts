// The Revolución threshold — a 3D welcome page built from the layer itself.
//
// The decorated cell's CHILDREN are the elements of the page: each child
// tile becomes a gilded panel in a colonnade that recedes into the dark,
// carrying the child's own tile art and title. The visitor walks the aisle
// (wheel / drag = dolly, pointer = parallax) and steps through a panel to
// enter that child — whose own view implementation owns the surface from
// there. This drone renders exactly ONE layer; children are doorways.
//
// Everything is self-drawn: CSS 3D perspective for the room, a 2D canvas
// for embers and smoke. No dependencies, no fetching beyond the hive's own
// sig-addressed tile art. The atmosphere loop pauses when the document is
// hidden and dies with the view — an orphaned rAF must never outlive it.

import { Drone, RESOURCE_URL_PREFIX } from '@hypercomb/core'
import { titleForLabel } from '../../diamondcoreprocessor.com/commands/decoration-kind-index.js'
import { isFeatureHidden } from '../../diamondcoreprocessor.com/sharing/feature-hidden.js'
import { isKindGloballyOff } from '../../diamondcoreprocessor.com/sharing/behavior-enablement.js'
import { listDecorations } from '../../diamondcoreprocessor.com/commands/decoration-manifest.js'
import { childNamesOf, type PlacementHistory, type PlacementLayer } from '../../diamondcoreprocessor.com/history/layer-placement.js'
import { WELCOME_KIND, WELCOME_VIEW, type WelcomePayload } from './welcome.queen.js'

type ViewModeShape = EventTarget & { mode: string; setMode(next: string): void }
type LineageShape = { explorerSegments?: () => readonly string[] }
type NavigationShape = { goRaw(segments: readonly string[]): void }
type HistoryShape = {
  sign(l: { explorerSegments?: () => readonly string[] }): Promise<string>
  currentLayerAt(sig: string): Promise<Record<string, unknown> | null>
}
type StoreShape = { getResource(sig: string): Promise<Blob | null> }
const SIG_RE = /^[0-9a-f]{64}$/

interface PanelData { label: string; title: string; imageUrl: string | null }

export class WelcomeViewDrone extends Drone {
  readonly namespace = 'revolucionstyle.com'
  override genotype = 'presentation'
  override description =
    'Revolución welcome renderer — the decorated cell opens into a 3D threshold whose panels are its children.'

  #host: HTMLElement | null = null
  #targetSegments: string[] | null = null
  #bound = false
  #active = false
  #gen = 0
  #raf = 0
  #cleanup: Array<() => void> = []

  protected override heartbeat = async (): Promise<void> => {
    if (!this.#bound) {
      this.#vm()?.addEventListener('change', this.#change)
      window.addEventListener('keydown', this.#key, true)
      this.onEffect('decorations:changed', this.#change)
      this.onEffect('feature:hidden', this.#change)
      this.onEffect('feature:restored', this.#change)
      this.onEffect<{ view?: string; segments?: string[] }>('view:open-for-tile', payload => {
        if (payload?.view !== WELCOME_VIEW) return
        this.#targetSegments = (payload.segments ?? []).map(String).filter(Boolean)
        this.#vm()?.setMode(WELCOME_VIEW)
        void this.#reconcile()
      })
      this.#bound = true
    }
    await this.#reconcile()
  }

  protected override dispose(): void {
    this.#vm()?.removeEventListener('change', this.#change)
    window.removeEventListener('keydown', this.#key, true)
    this.#teardown()
  }

  readonly #change = (): void => { void this.#reconcile() }
  readonly #key = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || this.#vm()?.mode !== WELCOME_VIEW) return
    event.preventDefault()
    event.stopImmediatePropagation()
    this.#vm()?.setMode('hexagons')
  }

  #vm(): ViewModeShape | undefined {
    return window.ioc?.get<ViewModeShape>('@hypercomb.social/ViewMode')
  }

  async #reconcile(): Promise<void> {
    const gen = ++this.#gen
    if (this.#vm()?.mode === WELCOME_VIEW) { await this.#mount(gen); return }
    this.#targetSegments = null
    this.#teardown()
  }

  async #mount(gen: number): Promise<void> {
    const lineage = window.ioc?.get<LineageShape>('@hypercomb.social/Lineage')
    const segments = this.#targetSegments ?? [...(lineage?.explorerSegments?.() ?? [])]
    if (isKindGloballyOff(WELCOME_KIND) || await isFeatureHidden(segments, WELCOME_KIND)) {
      this.#targetSegments = null
      this.#teardown()
      this.#vm()?.setMode('hexagons')
      return
    }

    const records = await listDecorations<WelcomePayload>({ kind: WELCOME_KIND, segments })
    if (gen !== this.#gen || this.#vm()?.mode !== WELCOME_VIEW) return
    const payload = records.at(-1)?.record.payload
    const label = segments.at(-1) ?? ''
    const title = payload?.title
      || (label ? titleForLabel(label, navigator.language) || label : 'Welcome')

    const panels = await this.#panels(segments)
    if (gen !== this.#gen || this.#vm()?.mode !== WELCOME_VIEW) return

    this.#teardown()
    this.#host = this.#build(title, payload?.tagline ?? '', segments, panels)
    document.body.appendChild(this.#host)
    this.#setActive(true)
  }

  /** The layer's children, in layer order — the elements of the page. */
  async #panels(segments: readonly string[]): Promise<PanelData[]> {
    const history = window.ioc?.get<HistoryShape>('@diamondcoreprocessor.com/HistoryService')
    if (!history) return []
    let labels: string[] = []
    try {
      const layer = await history.currentLayerAt(await history.sign({ explorerSegments: () => [...segments] }))
      if (layer) labels = await childNamesOf(history as unknown as PlacementHistory, layer as unknown as PlacementLayer)
    } catch { /* no layer here */ }
    return Promise.all(labels.map(async child => ({
      label: child,
      title: titleForLabel(child, navigator.language) || child,
      imageUrl: await this.#tileImageUrl([...segments, child]),
    })))
  }

  async #tileImageUrl(segments: readonly string[]): Promise<string | null> {
    const history = window.ioc?.get<HistoryShape>('@diamondcoreprocessor.com/HistoryService')
    const store = window.ioc?.get<StoreShape>('@hypercomb.social/Store')
    if (!history || !store) return null
    try {
      const layer = await history.currentLayerAt(await history.sign({ explorerSegments: () => [...segments] }))
      const propsSig = Array.isArray((layer as { properties?: unknown })?.properties)
        ? String(((layer as { properties?: unknown[] }).properties as unknown[])[0] ?? '')
        : ''
      if (!SIG_RE.test(propsSig)) return null
      const blob = await store.getResource(propsSig)
      if (!blob) return null
      const props = JSON.parse(await blob.text()) as { small?: { image?: string } }
      const imageSig = String(props?.small?.image ?? '')
      return SIG_RE.test(imageSig) ? RESOURCE_URL_PREFIX + imageSig : null
    } catch { return null }
  }

  // ── The scene ────────────────────────────────────────────────────────

  #build(title: string, tagline: string, segments: readonly string[], panels: PanelData[]): HTMLElement {
    const host = document.createElement('section')
    host.className = 'hc-welcome-view'
    host.innerHTML = `<style>${SCENE_CSS}</style>`

    const atmo = document.createElement('canvas')
    atmo.className = 'wl-atmo'
    host.appendChild(atmo)

    const viewport = document.createElement('div')
    viewport.className = 'wl-viewport'
    const stage = document.createElement('div')
    stage.className = 'wl-stage'
    viewport.appendChild(stage)
    host.appendChild(viewport)

    const floor = document.createElement('div')
    floor.className = 'wl-floor'
    stage.appendChild(floor)

    // Panels flank a centre aisle, deepening two-by-two into the dark.
    const STEP = 300, START = 260
    panels.forEach((panel, index) => {
      const side = index % 2 === 0 ? -1 : 1
      const depth = START + Math.floor(index / 2) * STEP
      const door = document.createElement('button')
      door.type = 'button'
      door.className = 'wl-panel'
      door.style.setProperty('--i', String(index))
      door.style.setProperty('--sx', String(side))
      door.style.setProperty('--z', `${-depth}px`)
      door.title = panel.title
      if (panel.imageUrl) {
        const img = document.createElement('img')
        img.className = 'wl-art'
        img.src = panel.imageUrl
        img.alt = ''
        img.draggable = false
        door.appendChild(img)
      } else {
        const blank = document.createElement('span')
        blank.className = 'wl-art wl-art-blank'
        door.appendChild(blank)
      }
      const plaque = document.createElement('span')
      plaque.className = 'wl-plaque'
      plaque.textContent = panel.title
      door.appendChild(plaque)
      door.onclick = () => this.#enter([...segments, panel.label])
      stage.appendChild(door)
    })

    // The crest waits at the end of the aisle.
    const crestDepth = START + Math.ceil(panels.length / 2) * STEP + 240
    const crest = document.createElement('div')
    crest.className = 'wl-crest'
    crest.style.transform = `translate(-50%,-50%) translate3d(0,-40px,${-crestDepth}px)`
    const heading = document.createElement('h1')
    heading.className = 'wl-title'
    heading.textContent = title
    crest.appendChild(heading)
    if (tagline) {
      const sub = document.createElement('p')
      sub.className = 'wl-tagline'
      sub.textContent = tagline
      crest.appendChild(sub)
    }
    stage.appendChild(crest)

    const hint = document.createElement('p')
    hint.className = 'wl-hint'
    hint.textContent = 'scroll to walk in · step through a panel'
    host.appendChild(hint)

    const close = document.createElement('button')
    close.type = 'button'
    close.className = 'wl-close'
    close.setAttribute('aria-label', 'Return to hexagons')
    close.textContent = '×'
    close.onclick = () => this.#vm()?.setMode('hexagons')
    host.appendChild(close)

    this.#animate(host, stage, atmo, crestDepth)
    return host
  }

  /** Step through a doorway: real navigation into the child, back on the
   *  hexagon canvas — the child's own view (when it exists) takes it from
   *  there. */
  #enter(segments: readonly string[]): void {
    this.#vm()?.setMode('hexagons')
    window.ioc?.get<NavigationShape>('@hypercomb.social/Navigation')?.goRaw(segments)
  }

  // ── Motion: one loop drives dolly, parallax and atmosphere ───────────

  #animate(host: HTMLElement, stage: HTMLElement, atmo: HTMLCanvasElement, maxDepth: number): void {
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    let dolly = 0, dollyTarget = 0
    let rotX = 0, rotY = 0, rotXTarget = 0, rotYTarget = 0
    let dragY: number | null = null

    // Interaction must land even when rAF starves (occluded/uncomposited
    // tabs) — write the transform immediately, let the loop smooth it.
    const render = (): void => {
      stage.style.transform = `translateZ(${dolly}px) rotateX(${rotX}deg) rotateY(${rotY}deg)`
    }
    const step = (rate: number): void => {
      dolly += (dollyTarget - dolly) * rate
      rotX += (rotXTarget - rotX) * rate
      rotY += (rotYTarget - rotY) * rate
      render()
    }
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault()
      dollyTarget = Math.max(0, Math.min(maxDepth - 140, dollyTarget + event.deltaY * 0.9))
      step(0.3)
    }
    const onMove = (event: PointerEvent): void => {
      if (dragY !== null && event.pointerType === 'touch') {
        dollyTarget = Math.max(0, Math.min(maxDepth - 140, dollyTarget + (dragY - event.clientY) * 2.4))
        dragY = event.clientY
        step(0.3)
        return
      }
      if (still) return
      rotYTarget = (event.clientX / window.innerWidth - 0.5) * 7
      rotXTarget = (0.5 - event.clientY / window.innerHeight) * 3.5
      step(0.2)
    }
    const onDown = (event: PointerEvent): void => { if (event.pointerType === 'touch') dragY = event.clientY }
    const onUp = (): void => { dragY = null }
    host.addEventListener('wheel', onWheel, { passive: false })
    host.addEventListener('pointermove', onMove)
    host.addEventListener('pointerdown', onDown)
    host.addEventListener('pointerup', onUp)
    this.#cleanup.push(() => {
      host.removeEventListener('wheel', onWheel)
      host.removeEventListener('pointermove', onMove)
      host.removeEventListener('pointerdown', onDown)
      host.removeEventListener('pointerup', onUp)
    })

    // Embers rise, smoke drifts — modest counts, 2D canvas, no fetching.
    const context = atmo.getContext('2d')
    const embers = Array.from({ length: 36 }, () => ({
      x: Math.random(), y: Math.random(), r: 0.6 + Math.random() * 1.6,
      vy: 0.0003 + Math.random() * 0.0008, sway: Math.random() * Math.PI * 2,
    }))
    const wisps = Array.from({ length: 5 }, (_, i) => ({
      x: 0.15 + i * 0.17, y: 0.25 + Math.random() * 0.4, r: 90 + Math.random() * 120,
      drift: Math.random() * Math.PI * 2,
    }))

    let last = 0
    const frame = (now: number): void => {
      this.#raf = requestAnimationFrame(frame)
      const dt = Math.min(48, now - last || 16)
      last = now

      dolly += (dollyTarget - dolly) * 0.08
      rotX += (rotXTarget - rotX) * 0.06
      rotY += (rotYTarget - rotY) * 0.06
      render()

      if (!context || still || document.hidden) return
      const w = atmo.clientWidth, h = atmo.clientHeight
      if (atmo.width !== w || atmo.height !== h) { atmo.width = w; atmo.height = h }
      context.clearRect(0, 0, w, h)
      const t = now * 0.001
      for (const wisp of wisps) {
        const x = (wisp.x + Math.sin(t * 0.07 + wisp.drift) * 0.05) * w
        const y = (wisp.y + Math.cos(t * 0.05 + wisp.drift) * 0.04) * h
        const glow = context.createRadialGradient(x, y, 0, x, y, wisp.r)
        glow.addColorStop(0, 'rgba(212,175,55,0.045)')
        glow.addColorStop(1, 'rgba(212,175,55,0)')
        context.fillStyle = glow
        context.fillRect(x - wisp.r, y - wisp.r, wisp.r * 2, wisp.r * 2)
      }
      for (const ember of embers) {
        ember.y -= ember.vy * dt
        ember.sway += 0.0006 * dt
        if (ember.y < -0.02) { ember.y = 1.02; ember.x = Math.random() }
        const x = (ember.x + Math.sin(ember.sway) * 0.01) * w
        const y = ember.y * h
        const a = 0.25 + Math.sin(ember.sway * 3) * 0.15
        context.fillStyle = `rgba(230,168,60,${a.toFixed(3)})`
        context.beginPath()
        context.arc(x, y, ember.r, 0, Math.PI * 2)
        context.fill()
      }
    }
    this.#raf = requestAnimationFrame(frame)
  }

  #teardown(): void {
    cancelAnimationFrame(this.#raf)
    this.#raf = 0
    for (const undo of this.#cleanup.splice(0)) undo()
    this.#host?.remove()
    this.#host = null
    this.#setActive(false)
  }

  #setActive(active: boolean): void {
    if (this.#active === active) return
    this.#active = active
    const modes = window.ioc?.get<{ enter(m: string, o: string): void; exit(m: string, o: string): void }>('@diamondcoreprocessor.com/ModeRegistry')
    if (active) modes?.enter('view:active', 'welcome-view')
    else modes?.exit('view:active', 'welcome-view')
  }
}

// Espresso and gold — the Revolución chrome. The room is dark wood and
// candle-light; panels are the only bright objects, the crest the only
// words. Wide gradients, no images: the atmosphere canvas carries the rest.
const SCENE_CSS = `
.hc-welcome-view{position:fixed;top:0;bottom:0;left:var(--hc-inset-left,0px);right:var(--hc-inset-right,0px);z-index:150;overflow:hidden;background:radial-gradient(120% 90% at 50% 30%,#2a1c12 0%,#1a110a 46%,#0c0805 100%);touch-action:none}
.wl-atmo{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:3}
.wl-viewport{position:absolute;inset:0;perspective:1300px;perspective-origin:50% 46%}
.wl-stage{position:absolute;inset:0;transform-style:preserve-3d;will-change:transform}
.wl-floor{position:absolute;left:50%;top:50%;width:2600px;height:4200px;transform:translate(-50%,-50%) rotateX(90deg) translateZ(-300px);background:
 repeating-linear-gradient(90deg,rgba(212,175,55,.05) 0 1px,transparent 1px 130px),
 repeating-linear-gradient(0deg,rgba(212,175,55,.05) 0 1px,transparent 1px 130px),
 radial-gradient(60% 45% at 50% 42%,rgba(212,175,55,.07),transparent 70%),
 linear-gradient(#150d07,#0b0704);
 -webkit-mask-image:radial-gradient(58% 46% at 50% 44%,#000 30%,transparent 78%);mask-image:radial-gradient(58% 46% at 50% 44%,#000 30%,transparent 78%)}
.wl-panel{position:absolute;left:50%;top:50%;width:230px;height:310px;padding:0;--lane:330px;transform:translate(-50%,-50%) translate3d(calc(var(--sx,1) * var(--lane)),0,var(--z,0px)) rotateY(calc(var(--sx,1) * -26deg));border:1px solid rgba(212,175,55,.55);background:linear-gradient(170deg,#241710,#160e08);cursor:pointer;transform-style:preserve-3d;box-shadow:0 30px 70px rgba(0,0,0,.6),0 0 0 5px rgba(20,12,7,.9),0 0 0 6px rgba(212,175,55,.28);animation:wl-arrive .9s cubic-bezier(.2,.7,.2,1) backwards;animation-delay:calc(.12s * var(--i,0));transition:box-shadow .25s ease,border-color .25s ease}
.wl-panel:hover,.wl-panel:focus-visible{border-color:#e9c767;box-shadow:0 34px 80px rgba(0,0,0,.65),0 0 0 5px rgba(20,12,7,.9),0 0 0 6px rgba(233,199,103,.7),0 0 46px rgba(212,175,55,.28);outline:none}
.wl-art{position:absolute;inset:10px 10px 56px;object-fit:cover;display:block;background:#0e0906;filter:saturate(.92) brightness(.96)}
.wl-panel:hover .wl-art{filter:saturate(1.05) brightness(1.05)}
.wl-art-blank{background:
 radial-gradient(40% 40% at 50% 44%,rgba(212,175,55,.2),transparent 70%),
 conic-gradient(from 30deg,rgba(212,175,55,.12) 0 60deg,transparent 0 120deg,rgba(212,175,55,.12) 0 180deg,transparent 0 240deg,rgba(212,175,55,.12) 0 300deg,transparent 0),#140d08}
.wl-plaque{position:absolute;left:10px;right:10px;bottom:10px;height:38px;display:flex;align-items:center;justify-content:center;background:linear-gradient(180deg,#2b1c10,#1c1109);border-top:1px solid rgba(212,175,55,.4);color:#e8d9ae;font:600 .82rem/1.1 Georgia,'Times New Roman',serif;letter-spacing:.14em;text-transform:uppercase;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding:0 .5rem;box-sizing:border-box}
.wl-crest{position:absolute;left:50%;top:50%;width:640px;text-align:center;transform-style:preserve-3d;pointer-events:none}
.wl-title{margin:0;font:italic 700 4.4rem/1.05 Georgia,'Times New Roman',serif;letter-spacing:.06em;background:linear-gradient(100deg,#8a6a1f 0%,#e9c767 28%,#fff3c4 50%,#e9c767 72%,#8a6a1f 100%);-webkit-background-clip:text;background-clip:text;color:transparent;filter:drop-shadow(0 4px 26px rgba(212,175,55,.25))}
.wl-tagline{margin:.9rem 0 0;color:#cdb98a;font:400 1.05rem/1.5 Georgia,serif;letter-spacing:.22em;text-transform:uppercase}
.wl-hint{position:absolute;left:50%;bottom:calc(1.1rem + env(safe-area-inset-bottom,0px));transform:translateX(-50%);z-index:4;margin:0;color:rgba(205,185,138,.55);font:400 .78rem/1 Georgia,serif;letter-spacing:.24em;text-transform:uppercase;pointer-events:none;animation:wl-fade 1.2s ease .8s backwards}
.wl-close{position:fixed;z-index:2147483600;right:calc(.75rem + env(safe-area-inset-right,0px));top:calc(.75rem + env(safe-area-inset-top,0px));width:2.25rem;height:2.25rem;display:flex;align-items:center;justify-content:center;border-radius:50%;background:rgba(20,12,7,.82);border:1px solid rgba(212,175,55,.45);backdrop-filter:blur(6px);color:#e8d9ae;cursor:pointer;font:1.3rem/1 serif;padding:0;opacity:.55;transition:opacity .16s ease}
.wl-close:hover{opacity:1}
@keyframes wl-arrive{from{opacity:0;translate:0 26px}to{opacity:1;translate:0 0}}
@keyframes wl-fade{from{opacity:0}to{opacity:1}}
@media(prefers-reduced-motion:reduce){.wl-panel{animation:none;opacity:1}.wl-hint{animation:none}}
@media(max-width:720px){.wl-panel{width:164px;height:224px;--lane:172px}.wl-art{inset:7px 7px 42px}.wl-plaque{height:30px;font-size:.68rem;bottom:7px;left:7px;right:7px}.wl-title{font-size:2.6rem}.wl-crest{width:88vw}.wl-viewport{perspective:1000px}}
`

const _welcomeView = new WelcomeViewDrone()
window.ioc.register('@revolucionstyle.com/WelcomeViewDrone', _welcomeView)
