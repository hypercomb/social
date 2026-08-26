// movement.types.ts — the navigation-commit counter's module↔shell contract.
//
// The implementation lives in essentials (navigation/movement.service.ts)
// and registers under MOVEMENT_SERVICE_KEY. Every committed navigation
// announces MOVEMENT_CHANGED on EffectBus (with the counter; replayed), so
// chrome that mounts before the module loads still re-renders on the first
// move it can see.

export const MOVEMENT_SERVICE_KEY = '@hypercomb.social/MovementService'
export const MOVEMENT_CHANGED = 'movement:changed'

export type MovementChange = { moved: number }

export interface MovementProvider {
  /** Increments after navigation intent is committed. */
  readonly moved: number
  move(segment: string): Promise<void>
  back(): Promise<void>
  forward(): Promise<void>
}
