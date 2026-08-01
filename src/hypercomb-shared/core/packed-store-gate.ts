// hypercomb-shared/core/packed-store-gate.ts
//
// THE BOOT GATE for the packed store's one-way door.
//
// WHY THIS IS NOT INSIDE `Store`.
//
// The first version of this check lived in `Store.#doInit` and threw. That is
// not a refusal — it is one service reporting a problem while the shell boots
// straight past it. Measured, on a hive that had been drained into the pack
// and then opened with the flag off: `Store.initialize()` threw, the shell
// carried on, the nine modules that call `navigator.storage.getDirectory()`
// DIRECTLY got the real (now hollow) flat root, install and boot logic wrote
// into it, and the next packed boot drained that damage INTO the pack. A
// committed layer was lost — bags 2 -> 1, markers 3 -> 1.
//
// So the gate has to run BEFORE anything can acquire storage, and it has to
// stop the boot rather than report. Two mechanisms, because one is not
// enough:
//
//   1. `main()` awaits this and returns without bootstrapping the app.
//   2. `navigator.storage.getDirectory` is replaced with a throwing stub, so
//      any module that reaches for the root directly — now or in future —
//      cannot write into the hollow flat layout either.
//
// The hive is NOT damaged in this state, and nothing here modifies it. The
// records are in the pack; the flat layout simply no longer holds all of
// them. Turning the flag back on restores the whole hive.

import { PACKED_STORE_FLAG_KEY, packedStoreEnabled } from '@hypercomb/core'
import { nativeAvailable } from './native-filesystem'
import { packedStoreHasRecords } from './packed-bridge'

const MESSAGE_TITLE = 'This hive lives in the packed store'
const MESSAGE_BODY =
  'Its records were migrated into the packed store, so the flat layout no longer ' +
  'holds all of them. Opening it this way would show a partial hive and quietly ' +
  'build on top of it, so the shell stopped instead. Nothing has been lost.'
const MESSAGE_FIX =
  `Re-enable packed mode — localStorage['${PACKED_STORE_FLAG_KEY}'] = '1' — and reload.`
const MESSAGE_TAB =
  'If another tab already has this hive open, use that tab: the packed store ' +
  'admits one writer at a time.'

/** Stop any further storage acquisition dead, including from modules that
 *  bypass `Store` entirely. */
const sealStorage = (): void => {
  try {
    Object.defineProperty(navigator.storage, 'getDirectory', {
      configurable: true,
      value: async () => {
        throw new Error(`[hypercomb] ${MESSAGE_TITLE}. ${MESSAGE_FIX}`)
      },
    })
  } catch { /* sealed is best-effort; the boot still stops below */ }
}

/** Plain DOM, no framework: the app must not bootstrap, so nothing that
 *  renders is available. */
const render = (): void => {
  try {
    const style = 'font:14px/1.6 system-ui,sans-serif;color:#cfd6e4;background:#0f1319;' +
      'padding:2rem;max-width:44rem;margin:0 auto'
    document.body.setAttribute('style', 'margin:0;background:#0f1319;min-height:100vh')
    document.body.innerHTML =
      `<div style="${style}">` +
      `<h1 style="font-size:1.1rem;font-weight:600;color:#e8edf5">${MESSAGE_TITLE}</h1>` +
      `<p>${MESSAGE_BODY}</p>` +
      `<p style="color:#8fa3bf">${MESSAGE_FIX}</p>` +
      `<p style="color:#8fa3bf">${MESSAGE_TAB}</p>` +
      `</div>`
  } catch { /* no DOM — the console line below still carries it */ }
}

/**
 * Should the shell refuse to boot?
 *
 * True only when a POPULATED pack exists and packed mode is not engaging —
 * the flag was turned off, or another tab holds the pack. An empty pack means
 * nothing was ever drained and the flat layout is still whole, so it does not
 * trip.
 *
 * Native shells are unaffected: they never had a flat OPFS layout to fall
 * back to.
 *
 * Call FIRST in `main()`, before any storage acquisition, and return early
 * when it answers true.
 */
export const packedStoreBlocksBoot = async (packPoolSig: string): Promise<boolean> => {
  if (nativeAvailable() || packedStoreEnabled()) return false
  if (!(await packedStoreHasRecords(packPoolSig))) return false
  console.error(
    `[hypercomb] ${MESSAGE_TITLE} — refusing to boot on a partial hive.\n` +
    `${MESSAGE_BODY}\n${MESSAGE_FIX}\n${MESSAGE_TAB}`,
  )
  sealStorage()
  render()
  return true
}
