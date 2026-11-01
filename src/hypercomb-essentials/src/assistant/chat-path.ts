// assistant/chat-path.ts
//
// `/chat /path/to/tile` opens that tile's conversation. The path completes
// against conversations that already exist. A sentence is still a question.

/** A path and nothing else. A space means the rest is a question. */
export const chatPathOf = (args: string): string | null => {
  const raw = args.trim()
  if (!raw.startsWith('/') || /\s/.test(raw) || raw.length > 240) return null
  if (raw.length > 1 && raw.endsWith('/')) return null
  return raw
}

/** Paths already in use that continue what was typed. Empty until a `/`. */
export const chatPathCompletions = (typed: string, paths: readonly string[]): string[] => {
  const raw = typed.trim().toLowerCase()
  if (!raw.startsWith('/')) return []
  const unique = [...new Set(paths.filter(path => path.startsWith('/')))]
  return unique.filter(path => path.toLowerCase().startsWith(raw)).sort().slice(0, 12)
}
