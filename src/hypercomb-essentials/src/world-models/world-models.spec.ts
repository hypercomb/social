// world-models/world-models.spec.ts
//
// The entrance is five needed traits and a page that only draws them.

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { EffectBus, llmKeyStore } from '@hypercomb/core'
import { WorldModelsQueenBee } from './world-models.queen.js'
import { WORLD_MODEL_TRAITS } from './world-models.drone.js'
import './entrance.view.js'

const here = dirname(fileURLToPath(import.meta.url))
const viewSource = readFileSync(join(here, 'entrance.view.ts'), 'utf8')
const subscriptionSource = [
  readFileSync(join(here, 'subscription.ts'), 'utf8'),
  readFileSync(join(here, 'subscription.drone.ts'), 'utf8'),
].join('\n')

const wordOf = (trait: (typeof WORLD_MODEL_TRAITS)[number]): string =>
  typeof trait === 'string' ? trait : trait.word

describe('world models entrance', () => {
  it('declares the five traits, subscription extruded and the rest still needed', () => {
    expect(WORLD_MODEL_TRAITS.map(wordOf)).toEqual([
      'subscription', 'language-model', 'world', 'clip', 'session',
    ])
    expect(WORLD_MODEL_TRAITS[0]).toBe('subscription')
    for (const trait of WORLD_MODEL_TRAITS.slice(1)) {
      expect(typeof trait).toBe('object')
      expect(trait).toMatchObject({ needs: true })
    }
  })

  it('opens a page of those seats and does not reach out', async () => {
    expect(viewSource).not.toMatch(/fetch\s*\(/)
    expect(viewSource).not.toMatch(/localStorage|sessionStorage|indexedDB|navigator\.storage/)
    expect(viewSource).not.toMatch(/https?:\/\//)
    expect(viewSource).not.toMatch(/apiKey|WebSocket|XMLHttpRequest/)
    expect(viewSource).not.toMatch(/addEventListener\(\s*['"]keydown['"]/)
    expect(subscriptionSource).not.toMatch(/llmKeyStore\s*\??\.\s*get\s*\(/)
    expect(subscriptionSource).not.toMatch(/localStorage|fetch\s*\(|https?:\/\//)

    const queen = new WorldModelsQueenBee()
    const el = document.createElement('hc-world-models')
    document.body.appendChild(el)
    await queen.invoke('')

    expect(el.classList.contains('wm-open')).toBe(true)
    expect(el.querySelector('.wm-title')?.textContent).toBe('World models')
    const seats = [...el.querySelectorAll('.wm-seat')]
    expect(seats.map(seat => seat.querySelector('.wm-word')?.textContent)).toEqual([
      'subscription', 'language-model', 'world', 'clip', 'session',
    ])
    for (const state of el.querySelectorAll('.wm-state')) expect(state.textContent).toBe('Open')
    expect(el.querySelector('.wm-invite')?.textContent).toContain('subscription')

    el.querySelector<HTMLButtonElement>('.wm-close')?.click()
    expect(el.classList.contains('wm-open')).toBe(false)
    expect(EffectBus).toBeTruthy()
    el.remove()
  })

  it('names a subscription already on this device and never the secret', async () => {
    document.querySelector('hc-world-models')?.remove()
    const secret = 'sk-or-v1-not-on-the-page'
    llmKeyStore.set('openrouter', secret)
    const el = document.createElement('hc-world-models')
    try {
      const queen = new WorldModelsQueenBee()
      document.body.appendChild(el)
      await queen.invoke('')

      const seat = el.querySelector('[data-seat="subscription"]')
      expect(seat?.querySelector('.wm-state')?.textContent).toBe('Connected')
      expect(seat?.querySelector('.wm-line')?.textContent).toBe('openrouter')
      expect(el.textContent).not.toContain(secret)

      let hits = 0
      const off = EffectBus.on('providers:open', () => { hits += 1 })
      const before = hits
      el.querySelector<HTMLButtonElement>('.wm-connect')?.click()
      off()
      expect(hits).toBe(before + 1)
    } finally {
      llmKeyStore.clear('openrouter')
      el.remove()
    }
  })
})
