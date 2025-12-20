// src/app/core/worker/worker.base.ts

export abstract class Worker {
  public abstract readonly action: string

  public abstract act(): Promise<void>
}
