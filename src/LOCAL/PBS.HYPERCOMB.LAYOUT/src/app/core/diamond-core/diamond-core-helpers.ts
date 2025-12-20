// src/app/core/diamond-core/diamond-core.helpers.ts

export function decay(weight: number, dt: number): number {
  const DECAY_RATE = 0.85
  return weight * Math.pow(DECAY_RATE, dt)
}

export function reinforce(current: number, added: number): number {
  return Math.min(1, current + added * (1 - current))
}
