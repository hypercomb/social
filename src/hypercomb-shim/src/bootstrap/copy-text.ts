// hypercomb-shim/src/bootstrap/copy-text.ts
//
// WHAT THE OTHER PLACE NEEDS GOES TO THE CLIPBOARD (jwize 2026-11-14: "you also
// have to copy the link to the clipboard if the person wants to allow it on
// their own machine"). Typing `keys allow` in the hive has always copied the
// link it makes (essentials keys.queen.ts). The pages that ask with one press
// did not: the front door showed the link behind a second press, and a managed
// page only printed the command to type. Both now copy by themselves, and say
// so; where a browser refuses (no permission, no press behind the call) the
// button stays and copies when pressed.

/** Put text on the clipboard. False where this browser would not. */
export const copyText = async (text: string): Promise<boolean> => {
  try { await navigator.clipboard.writeText(text); return true } catch { return false }
}

export type CopyLabels = {
  /** The button before anything was copied, and after a copy that failed. */
  readonly idle: string
  /** The button once the text is on the clipboard. */
  readonly done: string
}

/**
 * Make a button copy `text`, and say on it whether the text is copied. A press
 * copies; `now()` copies without waiting for one, for the moment the text
 * arrives (an invite the hive just made). `said` hears each outcome.
 */
export const offerCopy = (
  button: HTMLButtonElement,
  text: string,
  labels: CopyLabels,
  said: (copied: boolean) => void = () => {},
  copy: (text: string) => Promise<boolean> = copyText,
): { readonly now: () => Promise<boolean> } => {
  button.textContent = labels.idle
  const run = async (): Promise<boolean> => {
    const copied = await copy(text).catch(() => false)
    button.textContent = copied ? labels.done : labels.idle
    said(copied)
    return copied
  }
  button.addEventListener('click', () => { void run() })
  return { now: run }
}
