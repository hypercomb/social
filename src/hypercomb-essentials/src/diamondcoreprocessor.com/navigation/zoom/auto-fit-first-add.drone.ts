// diamondcoreprocessor.com/navigation/zoom/auto-fit-first-add.drone.ts
//
// Fits the viewport to content the first time a tile is added at a
// previously-empty lineage. Subsequent adds (or revisits to a lineage
// already fit during this session) leave the screen still — that's
// the long-standing constraint from `feedback_no_auto_fit_on_create_remove`
// and `feedback_add_remove_screen_still`. The narrower "first time only"
// behaviour gives the user a clean centred view when they start fresh
// at a new location without the annoyance of every subsequent add
// jumping the viewport around.
//
// Rule:
//   cell:added fires AND
//   the local OPFS at this lineage now contains exactly 1 tile AND
//   we haven't fit at this lineage sig before in this session
//   →  zoomToFit(snap=true)

import { Drone } from '@hypercomb/core'

const ZOOM_DRONE_KEY = '@diamondcoreprocessor.com/ZoomDrone'
const LINEAGE_KEY = '@hypercomb.social/Lineage'
const SIGNATURE_STORE_KEY = '@hypercomb/SignatureStore'

interface ZoomLike { zoomToFit?: (snap?: boolean) => void }
interface LineageLike {
  explorerSegments?: () => readonly string[]
  explorerDir?: () => Promise<FileSystemDirectoryHandle | null>
}
interface SignatureStoreLike { signText: (input: string) => Promise<string> }

export class AutoFitFirstAddDrone extends Drone {

  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'navigation'

  public override description =
    'Fits the viewport to content the first time a tile is added at an empty lineage. Subsequent adds leave the screen still.'

  protected override listens: string[] = ['cell:added']
  protected override emits: string[] = []

  // Per-session memo of which lineage sigs we've already auto-fit at.
  // Once a lineage has been fit (or a tile was added there), we never
  // fit it again in this session. Cleared on page reload.
  #fittedSigs = new Set<string>()

  #initialized = false

  protected override sense = () => true

  protected override heartbeat = async (): Promise<void> => {
    if (this.#initialized) return
    this.#initialized = true

    this.onEffect('cell:added', () => { void this.#maybeFit() })
  }

  #maybeFit = async (): Promise<void> => {
    const lineage = (window as { ioc?: { get: (k: string) => unknown } }).ioc?.get?.(LINEAGE_KEY) as LineageLike | undefined
    const sigStore = (window as { ioc?: { get: (k: string) => unknown } }).ioc?.get?.(SIGNATURE_STORE_KEY) as SignatureStoreLike | undefined
    if (!lineage?.explorerDir || !sigStore?.signText) return

    // Compute the lineage sig the same way show-cell + swarm do, so our
    // per-sig memoisation lines up with their notion of "this location".
    const segsRaw = lineage.explorerSegments?.() ?? []
    const segments = (Array.isArray(segsRaw) ? segsRaw : [])
      .map((x: unknown) => String(x ?? '').trim())
      .filter((x: string) => x.length > 0)
    const key = segments.join('/')

    let sig = ''
    try { sig = await sigStore.signText(key) } catch { return }
    if (!sig) return

    // Already fit at this location once this session — the user has had
    // their initial centred view and any subsequent adds must not move
    // the viewport.
    if (this.#fittedSigs.has(sig)) return

    const dir = await lineage.explorerDir()
    if (!dir) return

    // Count local children. We only fit when count is exactly 1 — i.e.
    // the lineage was empty until this add. If we arrive at a lineage
    // that already has tiles (e.g. revisiting a populated location) the
    // count exceeds 1 and we leave the viewport alone.
    let count = 0
    try {
      for await (const [name, h] of (dir as unknown as {
        entries: () => AsyncIterable<[string, FileSystemHandle]>
      }).entries()) {
        if (h.kind !== 'directory') continue
        if (name.startsWith('__') && name.endsWith('__')) continue
        count++
        if (count > 1) break
      }
    } catch { return }

    if (count !== 1) return

    this.#fittedSigs.add(sig)

    // Brief delay so the new cell's layer commit + render lands first.
    // zoomToFit reads live bounds from the hex-mesh content layer; if
    // we fire before that layer has the new geometry the bounds union
    // is stale and the fit zooms to the wrong rectangle.
    //
    // Location-stamped: the delay is a real navigation window. Without
    // the stamp, an add-then-navigate inside 80ms fired the fit against
    // the DESTINATION page's mesh — an automatic viewport jump on a page
    // the user never asked to fit (a "wrong zoom on navigation" vector).
    // If the lineage changed by the time the timer lands, drop the fit.
    setTimeout(() => {
      const liveSegs = (lineage.explorerSegments?.() ?? [])
        .map((x: unknown) => String(x ?? '').trim())
        .filter((x: string) => x.length > 0)
      if (liveSegs.join('/') !== key) return  // navigated away inside the delay
      const zoom = (window as { ioc?: { get: (k: string) => unknown } }).ioc?.get?.(ZOOM_DRONE_KEY) as ZoomLike | undefined
      zoom?.zoomToFit?.(true)
    }, 80)
  }
}

const _autoFit = new AutoFitFirstAddDrone()
;(window as { ioc?: { register?: (k: string, v: unknown) => void } }).ioc?.register?.(
  '@diamondcoreprocessor.com/AutoFitFirstAddDrone',
  _autoFit,
)
