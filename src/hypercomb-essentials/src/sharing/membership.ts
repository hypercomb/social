// sharing/membership.ts
//
// IS THIS TAB IN THE SWARM? Membership is per tab: the shell keeps it in this
// tab's sessionStorage under `hc:mesh-session` (hypercomb-shared/core/
// mesh-session.ts — keep the key literal in step with it), so a reload keeps
// the join and a new tab never inherits one. Essentials never reads the
// origin-wide `hc:mesh-public` flag: every tab shares that one, and a second
// tab's boot used to silence the joined tab mid-meeting (doctrine.spec.ts
// ratchets the literal out of essentials).
//
// Seeded once from the session, then it follows `mesh:public-changed`, which
// every join and leave path announces.

import { EffectBus } from '@hypercomb/core'

const MESH_SESSION_KEY = 'hc:mesh-session'

let joined = ((): boolean => {
  try { return sessionStorage.getItem(MESH_SESSION_KEY) === 'true' } catch { return false }
})()

EffectBus.on<{ public?: boolean }>('mesh:public-changed', (p) => { joined = p?.public === true })

/** True while THIS tab is a member of the swarm. */
export const isJoinedHere = (): boolean => joined
