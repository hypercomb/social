// hypercomb-core/src/processor.ts
//
// THE PROCESSOR — the part of core a host cannot run without: act() and its
// optimize pass, the bee lifecycle (bee, drone, queen, worker), the resolver
// key, IoC, the effect bus and signing. The minimal install ships this file
// and nothing else of core; library.ts arrives by signature (build.mjs).
//
// Keep it closed: nothing here may import from library.ts, or the install
// would carry the library after all.

export * from './core/hypercomb.web.js'
export * from './core/hypercomb.js'
export * from './core/signature.service.js'
export * from './bee.base.js'
export * from './worker.base.js'
export * from './drone.base.js'
export * from './queen.base.js'
export * from './core/bee-resolver.js'
export * from './ioc/ioc.js'
export * from './ioc/service-key.js'
export { EffectBus, type EffectHandler } from './effect-bus.js'
