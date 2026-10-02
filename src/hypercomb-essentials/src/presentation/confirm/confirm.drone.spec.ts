// confirm.drone.spec.ts — the confirm dialog's bee wires its surface. The view
// only exports; without this bee no question is ever answered. The view
// arrives with the first question, not at boot.

import { afterAll, describe, expect, it, vi } from 'vitest'

const wired = vi.hoisted(() => {
  const state = { registered: [] as string[], ready: new Map<string, (value: unknown) => void>() }
  ;(window as unknown as { ioc: unknown }).ioc = {
    register: (key: string) => { state.registered.push(key) },
    get: () => undefined,
    has: () => false,
    list: () => [],
    whenReady: (key: string, callback: (value: unknown) => void) => { state.ready.set(key, callback) },
  }
  return state
})

const { EffectBus, requestConfirm } = await import('@hypercomb/core')
const { CONFIRM_OWNER, CONFIRM_SURFACE } = await import('./confirm.view.js')
const define = vi.spyOn(customElements, 'define')
await import('./confirm.drone.js')

const defines = (): number => define.mock.calls.filter(([name]) => name === CONFIRM_SURFACE).length
const settle = async (): Promise<void> => { for (let i = 0; i < 20; i++) await Promise.resolve() }

// What the shell's surface host does: create the tag, defined or not.
const host = document.createElement(CONFIRM_SURFACE)
document.body.appendChild(host)
afterAll(() => { vi.restoreAllMocks(); host.remove() })

describe('the confirm dialog\'s bee', () => {
  it('registers itself, and adds the surface once the registry is ready — undefined until the first question', () => {
    expect(wired.registered).toContain('@diamondcoreprocessor.com/ConfirmDrone')
    const surfaces: unknown[] = []
    wired.ready.get('@hypercomb.social/ShellSurfaceRegistry')!({ add: (surface: unknown) => surfaces.push(surface) })
    expect(surfaces).toEqual([{ name: CONFIRM_SURFACE, owner: CONFIRM_OWNER, element: CONFIRM_SURFACE, order: 240 }])
    expect(defines()).toBe(0)
  })

  it('defines the element on the first question, which the upgraded element then answers', async () => {
    const asked = requestConfirm({ title: 'confirm.delete-title', message: 'confirm.delete-message', messageParams: { name: 'garden' } })
    await settle()
    expect(defines()).toBe(1)
    const dialog = host as HTMLElement & { open$?: boolean; confirm?(): void }
    expect(dialog.open$).toBe(true)
    expect(host.querySelector('.hc-confirm-message')?.textContent).toBe('Are you sure you want to delete "garden"?')
    dialog.confirm!()
    await expect(asked).resolves.toBe(true)

    // The next question is the element's own: the bee defines nothing twice.
    EffectBus.emit('confirm:request', { id: 'again', title: 't', message: 'm' })
    await settle()
    expect(defines()).toBe(1)
    expect(dialog.open$).toBe(true)
  })
})
