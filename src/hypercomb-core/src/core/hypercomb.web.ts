// src/app/hypercomb.web.ts

export type ActIntent =
  | { kind: 'action'; name: string }
  | { kind: 'seed'; name: string }
  | { kind: 'error'; name: string }

export abstract class web {
  public abstract act(text: string): Promise<ActIntent>
}
