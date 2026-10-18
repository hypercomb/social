// show-features.refresh.spec.ts — A REFRESH NEVER REVEALS THE PANEL.
//
// A window opens only when the participant asks for that window. The drone's
// `features:open` answer is what the Beehaviors panel shows, and it used to
// raise the panel whatever asked for it — so a word's called attach
// (`meetup@postit("Doors at 7")`) popped the panel over the hive. Now every
// answer that only refreshes a group says so (`refresh: true`) and the panel
// drops it while it is down; only a door's request (no flag) raises it. The
// answer is transient too: a panel mounting later never replays a stale open.

import { describe, expect, it } from 'vitest'
import { EffectBus } from '@hypercomb/core'

const services = new Map<string, unknown>()
;(window as unknown as { ioc: unknown }).ioc = {
  get: (key: string) => services.get(key),
  register: (key: string, value: unknown) => { if (!services.has(key)) services.set(key, value) },
  list: () => [...services.keys()],
  whenReady: () => void 0,
  onRegister: () => void 0,
}

const QUEEN_KEY = '@diamondcoreprocessor.com/PostitQueenBee'
const calls: unknown[] = []
services.set(QUEEN_KEY, { applyCall: async (call: unknown) => { calls.push(call) } })
services.set('@hypercomb.social/I18n', { t: (key: string) => key })
const bees = [{
  view: 'postit', decorationKind: 'visual:postit:note', iconName: 'note',
  labelKey: 'postit.label', descriptionKey: 'postit.desc', queenKey: QUEEN_KEY, attachable: true,
}]
services.set('@diamondcoreprocessor.com/VisualBeeRegistry', {
  all: () => bees,
  get: (view: string) => bees.find(b => b.view === view),
  byDecorationKind: (kind: string) => bees.find(b => b.decorationKind === kind),
})

await import('./show-features.drone.js')

type Open = { cell: string; segments: string[]; refresh?: boolean }

/** Run `act` and collect the `features:open` answers and log lines it causes. */
const answersTo = async (act: () => void): Promise<{ opens: Open[]; logs: string[] }> => {
  const opens: Open[] = []
  const logs: string[] = []
  const offOpen = EffectBus.on<Open>('features:open', p => { opens.push(p) })
  const offLog = EffectBus.on<{ message: string }>('activity:log', p => { logs.push(p.message) })
  logs.length = 0                                  // the stored log line replayed at subscribe
  act()
  for (let i = 0; i < 50 && opens.length === 0; i++) await new Promise(r => setTimeout(r, 10))
  offOpen(); offLog()
  return { opens, logs }
}

describe('the Beehaviors answer and the rule that a refresh never reveals', () => {
  it('a door\'s request (no flag) is answered without `refresh` — that answer may raise the panel', async () => {
    const { opens } = await answersTo(() =>
      EffectBus.emit('tile:action', { action: 'features', label: 'beds', segments: ['garden', 'beds'] }))
    expect(opens).toHaveLength(1)
    expect(opens[0]!.cell).toBe('beds')
    expect(opens[0]!.refresh).toBeUndefined()
  })

  it('a refresh request is answered as a refresh', async () => {
    const { opens } = await answersTo(() =>
      EffectBus.emit('tile:action', { action: 'features', label: 'beds', segments: ['garden', 'beds'], refresh: true }))
    expect(opens).toHaveLength(1)
    expect(opens[0]!.refresh).toBe(true)
  })

  it('a called attach answers in place — a log line, and no panel read at all', async () => {
    const { opens, logs } = await answersTo(() =>
      EffectBus.emit('feature:apply', { view: 'postit', segments: ['meetup'], called: true, args: ['Doors at 7'] }))
    expect(calls).toHaveLength(1)
    // Not even a refresh: its segments are the TARGET tile, and a showing
    // panel would swap its context layer for that tile.
    expect(opens).toHaveLength(0)
    expect(logs).toContain('postit on "meetup"')
  })

  it('the answer is transient — a panel subscribing afterwards is never handed a stale open', async () => {
    await answersTo(() =>
      EffectBus.emit('tile:action', { action: 'features', label: 'beds', segments: ['garden', 'beds'] }))
    const late: Open[] = []
    EffectBus.on<Open>('features:open', p => { late.push(p) })()
    expect(late).toEqual([])
  })
})
