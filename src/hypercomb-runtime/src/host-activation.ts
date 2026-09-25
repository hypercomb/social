// One host route, one hashed location bag. Its latest hash-verified layer decides
// which offered creation that hostname serves; prior markers remain revisions.
import { commitLocationLayer, currentLocationLayer, locationAddress,
  type LocationLayerStore } from './location-layer'

const SIG = /^[a-f0-9]{64}$/
const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/

export type HostActivation = {
  name: 'host:activation'
  enabled: boolean
  pubkey: string
  lineage: string
  /** The publisher's implementation door, as visited. */
  sourceRoute: string
  /** The local hostname that will serve this creation, without scheme or port. */
  localRoute: string
  head: string
  source: string
}

export type HostActivationInput = Omit<HostActivation, 'name'>

/** Host header and browser URL forms resolve to the same hostname bytes. */
export const hostRouteName = (raw: string): string => {
  let value = String(raw ?? '').trim().toLowerCase()
  if (value.includes('://')) {
    try { value = new URL(value).hostname.toLowerCase() } catch { return '' }
  } else if (/:[0-9]{1,5}$/.test(value)) {
    const split = value.lastIndexOf(':')
    const port = Number(value.slice(split + 1))
    if (port < 1 || port > 65_535) return ''
    value = value.slice(0, split)
  }
  return value.length <= 253 && value.split('.').every(label => LABEL.test(label)) ? value : ''
}

/** This is the same actionable location the server derives from HTTP Host. */
export const hostActivationLocation = async (localRoute: string): Promise<string> => {
  const hostname = hostRouteName(localRoute)
  if (!hostname) throw new Error('A host activation needs a local hostname')
  return locationAddress(hostname)
}

const valid = (layer: HostActivation, at: string): boolean =>
  layer?.name === 'host:activation' && typeof layer.enabled === 'boolean'
  && SIG.test(layer.pubkey) && SIG.test(layer.head)
  && typeof layer.lineage === 'string' && layer.lineage.split('/').every(part => !!part)
  && typeof layer.sourceRoute === 'string' && !!layer.sourceRoute.trim()
  && typeof layer.source === 'string' && !!layer.source.trim()
  && hostRouteName(layer.localRoute) === at && layer.localRoute === at

/** Read only the highest marker. A malformed or foreign layer is not active. */
export const readHostActivation = async (
  store: LocationLayerStore, localRoute: string,
): Promise<{ layer: HostActivation; sig: string; marker: string } | null> => {
  const hostname = hostRouteName(localRoute)
  if (!hostname) return null
  const current = await currentLocationLayer<HostActivation>(store, await hostActivationLocation(hostname))
  return current && valid(current.layer, hostname) ? current : null
}

/** Append the local route's on/off layer after its signature-named bytes are stored. */
export const writeHostActivation = async (
  store: LocationLayerStore, input: HostActivationInput,
  options: { replaceExisting?: boolean } = {},
): Promise<{ layer: HostActivation; sig: string; marker: string }> => {
  const localRoute = hostRouteName(input.localRoute)
  const layer: HostActivation = { ...input, name: 'host:activation', localRoute }
  if (!localRoute || !valid(layer, localRoute)) throw new Error('Invalid host activation')
  const before = await readHostActivation(store, localRoute)
  // A stale tile cannot turn off another creation or mask a different layer.
  // Replacing an occupied hostname requires an explicit, reviewed choice.
  if (!input.enabled && (!before || before.layer.pubkey !== input.pubkey
    || before.layer.lineage !== input.lineage)) throw new Error('Host route now serves another creation')
  if (input.enabled && before?.layer.enabled && (before.layer.pubkey !== input.pubkey
    || before.layer.lineage !== input.lineage) && !options.replaceExisting) {
    throw new Error('Host route already serves another creation')
  }
  await commitLocationLayer(store, await hostActivationLocation(localRoute), layer)
  const current = await readHostActivation(store, localRoute)
  if (!current) throw new Error('Host activation did not verify after commit')
  return current
}
