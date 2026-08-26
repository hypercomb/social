// diamondcoreprocessor.com/assistant/chat-highlight.ts
//
// Syntax highlighting for chat code blocks — LAZY, and optional.
//
// highlight.js is a root dependency, but it is also the single largest thing
// the chat window could pull in, and most conversations never contain a code
// block. So it is a dynamic import: the first fenced block that arrives pays
// for it once, and a hive whose chats are all prose never loads it at all.
//
// `lib/common` (not the full build) — the ~35 languages anyone actually pastes,
// without the long tail of the complete registry.
//
// Failure is silent BY DESIGN. Unhighlighted code is still perfectly readable
// code; a missing chunk must never cost the participant their answer.

type Highlighter = { highlightElement(element: HTMLElement): void }

let pending: Promise<Highlighter | null> | null = null

/** The shared highlighter, loaded at most once per session. */
export const loadHighlighter = (): Promise<Highlighter | null> => {
  pending ??= import('highlight.js/lib/common')
    .then(module => (module.default ?? null) as Highlighter | null)
    .catch(() => null)
  return pending
}

/**
 * Highlight every fenced block under `root` that has not been done yet.
 *
 * The `data-hl` guard is ours rather than highlight.js's own `data-highlighted`
 * because a re-rendered turn arrives as fresh DOM with no marks on it — the
 * guard has to mean "this element, as it stands now", which is exactly what a
 * dataset flag on the live node means.
 */
export const highlightBlocks = async (root: HTMLElement | null | undefined): Promise<void> => {
  if (!root) return
  const blocks = [...root.querySelectorAll<HTMLElement>('code[class*="language-"]:not([data-hl])')]
    // A streaming answer's last block is still being written; highlighting it
    // per chunk is churn for a result that changes again in 40ms.
    .filter(block => !block.closest('[data-streaming]'))
  if (!blocks.length) return

  const highlighter = await loadHighlighter()
  if (!highlighter) return

  for (const block of blocks) {
    if (block.dataset['hl']) continue
    block.dataset['hl'] = '1'
    try { highlighter.highlightElement(block) } catch { /* unhighlighted is fine */ }
  }
}
