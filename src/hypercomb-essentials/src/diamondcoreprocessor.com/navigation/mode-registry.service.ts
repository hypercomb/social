// diamondcoreprocessor.com/navigation/mode-registry.service.ts
//
// Owner-counted MODE state. A "mode" (e.g. 'view:active') is a full-surface
// state that several INDEPENDENT owners can hold at once — a website site-view
// AND a photo overlay on top of it both mean "a view is covering the canvas,
// hide the chrome". The mode is active while ANY owner holds it.
//
// The bug this exists to kill: a mode broadcast as a single-slot boolean, set
// by whoever emitted last. Photo-over-site-view, then close the photo → the
// photo emitted `view:active {active:false}`, which unhid the canvas + chrome
// UNDERNEATH the still-open site-view. The site-view — guarding on its own
// private `#viewActive` copy — never re-asserted `true`, so the global state
// could not be repaired without leaving the view entirely. Same disease, same
// cure as InputGate's `#lockOwners` Set (see input-gate.service.ts): the last
// releaser no longer wins; the mode stays on until the LAST owner exits.
//
// The aggregate is broadcast on EffectBus under the mode's OWN name, and ONLY
// on a 0↔1 owner transition, so:
//   • existing consumers (which latch `<mode> {active}`) need no change — they
//     just receive correct values now;
//   • a late/re-mounting subscriber's last-value replay is the true aggregate,
//     never a stale `false` a since-closed overlay left behind.
//
// Imported for its side-effect ONCE via the side-effects barrel; every consumer
// resolves the singleton through IoC (`import type` + window.ioc.get) rather
// than value-importing this module — the same rule InputGate follows so esbuild
// can't inline a second copy into a bee bundle and split the owner set.
//
// IoC key: @diamondcoreprocessor.com/ModeRegistry

import { EffectBus } from '@hypercomb/core'

export type ModePayload = { active: boolean; owner: string }

export class ModeRegistry {
  #owners = new Map<string, Set<string>>()

  /** Is `mode` held by any owner right now? */
  isActive = (mode: string): boolean => (this.#owners.get(mode)?.size ?? 0) > 0

  /** Owners currently holding `mode` (for introspection / debugging). */
  ownersOf = (mode: string): readonly string[] => [...(this.#owners.get(mode) ?? [])]

  /** `owner` enters `mode`. Idempotent per owner. Broadcasts
   *  `<mode> {active:true, owner}` ONLY on the 0→1 transition — the first
   *  owner turns the mode on. Re-entering an already-active mode is silent. */
  enter = (mode: string, owner: string): void => {
    let set = this.#owners.get(mode)
    if (!set) { set = new Set(); this.#owners.set(mode, set) }
    const wasActive = set.size > 0
    if (set.has(owner)) return
    set.add(owner)
    if (!wasActive) EffectBus.emit<ModePayload>(mode, { active: true, owner })
  }

  /** `owner` exits `mode`. Broadcasts `<mode> {active:false, owner}` ONLY on
   *  the 1→0 transition — a mode still held by another owner stays on, so a
   *  closing overlay can never unhide what a still-open one is covering. */
  exit = (mode: string, owner: string): void => {
    const set = this.#owners.get(mode)
    if (!set || !set.delete(owner)) return
    if (set.size === 0) EffectBus.emit<ModePayload>(mode, { active: false, owner })
  }

  /** Force-drop `owner` from EVERY mode it holds — teardown when a surface is
   *  disposed while still entered, or escape-cascade emergency recovery so a
   *  leaked enter() can never strand a mode on forever. Any mode that falls to
   *  zero owners emits its `false` transition. */
  releaseOwner = (owner: string): void => {
    for (const [mode, set] of this.#owners) {
      if (set.delete(owner) && set.size === 0) {
        EffectBus.emit<ModePayload>(mode, { active: false, owner })
      }
    }
  }
}

const _modeRegistry = new ModeRegistry()
window.ioc.register('@diamondcoreprocessor.com/ModeRegistry', _modeRegistry)
