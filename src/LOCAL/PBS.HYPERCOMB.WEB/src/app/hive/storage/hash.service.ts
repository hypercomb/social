// src/app/hive/storage/hashing-service.ts

import { Injectable } from "@angular/core"

// ---------------------------------------------
// hash / signature types
// ---------------------------------------------

export type HashString = string   // lowercase hex (64 chars)
export type Hash      = HashString
export type Signature = HashString

@Injectable({ providedIn: 'root' })
export class HashService {

  // sha-256 hex digest length (bytes=32 → hex chars=64)
  public static readonly HASH_LENGTH = 64

  // ---------------------------------------------
  // low-level sha-256
  // ---------------------------------------------

  private static async sha256Hex(
    input: string | ArrayBuffer
  ): Promise<HashString> {
    const buffer =
      typeof input === 'string'
        ? new TextEncoder().encode(input).buffer
        : input

    const hash = await crypto.subtle.digest('SHA-256', buffer)

    return Array.from(new Uint8Array(hash))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('') as HashString
  }

  // ---------------------------------------------
  // identity hashing (names, intent)
  // ---------------------------------------------

  public static hash(input: string): Promise<Hash> {
    return this.sha256Hex(input)
  }

  // ---------------------------------------------
  // content signatures (truth)
  // ---------------------------------------------

  public static async signature(
    payload: unknown | ArrayBuffer
  ): Promise<Signature> {
    const bytes =
      payload instanceof ArrayBuffer
        ? payload
        : new TextEncoder().encode(
            this.canonicalStringify(payload)
          ).buffer

    return this.sha256Hex(bytes)
  }

  // ---------------------------------------------
  // canonical json (deterministic)
  // ---------------------------------------------

  private static canonicalStringify(value: unknown): string {
    if (value === null || typeof value !== 'object') {
      return JSON.stringify(value)
    }

    if (Array.isArray(value)) {
      return `[${value.map(v => this.canonicalStringify(v)).join(',')}]`
    }

    const obj = value as Record<string, unknown>
    const keys = Object.keys(obj).sort()

    return `{${keys
      .map(k => `"${k}":${this.canonicalStringify(obj[k])}`)
      .join(',')}}`
  }
}
