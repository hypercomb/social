// mesh-zone.types.ts — the swarm zone's credential/preference contracts.
//
// Implementations live in essentials (sharing/) and register under the keys
// below. Shells resolve instances via IoC only to WRITE; for VALUES they
// subscribe on EffectBus — each store announces its current value at
// construction and on every change, so last-value replay makes the contract
// timing-free for chrome that mounts before the sharing module loads.

export const ROOM_STORE_KEY = '@hypercomb.social/RoomStore'
export const SECRET_STORE_KEY = '@hypercomb.social/SecretStore'
export const SECRET_STRENGTH_KEY = '@hypercomb.social/SecretStrengthProvider'
export const SAVED_LOCATIONS_KEY = '@hypercomb.social/SavedLocationsStore'

/** EffectBus effects — emitted with the current value at store construction
 *  and again on every change. */
export const ROOM_CHANGED = 'mesh:room-changed'
export const SECRET_CHANGED = 'mesh:secret-changed'
export const SAVED_LOCATIONS_CHANGED = 'mesh:saved-locations-changed'

export type ZoneValueChange = { value: string }
export type SavedLocationsChange = { value: ReadonlyArray<string> }

/** RoomStore / SecretStore shape (localStorage-backed, EventTarget 'change'). */
export interface ZoneValueStore {
  readonly value: string
  set(value: string): void
  clear(): void
}

/** Pluggable secret strength evaluation — any module can register a
 *  replacement at SECRET_STRENGTH_KEY. */
export interface SecretStrengthProvider {
  evaluate(secret: string): number // 0.0 – 1.0
}

export interface SavedLocationsProvider {
  readonly value: ReadonlyArray<string>
  add(name: string): void
  remove(name: string): void
}
