// sharing/hive-format.attack.spec.ts
//
// ADVERSARIAL PASS over the DELIVERY half of the hive format marker — the
// read, the once-per-declaration mark, and the surface.
//
// `advanceFormat` makes a downgrade uncomposable at WRITE time. These tests
// attack the two places that guarantee does not reach: the READ (which has no
// tiebreak at all) and the SURFACE (which can lose the sentence after the
// "already told them" mark is already committed).
//
// Written to FAIL against the current implementation.

import { beforeEach, describe, expect, it } from 'vitest'
import { EffectBus, HIVE_FORMAT_KIND, type HiveFormatDeclaration } from '@hypercomb/core'
import { announceHiveFormat, readHiveFormat } from './hive-format.js'

// toast.drone.ts self-registers at module load, so the IoC shim has to exist
// before it is imported — hence the dynamic import in the test below.
;(window as unknown as { ioc: Record<string, unknown> }).ioc =
  { register: () => {}, get: () => undefined }

const SEEN_KEY = 'hc:hive-format-seen'

const declaration = (over: Partial<HiveFormatDeclaration> = {}): HiveFormatDeclaration => ({
  kind: HIVE_FORMAT_KIND,
  v: 1,
  format: 2,
  minReader: 2,
  changedAt: Date.UTC(2026, 8, 3),
  ...over,
})

const bytes = (d: HiveFormatDeclaration): ArrayBuffer => {
  const u8 = new TextEncoder().encode(JSON.stringify(d))
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer
}

// ── A pool that holds MORE THAN ONE member ────────────────────────────────
//
// `putPoolDoc` writes the new member BEFORE dropping the old, its sweep is
// best-effort (`removeEntry` inside `catch {}`), and the sweep is REFUSED
// outright whenever `documentSweepVetoFor` objects — a crash between the two
// steps, a raced removeEntry, or a folder-sync restore of a pre-advance
// backup all leave two members behind.
//
// `getPoolDoc` (hypercomb-runtime/src/store.ts:296-311) then returns the
// FIRST non-empty sig-named member in `entries()` order. OPFS does not
// specify that order. This stub reproduces exactly that contract.
const poolStore = (members: readonly ArrayBuffer[]): unknown => {
  // A pool handle that enumerates, exactly as OPFS does: sig-named FILE
  // entries in an unspecified order. `getPoolDoc` reproduces store.ts's real
  // contract on top of it - the FIRST non-empty member wins - which is the
  // defect this suite attacks, and which the fix must not depend on.
  const entries = members.map((bytes, i) => [
    String(i).padStart(64, 'a'),
    {
      kind: 'file' as const,
      getFile: async () => ({
        size: bytes.byteLength,
        text: async () => new TextDecoder().decode(bytes),
      }),
    },
  ] as const)
  const pool = {
    name: 'pool',
    entries: async function* () { for (const e of entries) yield e },
  }
  return {
    getPool: async () => pool as unknown as FileSystemDirectoryHandle,
    getPoolDoc: async () => members.find(b => b.byteLength > 0) ?? null,
    putPoolDoc: async () => 'sig',
  }
}

const installStore = (store: unknown): void => {
  ;(window as unknown as { ioc: Record<string, unknown> }).ioc =
    { register: () => {}, get: () => store }
}

describe('ATTACK — the READ has no tiebreak, so a stale sibling silences the warning', () => {
  beforeEach(() => { localStorage.removeItem(SEEN_KEY) })

  it('prefers the NEWEST declaration in the pool, not whichever comes first', async () => {
    const stale = declaration({ format: 1, minReader: 1, changedAt: Date.UTC(2026, 0, 1) })
    const current = declaration({ format: 2, minReader: 2 })
    // Iteration order puts the STALE member first — the exact case
    // `advanceFormat` was written to make impossible on the write side.
    installStore(poolStore([bytes(stale), bytes(current)]))

    const found = await readHiveFormat()
    expect(found?.format).toBe(2)
    expect(found?.minReader).toBe(2)
  })

  it('still announces when a stale sibling shadows the current declaration', async () => {
    installStore(poolStore([
      bytes(declaration({ format: 1, minReader: 1, changedAt: Date.UTC(2026, 0, 1) })),
      bytes(declaration({ format: 2, minReader: 2 })),
    ]))

    const verdict = await announceHiveFormat()
    // The hive genuinely requires reader 2 and this client reads 1. One stale
    // byte-blob in the pool turns the whole feature off, silently.
    expect(verdict.verdict).toBe('unreadable')
    expect(verdict.announce).toBe(true)
  })
})

describe('ATTACK — the "already told them" mark is committed before the sentence survives', () => {
  beforeEach(() => { localStorage.removeItem(SEEN_KEY) })

  it('does not lose the standing warning to five ordinary toasts, forever', async () => {
    const { ToastDrone } = await import('../commands/toast.drone.js')
    const toasts = new ToastDrone()
    const decl = declaration({ format: 2, minReader: 2 })

    await announceHiveFormat(decl)
    expect(toasts.toasts.some(t => t.title === 'Older client')).toBe(true)

    // ToastDrone keeps MAX_VISIBLE = 5 and PREPENDS, so a sticky toast
    // (duration 0, never auto-dismissed) is simply sliced off the end by the
    // next five notifications of any kind. Twelve seconds after boot, that is
    // an ordinary afternoon.
    for (let i = 0; i < 5; i++) {
      EffectBus.emit('toast:show', { type: 'tip', message: `routine ${i}` })
    }
    expect(toasts.toasts.some(t => t.title === 'Older client')).toBe(false)

    // ...and the localStorage fingerprint was written BEFORE the emit, so the
    // condition — which is standing and unchanged — is never mentioned again
    // on this device for this declaration.
    await announceHiveFormat(decl)
    expect(toasts.toasts.some(t => t.title === 'Older client')).toBe(true)
  })
})
