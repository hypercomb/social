// src/app/core/agent/agent.ts

export interface Agent<T = unknown> {
  compute(ref: string): Promise<T | null>
}
