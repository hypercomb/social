// sharing/device-sync.walker.ts
//
// The replication walker as a MODULE sees it. The walker itself lives in the
// runtime (hypercomb-runtime/src/replication-walker.ts) and a module may not
// import the runtime, so the runtime registers it in IoC and this is the shape
// a module asks for. Only the two calls device sync uses.

export const WALKER_IOC_KEY_LOCAL = '@hypercomb.social/ReplicationWalker'

type Io = {
  read(signature: string): Promise<Uint8Array<ArrayBuffer> | null>
  fetch(signature: string): Promise<Uint8Array<ArrayBuffer> | null>
  write(signature: string, bytes: Uint8Array<ArrayBuffer>): Promise<void>
}

type Result = { holes: string[]; refused: string[]; limited: boolean }

export interface WalkerLike {
  resolveSignatureClosure(root: string, io: Io, options?: { limit?: number }): Promise<Result>
  isComplete(result: Result): boolean
}
