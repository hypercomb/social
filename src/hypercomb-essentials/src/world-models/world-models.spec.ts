// world-models/world-models.spec.ts
//
// The entrance is five needed traits and a page that only draws them.

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { EffectBus } from '@hypercomb/core'
import { WorldModelsQueenBee } from './world-models.queen.js'
import { WORLD_MODEL_TRAITS } from './world-models.drone.js'
import './entrance.view.js'

const here = dirname(fileURLToPath(import.meta.url))
const viewSource = readFileSync(join(here, 'entrance.view.ts'), 'utf8')

const wordOf = (trait: (typeof WORLD_MODEL_TRAITS)[number]): string =>
  typeof trait === 'string' ? trait : trait.word

describe('world models entrance', () => {
  it('declares the five open traits, each one needed', () => {
    expect(WORLD_MODEL_TRAITS.map(wordOf)).toEqual([
      'subscription', 'language-model', 'world', 'clip', 'session',
    ])
    for (const trait of WORLD_MODEL_TRAITS) {
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
  })
})
