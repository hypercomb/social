import { describe, expect, it } from 'vitest'
import {
  localClaudeBridgeAutoConnectFor,
  localClaudeBridgeConfiguredFor,
} from './local-claude-bridge.js'

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

  it('is on by default in the native shell, which has no URL bar to opt in with', () => {
    expect(configured('tauri.localhost')).toBe(true)
    expect(configured('tauri.localhost', null, 'false')).toBe(false)
    expect(configured('tauri.localhost', 'false', '1')).toBe(false)
  })

  it('lets an explicit query flag disable a stored opt-in for one tab', () => {
    expect(configured('localhost', 'false', '1')).toBe(false)
    expect(configured('localhost', '', '1')).toBe(false)
  })

  it('does not probe an offline browser bridge from persisted configuration', () => {
    expect(localClaudeBridgeAutoConnectFor({
      hostname: 'localhost', queryValue: null, storedValue: '1',
    })).toBe(false)
    expect(localClaudeBridgeAutoConnectFor({
      hostname: 'localhost', queryValue: '1', storedValue: null,
    })).toBe(true)
  })

  it('does not probe native or public hosts without an explicit bridge action', () => {
    expect(localClaudeBridgeAutoConnectFor({
      hostname: 'tauri.localhost', queryValue: null, storedValue: null,
    })).toBe(false)
    expect(localClaudeBridgeAutoConnectFor({
      hostname: 'hypercomb.social', queryValue: '1', storedValue: '1',
    })).toBe(false)
  })
})
