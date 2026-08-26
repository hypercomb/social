// view-mode.types.ts — the active presentation surface's module↔shell
// contract.
//
// The implementation lives in essentials (commands/view-mode.service.ts,
// beside the visual-bee registry whose views it grounds) and registers under
// VIEW_MODE_KEY. Shells resolve it via whenReady (they always did) and ask
// the INSTANCE whether a mode is transient — the hand-maintained set rides
// the service, so no shell carries a copy.

export const VIEW_MODE_KEY = '@hypercomb.social/ViewMode'

/** A view-mode is just a string — unlimited modes, mutual exclusion by
 *  "only one is active." Concrete modes are conventional, not enforced. */
export type ViewMode = string

export interface ViewModeProvider {
  readonly mode: ViewMode
  /** The surface that was up immediately before the current one. */
  readonly previous: ViewMode
  is(name: ViewMode): boolean
  setMode(next: ViewMode): void
  toggle(a?: ViewMode, b?: ViewMode): ViewMode
  /** True when `mode` is a full-surface (canvas-covering) view — the shells
   *  key `body.hc-view-covered` on this. */
  isTransient(mode: ViewMode): boolean
}
