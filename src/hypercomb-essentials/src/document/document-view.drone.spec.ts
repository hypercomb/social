// document-view.drone.spec.ts — the document has a phone-sized way home.
//
// Browser / hardware BACK is trapped once for the whole view stack by
// navigation/view-back. The document contributes only its BackGesture peel;
// it must never grow a second history trap of its own.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DOCUMENT_SLOT } from './document-slot.js'

type BackEntry = { owner: string; back: () => void }
type DroneShape = { pulse(grammar: string): Promise<void>; markDisposed(): void }

const registered: Record<string, unknown> = {}
const services: Record<string, unknown> = {}

;(window as unknown as { ioc: unknown }).ioc = {
  register: (key: string, value: unknown) => { registered[key] = value },
  get: (key: string) => registered[key] ?? services[key],
  has: (key: string) => key in registered || key in services,
  whenReady: () => {},
}
;(globalThis as unknown as { ioc: unknown }).ioc = window.ioc

services['@diamondcoreprocessor.com/VisualBeeRegistry'] = { register: vi.fn() }

const { DocumentViewDrone } = await import('./document-view.drone.js')

class ViewModeStub extends EventTarget {
  mode = 'document'

  setMode(next: string): void {
    this.mode = next
    this.dispatchEvent(new Event('change'))
  }
}

class LineageStub extends EventTarget {
  explorerSegments = (): readonly string[] => ['field-notes']
}

const settle = async (): Promise<void> => {
  for (let i = 0; i < 8; i++) await Promise.resolve()
}

describe('document view mobile exit', () => {
  let drone: DroneShape | null
  let mode: ViewModeStub
  let lineage: LineageStub
  let backEntry: BackEntry | null
  let dropBack: ReturnType<typeof vi.fn>
  let registerBack: ReturnType<typeof vi.fn>
  let backOutOfView: ReturnType<typeof vi.fn>
  let putResource: ReturnType<typeof vi.fn>
  let update: ReturnType<typeof vi.fn>
  let enter: ReturnType<typeof vi.fn>
  let exit: ReturnType<typeof vi.fn>

  beforeEach(() => {
    document.getElementById('hc-document-view-host')?.remove()
    mode = new ViewModeStub()
    lineage = new LineageStub()
    backEntry = null
    dropBack = vi.fn()
    registerBack = vi.fn((entry: BackEntry) => {
      backEntry = entry
      return dropBack
    })
    backOutOfView = vi.fn((peel: () => void) => peel())
    putResource = vi.fn(async () => 'body-sig-next')
    update = vi.fn(async () => 'layer-sig-next')
    enter = vi.fn()
    exit = vi.fn()

    services['@hypercomb.social/ViewMode'] = mode
    services['@hypercomb.social/Lineage'] = lineage
    services['@hypercomb.social/Store'] = {
      getResource: vi.fn(async () => null),
      putResource,
    }
    services['@diamondcoreprocessor.com/HistoryService'] = {
      sign: vi.fn(async () => 'location-sig'),
      currentLayerAt: vi.fn(async () => ({ name: 'field-notes' })),
    }
    services['@diamondcoreprocessor.com/LayerCommitter'] = { update }
    services['@diamondcoreprocessor.com/ModeRegistry'] = { enter, exit }
    services['@diamondcoreprocessor.com/BackGesture'] = {
      register: registerBack,
      backOutOfView,
    }
    drone = null
  })

  afterEach(() => {
    drone?.markDisposed()
    drone = null
    document.getElementById('hc-document-view-host')?.remove()
    vi.restoreAllMocks()
  })

  const mount = async (): Promise<void> => {
    drone = new DocumentViewDrone()
    await drone.pulse('')
    await settle()
    expect(document.getElementById('hc-document-view-host')).not.toBeNull()
  }

  it('mounts a labelled 44px back plate inside a safe-area-aware toolbar and keeps phone editing at 16px', async () => {
    await mount()

    const toolbar = document.querySelector('[data-hc-document-toolbar]') as HTMLElement
    const back = document.querySelector('[data-hc-document-back]') as HTMLButtonElement
    const editor = document.querySelector('.hc-document-editor') as HTMLTextAreaElement

    expect(back.tagName).toBe('BUTTON')
    expect(back.getAttribute('aria-label')).toBe('Back to the hive')
    expect(back.style.width).toBe('2.75rem')
    expect(back.style.height).toBe('2.75rem')
    expect(toolbar.getAttribute('style')).toContain('--hc-safe-top')
    expect(editor.getAttribute('aria-label')).toBe('Document body')
    expect(editor.style.fontSize).toBe('16px')
  })

  it('registers one shared view peel for right-click and browser BACK without adding a private history trap', async () => {
    const push = vi.spyOn(window.history, 'pushState')
    await mount()

    expect(registerBack).toHaveBeenCalledTimes(1)
    expect(backEntry).toMatchObject({ owner: 'document-view' })
    expect(enter).toHaveBeenCalledWith('view:active', 'document-view')
    expect(push).not.toHaveBeenCalled()

    backEntry?.back()
    await settle()
    expect(mode.mode).toBe('hexagons')
    expect(document.getElementById('hc-document-view-host')).toBeNull()
  })

  it('saves an unfinished edit before the visible back plate leaves through BackGesture', async () => {
    await mount()
    const editor = document.querySelector('.hc-document-editor') as HTMLTextAreaElement
    editor.value = 'A thought written on the phone.'
    editor.dispatchEvent(new Event('input'))

    ;(document.querySelector('[data-hc-document-back]') as HTMLButtonElement).click()
    await settle()

    expect(putResource).toHaveBeenCalledTimes(1)
    expect(update).toHaveBeenCalledWith(
      ['field-notes'],
      { name: 'field-notes', [DOCUMENT_SLOT]: ['body-sig-next'] },
    )
    expect(backOutOfView).toHaveBeenCalledTimes(1)
    expect(mode.mode).toBe('hexagons')
    expect(exit).toHaveBeenCalledWith('view:active', 'document-view')
  })

  it('unregisters its BackGesture contribution when disposed', async () => {
    await mount()
    drone?.markDisposed()
    drone = null
    expect(dropBack).toHaveBeenCalledTimes(1)
  })
})
