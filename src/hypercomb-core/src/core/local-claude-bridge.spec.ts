import { describe, expect, it } from 'vitest'
import { localClaudeBridgeConfiguredFor } from './local-claude-bridge.js'

const configured = (
  hostname: string,
  queryValue: string | null = null,
  storedValue: string | null = null,
): boolean => localClaudeBridgeConfiguredFor({ hostname, queryValue, storedValue })

describe('local Claude bridge capability', () => {
  it('is unavailable without an explicit opt-in', () => {
    expect(configured('localhost')).toBe(false)
  })

  it('accepts query or stored opt-in on loopback hosts', () => {
    expect(configured('localhost', 'true')).toBe(true)
    expect(configured('127.0.0.1', null, '1')).toBe(true)
    expect(configured('::1', 'yes')).toBe(true)
    expect(configured('[::1]', null, 'on')).toBe(true)
  })

  it('never enables the local feature on a public host', () => {
    expect(configured('hypercomb.social', 'true', '1')).toBe(false)
  })

  it('lets an explicit query flag disable a stored opt-in for one tab', () => {
    expect(configured('localhost', 'false', '1')).toBe(false)
    expect(configured('localhost', '', '1')).toBe(false)
  })
})
