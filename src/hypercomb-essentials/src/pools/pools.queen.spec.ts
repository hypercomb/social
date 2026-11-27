// pools/pools.queen.spec.ts : the word `pools` only asks. The header is played
// by the spec: it answers LIGHTS_ENTER with the mode, or does not answer.

import { beforeEach, describe, expect, it } from 'vitest'
import { EffectBus } from '@hypercomb/core'

const services = new Map<string, unknown>()
;(globalThis as unknown as { ioc: unknown }).ioc = {
  get: (key: string) => services.get(key),
  register: (key: string, value: unknown) => { services.set(key, value) },
  whenReady: () => void 0,
  onRegister: () => () => void 0,
}

const { LIGHTS_ENTER, LIGHTS_LEAVE, LIGHTS_MODE, LIGHTS_PUBLISH } = await import('./lights-contract.js')
const { PoolsQueenBee } = await import('./pools.queen.js')

const queen = services.get('@diamondcoreprocessor.com/PoolsQueenBee') as InstanceType<typeof PoolsQueenBee>

let sent: string[]
let toasts: { type: string; message: string }[]
let headerAnswers = true

EffectBus.on(LIGHTS_ENTER, () => { sent.push('enter'); if (headerAnswers) EffectBus.emit(LIGHTS_MODE, { active: true }) })
EffectBus.on(LIGHTS_LEAVE, () => { sent.push('leave') })
EffectBus.on(LIGHTS_PUBLISH, () => { sent.push('publish') })
EffectBus.on<{ type: string; message: string }>('toast:show', toast => { toasts.push(toast) })

beforeEach(() => {
  EffectBus.emit(LIGHTS_MODE, { active: false })
  sent = []
  toasts = []
  headerAnswers = true
})

describe('the word pools', () => {
  it('is registered under its own key, with a sentence and something to try', () => {
    expect(queen.command).toBe('pools')
    expect(queen.description.length).toBeGreaterThanOrEqual(20)
    expect(queen.examples.map(example => example.input)).toEqual(['/pools', '/pools publish', '/pools off'])
    expect(queen.aliases).toEqual([])
  })

  it('alone asks the header to start pools mode, and says nothing when it does', async () => {
    await queen.invoke('')
    expect(sent).toEqual(['enter'])
    expect(toasts).toEqual([])
  })

  it('says so when the mode did not start, as inside a swarm', async () => {
    headerAnswers = false
    await queen.invoke('')
    expect(sent).toEqual(['enter'])
    expect(toasts).toHaveLength(1)
    expect(toasts[0].message).toMatch(/did not start/)
  })

  it('off asks to go back to private, and publish asks for the publish', async () => {
    await queen.invoke(' OFF ')
    await queen.invoke('publish')
    expect(sent).toEqual(['leave', 'publish'])
    expect(toasts).toEqual([])
  })

  it('any other word sends nothing and says what the word takes', async () => {
    await queen.invoke('everything')
    expect(sent).toEqual([])
    expect(toasts).toHaveLength(1)
    expect(toasts[0].type).toBe('warning')
  })

  it('completes its two sub-words', () => {
    expect(queen.slashComplete('')).toEqual(['off', 'publish'])
    expect(queen.slashComplete('p')).toEqual(['publish'])
    expect(queen.slashComplete('off')).toEqual([])
  })
})
