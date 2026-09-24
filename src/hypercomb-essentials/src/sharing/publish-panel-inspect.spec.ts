// The publish panel asks the drone to inspect the current row from inside its
// `publish:render` handler, and the drone may answer with a render
// synchronously (a row with no live head). If the panel asks before it has
// recorded the key and its visibility, every re-entry looks like a new subject
// and the pair loops until the stack overflows — which took publishing down
// (2026-09-23, "Maximum call stack size exceeded" in PublishStatusDrone).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const PANEL = readFileSync(
  join(process.cwd(), 'hypercomb-shared', 'ui', 'publish-panel', 'publish-panel.component.ts'), 'utf8')

describe('the publish panel re-aims without looping', () => {
  it('records the key and visibility before it asks the drone to inspect', () => {
    const handler = PANEL.slice(PANEL.indexOf("EffectBus.on<PublishRenderPayload>('publish:render'"))
    const end = handler.indexOf('ngOnDestroy')
    const body = handler.slice(0, end)
    const ask = body.indexOf("EffectBus.emit('publish:inspect'")
    expect(ask).toBeGreaterThan(-1)
    expect(body.indexOf('this.currentKey.set(nextCurrent)')).toBeLessThan(ask)
    expect(body.indexOf('this.visible.set(!!p.open)')).toBeLessThan(ask)
    expect(body.match(/publish:inspect/g)).toHaveLength(1)
  })
})
