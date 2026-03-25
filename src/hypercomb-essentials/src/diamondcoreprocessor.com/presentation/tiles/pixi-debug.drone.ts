// diamondcoreprocessor.com/pixi/pixi-debug.drone.ts
import { Drone } from '@hypercomb/core'
import { Application, Container, Mesh, Text, Graphics, Sprite, Point } from 'pixi.js'
import type { HostReadyPayload } from './pixi-host.worker.js'

type DisplayObject = Container

/** Recursively collect all display objects whose bounds contain the point. */
function hitCollect(
  root: Container,
  globalPt: Point,
  out: DisplayObject[],
): void {
  if (!root.visible || root.alpha <= 0) return

  for (let i = root.children.length - 1; i >= 0; i--) {
    const child = root.children[i] as Container
    hitCollect(child, globalPt, out)
  }

  // check this node itself (skip the stage root)
  try {
    const bounds = root.getBounds()
    if (
      globalPt.x >= bounds.x &&
      globalPt.x <= bounds.x + bounds.width &&
      globalPt.y >= bounds.y &&
      globalPt.y <= bounds.y + bounds.height
    ) {
      out.push(root)
    }
  } catch { /* some objects throw on getBounds — skip */ }
}

/** Walk the display tree and collect every node. */
function walkTree(node: Container, depth: number, lines: string[]): void {
  const tag = describeObject(node)
  const vis = node.visible ? '' : ' [hidden]'
  const prefix = '  '.repeat(depth)
  lines.push(`${prefix}${tag}${vis}  pos(${node.position.x.toFixed(1)}, ${node.position.y.toFixed(1)})  z:${(node as any).zIndex ?? '-'}`)

  for (const child of node.children) {
    walkTree(child as Container, depth + 1, lines)
  }
}

function describeObject(obj: DisplayObject): string {
  if (obj instanceof Mesh) return `Mesh`
  if (obj instanceof Text) return `Text("${(obj.text ?? '').slice(0, 24)}")`
  if (obj instanceof Sprite) return `Sprite`
  if (obj instanceof Graphics) return `Graphics`
  if (obj instanceof Container && obj.children.length > 0) return `Container(${obj.children.length})`
  if (obj instanceof Container) return `Container`
  return (obj as any).constructor?.name ?? 'DisplayObject'
}

function formatObjectInfo(obj: DisplayObject): string {
  const lines: string[] = []
  const type = describeObject(obj)
  lines.push(`type: ${type}`)
  lines.push(`pos: (${obj.position.x.toFixed(1)}, ${obj.position.y.toFixed(1)})`)
  lines.push(`scale: (${obj.scale.x.toFixed(2)}, ${obj.scale.y.toFixed(2)})`)
  lines.push(`visible: ${obj.visible}  alpha: ${obj.alpha.toFixed(2)}`)
  lines.push(`children: ${obj.children.length}`)

  if ((obj as any).zIndex !== undefined) lines.push(`zIndex: ${(obj as any).zIndex}`)

  try {
    const b = obj.getBounds()
    lines.push(`bounds: ${b.width.toFixed(0)}×${b.height.toFixed(0)} @ (${b.x.toFixed(0)},${b.y.toFixed(0)})`)
  } catch { /* skip */ }

  if (obj instanceof Text) lines.push(`text: "${(obj.text ?? '').slice(0, 60)}"`)
  if (obj instanceof Mesh) {
    const geo = (obj as any).geometry
    if (geo) lines.push(`geometry buffers: ${geo.buffers?.length ?? '?'}`)
  }

  // label from parent's IoC registration
  const iocLabel = findIocLabel(obj)
  if (iocLabel) lines.push(`ioc: ${iocLabel}`)

  return lines.join('\n')
}

function findIocLabel(obj: DisplayObject): string | null {
  const ioc = (window as any).ioc
  if (!ioc?.list) return null

  // Walk up from obj to find an IoC-registered drone that owns this container
  let current: DisplayObject | null = obj
  while (current) {
    const all = ioc.list() as Map<string, any> | Record<string, any>
    const entries = all instanceof Map ? [...all.entries()] : Object.entries(all)
    for (const [key, val] of entries) {
      if (!val || typeof val !== 'object') continue
      // Check common patterns: val.layer, val.overlay, val.container === current
      for (const prop of ['layer', 'overlay', 'container', 'mesh']) {
        if ((val as any)[prop] === current) return `${key}.${prop}`
      }
      if (val === current) return key
    }
    current = current.parent as DisplayObject | null
  }
  return null
}

// ── HTML overlay panel ──────────────────────────────────────────────────

function createPanel(): HTMLDivElement {
  const el = document.createElement('div')
  el.id = 'pixi-debug-panel'
  el.style.cssText = `
    position: fixed; bottom: 8px; left: 8px; z-index: 999999;
    background: rgba(0,0,0,0.88); color: #0f0; font: 11px/1.4 monospace;
    padding: 8px 10px; border-radius: 4px; pointer-events: none;
    max-width: 420px; white-space: pre-wrap; word-break: break-all;
    border: 1px solid rgba(0,255,0,0.3);
    transition: opacity 0.15s;
  `
  document.body.appendChild(el)
  return el
}

function createHitListPanel(): HTMLDivElement {
  const el = document.createElement('div')
  el.id = 'pixi-debug-hitlist'
  el.style.cssText = `
    position: fixed; top: 8px; right: 8px; z-index: 999999;
    background: rgba(0,0,0,0.88); color: #0f0; font: 11px/1.4 monospace;
    padding: 8px 10px; border-radius: 4px; pointer-events: auto;
    max-width: 360px; max-height: 60vh; overflow-y: auto;
    white-space: pre-wrap; word-break: break-all;
    border: 1px solid rgba(0,255,0,0.3);
  `
  document.body.appendChild(el)
  return el
}

// ── The Drone ───────────────────────────────────────────────────────────

export class PixiDebugDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override description = 'dev-only Pixi display-tree inspector — hover to identify objects'

  #app: Application | null = null
  #renderContainer: Container | null = null
  #renderer: Application['renderer'] | null = null
  #canvas: HTMLCanvasElement | null = null

  #panel: HTMLDivElement | null = null
  #hitListPanel: HTMLDivElement | null = null
  #listening = false
  #active = true
  #pinnedObj: DisplayObject | null = null

  protected override listens = ['render:host-ready']

  protected override heartbeat = async (): Promise<void> => {
    this.onEffect<HostReadyPayload>('render:host-ready', (payload) => {
      this.#app = payload.app
      this.#renderContainer = payload.container
      this.#canvas = payload.canvas
      this.#renderer = payload.renderer
      this.#attach()
    })
  }

  protected override dispose(): void {
    this.#detach()
  }

  // ── Setup ─────────────────────────────────────────────────────────────

  #attach(): void {
    if (this.#listening) return
    this.#listening = true
    this.#panel = createPanel()
    this.#hitListPanel = createHitListPanel()

    document.addEventListener('pointermove', this.#onMove)
    document.addEventListener('keydown', this.#onKey)
    this.#hitListPanel.addEventListener('click', this.#onHitListClick)

    // expose helpers on window for console use
    const dbg = (window as any).__pixiDebug = {
      active: this.#active,
      hovered: null as DisplayObject | null,
      hits: [] as DisplayObject[],
      pinned: null as DisplayObject | null,
      tree: () => this.#printTree(),
      find: (pred: (obj: DisplayObject) => boolean) => this.#findInTree(pred),
      app: this.#app,
      container: this.#renderContainer,
      toggle: () => { this.#active = !this.#active; dbg.active = this.#active; this.#updatePanelVisibility() },
    }

    console.log(
      '%c[PixiDebug] %cAttached — hover to inspect, press D to toggle, click hit-list to pin\n' +
      '  window.__pixiDebug.hovered  → current hover target\n' +
      '  window.__pixiDebug.hits     → all objects under cursor\n' +
      '  window.__pixiDebug.pinned   → click-pinned object\n' +
      '  window.__pixiDebug.tree()   → print display tree\n' +
      '  window.__pixiDebug.find(fn) → search display tree',
      'color: #0f0; font-weight: bold', 'color: #0f0',
    )
  }

  #detach(): void {
    if (!this.#listening) return
    document.removeEventListener('pointermove', this.#onMove)
    document.removeEventListener('keydown', this.#onKey)
    this.#panel?.remove()
    this.#hitListPanel?.remove()
    this.#panel = null
    this.#hitListPanel = null
    this.#listening = false
    delete (window as any).__pixiDebug
  }

  #updatePanelVisibility(): void {
    if (this.#panel) this.#panel.style.display = this.#active ? '' : 'none'
    if (this.#hitListPanel) this.#hitListPanel.style.display = this.#active ? '' : 'none'
  }

  // ── Input ─────────────────────────────────────────────────────────────

  #onKey = (e: KeyboardEvent): void => {
    // 'D' toggles the debug overlay (unless an input is focused)
    if (e.key === 'd' || e.key === 'D') {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      this.#active = !this.#active
      ;(window as any).__pixiDebug.active = this.#active
      this.#updatePanelVisibility()
    }
  }

  #onMove = (e: PointerEvent): void => {
    if (!this.#active || !this.#app || !this.#renderer || !this.#canvas || !this.#renderContainer) return

    const pixiGlobal = this.#clientToPixiGlobal(e.clientX, e.clientY)
    const pt = new Point(pixiGlobal.x, pixiGlobal.y)

    const hits: DisplayObject[] = []
    hitCollect(this.#app.stage, pt, hits)

    // sort: deepest children first (most specific)
    hits.sort((a, b) => treeDepth(b) - treeDepth(a))

    const top = hits[0] ?? null
    const dbg = (window as any).__pixiDebug
    if (dbg) {
      dbg.hovered = top
      dbg.hits = hits
    }

    // info panel — show topmost hit
    if (this.#panel) {
      if (top) {
        this.#panel.textContent = formatObjectInfo(top)
        this.#panel.style.opacity = '1'
      } else {
        this.#panel.style.opacity = '0.4'
        this.#panel.textContent = '(no hit)'
      }
    }

    // hit list panel — show all hits
    if (this.#hitListPanel && !this.#pinnedObj) {
      this.#renderHitList(hits)
    }
  }

  #onHitListClick = (e: MouseEvent): void => {
    const target = e.target as HTMLElement
    const idx = target.dataset['hitIdx']
    if (idx === undefined) return

    const dbg = (window as any).__pixiDebug
    const hits = dbg?.hits as DisplayObject[] | undefined
    if (!hits) return

    const obj = hits[parseInt(idx, 10)]
    if (!obj) return

    if (this.#pinnedObj === obj) {
      // unpin
      this.#pinnedObj = null
      if (dbg) dbg.pinned = null
      return
    }

    this.#pinnedObj = obj
    if (dbg) dbg.pinned = obj

    // update info panel with pinned object
    if (this.#panel) {
      this.#panel.textContent = '📌 PINNED\n' + formatObjectInfo(obj)
      this.#panel.style.opacity = '1'
    }

    console.log('%c[PixiDebug] Pinned:', 'color:#0f0;font-weight:bold', obj)
  }

  // ── Rendering ─────────────────────────────────────────────────────────

  #renderHitList(hits: DisplayObject[]): void {
    if (!this.#hitListPanel) return
    if (hits.length === 0) {
      this.#hitListPanel.textContent = 'Hit list: (empty)'
      return
    }

    this.#hitListPanel.innerHTML = ''
    const title = document.createElement('div')
    title.textContent = `Hit list (${hits.length}):`
    title.style.cssText = 'color: #0f0; margin-bottom: 4px; font-weight: bold;'
    this.#hitListPanel.appendChild(title)

    for (let i = 0; i < Math.min(hits.length, 30); i++) {
      const obj = hits[i]
      const row = document.createElement('div')
      row.dataset['hitIdx'] = String(i)
      row.style.cssText = `
        cursor: pointer; padding: 2px 4px; border-radius: 2px;
        color: ${this.#pinnedObj === obj ? '#ff0' : '#0f0'};
      `
      row.textContent = `${i}: ${describeObject(obj)}  z:${(obj as any).zIndex ?? '-'}  d:${treeDepth(obj)}`
      row.addEventListener('mouseenter', () => { row.style.background = 'rgba(0,255,0,0.15)' })
      row.addEventListener('mouseleave', () => { row.style.background = '' })
      this.#hitListPanel.appendChild(row)
    }
  }

  // ── Coordinate mapping ────────────────────────────────────────────────

  #clientToPixiGlobal(cx: number, cy: number) {
    const events = (this.#renderer as any)?.events
    if (events?.mapPositionToPoint) {
      const out = new Point()
      events.mapPositionToPoint(out, cx, cy)
      return { x: out.x, y: out.y }
    }
    const rect = this.#canvas!.getBoundingClientRect()
    const screen = this.#renderer!.screen
    return {
      x: (cx - rect.left) * (screen.width / rect.width),
      y: (cy - rect.top) * (screen.height / rect.height),
    }
  }

  // ── Console helpers ───────────────────────────────────────────────────

  #printTree(): void {
    if (!this.#app) { console.log('[PixiDebug] No app'); return }
    const lines: string[] = []
    walkTree(this.#app.stage, 0, lines)
    console.log('%c[PixiDebug] Display tree:\n' + lines.join('\n'), 'color: #0f0')
  }

  #findInTree(pred: (obj: DisplayObject) => boolean): DisplayObject[] {
    if (!this.#app) return []
    const results: DisplayObject[] = []
    const recurse = (node: Container) => {
      if (pred(node)) results.push(node)
      for (const child of node.children) recurse(child as Container)
    }
    recurse(this.#app.stage)
    console.log(`%c[PixiDebug] Found ${results.length} match(es)`, 'color: #0f0', results)
    return results
  }
}

function treeDepth(obj: DisplayObject): number {
  let d = 0
  let current: DisplayObject | null = obj
  while (current?.parent) { d++; current = current.parent as DisplayObject }
  return d
}

const _pixiDebug = new PixiDebugDrone()
window.ioc.register('@diamondcoreprocessor.com/PixiDebugDrone', _pixiDebug)
