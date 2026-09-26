// hypercomb-shim/src/bootstrap/ports.ts
//
// The two IoC keys between the host bundle and its host package: the host
// offers its installer (HOST_ACQUIRE_KEY, replicate.ts), the host package's
// console bee offers itself (HOST_CONSOLE_KEY, host-console.drone.ts).

export const HOST_ACQUIRE_KEY = '@hypercomb.social/HostAcquire'
export const HOST_CONSOLE_KEY = '@hypercomb.social/HostConsole'
