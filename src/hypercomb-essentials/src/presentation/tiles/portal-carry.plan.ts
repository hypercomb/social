// presentation/tiles/portal-carry.plan.ts
//
// What letting go of the tile's handle MEANS, as a pure decision so a spec
// can run it without a pointer. The handle sends a reference to the quick
// tray (documentation/recents-and-the-quick-tray.md, codex A9): a plain click
// takes, and a drag let go anywhere takes — except over a row of the Portals
// window (add to that portal, the gesture that was here before the tray) or
// over the window itself (stage it there). No release writes to the source
// page; the tray's own drop is where appearance or custody is decided.

export type HandleRelease =
  | { kind: 'take' }
  | { kind: 'portal'; targetKey: string }
  | { kind: 'stage' }

export const planHandleRelease = (at: { portalKey?: string | null; overIndex?: boolean }): HandleRelease => {
  if (at.portalKey) return { kind: 'portal', targetKey: at.portalKey }
  if (at.overIndex) return { kind: 'stage' }
  return { kind: 'take' }
}

/** What a take carries: the tile's name, the page it stands on (its SOURCE —
 *  the parent, never the tile's own path), and the signature that page lists
 *  it by when it is known. `loose` is an atom no page lists: it has no source
 *  to seal from, so its sig is the only handle on it. */
export const takePayload = (
  label: string,
  segments: readonly string[],
  sig?: string | null,
  loose = false,
): { label: string; segments: string[]; sig?: string; loose?: true } => ({
  label,
  segments: [...segments],
  ...(sig ? { sig } : {}),
  ...(loose ? { loose: true as const } : {}),
})
