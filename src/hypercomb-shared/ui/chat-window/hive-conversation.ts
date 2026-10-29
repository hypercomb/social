// hive-conversation.ts — which hive move opens a conversation.
//
// Clicking a tile and going into a tile both arm that tile's conversation.
// The reading pane stays where it was. Coming back out of the tile is what
// puts the armed conversation in view.

export type HiveMove =
  | { readonly kind: 'enter'; readonly segments: readonly string[] }
  | { readonly kind: 'back'; readonly segments: readonly string[] }
  | { readonly kind: 'same' }

/** One step in or one step out. Any other path change is not this gesture. */
export const hiveConversationMove = (
  prev: readonly string[],
  next: readonly string[],
): HiveMove => {
  const into = next.length === prev.length + 1 && prev.every((segment, index) => segment === next[index])
  if (into) return { kind: 'enter', segments: next }
  const out = prev.length === next.length + 1 && next.every((segment, index) => segment === prev[index])
  if (out) return { kind: 'back', segments: prev }
  return { kind: 'same' }
}
