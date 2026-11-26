// hypercomb-shared/ui/mesh-modal/mesh-modal.show-code.spec.ts
//
// 'SHOW CODE' ASKS THE QUEEN WHETHER SHE DRAWS ONE. The shell and the package
// are versioned apart, so the selector meets queens older than the code. One
// with meetingLink and no code would hand the link to a share sheet; one with
// neither reads the word 'qr' as a label and stamps junctions on the selected
// tiles. The queen says she draws the code (`meetingCode`), the selector offers
// the button only then, and the word is never passed to an older queen.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EffectBus } from '@hypercomb/core'

// The widget directive's field decorators need the Angular compiler; the
// selector's logic does not touch it.
vi.mock('../widget-zoom/hc-widget.directive', () => ({ HcWidgetDirective: class {} }))

const services = new Map<string, unknown>()
;(globalThis as { get?: unknown }).get = (k: string) => services.get(k)
;(globalThis as { register?: unknown }).register = (k: string, v: unknown) => { services.set(k, v) }
;(window as unknown as { ioc: unknown }).ioc = { get: (k: string) => services.get(k), register: (k: string, v: unknown) => { services.set(k, v) } }

const { MeshModalComponent } = await import('./mesh-modal.component')
const meshSession = await import('../../core/mesh-session')

const QUEEN = '@diamondcoreprocessor.com/InviteQueenBee'
const offs: (() => void)[] = []
const toasts: { type?: string }[] = []

/** The selector, open on a room that has everything a link needs. */
const open = (): InstanceType<typeof MeshModalComponent> => {
  const modal = new MeshModalComponent()
  modal.ngOnInit()
  offs.push(() => modal.ngOnDestroy())
  sessionStorage.setItem('hc:mesh-zone', JSON.stringify({ room: 'kitchen', secret: 'two-words', relay: 'wss://hypercomb.com' }))
  EffectBus.emit('mesh:open-modal', {})
  return modal
}

beforeEach(() => {
  meshSession.writeMeshZone({ relay: '' })
  sessionStorage.clear()
  localStorage.clear()
  services.clear()
  const cred = (value: string) => ({ value, set(v: string) { this.value = v } })
  services.set('@hypercomb.social/RoomStore', cred('kitchen'))
  services.set('@hypercomb.social/SecretStore', cred('two-words'))
  services.set('@diamondcoreprocessor.com/NostrMeshDrone', {
    configureRelays: vi.fn(),
    getDebug: () => ({ relays: ['wss://hypercomb.com'] }),
    ownRelays: () => ['wss://hypercomb.com'],
    swarmHost: () => 'hypercomb.com',
  })
  toasts.length = 0
  offs.push(EffectBus.on<{ type?: string }>('toast:show', toast => { toasts.push(toast) }))
  toasts.length = 0
})

afterEach(() => { while (offs.length) offs.pop()!() })

describe("the selector's 'show code'", () => {
  it('a queen that draws the code is asked for it, by its own door', async () => {
    const queen = { invoke: vi.fn(async () => {}), meetingLink: vi.fn(async () => {}), meetingCode: true }
    services.set(QUEEN, queen)
    const modal = open()
    expect(modal.codeSupported()).toBe(true)
    await modal.showRoomCode()
    expect(queen.meetingLink).toHaveBeenCalledTimes(1)
    expect(queen.meetingLink).toHaveBeenCalledWith('qr')
    expect(queen.invoke).not.toHaveBeenCalled()
  })

  it('the previous queen (a meeting link, no code) is not offered the button and is never handed the word', async () => {
    // Her meetingLink('qr') is not 'copy', so it opened the share sheet.
    const queen = { invoke: vi.fn(async () => {}), meetingLink: vi.fn(async () => {}) }
    services.set(QUEEN, queen)
    const modal = open()
    await modal.showRoomCode()
    expect(queen.meetingLink).not.toHaveBeenCalled()
    expect(queen.invoke).not.toHaveBeenCalled()
    expect(modal.codeSupported()).toBe(false)
  })

  it("an older queen still (no meeting link at all) is never invoked with 'qr', which she reads as a junction's label", async () => {
    const queen = { invoke: vi.fn(async () => {}) }
    services.set(QUEEN, queen)
    const modal = open()
    await modal.showRoomCode()
    expect(queen.invoke).not.toHaveBeenCalled()
    expect(modal.codeSupported()).toBe(false)
  })

  it('a queen that only claims the code, with no door to draw it, is not asked', async () => {
    const queen = { invoke: vi.fn(async () => {}), meetingCode: true }
    services.set(QUEEN, queen)
    const modal = open()
    await modal.showRoomCode()
    expect(queen.invoke).not.toHaveBeenCalled()
    expect(modal.codeSupported()).toBe(false)
  })

  it('while no queen is loaded yet the button stays, and says the behaviour is not loaded', async () => {
    const modal = open()
    expect(modal.codeSupported()).toBe(true)
    await modal.showRoomCode()
    expect(toasts.map(toast => toast.type)).toEqual(['error'])
  })

  it('a queen that loads after the selector opened is asked again at the press: an older one takes the button away', async () => {
    const modal = open()
    const queen = { invoke: vi.fn(async () => {}), meetingLink: vi.fn(async () => {}) }
    services.set(QUEEN, queen)
    await modal.showRoomCode()
    expect(queen.meetingLink).not.toHaveBeenCalled()
    expect(queen.invoke).not.toHaveBeenCalled()
    expect(modal.codeSupported()).toBe(false)
  })

  it('share is untouched: an older queen still hands out the meeting link through invoke', async () => {
    const queen = { invoke: vi.fn(async () => {}) }
    services.set(QUEEN, queen)
    const modal = open()
    await modal.copyShareLink()
    expect(queen.invoke).toHaveBeenCalledTimes(1)
    expect(queen.invoke).toHaveBeenCalledWith('')
  })

  it('the template draws the button only when the queen draws the code', () => {
    const html = readFileSync(join(__dirname, 'mesh-modal.component.html'), 'utf8')
    const button = html.indexOf('(click)="showRoomCode()"')
    expect(button).toBeGreaterThan(-1)
    const guard = html.lastIndexOf('@if (codeSupported()) {', button)
    expect(guard).toBeGreaterThan(-1)
    // Nothing but the button's own opening tag sits between the guard and it.
    expect(html.slice(guard, button)).toMatch(/^@if \(codeSupported\(\)\) \{\s*<button class="mesh-modal-btn share code" type="button" $/)
  })
})
