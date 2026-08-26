import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EffectBus } from '@hypercomb/core'
import { ControlsBarElement } from './controls-bar.element'

const nextRender = async (): Promise<void> => {
  await Promise.resolve()
  await Promise.resolve()
}

describe('hc-controls-bar', () => {
  const services = new Map<string, unknown>()

  beforeEach(() => {
    EffectBus.clear()
    localStorage.clear()
    document.body.replaceChildren()
    services.clear()
    services.set('@hypercomb.social/Navigation', {
      segmentsRaw: () => [],
      goRaw: vi.fn(),
    })
    services.set('@diamondcoreprocessor.com/InputGate', Object.assign(new EventTarget(), {
      locked: false,
      lock: vi.fn(),
      unlock: vi.fn(),
      lockedBy: () => false,
    }))
    Object.assign(globalThis, { get: (key: string) => services.get(key) })
    Object.assign(window, {
      ioc: {
        get: (key: string) => services.get(key),
        whenReady: () => undefined,
      },
      matchMedia: (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => undefined,
        removeListener: () => undefined,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        dispatchEvent: () => false,
      }),
    })
  })

  afterEach(() => document.body.replaceChildren())

  const mount = (): ControlsBarElement => {
    const element = document.createElement('hc-controls-bar') as ControlsBarElement
    document.body.appendChild(element)
    return element
  }

  it('renders the light-DOM rail and routes registry controls through their existing actions', async () => {
    const element = mount()
    await nextRender()
    expect(customElements.get('hc-controls-bar')).toBe(ControlsBarElement)
    expect(element).toBeInstanceOf(ControlsBarElement)
    expect(element.querySelector('.pill-stage.dock-left')).not.toBeNull()
    expect(element.querySelector('.controls-row')).not.toBeNull()

    const portals: unknown[] = []
    window.addEventListener('portal:open', event => portals.push((event as CustomEvent).detail), { once: true })
    element.querySelector<HTMLButtonElement>('[data-ctrl-id="dcp"]')!.click()
    expect(portals).toEqual([{ target: 'dcp' }])
  })

  it('owns mesh state and joins through the shared command path', async () => {
    const commands: string[] = []
    EffectBus.on<{ cmd?: string }>('keymap:invoke', ({ cmd }) => { if (cmd) commands.push(cmd) })
    const element = mount()
    await nextRender()
    const fit = element.querySelector<HTMLButtonElement>('[data-ctrl-id="fit"]')!
    fit.focus()

    EffectBus.emit('mesh:join', {})
    expect(commands).toEqual(['mesh.togglePublic'])
    EffectBus.emit('mesh:public-changed', { public: true })
    await nextRender()
    expect(element.querySelector('.controls-pill')?.classList.contains('public-mode')).toBe(true)
    expect((document.activeElement as HTMLElement | null)?.dataset['ctrlId']).toBe('fit')

    element.toggleMeshPublic()
    expect(commands).toEqual(['mesh.togglePublic', 'mesh.togglePublic'])
  })

  it('mirrors full-view visibility and tag state without Angular inputs', async () => {
    const element = mount()
    await nextRender()
    EffectBus.emit('render:tags', { tags: [{ name: 'amber', count: 2 }] })
    await nextRender()
    expect(element.querySelector('.tag-crumb')?.textContent).toBe('amber')

    EffectBus.emit('view:active', { active: true })
    await nextRender()
    expect(element.querySelector('.pill-stage')?.classList.contains('faded')).toBe(true)
  })
})
