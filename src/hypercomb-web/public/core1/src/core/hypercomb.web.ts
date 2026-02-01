// src/app/hypercomb.web.ts
export abstract class web {
  public abstract act(text: string): Promise<void>
}
