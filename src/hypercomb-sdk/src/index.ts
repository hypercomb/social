// -------------------------------------------------
// IoC — environment-agnostic service locator
// -------------------------------------------------

export { ioc } from './ioc/ioc.js'
export type { IoCContainer } from './ioc/ioc.types.js'

// -------------------------------------------------
// Keys — all known IoC key constants
// -------------------------------------------------

export * from './keys/index.js'

// -------------------------------------------------
// Bridge — CLI ↔ browser protocol
// -------------------------------------------------

export { BRIDGE_PORT } from './bridge.js'
export type { BridgeOp, BridgeRequest, BridgeResponse } from './bridge.js'

// -------------------------------------------------
// Build — programmatic module build pipeline
// -------------------------------------------------

export { buildModules } from './build/index.js'
export type { BuildOptions, BuildResult } from './build/index.js'

// -------------------------------------------------
// Core primitives — everything needed to author
// drones, workers, and services
// -------------------------------------------------

export {
  // base classes
  Bee,
  Drone,
  Worker,

  // lifecycle
  BeeState,

  // communication
  EffectBus,

  // identity
  SignatureService,
  ServiceToken,

  // IoC key helpers
  serviceKey,
  parseServiceKey,

  // resolver contract
  BEE_RESOLVER_KEY,

  // introspection types
  type BeeResolver,
  type EffectHandler,
  type GrammarHint,
  type Effect,
  type ProviderLink,
} from '@hypercomb/core'
