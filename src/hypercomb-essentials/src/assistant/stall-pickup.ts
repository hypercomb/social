// assistant/stall-pickup.ts
//
// A STALLED CHAT IS PICKED BACK UP (Jaime, 2026-10-27: "the chats should never
// fall idle… an orchestrator should figure out that things are stalled and
// help you pick up where you left off").
//
// owed-step.ts already notices a loop: the same leftover twice with nothing
// done, two idle legs, or three empty promises. It parks that as
// waiting/stalled and the cue used to wait for the participant to type
// "continue". Replaying that same continue word is the loop the park exists
// to break, so a pickup changes the step. It names what is still open and
// asks for a different concrete action.
//
// This decides the patch. It reads no store and sends no word. The
// orchestrator applies it; the chat window sends the word for the
// conversation on screen. A question, a model that gave up, an interrupted
// leg, a spent budget, and a manager's ask are left as they are. A hold is
// not: the leg ended without recording the rest, and that is unfinished work.
// Open steps stay owed past the first few pickups. The request budget is
// what stops the work.

export const STALL_WAKE_MS = 2_000
export const STALL_PASS_MS = 30_000
/** How long a finished reply sits before open workflow steps count as idle.
 *  Long enough for the route organizer to catch the latest turn. */
export const STALL_QUIET_MS = 15_000
/** Backoff before the next pickup of the same stall. The first is immediate
 *  once the pass runs; later ones wait, and the words change each time. */
export const STALL_PICKUP_BACKOFF_MS = [0, 15_000, 60_000, 180_000] as const
/** Open steps come back on this shorter ladder. A three-minute wait read as
 *  the work sitting with the participant. */
export const STALL_OPEN_BACKOFF_MS = [0, 15_000, 60_000] as const
/** Times the same open steps are picked up before the instruction switches
 *  to a write and stays there. The pass still picks them up. */
export const STALL_OPEN_PICKUPS_MAX = 3

export interface StallSpent { readonly rounds: number; readonly tokens: number; readonly legs: number }

export interface StallOwed {
  readonly state: 'continue' | 'waiting' | 'paused'
  readonly why: string
  readonly left: string
  readonly asker?: string
  readonly spent: StallSpent
  readonly pickups: number
  readonly next: number
}

/** Open steps of a flow that has already read this conversation's history. */
export interface StallOpen {
  readonly current: boolean
  readonly titles: readonly string[]
  /** Pickups of this same open set already sent. */
  readonly picked: number
}

export interface StallChat {
  readonly owed?: StallOwed
  readonly open?: StallOpen
  readonly asking: boolean
  readonly quiet: boolean
  readonly budget: { readonly rounds: number; readonly tokens: number }
}

export interface StallPatch {
  readonly state: 'continue' | 'paused'
  readonly why: string
  readonly left: string
  readonly lastLeft: string
  readonly pickups: number
  readonly next: number
  readonly idleLegs: number
  readonly promises: number
  readonly spent: StallSpent
}

const clip = (text: string): string => text.replace(/\s+/g, ' ').trim().slice(0, 500)

/** What the next leg is asked, so it cannot be the continue word that just stalled. */
export const unstickLeft = (left: string, pickups: number): string => {
  const what = clip(left) || 'the work that was still open'
  const which = pickups <= 1 ? 'The last approach stalled' : `Approach ${pickups - 1} stalled as well`
  return `${which}. Still open: ${what}. Pick that up by a different step: do one concrete thing in the hive toward it now, then say what is still left.`
}

/** What a chat that went quiet still has open in its workflow.
 *  `picked` is how many times this same set was already sent. The first pass
 *  names the step. The next pass writes it. A later pass stops the read loop
 *  that kept returning help text. The step belongs to the agent. */
export const openWorkLeft = (titles: readonly string[], picked = 0): string => {
  const what = titles.map(clip).filter(Boolean).slice(0, 6).join('; ') || 'a step still open'
  const step = `Open step for the agent: ${what}.`
  if (picked >= 2) {
    return `${step} The last passes read and did not finish it. Write the change on this same tile now. Do not read the same signatures or help text again. Say the trial address from this message's SANDBOX line.`
  }
  if (picked >= 1) {
    return `${step} Write the change on this same tile now. Say the trial address from this message's SANDBOX line. A read is not the finish.`
  }
  return `${step} Do that step in the hive now. If it changes a page, write the page on this same tile and say the trial address from this message's SANDBOX line.`
}

const overBudget = (spent: StallSpent, budget: StallChat['budget']): boolean =>
  spent.rounds >= budget.rounds || spent.tokens >= budget.tokens

const zeroSpent: StallSpent = { rounds: 0, tokens: 0, legs: 0 }

/**
 * The owed patch that picks a stalled or idle chat back up, or null when
 * this chat is not one the orchestrator may move. Pure.
 */
export const stallPickup = (chat: StallChat, now: number): StallPatch | null => {
  if (chat.asking) return null
  const owed = chat.owed
  if (owed?.asker) return null
  if (owed?.state === 'paused') return null
  if (owed?.state === 'waiting' && owed.why !== 'stalled' && owed.why !== 'held') return null

  if (owed?.state === 'waiting' && (owed.why === 'stalled' || owed.why === 'held')) {
    if (overBudget(owed.spent, chat.budget)) {
      return {
        state: 'paused', why: 'budget', left: owed.left, lastLeft: owed.left,
        pickups: owed.pickups, next: 0, idleLegs: 0, promises: 0, spent: owed.spent,
      }
    }
    const pickups = owed.pickups + 1
    const delay = STALL_PICKUP_BACKOFF_MS[Math.min(pickups - 1, STALL_PICKUP_BACKOFF_MS.length - 1)] ?? 0
    return {
      state: 'continue', why: 'unstick', left: unstickLeft(owed.left, pickups), lastLeft: owed.left,
      pickups, next: delay ? now + delay : 0, idleLegs: 0, promises: 0, spent: owed.spent,
    }
  }

  // A continue record is the window's to send. Anything else owed is a wait
  // this pass has already declined.
  if (owed) return null
  const open = chat.open
  if (!chat.quiet || !open?.current) return null
  const titles = open.titles.map(clip).filter(Boolean)
  if (!titles.length) return null
  const pickups = open.picked + 1
  const delay = STALL_OPEN_BACKOFF_MS[Math.min(open.picked, STALL_OPEN_BACKOFF_MS.length - 1)] ?? 0
  const left = openWorkLeft(titles, open.picked)
  return {
    state: 'continue', why: 'unstick', left, lastLeft: '',
    pickups, next: delay ? now + delay : 0, idleLegs: 0, promises: 0, spent: zeroSpent,
  }
}
