// hypercomb-shared/core/mesh-session.ts
//
// REFRESH KEEPS THE SWARM; CLOSING THE TAB LEAVES IT.
//
// Swarm membership is a per-tab gesture, never a persisted posture. The flag
// every drone samples (`hc:mesh-public`) lives in localStorage, which outlives
// the tab and is shared by every tab on the origin — so it is rewritten here,
// from THIS tab's sessionStorage, before any drone can read it. A reload (or a
// crash-reload mid-meeting) rejoins; a new tab or a reopened browser boots
// solo/private. Joining is always an explicit act (mesh-header cycle →
// selector → START, the keymap toggle, the `join` word); leaving is the leave
// gesture or closing the tab.
//
// Both shells import this FIRST in main.ts, after quiet-console: the dev shell
// imports its drones at module load, so a write any later than this would let
// them sample a joined flag a closed tab left behind.

const MESH_PUBLIC_KEY = 'hc:mesh-public'
// MIRRORED: hypercomb-essentials/src/sharing/membership.ts reads this same key
// (a module never imports the shell) — essentials' isJoinedHere() is seeded
// from it. Rename it in both places or per-tab membership silently breaks
// after a reload. hypercomb-runtime's keymap toggle writes it too.
const MESH_SESSION_KEY = 'hc:mesh-session'

export const meshResumed: boolean = (() => {
  try { return sessionStorage.getItem(MESH_SESSION_KEY) === 'true' } catch { return false }
})()

try { localStorage.setItem(MESH_PUBLIC_KEY, String(meshResumed)) } catch { /* no storage — default is off anyway */ }

/** Every join and leave path announces `mesh:public-changed`; the shell
 *  records each one here so the next reload of this tab resumes it. */
export const rememberMeshSession = (pub: boolean): void => {
  try { sessionStorage.setItem(MESH_SESSION_KEY, String(pub)) } catch { /* no storage — a reload boots private */ }
}
