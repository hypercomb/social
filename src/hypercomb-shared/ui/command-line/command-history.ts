// ui/command-line/command-history.ts — the line history gives a secret back.
//
// The command line remembers every line as typed (`hc:command-history`, on
// this device), before any behaviour is handed it. A word that finds a
// secret on its line — `bridge add susan <code>`, where the code belongs in
// the prompt the word opens — asks for it back with the transient effect
// `command-history:forget { words: 'bridge add susan' }`: every remembered
// line that begins with those words and carries more is cut back to them.
// The payload is the words to keep, never the secret.

/** Every line that begins with `words` (slash or none, case folded) and
 *  carries more after them, cut back to those words in the line's own
 *  spelling. A repeat the cut makes next to its twin collapses, as recording
 *  collapses consecutive repeats. */
export function cutBackToWords(history: readonly string[], words: string): string[] {
  const kept = words.trim().replace(/^\//, '').split(/\s+/).filter(Boolean).map(word => word.toLowerCase())
  if (!kept.length) return [...history]
  const cut = history.map(line => {
    const text = line.trimStart()
    const slash = text.startsWith('/') ? '/' : ''
    const parts = text.slice(slash.length).trim().split(/\s+/)
    if (parts.length <= kept.length) return line
    if (!kept.every((word, index) => parts[index]?.toLowerCase() === word)) return line
    return slash + parts.slice(0, kept.length).join(' ')
  })
  return cut.filter((line, index) => index === 0 || line !== cut[index - 1])
}

// WHAT THE COMMAND LINE NEVER REMEMBERS. Recall (Up / Down) keeps every line
// it ran in origin-wide localStorage — readable by every module on the
// origin, recalled in every tab, kept across sessions. A meeting point's
// ACCESS CODE lives only in the tab's session and in the meeting link
// (essentials sharing/meeting-invite.ts), so a line that carries one is run
// and never written down:
//   - `invite code <x>` — the invite word refuses it (the selector is where a
//     code is typed), but the line is recorded before any word runs;
//   - a pasted meeting link whose fragment carries `code=`.

const INVITE_CODE_RE = /^\/?invite\s+code\s+\S/i
const MEET_CODE_RE = /#meet=[^\s]*[&?]code=/i

/** Does this line carry an access code — so it must never be recalled? */
export const isSensitiveLine = (line: string): boolean => {
  const text = String(line ?? '').trim()
  return INVITE_CODE_RE.test(text) || MEET_CODE_RE.test(text)
}
