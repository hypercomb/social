// local-claude-bridge.ts — one capability gate for the local Claude Code UI.
//
// The bridge is deliberately loopback-only. A production tab cannot reliably
// open ws://localhost through Private Network Access. Keep this decision in
// core so the essentials socket and shared chat UI do not grow subtly
// different interpretations of whether the LOCAL bridge is configured. A
// participant-supplied AI host is a separate way to enable chat.

export const CLAUDE_BRIDGE_ENABLED_QUERY_KEY = 'claudeBridge'
export const CLAUDE_BRIDGE_ENABLED_STORAGE_KEY = 'hypercomb.claudeBridge.enabled'

export interface LocalClaudeBridgeConfig {
  hostname: string
  /** null means the query flag was absent; an empty/false flag overrides storage. */
  queryValue: string | null
  storedValue: string | null
}

const enabledValue = (value: string | null): boolean =>
  value !== null && /^(1|true|yes|on)$/i.test(value.trim())

const loopbackHost = (hostname: string): boolean => {
  const host = hostname.trim().toLowerCase()
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]'
}

/** Pure decision seam used by tests and non-browser hosts. */
export const localClaudeBridgeConfiguredFor = (config: LocalClaudeBridgeConfig): boolean => {
  if (!loopbackHost(config.hostname)) return false
  return enabledValue(config.queryValue !== null ? config.queryValue : config.storedValue)
}

/**
 * Whether this tab explicitly opted into the local Claude Code bridge.
 *
 * Query state wins over storage so `?claudeBridge=false` is a safe one-tab
 * escape hatch from a stored opt-in. Browser globals are read defensively so
 * importing the helper during SSR/tests simply reports unavailable.
 */
export const isLocalClaudeBridgeConfigured = (): boolean => {
  try {
    const hostname = globalThis.location?.hostname ?? ''
    const queryValue = new URLSearchParams(globalThis.location?.search ?? '')
      .get(CLAUDE_BRIDGE_ENABLED_QUERY_KEY)
    let storedValue: string | null = null
    try { storedValue = globalThis.localStorage?.getItem(CLAUDE_BRIDGE_ENABLED_STORAGE_KEY) ?? null }
    catch { /* unavailable/private storage means not configured */ }
    return localClaudeBridgeConfiguredFor({ hostname, queryValue, storedValue })
  } catch {
    return false
  }
}
