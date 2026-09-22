// package-floor.spec.ts — when the shell moves a package that cannot move itself.

import { describe, expect, it, vi } from 'vitest'
import { EffectBus } from '@hypercomb/core'
import { planFloor, UPDATE_DOOR } from './package-floor'

// The move itself needs a browser store; these cases are the decision alone.
vi.mock('@hypercomb/runtime/acquire', () => ({ acquire: vi.fn(), headPackage: vi.fn() }))
vi.mock('@hypercomb/runtime/host-zones', () => ({ DEFAULT_HOST_ZONES: ['jwize.com'], listHostZones: vi.fn() }))
vi.mock('./resolve-import-map', () => ({ cacheImportMap: vi.fn() }))

const OLD = 'a'.repeat(64)
const HEAD = { packageSig: 'b'.repeat(64), zone: 'jwize.com' }

describe('planFloor', () => {
  it('moves a package that answers no update door to the seed head', () => {
    expect(planFloor({ installed: OLD, doorAnswered: false, head: HEAD, reloadedFor: null }))
      .toEqual({ act: true, from: OLD, to: HEAD.packageSig, zone: 'jwize.com' })
  })

  it('never touches a package that answers the door — updating it stays a choice', () => {
    expect(planFloor({ installed: OLD, doorAnswered: true, head: HEAD, reloadedFor: null }).act).toBe(false)
  })

  it('stands aside when it cannot tell, when nothing is installed, or when there is nowhere to go', () => {
    expect(planFloor({ installed: OLD, doorAnswered: null, head: HEAD, reloadedFor: null }).act).toBe(false)
    expect(planFloor({ installed: null, doorAnswered: false, head: HEAD, reloadedFor: null }).act).toBe(false)
    expect(planFloor({ installed: OLD, doorAnswered: false, head: null, reloadedFor: null }).act).toBe(false)
    expect(planFloor({ installed: HEAD.packageSig, doorAnswered: false, head: HEAD, reloadedFor: null }).act).toBe(false)
  })

  it('moves an install known only by the old stamp even when something answers the door', () => {
    // An interrupted move leaves the head's dependencies in the pool; an install
    // that old has no bag, so they load, and their Packages window answers a door
    // the package itself never had.
    expect(planFloor({ installed: OLD, legacyRecord: true, doorAnswered: true, head: HEAD, reloadedFor: null }))
      .toEqual({ act: true, from: OLD, to: HEAD.packageSig, zone: 'jwize.com' })
    expect(planFloor({ installed: OLD, legacyRecord: true, doorAnswered: null, head: HEAD, reloadedFor: null }).act).toBe(true)
    expect(planFloor({ installed: HEAD.packageSig, legacyRecord: true, doorAnswered: true, head: HEAD, reloadedFor: null }).act).toBe(false)
    expect(planFloor({ installed: OLD, legacyRecord: true, doorAnswered: true, head: HEAD, reloadedFor: HEAD.packageSig }).act).toBe(false)
  })

  it('moves once per session: a reload that did not stick is not retried', () => {
    expect(planFloor({ installed: OLD, doorAnswered: false, head: HEAD, reloadedFor: HEAD.packageSig }).act).toBe(false)
  })
})

describe('the door question', () => {
  it('is answered by whoever listens for what the pill emits', () => {
    expect(EffectBus.listens(UPDATE_DOOR)).toBe(false)
    const off = EffectBus.on(UPDATE_DOOR, () => {})
    expect(EffectBus.listens(UPDATE_DOOR)).toBe(true)
    off()
    expect(EffectBus.listens(UPDATE_DOOR)).toBe(false)
  })
})
