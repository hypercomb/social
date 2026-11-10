// show-features.words.spec.ts — EVERY WORD TAKES A ROW, EVERYWHERE.
//
// The Beehaviors pool used to list only what a tile can carry, so 161 words
// had no switch. Each word the command line knows now takes a row of its
// own (`word:<word>`), lit or dark as its light reads; the way back to every
// other light is shown lit and never switches; a community word names its
// module; a record left by a word nobody declares is not offered as a
// foreign behaviour; and every row says whether it is a view, which is what
// the window's Views / Not views filter reads on both tabs.

import { beforeEach, describe, expect, it } from 'vitest'
import { EffectBus } from '@hypercomb/core'

const services = new Map<string, unknown>()
;(window as unknown as { ioc: unknown }).ioc = {
  get: (key: string) => services.get(key),
  register: (key: string, value: unknown) => { if (!services.has(key)) services.set(key, value) },
  list: () => [...services.keys()],
  whenReady: () => void 0,
  onRegister: () => void 0,
}

type Word = { word: string; description: string; namespace?: string; dark: boolean; hidden: boolean }
const words: Word[] = []
services.set('@diamondcoreprocessor.com/SlashBehaviourDrone', {
  retiredKind: () => undefined,
  wordCensus: () => words,
})
services.set('@hypercomb.social/I18n', { t: (key: string) => key })

type Bee = { view: string; decorationKind: string; iconName: string; labelKey: string; descriptionKey: string; behavior?: string }
const bees: Bee[] = [
  { view: 'postit', decorationKind: 'visual:postit:note', iconName: 'note', labelKey: 'postit.label', descriptionKey: 'postit.desc' },
  { view: 'pan', decorationKind: 'visual:nav:pan', iconName: 'pan_tool', labelKey: 'pan.label', descriptionKey: 'pan.desc', behavior: 'navigation' },
]
services.set('@diamondcoreprocessor.com/VisualBeeRegistry', {
  all: () => bees,
  get: (view: string) => bees.find(b => b.view === view),
  byDecorationKind: (kind: string) => bees.find(b => b.decorationKind === kind),
})

await import('./show-features.drone.js')

type Row = { kind: string; category: string; on: boolean; isView: boolean; fixed?: boolean; module?: string; foreign?: boolean; slashCommand?: string; label: string }

const roster = (): Row[] => {
  let rows: Row[] = []
  const off = EffectBus.on<{ rows: Row[] }>('features:roster', p => { rows = p.rows })
  EffectBus.emit('features:roster-open', {})
  off()
  return rows
}

const lights = (on: string[] | null, off: string[] = [], cohorts?: string[]): void => {
  if (on) localStorage.setItem('hc:behavior-global-on', JSON.stringify(on))
  else localStorage.removeItem('hc:behavior-global-on')
  localStorage.setItem('hc:behavior-global-off', JSON.stringify(off))
  if (cohorts) localStorage.setItem('hc:behavior-seeded', JSON.stringify(cohorts))
  EffectBus.emit('behavior:enablement-changed', {})
}

describe('words in the Beehaviors pool', () => {
  beforeEach(() => {
    localStorage.clear()
    words.length = 0
  })

  it('gives every word a row of its own, lit or dark as its light reads', () => {
    words.push(
      { word: 'mail', description: 'Open your mail', namespace: 'diamondcoreprocessor.com', dark: false, hidden: false },
      { word: 'comfy', description: 'The comfy desk', dark: true, hidden: false },
    )
    lights([], ['word:comfy'], ['*'])
    const rows = roster()
    const mail = rows.find(r => r.kind === 'word:mail')
    expect(mail).toMatchObject({ category: 'word', on: true, isView: false, slashCommand: '/mail', label: 'mail' })
    expect(rows.find(r => r.kind === 'word:comfy')?.on).toBe(false)
  })

  it('shows the way back lit, and marks it as a light that does not switch', () => {
    words.push({ word: 'beehaviors', description: 'Open Beehaviors', dark: false, hidden: false })
    lights([], [], ['*'])
    expect(roster().find(r => r.kind === 'word:beehaviors')).toMatchObject({ on: true, fixed: true })
  })

  it("names a community word's module, as a foreign kind names its own", () => {
    words.push({ word: 'gallery', description: 'A gallery', namespace: 'lightbox.example', dark: true, hidden: false })
    lights([], [], ['*'])
    const row = roster().find(r => r.kind === 'word:gallery')
    expect(row).toMatchObject({ module: 'lightbox.example', on: false })
    expect(row?.foreign).toBeUndefined()
  })

  it('never offers the record of a word nobody declares as a foreign behaviour', () => {
    lights(['word:gone'], ['word:retired'], ['*'])
    const kinds = roster().map(r => r.kind)
    expect(kinds).not.toContain('word:gone')
    expect(kinds).not.toContain('word:retired')
  })

  it('says of every row whether it is a view — what the filter reads on both tabs', () => {
    lights([], [], ['*'])
    const rows = roster()
    expect(rows.find(r => r.kind === 'visual:postit:note')?.isView).toBe(true)
    expect(rows.find(r => r.kind === 'visual:nav:pan')?.isView).toBe(false)
    expect(rows.every(r => typeof r.isView === 'boolean')).toBe(true)
  })

  it("carries a door's search back with its rows, so the window opens on it", () => {
    lights([], [], ['*'])
    let answer: { query?: string } = {}
    const off = EffectBus.on<{ query?: string }>('features:roster', p => { answer = p })
    EffectBus.emit('features:roster-open', { query: 'mail' })
    off()
    expect(answer.query).toBe('mail')
    EffectBus.emit('features:roster-open', {})
    expect(roster().length).toBeGreaterThan(0)
  })

  it('lights a community word that already worked here once, and never on a hive that started dark', () => {
    words.push({ word: 'gallery', description: 'A gallery', namespace: 'lightbox.example', dark: true, hidden: false })
    lights(['visual:postit:note'], [], ['games'])
    roster()
    expect(JSON.parse(localStorage.getItem('hc:behavior-global-on') ?? '[]')).toContain('word:gallery')

    localStorage.clear()
    lights([], [], ['*'])
    roster()
    expect(JSON.parse(localStorage.getItem('hc:behavior-global-on') ?? '[]')).not.toContain('word:gallery')
  })
})
