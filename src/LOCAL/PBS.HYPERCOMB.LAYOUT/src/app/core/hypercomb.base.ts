// src/app/core/hypercomb.base.ts

/*
shared base
- no ownership
- no persistence
*/

export abstract class Hypercomb {
  protected assert = (condition: boolean, message: string): void => {
    if (!condition) throw new Error(message)
  }
}
