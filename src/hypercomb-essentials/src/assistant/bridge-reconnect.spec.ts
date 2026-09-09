import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// A RENDERER THAT OPTED IN MUST KEEP DIALLING.
//
// The worker used to reconnect only when it had a PRIOR successful
// connection (`if (wasConnected) this.#scheduleReconnect()`), so a tab that
// loaded while the broker was down gave up after one refused socket and
// stayed dead for the rest of its life. Starting the broker afterwards
// changed nothing — `bridge-cli` answered `no renderer connected` while the
// participant's tab sat there, apparently fine, having quietly stopped
// asking. The only cure was a manual reload, and nothing on screen said so.
//
// That gate was there to keep the console quiet, but the console cost is
// real either way: a refused WebSocket is logged by the BROWSER and cannot
// be caught. The answer is backoff, not surrender — and reaching this code
// at all already means `isLocalClaudeBridgeConfigured()` said yes.
//
// Found 2026-09-09, diagnosing a renderer that never attached.

const WORKER = join(__dirname, 'claude-bridge.worker.ts')
const source = readFileSync(WORKER, 'utf8')

describe('claude bridge renderer reconnection', () => {
  it('never makes the reconnect conditional on a prior success', () => {
    // The exact shape of the regression: a scheduling call fenced by the
    // flag that means "we have connected before".
    expect(source).not.toMatch(/if\s*\(\s*wasConnected\s*\)\s*\{[^}]*#scheduleReconnect/)
    // ...and the single-statement spelling of the same fence.
    expect(source).not.toMatch(/if\s*\(\s*wasConnected\s*\)\s*this\.#scheduleReconnect/)
  })

  it('schedules a reconnect from close AND from a failed construction', () => {
    // Two exits from `#connect` can leave the tab with no socket: `onclose`
    // (the refused/broken case) and the `catch` around `new WebSocket`.
    // Both must re-arm, or the give-up bug comes back through the other door.
    const calls = source.match(/this\.#scheduleReconnect\(\)/g) ?? []
    expect(calls.length).toBeGreaterThanOrEqual(2)
  })

  it('backs off to a ceiling instead of hammering every RECONNECT_MS', () => {
    // Unconditional retry is only affordable because the wait grows.
    expect(source).toMatch(/RECONNECT_CEILING_MS\s*=/)
    expect(source).toMatch(/Math\.min\(\s*RECONNECT_MS\s*\*\s*2\s*\*\*\s*this\.#attempts/)
  })

  it('resets the backoff on a successful handshake', () => {
    // Without this a long-lived tab that once had a slow start would carry
    // the ceiling forever, turning a routine broker restart into a 30s gap.
    const onopen = source.slice(source.indexOf('ws.onopen'), source.indexOf('ws.onmessage'))
    expect(onopen).toMatch(/this\.#attempts\s*=\s*0/)
  })

  it('will not open a second socket over a live one', () => {
    // A pending timer and an explicit `claude-bridge:connect` can now both
    // reach `#connect`.
    const body = source.slice(source.indexOf('#connect(): void {'))
    expect(body.slice(0, 400)).toMatch(/if\s*\(\s*this\.#ws\s*\)\s*return/)
  })
})
