import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BriefAffordance } from './tile-brief.js'
import { buildSquareTileMenuPanel } from './square-tile-menu-panel.js'
import { SquareTileMenu, squareMenuNeighbour } from './square-tile-menu.js'

vi.mock('./tile-brief.js', () => ({
  briefText: (_key: string, fallback: string) => fallback,
}))

type Position = { left: number; top: number; width?: number; height?: number }

let menus: SquareTileMenu[]
let resized: () => void
let disconnect: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.useFakeTimers()
  menus = []
  disconnect = vi.fn()
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { resized = callback }
    observe = vi.fn()
    disconnect = disconnect
  })
})

afterEach(() => {
  for (const menu of menus) menu.destroy()
  document.body.replaceChildren()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function makeGrid(positions: Position[]): { grid: HTMLElement; plates: HTMLElement[] } {
  const host = document.createElement('div')
  host.className = 'hc-square-tile-view'
  const grid = document.createElement('div')
  grid.className = 'wv-grid'
  const plates = positions.map((position, index) => {
    const plate = document.createElement('div')
    plate.className = 'wv-plate'
    plate.inert = false
    Object.defineProperties(plate, {
      offsetTop: { configurable: true, value: position.top },
      offsetLeft: { configurable: true, value: position.left },
      offsetWidth: { configurable: true, value: position.width ?? 180 },
    })
    const door = document.createElement('button')
    door.className = 'wv-door'
    door.textContent = `Tile ${index + 1}`
    const mat = document.createElement('span')
    mat.className = 'wv-mat'
    Object.defineProperty(mat, 'offsetHeight', { value: position.height ?? 180 })
    door.appendChild(mat)
    plate.appendChild(door)
    grid.appendChild(plate)
    return plate
  })
  host.appendChild(grid)
  document.body.appendChild(host)
  return { grid, plates }
}

function bindMenu(grid: HTMLElement, plates: HTMLElement[], actions: BriefAffordance[] = []) {
  const onDetails = vi.fn()
  const actionsFor = vi.fn(() => actions)
  const menu = new SquareTileMenu(grid, { actionsFor, onDetails })
  menus.push(menu)
  plates.forEach((plate, index) => menu.bind(plate, `tile-${index + 1}`, `Tile ${index + 1}`))
  return { menu, onDetails, actionsFor }
}

function pointer(target: Element, type: string, pointerType = 'mouse', relatedTarget: EventTarget | null = null) {
  // jsdom does not implement PointerEvent in every supported version.
  const event = new Event(type, { bubbles: type === 'pointerdown' })
  Object.defineProperties(event, {
    pointerType: { value: pointerType },
    relatedTarget: { value: relatedTarget },
  })
  target.dispatchEvent(event)
}

const trigger = (plate: HTMLElement): HTMLButtonElement => plate.querySelector('.wv-manage')!
const panel = (plate: HTMLElement): HTMLElement | null => plate.querySelector('.wv-menu')

function hover(plate: HTMLElement): void {
  pointer(plate, 'pointerenter')
  vi.advanceTimersByTime(180)
}

function affordance(overrides: Partial<BriefAffordance> = {}): BriefAffordance {
  return {
    name: 'edit', label: 'Edit tile', destructive: false, inert: false,
    svgMarkup: '<svg viewBox="0 0 24 24"><path d="M2 2h20v20H2z"/></svg>',
    run: vi.fn(), ...overrides,
  }
}

describe('square tile menu placement', () => {
  it('finds the closest real tile to the right in the same row, independent of DOM order', () => {
    const { grid, plates } = makeGrid([
      { left: 0, top: 0 }, { left: 0, top: 210 },
      { left: 400, top: 0 }, { left: 200, top: 0 },
    ])
    const brief = document.createElement('article')
    Object.defineProperties(brief, { offsetLeft: { value: 100 }, offsetTop: { value: 0 } })
    grid.appendChild(brief)
    expect(squareMenuNeighbour(plates[0], grid)).toBe(plates[3])
    bindMenu(grid, plates)
    hover(plates[0])
    expect(plates[0].dataset['menuSide']).toBe('right')
    expect(panel(plates[0])?.style.left).toBe('200px')
    expect(panel(plates[0])?.style.width).toBe('180px')
    expect(plates[3].inert).toBe(true)
    expect(plates[1].inert).toBe(false)
  })

  it('borrows the closest tile on the left at the row edge and uses its width', () => {
    const { grid, plates } = makeGrid([
      { left: 0, top: 0 }, { left: 200, top: 0, width: 170 },
      { left: 390, top: 0, width: 190, height: 185 }, { left: 0, top: 220 },
    ])
    bindMenu(grid, plates)
    hover(plates[2])
    expect(squareMenuNeighbour(plates[2], grid)).toBe(plates[1])
    expect(plates[2].dataset['menuSide']).toBe('left')
    expect(panel(plates[2])?.style.left).toBe('-190px')
    expect(panel(plates[2])?.style.width).toBe('170px')
    expect(panel(plates[2])?.style.height).toBe('185px')
    expect(plates[2].style.getPropertyValue('--wv-menu-width')).toBe('380px')
  })

  it.each([
    [[{ left: 0, top: 0 }], 0],
    [[{ left: 0, top: 0 }, { left: 0, top: 210 }], 0],
    [[{ left: 0, top: 0 }, { left: 200, top: 0 }, { left: 0, top: 210 }], 2],
  ] as [Position[], number][])('stays inside a tile with no same-row neighbour (%#)', (positions, active) => {
    const { grid, plates } = makeGrid(positions)
    bindMenu(grid, plates)
    hover(plates[active])
    expect(squareMenuNeighbour(plates[active], grid)).toBeNull()
    expect(plates[active].dataset['menuSide']).toBe('inside')
    expect(panel(plates[active])?.style.left).toBe('0px')
    expect(panel(plates[active])?.style.width).toBe('180px')
    expect(plates.every(plate => !plate.inert)).toBe(true)
  })
})

describe('square tile menu interaction', () => {
  it('waits for mouse hover, keeps descendant controls open, and dismisses when the whole tile is left', () => {
    const { grid, plates } = makeGrid([{ left: 0, top: 0 }, { left: 200, top: 0 }])
    const navigate = vi.fn()
    plates[0].querySelector('.wv-door')!.addEventListener('click', navigate)
    const { actionsFor } = bindMenu(grid, plates)
    pointer(plates[0], 'pointerenter')
    vi.advanceTimersByTime(179)
    expect(panel(plates[0])).toBeNull()
    vi.advanceTimersByTime(1)
    const controls = panel(plates[0])!
    expect(controls.parentElement).toBe(plates[0])
    pointer(controls, 'pointerenter', 'mouse', plates[0].querySelector('.wv-door'))
    pointer(controls, 'pointerleave', 'mouse', plates[0].querySelector('.wv-door'))
    expect(panel(plates[0])).toBe(controls)
    expect(actionsFor).toHaveBeenCalledExactlyOnceWith('tile-1')
    expect(navigate).not.toHaveBeenCalled()
    pointer(plates[0], 'pointerleave')
    expect(panel(plates[0])).toBeNull()
    expect(plates[1].inert).toBe(false)
  })

  it('cancels brief hover and never opens from touch or pen hover', () => {
    const { grid, plates } = makeGrid([{ left: 0, top: 0 }])
    const { actionsFor } = bindMenu(grid, plates)
    pointer(plates[0], 'pointerenter')
    vi.advanceTimersByTime(100)
    pointer(plates[0], 'pointerleave')
    vi.advanceTimersByTime(200)
    pointer(plates[0], 'pointerenter', 'touch')
    vi.advanceTimersByTime(200)
    pointer(plates[0], 'pointerenter', 'pen')
    vi.advanceTimersByTime(200)
    expect(panel(plates[0])).toBeNull()
    expect(actionsFor).not.toHaveBeenCalled()
  })

  it('opens only one menu and restores the previous neighbour before borrowing another', () => {
    const { grid, plates } = makeGrid([
      { left: 0, top: 0 }, { left: 200, top: 0 },
      { left: 0, top: 210 }, { left: 200, top: 210 },
    ])
    const { menu } = bindMenu(grid, plates)
    hover(plates[0])
    expect(plates[1].inert).toBe(true)
    hover(plates[2])
    expect(grid.querySelectorAll('.wv-menu')).toHaveLength(1)
    expect(panel(plates[0])).toBeNull()
    expect(plates[0].hasAttribute('data-menu-side')).toBe(false)
    expect(trigger(plates[0]).getAttribute('aria-expanded')).toBe('false')
    expect(plates[1].inert).toBe(false)
    expect(plates[3].inert).toBe(true)
    menu.dismiss()
    expect(plates[3].inert).toBe(false)
  })

  it('preserves a neighbour that was already inert after dismissal', () => {
    const { grid, plates } = makeGrid([{ left: 0, top: 0 }, { left: 200, top: 0 }])
    plates[1].inert = true
    const { menu } = bindMenu(grid, plates)
    hover(plates[0])
    menu.dismiss()
    expect(plates[1].inert).toBe(true)
  })

  it('pins on the explicit manage click and closes on an outside pointer press', () => {
    const { grid, plates } = makeGrid([{ left: 0, top: 0 }, { left: 200, top: 0 }])
    bindMenu(grid, plates)
    trigger(plates[0]).click()
    expect(trigger(plates[0]).getAttribute('aria-expanded')).toBe('true')
    expect(panel(plates[0])?.contains(document.activeElement)).toBe(true)
    pointer(plates[0], 'pointerleave')
    expect(panel(plates[0])).not.toBeNull()
    pointer(panel(plates[0])!, 'pointerdown')
    expect(panel(plates[0])).not.toBeNull()
    pointer(document.body, 'pointerdown')
    expect(panel(plates[0])).toBeNull()
    expect(plates[1].inert).toBe(false)
  })

  it('consumes Escape dismissal once and restores focus to the manage trigger', () => {
    const { grid, plates } = makeGrid([{ left: 0, top: 0 }, { left: 200, top: 0 }])
    const { menu } = bindMenu(grid, plates)
    trigger(plates[0]).click()
    // The containing square view sends its Escape/back shortcut here.
    expect(menu.dismiss(true)).toBe(true)
    expect(document.activeElement).toBe(trigger(plates[0]))
    expect(trigger(plates[0]).getAttribute('aria-expanded')).toBe('false')
    expect(menu.dismiss(true)).toBe(false)
  })

  it('closes when keyboard focus moves outside the tile', () => {
    const { grid, plates } = makeGrid([{ left: 0, top: 0 }, { left: 200, top: 0 }])
    bindMenu(grid, plates)
    trigger(plates[0]).click()
    const outside = document.createElement('button')
    document.body.appendChild(outside)
    outside.focus()
    expect(panel(plates[0])).toBeNull()
    expect(document.activeElement).toBe(outside)
  })

  it('closes before dispatching a tile action and keeps unavailable actions inert', () => {
    const { grid, plates } = makeGrid([{ left: 0, top: 0 }, { left: 200, top: 0 }])
    const run = vi.fn(() => {
      expect(panel(plates[0])).toBeNull()
      expect(plates[1].inert).toBe(false)
      expect(document.activeElement).toBe(trigger(plates[0]))
    })
    const unavailable = vi.fn()
    bindMenu(grid, plates, [affordance({ run }), affordance({ name: 'pending', inert: true, run: unavailable })])
    trigger(plates[0]).click()
    const disabled = panel(plates[0])!.querySelector<HTMLButtonElement>('[data-action="pending"]')!
    expect(disabled.disabled).toBe(true)
    disabled.click()
    expect(unavailable).not.toHaveBeenCalled()
    expect(panel(plates[0])).not.toBeNull()
    panel(plates[0])!.querySelector<HTMLButtonElement>('[data-action="edit"]')!.click()
    expect(run).toHaveBeenCalledOnce()
  })

  it('opens Details for the bound tile after releasing the borrowed space', () => {
    const { grid, plates } = makeGrid([{ left: 0, top: 0 }, { left: 200, top: 0 }])
    const { onDetails } = bindMenu(grid, plates)
    trigger(plates[1]).click()
    panel(plates[1])!.querySelector<HTMLButtonElement>('.wv-menu-details')!.click()
    expect(onDetails).toHaveBeenCalledExactlyOnceWith('tile-2')
    expect(panel(plates[1])).toBeNull()
    expect(plates[0].inert).toBe(false)
  })

  it('releases the neighbour on resize and disconnects all menu listeners on destruction', () => {
    const { grid, plates } = makeGrid([{ left: 0, top: 0 }, { left: 200, top: 0 }])
    const { menu } = bindMenu(grid, plates)
    hover(plates[0])
    resized()
    expect(panel(plates[0])).toBeNull()
    expect(plates[1].inert).toBe(false)
    pointer(plates[0], 'pointerenter')
    menu.destroy()
    vi.advanceTimersByTime(200)
    trigger(plates[0]).click()
    expect(panel(plates[0])).toBeNull()
    expect(disconnect).toHaveBeenCalledOnce()
  })
})

describe('square tile menu panel', () => {
  it('uses labeled native controls and separates destructive actions', () => {
    const calls: string[] = []
    const root = buildSquareTileMenuPanel({
      title: 'Garden', onClose: () => calls.push('close'), onDetails: vi.fn(),
      actions: [affordance({ run: () => calls.push('edit') }),
        affordance({ name: 'remove', label: 'Remove tile', destructive: true })],
    })
    document.body.appendChild(root)
    expect(root.tagName).toBe('ASIDE')
    expect(root.getAttribute('aria-label')).toBe('Tile options: Garden')
    expect(root.querySelector('h3')?.textContent).toBe('Garden')
    expect(root.querySelector('[role="menu"]')).toBeNull()
    const edit = root.querySelector<HTMLButtonElement>('[data-action="edit"]')!
    expect(edit.type).toBe('button')
    expect(edit.getAttribute('aria-label')).toBe('Edit tile')
    expect(edit.title).toBe('Edit tile')
    expect(edit.textContent).toBe('Edit tile')
    expect(edit.querySelector('svg')?.getAttribute('focusable')).toBe('false')
    expect(root.querySelector('.wv-menu-danger [data-action="remove"]')).not.toBeNull()
    expect(root.querySelector('.wv-menu-danger [data-action="edit"]')).toBeNull()
    edit.click()
    expect(calls).toEqual(['close', 'edit'])
  })

  it('keeps Details and Close available even with no registry actions', () => {
    const onClose = vi.fn()
    const onDetails = vi.fn()
    const root = buildSquareTileMenuPanel({ title: 'Garden', actions: [], onClose, onDetails })
    document.body.appendChild(root)
    const details = root.querySelector<HTMLButtonElement>('.wv-menu-details')!
    expect(details.disabled).toBe(false)
    details.click()
    expect(onDetails).toHaveBeenCalledOnce()
    expect(onClose).not.toHaveBeenCalled()
    root.querySelector<HTMLButtonElement>('.wv-menu-close')!.click()
    expect(onClose).toHaveBeenCalledOnce()
  })
})
