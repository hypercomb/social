// hypercomb-shared/ui/command-line/command-history.ts
//
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
