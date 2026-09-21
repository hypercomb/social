// hypercomb-core/src/core/module-sections.ts
//
// A BEE IS READABLE BY SOURCE FILE. A shipped module is one unminified ESM
// bundle, and the bundler marks where each source file begins with a comment
// on its own line at column 0: `// src/games/solomon/labyrinth.ts`. Those
// headers are the only structure a bundle has, and they are enough: a section
// runs from its header to the line before the next one, so a source path names
// a slice of the module that a model can read alone and write back whole.
//
// Pure text. Nothing here reads a store or hashes anything; the draft door
// (hypercomb-runtime module-drafts.ts) does that around these.

const HEADER_RE = /^\/\/ (src\/[^\s]+)$/

export type ModuleSection = {
  /** `src/games/solomon/labyrinth.ts` — the source file this slice came from. */
  readonly path: string
  /** Character offset of the header line's first character. */
  readonly from: number
  /** Character offset one past the section's last character (the next header, or the end). */
  readonly to: number
  /** Lines in the section, header included. */
  readonly lines: number
}

/** Every section of a module, in file order. Empty when the text carries no headers. */
export const sectionIndex = (text: string): ModuleSection[] => {
  const heads: { path: string; from: number; line: number }[] = []
  let offset = 0
  let line = 0
  for (const raw of text.split('\n')) {
    const match = HEADER_RE.exec(raw)
    if (match) heads.push({ path: match[1], from: offset, line })
    offset += raw.length + 1
    line++
  }
  return heads.map((head, index) => {
    const next = heads[index + 1]
    const to = next ? next.from : text.length
    return { path: head.path, from: head.from, to, lines: (next ? next.line : line) - head.line }
  })
}

/** The section a source path names, or null when the module has none by that name. */
export const sectionOf = (text: string, path: string): ModuleSection | null =>
  sectionIndex(text).find(section => section.path === path) ?? null

/** Is this a source path a section header could carry? */
export const isSectionPath = (value: unknown): value is string =>
  typeof value === 'string' && /^src\/[A-Za-z0-9_.@-]+(?:\/[A-Za-z0-9_.@-]+)*$/.test(value) && value.length <= 200

/**
 * The module with one section's body replaced. The header line stays exactly
 * where it was, so the section keeps its name and every other section keeps
 * its place; the body is written as given, ending in one newline.
 */
export const replaceSection = (text: string, path: string, body: string): string | null => {
  const section = sectionOf(text, path)
  if (!section) return null
  const headerEnd = text.indexOf('\n', section.from)
  const head = text.slice(0, headerEnd + 1)
  const tail = text.slice(section.to)
  const content = body.replace(/\s+$/, '')
  return `${head}${content ? `${content}\n` : ''}${tail}`
}
