// execution-change.ts
//
// WHAT RUN WILL CHANGE, said beside the button.
//
// A file write waited in the thread as `write /business-card/main.js` and two
// buttons. The participant was asked to let a change run without being told
// what the change was: a new file, one line of three hundred, or the whole
// file replaced (business-card.jwize.com, 2026-11-15; jwize, 2026-11-16:
// "continue with the followups").
//
// These lines are what the held row shows under the command: one that says
// the size of the change and where it sits, then the first lines that go and
// the first that come. They are read from the file as it is now and the text
// the write would leave, so they are true of this write and say nothing the
// write does not do.
//
// The comparison is the span between the first and the last line that
// differ: exact for one edit, and for several it says the span they cover.
// A file's worth of work for a diff that names every hunk is not paid on
// every write.
//
// Pure: no store, no DOM.

/** Characters one shown line keeps. */
const SHOWN_CHARS = 110
/** Lines shown of what goes, and of what comes. */
const SHOWN_LINES = 2

const linesOf = (text: string): string[] => {
  const lines = text.split('\n')
  // A trailing newline is the end of the last line, not one more line.
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop()
  return lines
}

const count = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`
const clip = (line: string): string => {
  const flat = line.replace(/\t/g, '  ').trimEnd()
  return flat.length > SHOWN_CHARS ? `${flat.slice(0, SHOWN_CHARS)}…` : flat
}

/** Where two texts differ: the first line that does, and how many lines of
 *  each lie between it and the last that does. Null when they are the same. */
export const changedSpan = (before: string, after: string): { from: number; removed: string[]; added: string[] } | null => {
  if (before === after) return null
  const was = linesOf(before)
  const now = linesOf(after)
  let head = 0
  while (head < was.length && head < now.length && was[head] === now[head]) head++
  let tail = 0
  while (tail < was.length - head && tail < now.length - head && was[was.length - 1 - tail] === now[now.length - 1 - tail]) tail++
  return { from: head + 1, removed: was.slice(head, was.length - tail), added: now.slice(head, now.length - tail) }
}

/**
 * The lines the held row shows for a write of `after` over `before` (null:
 * the file does not exist yet). Empty when there is nothing to say.
 */
export const changeLines = (before: string | null, after: string): string[] => {
  const now = linesOf(after)
  if (before === null) {
    return [`New file: ${count(now.length, 'line', 'lines')}.`, ...now.slice(0, SHOWN_LINES).map(line => `+ ${clip(line)}`)]
  }
  const span = changedSpan(before, after)
  if (!span) return ['No change: the file already holds exactly this.']
  const was = linesOf(before)
  const out: string[] = []
  if (span.removed.length === was.length && was.length > 0 && span.added.length > 0) {
    out.push(`Replaces the whole file: ${count(was.length, 'line', 'lines')} become ${now.length}.`)
  } else if (!span.removed.length) {
    out.push(`Adds ${count(span.added.length, 'line', 'lines')} at line ${span.from} (${was.length} lines now).`)
  } else if (!span.added.length) {
    out.push(`Removes ${count(span.removed.length, 'line', 'lines')} from line ${span.from} (${was.length} lines now).`)
  } else {
    out.push(`Changes ${count(span.removed.length, 'line', 'lines')} from line ${span.from} into ${span.added.length} (${was.length} lines now).`)
  }
  for (const line of span.removed.slice(0, SHOWN_LINES)) out.push(`- ${clip(line)}`)
  if (span.removed.length > SHOWN_LINES) out.push(`- … ${span.removed.length - SHOWN_LINES} more`)
  for (const line of span.added.slice(0, SHOWN_LINES)) out.push(`+ ${clip(line)}`)
  if (span.added.length > SHOWN_LINES) out.push(`+ … ${span.added.length - SHOWN_LINES} more`)
  return out
}
