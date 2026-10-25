import { beforeEach, describe, expect, it } from 'vitest'

const registrations = new Map<string, unknown>()
;(globalThis as unknown as { window: unknown }).window = {
  ioc: {
    register: (key: string, value: unknown) => registrations.set(key, value),
    get: (key: string) => registrations.get(key),
  },
}

const { EffectBus } = await import('@hypercomb/core')
const { WithholdQueenBee } = await import('./withhold.queen.js')

const logged: string[] = []

/** The shell's half: answers every request with the list, as ai-withheld.store does. */
const shell = (routes: string[]): void => {
  EffectBus.on<{ op?: string; route?: string }>('ai:withhold', request => {
    const changed = request?.op === 'add' && !routes.includes(request.route ?? '')
    if (changed) routes.push(request.route!)
    EffectBus.emit('ai:withheld', { routes: [...routes], ...(request?.op ? { op: request.op, route: request.route, changed } : {}) })
  })
}

beforeEach(() => {
  EffectBus.clear()
  logged.length = 0
  EffectBus.on<{ message: string }>('activity:log', payload => { logged.push(payload.message) })
})

// 2026-10-24: with the list answered once, the bus replayed that last reply to
// the word's subscription before it had a handle to stop it — the word threw
// "Cannot access 'stop' before initialization" every time after the first.
describe('/withhold after the list has already been answered once', () => {
  it('lists, and reports the change THIS request made — not the replayed reply', async () => {
    shell(['/susan'])
    await new WithholdQueenBee().invoke('')
    expect(logged.at(-1)).toBe('Withheld from outside models: /susan')

    await new WithholdQueenBee().invoke('/scratch-diary')
    expect(logged.at(-1)).toBe('Withheld from outside models: /scratch-diary and everything under it')

    await new WithholdQueenBee().invoke('/scratch-diary')
    expect(logged.at(-1)).toBe('/scratch-diary was already withheld')
  })
})
