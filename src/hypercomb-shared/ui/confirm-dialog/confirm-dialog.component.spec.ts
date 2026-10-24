// ui/confirm-dialog/confirm-dialog.component.spec.ts — every request is asked
// in its turn and every caller gets an answer.
//
// The dialog held ONE request: a second `confirm:request` replaced the first,
// and the first caller's promise never settled. A publish said twice, or a
// publish and another session's consent at once, left a publish waiting
// forever on a dialog nobody could see again (2026-10-23).

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import '@angular/compiler'
import { EffectBus, requestConfirm } from '@hypercomb/core'

const services = new Map<string, unknown>()
;(globalThis as { get?: unknown }).get = (k: string) => services.get(k)
;(globalThis as { register?: unknown }).register = (k: string, v: unknown) => { services.set(k, v) }
;(window as unknown as { ioc: unknown }).ioc = { get: (k: string) => services.get(k), register: (k: string, v: unknown) => { services.set(k, v) } }

const { ConfirmDialogComponent } = await import('./confirm-dialog.component')

const settled = async <T>(p: Promise<T>): Promise<T | 'pending'> =>
  Promise.race([p, new Promise<'pending'>(resolve => setTimeout(() => resolve('pending'), 20))])

describe('the consent dialog', () => {
  // ONE dialog, as the shell mounts it once: a fresh instance would be handed
  // the bus's last request again (last-value replay) and show it a second time.
  let dialog: InstanceType<typeof ConfirmDialogComponent>
  beforeAll(() => { dialog = new ConfirmDialogComponent(); dialog.ngOnInit() })
  afterAll(() => dialog.ngOnDestroy())

  it('asks a second request after the first is answered — neither caller is left waiting', async () => {
    const first = requestConfirm({ title: 'a', message: 'first' })
    const second = requestConfirm({ title: 'b', message: 'second' })
    expect(dialog.request()?.message).toBe('first')

    let now = 1_000
    const clock = vi.spyOn(performance, 'now').mockImplementation(() => now)
    dialog.confirm()
    expect(await settled(first)).toBe(true)
    expect(dialog.request()?.message).toBe('second')
    expect(await settled(second)).toBe('pending')

    // The second click of a double-click lands on a question nobody read yet.
    now += 120
    dialog.confirm()
    expect(dialog.request()?.message).toBe('second')
    expect(await settled(second)).toBe('pending')

    now += ConfirmDialogComponent.ARM_MS
    dialog.dismiss()
    expect(await settled(second)).toBe(false)
    expect(dialog.open()).toBe(false)
    clock.mockRestore()
  })

  it('a replayed request it already showed is not asked twice', async () => {
    const asked = requestConfirm({ title: 'c', message: 'once' })
    const shown = dialog.request()!
    EffectBus.emit('confirm:request', shown)          // a late replay of the same request
    dialog.confirm()
    expect(await settled(asked)).toBe(true)
    expect(dialog.open()).toBe(false)
  })
})
