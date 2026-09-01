// hypercomb-web/src/setup/visitor-session.ts
//
// IS THIS SHELL A READER OR A PARTICIPANT? One question, one answer, asked
// wherever boot has to treat a published site differently from someone's own
// hive.
//
// `installMemoryFilesystem()` stamps the mark (main.visitor.ts runs it before
// it imports the participant boot graph), so the answer is already true by
// the time anything in `./main` asks. Reading the DOM/global rather than
// keeping a second flag means there is ONE truth, set at the one place that
// knows: the module that swapped the filesystem out.

/** True when this page is a published site being READ, not a hive being kept. */
export function isVisitorSession(): boolean {
  try {
    if ((window as Window & { __HC_READONLY__?: boolean }).__HC_READONLY__ === true) return true
    return document.documentElement.dataset['hypercombMode'] === 'visitor'
  } catch { return false }
}
