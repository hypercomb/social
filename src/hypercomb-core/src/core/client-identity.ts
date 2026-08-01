// hypercomb-core/src/core/client-identity.ts
//
// CLIENT IDENTITY — one persistent identifier per client install, so DCP
// can tell installs apart. Every isolated storage world is its own client:
// Edge's OPFS, Chrome's OPFS, each native --instance hive, a Windows Store
// install. They can all run different package versions on one machine, and
// managing them requires knowing WHICH client is talking.
//
// The identity travels through the DATA — the portal handoff URL into DCP —
// never through shared storage (there is none across browsers/webviews).
// The id is minted once per install (random 64-hex, NOT a content signature)
// and persists in localStorage. The name is a human handle: the native shell
// injects its --instance name via `window.__HC_INSTANCE`; web installs
// default to the browser's name. Rename freely — the id is the identity.

export interface ClientIdentity {
  /** Random 64-hex minted once per install. Identity, not content. */
  id: string
  /** Human handle (instance name / browser name). Display only. */
  name: string
  platform: 'web' | 'native'
}

const ID_KEY = 'hc:client-id'
const NAME_KEY = 'hc:client-name'

const mintId = (): string => {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
}

const isNative = (): boolean =>
  typeof (window as { __HC_INSTANCE?: string }).__HC_INSTANCE === 'string'
  || '__TAURI_INTERNALS__' in window
  || '__TAURI__' in window

const defaultName = (): string => {
  const instance = (window as { __HC_INSTANCE?: string }).__HC_INSTANCE
  if (typeof instance === 'string' && instance) return instance
  if (isNative()) return 'native'
  const ua = navigator.userAgent
  if (ua.includes('Edg/')) return 'edge'
  if (ua.includes('OPR/')) return 'opera'
  if (ua.includes('Firefox/')) return 'firefox'
  if (ua.includes('Chrome/')) return 'chrome'
  if (ua.includes('Safari/')) return 'safari'
  return 'web'
}

/** This install's identity — minted on first call, stable ever after. */
export const getClientIdentity = (): ClientIdentity => {
  let id = ''
  try { id = localStorage.getItem(ID_KEY) ?? '' } catch { /* storage unavailable */ }
  if (!/^[a-f0-9]{64}$/.test(id)) {
    id = mintId()
    try { localStorage.setItem(ID_KEY, id) } catch { /* ephemeral id this session */ }
  }
  let name = ''
  try { name = (localStorage.getItem(NAME_KEY) ?? '').trim() } catch { /* fall through */ }
  return {
    id,
    name: name || defaultName(),
    platform: isNative() ? 'native' : 'web',
  }
}

/** Participant-local rename for this client install. Empty restores default. */
export const setClientName = (name: string): void => {
  const trimmed = (name ?? '').trim()
  try {
    if (trimmed) localStorage.setItem(NAME_KEY, trimmed)
    else localStorage.removeItem(NAME_KEY)
  } catch { /* storage unavailable — non-fatal */ }
}
