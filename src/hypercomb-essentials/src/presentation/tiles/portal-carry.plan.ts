// presentation/tiles/portal-carry.plan.ts
//
// What a take carries to the quick tray, as a pure shape so a spec can run it
// (documentation/recents-and-the-quick-tray.md, codex A9). The to-the-tray icon
// and the recents view both send this; nothing about a take writes anywhere.

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
