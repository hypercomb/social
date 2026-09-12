// hypercomb-shared/ui/chat-window/chat-window.component.ts
//
// THE CHAT WINDOW — talk to Claude about the hive. One tool window, one
// conversation per chat, and nothing else to learn.
//
// ── What this replaced, and why ─────────────────────────────────────────────
//
// The ask screen (assistant/ask-screen.view.ts, retired) was a fullscreen
// REQUEST-REFINEMENT HARNESS: a draft box at the top labelled "this is what
// gets sent as the note", a grid of tile chips, a chat box at the bottom for
// "talking it through", and a Send-as-note button that wrote the draft — not
// the conversation — onto the chosen tiles. Talking to Claude was not the
// point; producing a note for a LATER routine to read was.
//
// That model is defensible and nobody could hold it. Two text boxes where the
// one you type in is not the one that ships; one button with three different
// destinations depending on invisible state (chipped tiles / this page / the
// feedback window); and `close()` threw away the draft, the chips and the whole
// transcript, so every visit started from nothing.
//
// So: a chat window is a chat window. You type, Claude answers, the answer is
// in the window. Writing a note is something Claude DOES — "put that on the
// Genome tile" is a sentence, not a button — and it shows up in the hive.
//
// ── ONE SHAPE: full screen ──────────────────────────────────────────────────
//
// There used to be two shapes — a right-docked strip and a focus mode that
// widened over the hive — and a button to swap between them. Two shapes meant
// two layouts to keep honest, a rail that existed in one of them and not the
// other, and an Escape cascade with a rung whose only job was to undo a
// choice nobody wanted to make. The docked strip lost anyway: a conversation
// about the hive needs the tiles rail beside it, and the rail needs the width.
//
// So the window is full screen, always. What the docked strip was for — seeing
// the hive while you talk about it — the rail does better, because it names
// the tiles the request will actually carry. `hcDockedPanel` stays on the
// element for the window group's text ladder and settings gear, not for
// geometry; the SCSS overrides its width and lane offset outright.
//
// ── One conversation per chat ───────────────────────────────────────────────
//
// Every chat is its own thread with its own id, and threads are DURABLE: they
// live in the `sign('threads')` pool (assistant/chat-thread.ts), which already
// stored every reply long before anything read them back. Closing the window
// costs nothing; reopening resumes where you were; a second device sees the
// same threads.
//
// The list is recovered from the pool rather than from an index — a bucket is
// named `sha256(convoId)`, but every turn inside carries its own convoId, so
// the threads describe themselves. An index would be a second copy of a fact
// the turns already hold, free to drift the first time a write half-lands.
//
// ── Context is shown, not operated ──────────────────────────────────────────
//
// The chip grid is gone. Where you are standing and what you have selected ARE
// the context, reported in one line above the input. That is the same
// information the chips carried, minus the obligation to maintain it.
//
// ── Silence is a state, and it is named ─────────────────────────────────────
//
// Replies can arrive from a participant-configured host or the local Claude
// bridge. A configured-but-disconnected bridge can durably queue a question;
// an unreachable host cannot. The status line keeps those states distinct.
//
// And a wait is REPORTED, not implied. The row that used to say "Thinking…"
// forever now carries a clock, says "nothing is listening yet" when that is
// the truth (no session on the bridge to drain the durable queue), and offers
// a way out — because a question you cannot call back is a question you are
// stuck with. Stop means two different acts, one per tier: a live host stream
// is ABORTED (`host-ai.service.ts` always accepted an AbortSignal and nothing
// ever passed one), a queued bridge ask is WITHDRAWN from the optimization
// pool. A partial host answer survives the abort — the host really said it.
//
// ── An answer is read, and then acted on ────────────────────────────────────
//
// Turns render as markdown (chat-markdown.ts): headings, lists, tables, fenced
// code with a language label and a copy button, autolinked URLs, and hive-path
// chips that navigate — an answer naming `dolphin/site` takes you there. The
// rendered HTML is trusted past Angular's sanitizer, so the renderer's
// escape-first discipline is load-bearing; read its header before touching it.
//
// Every message carries copy, retry, and either "put this on the tile" (an
// answer) or "edit and send again" (a question). Nothing rewrites the thread:
// editing sends a NEW turn, because a thread is append-only like everything
// else in the hive.
//
// The transcript follows the newest turn only while you are AT the newest
// turn. Scroll up to read something and arrivals stop moving the view under
// you; a pill offers the way back. (It used to pin `scrollTop` on every chunk,
// which made a streaming answer impossible to read from the top.)
//
// Shell UI — resolves everything through `window.ioc` at call time and never
// imports essentials.

import { Component, ElementRef, Injector, afterNextRender, computed, effect, inject, signal, viewChild, type OnDestroy } from '@angular/core'
import { NgTemplateOutlet } from '@angular/common'
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser'
import {
  CLAUDE_BRIDGE_ENABLED_STORAGE_KEY,
  EffectBus,
  PARTICIPANT_AI_HOST_STORAGE_KEY,
  QUESTION_ASKING_INSTRUCTION,
  hostWireText,
  isLocalClaudeBridgeConfigured,
  isParticipantAiHostConfigured,
  settleQuestions,
  splitQuestion,
  type SettledQuestion,
} from '@hypercomb/core'
import { TranslatePipe } from '../../core/i18n.pipe'
import { registerShellSurface } from '@hypercomb/runtime/shell-surface-registry'
import { HcDockedPanelDirective } from '../docked-panel/hc-docked-panel.directive'
import { DockInsetDirective } from '../dock-inset/dock-inset.directive'
import { signalSession } from '../window-session'
import { highlightBlocks } from './chat-highlight'
import { resolveEntryImageUrl } from '../clipboard-thumbs'
import { hivePathSegments, renderChatMarkdown } from './chat-markdown'
import { liveHostConvos, liveHostRun, startHostRun, stopHostRun, type HostAsk } from './host-stream'
import {
  callableBehaviours,
  formatHypercombReceipt,
  hypercombActionProviderId,
  hypercombContextKey,
  hypercombGrammarInstruction,
  hypercombGrammarTool,
  HYPERCOMB_GRAMMAR_TOOL_NAME,
  parseHypercombToolCalls,
  HypercombActionExecutionError,
  HypercombPlanQueue,
  type HypercombBehaviour,
  type HypercombBehaviourExecutor,
  type HypercombFunctionTool,
  type HypercombToolCall,
} from './hypercomb-grammar'
import {
  executeHypercombObservationPlan,
  formatHypercombObservationReceipt,
  HYPERCOMB_OBSERVATION_TOOL_NAME,
  hypercombObservationInstruction,
  hypercombObservationTool,
  parseHypercombObservationToolCalls,
  type HypercombTreeReader,
} from './hypercomb-observation'

type TurnRole = 'user' | 'assistant'

type ChatTurn = {
  readonly kind: 'chat-turn'
  readonly convoId: string
  readonly role: TurnRole
  readonly text: string
  readonly at: number
  /** The turn's manifest signature — its file name in the bucket. Present
   *  on a turn read back from disk, absent on one this window appended in
   *  memory and has not re-read yet. It is the ONLY join between a drawn
   *  row and the route's work rows (documentation/chat-route.md §3.2): a
   *  turn without one gets no pieces. */
  readonly sig?: string
}

// ── THE ROUTE, as essentials reports it ─────────────────────────────────
//
// Work pieces are read from the run ledger by `ChatThreads.readRoute`
// (documentation/chat-route.md §3), feature-detected like everything else on
// that object. Junctions are NOT in it: the shell derives them itself from
// `settleQuestions` over the turns it already holds, and zips both onto its
// rows. These shapes are the contract, spelled here because the shell may
// never import the module that produces them.

/** One attempt inside a run — a step from the ledger, settled. */
type RouteAttempt = {
  readonly seq: number
  readonly verb: string
  readonly outcome: 'ok' | 'failed'
  readonly cell?: string
  readonly error?: string
  readonly at: number
}

/** One run the responder made: one piece on the pipe, however many attempts
 *  it holds. A run with a failed attempt anywhere is a LEAK. */
type RoutePiece = {
  readonly runId: string
  readonly attempts: readonly RouteAttempt[]
  readonly leak: boolean
  /** No chat-reply step named this row; the run was placed by time. */
  readonly placedByTime?: boolean
  /** Its newest step is young enough that the reply's step may still be on
   *  its way — drawn as in progress, never as unfinished. */
  readonly inProgress?: boolean
}

type Route = {
  readonly rows: readonly { readonly turnSig: string; readonly index: number; readonly pieces: readonly RoutePiece[] }[]
  /** The run the outstanding ask is making right now — the wait row's piece. */
  readonly live?: RoutePiece
  /** Runs no reply followed, drawn after the row they came after. */
  readonly unfinished: readonly { readonly afterIndex: number; readonly piece: RoutePiece }[]
  /** The conversation's ORGANIZED WORKFLOW (chat-route.md §4.1.7) — present
   *  only when the slot holds a record at this version about THIS history.
   *  Absent when nothing has organized it yet, and on an older essentials
   *  build: then every exchange is a dormant stage. */
  readonly flow?: RouteFlowView
  /** What the participant's own local model can do right now, read from probe
   *  STATE only (§3.5). Absent on an older essentials build: then the pane
   *  says nothing about why no model is running and the section carries no
   *  `data-route-organizer`. */
  readonly organizerState?: RouteOrganizerState
  /** Present only while `organizerState` is `awake`. */
  readonly organizer?: { readonly providerId: string; readonly model: string }
  /** A flow model call for THIS conversation is in flight. */
  readonly organizing?: { readonly stage: 'structure' } | { readonly stage: 'card'; readonly nodeId: string }
  /** Node ids whose card is in back-off: its last answer was unusable, recently. */
  readonly cardBackoff?: readonly string[]
}

type RouteOrganizerState = 'awake' | 'off' | 'unknown' | 'asleep' | 'blocked' | 'needs-permission' | 'empty' | 'no-model'

type RouteFlowState = 'done' | 'open' | 'decided' | 'dropped'

/** A node's CARD — three parts in the local model's words (§4.1.5). `stale`
 *  says it was written from fewer exchanges than the node now holds, or at an
 *  older card version; `exchanges` is how many it read. Every field is
 *  optional here: the shell reads whatever an essentials build of any age
 *  hands it, and draws only what is there. */
type RouteFlowCard = {
  readonly cv?: number
  readonly goal?: string
  readonly done?: string
  readonly outcome?: string
  /** What the step WAS — one word from a closed list, drawn as an icon. */
  readonly kind?: string
  readonly exchanges?: number
  readonly model?: string
  readonly at?: number
  readonly stale?: boolean
}

/** THE SESSION CARD — the conversation's name and where it stands, in the
 *  local model's words, written once every step's card is current. */
type RouteFlowSession = {
  readonly name?: string
  readonly stands?: string
  readonly model?: string
  readonly at?: number
  readonly stale?: boolean
}

/** One node of a conversation's workflow: a task, in RATIONAL order. `turns`
 *  are its OWN exchanges' turn ranges — a parent's never include its
 *  branches', so pressing a parent finds where that goal was stated. `parent`
 *  is an earlier node it branches from; `state` is the rolled-up display
 *  state. */
type RouteFlowNode = {
  readonly id: string
  readonly title: string
  readonly named?: true
  readonly state: RouteFlowState
  readonly parent?: string
  /** The 1-based exchange numbers the node owns (v2). */
  readonly exchanges?: readonly number[]
  readonly turns: readonly number[]
  /** v1's one-line detail — what the pane says on an essentials build that
   *  has no cards yet. */
  readonly detail?: string
  readonly card?: RouteFlowCard
}

type RouteFlowView = {
  readonly upToTurnCount: number
  readonly pending?: number
  /** The model that organized it — "Organized by {model}". */
  readonly model?: string
  readonly nodes: readonly RouteFlowNode[]
  readonly session?: RouteFlowSession
  /** Nodes by rolled-up state. */
  readonly counts?: Partial<Readonly<Record<RouteFlowState, number>>>
}

/** A step's KIND as an icon. Written as an array so the icon subset extractor
 *  sees every glyph; every name here is in the shipped subset. */
const KIND_ICONS: readonly { kind: string; icon: string }[] = [
  { kind: 'fix', icon: 'bug_report' },
  { kind: 'idea', icon: 'lightbulb' },
  { kind: 'choice', icon: 'alt_route' },
  { kind: 'build', icon: 'bolt' },
  { kind: 'look', icon: 'explore' },
]

/** What the sidebar's head says: the conversation's name, where it stands,
 *  and the step counts. From the session card when there is one; until then
 *  the first root step's name and the newest carded step's outcome. */
type RouteHead = {
  readonly name: string
  readonly stands: string
  readonly stale: boolean
  readonly icon: string
  readonly done: number
  readonly open: number
  readonly total: number
}

/** A step rule in the thread: where a step begins, what it was, how it stands. */
type StepRule = {
  readonly title: string
  readonly icon: string
  readonly state: RouteFlowState
}

/** How a piece names its verb. Written as an array of `{ verb, icon }` so the
 *  icon subset extractor (scripts/icon-names.cjs, rule 3: `icon: '…'`) sees
 *  every glyph — a map keyed by verb would ship the WORDS. Every name here
 *  must already be, or now be, in the shipped subset. */
const VERB_ICONS: readonly { verb: string; icon: string }[] = [
  { verb: 'update', icon: 'edit' },
  { verb: 'note-add', icon: 'edit_note' },
  { verb: 'note-delete', icon: 'delete' },
  { verb: 'note-split', icon: 'edit_note' },
  { verb: 'put-resource', icon: 'upload_file' },
  { verb: 'optimization-add', icon: 'bolt' },
  { verb: 'decoration-add', icon: 'label' },
  { verb: 'bag-add', icon: 'add_box' },
  { verb: 'bag-remove', icon: 'delete' },
  { verb: 'bag-set', icon: 'sync' },
  { verb: 'build-record', icon: 'build' },
  { verb: 'stamp', icon: 'flag' },
  { verb: 'add', icon: 'add_box' },
  { verb: 'remove', icon: 'delete' },
  { verb: 'summary-add', icon: 'description' },
  { verb: 'submit', icon: 'play_arrow' },
]

/** A verb the map does not know still gets a glyph, never its name. */
const VERB_ICON_FALLBACK: { readonly icon: string } = { icon: 'build' }

/** ONE CARD OF THE SIDEBAR (documentation/chat-route.md §4). The tree is the
 *  flow's tasks in preorder, each branch one indent step in; after it, on the
 *  main line, the TAIL — one card per exchange the flow has not read, then the
 *  live run or the wait, then the end. Every card points back at the thread
 *  rows it stands for.
 *
 *    node   — a task of the organized workflow, titled in the local model's words
 *    stage  — an exchange not organized yet: a dormant card with no text
 *    live   — the run the outstanding ask is making now
 *    wait   — a request is out and no run has reported yet
 *    end    — open, goal reached, or put away
 *
 *  An exchange's work, reply and question are MARKS on its card and entries
 *  in the pane, never cards of their own: v1 drew a card per piece, and one
 *  or two open exchanges filled the followed viewport. */
type RouteItem = {
  readonly key: string
  readonly kind: 'node' | 'stage' | 'live' | 'wait' | 'end'
  /** The first thread row the card stands for; -1 is the thread's foot. */
  readonly row: number
  /** Every thread row it stands for — the rows that light together. */
  readonly rows: readonly number[]
  readonly node?: RouteFlowNode
  /** The runs of those rows: each reply's own, and those no reply followed. */
  readonly runs: readonly RoutePiece[]
  /** Which of `runs` no reply followed. */
  readonly unfinished: ReadonlySet<string>
  readonly questions: readonly SettledQuestion[]
  /** A stage's first reply row, or -1 while its exchange holds none. */
  readonly replyRow: number
  /** On the dormant tail: how many exchanges it holds. */
  readonly exchanges?: number
  /** The live run, on the live card. */
  readonly piece?: RoutePiece
  /** The depth column and the grid row, both 0-based; `level` is ARIA's. */
  readonly x: number
  readonly y: number
  readonly level: number
  /** The effective parent's node id — absent on the main line. */
  readonly parent?: string
  /** The first VISIBLE child's key, where → walks. */
  readonly firstChild?: string
  /** Among the visible siblings; the roots and the tail are one level-1 set. */
  readonly setSize: number
  readonly posInSet: number
  /** Drawn nodes beneath, folded or not, and whether they are folded away. */
  readonly descendants: number
  readonly collapsed: boolean
  /** The pipe INTO this card comes after an open question: not flowing yet. */
  readonly dashed: boolean
  readonly joint: readonly RouteSeg[]
  /** The joint's sides as the DOM carries them — `n`, `w d`. */
  readonly jointSides: string
  readonly stem: RouteSeg | null
}

/** Where the current step came from (§4.4.3). A press, a key or a span chip
 *  holds until the participant scrolls the thread; reading never holds. */
type RouteSource = 'press' | 'key' | 'span' | 'thread'

/** The sidebar as drawn: the cards, the free pipe cells between them, and
 *  what the pane needs of the tree beyond the visible cards — every drawn
 *  node, its effective parent, and its children folded or not. */
type RouteTree = {
  readonly items: readonly RouteItem[]
  readonly pipes: readonly RoutePipe[]
  readonly cols: number
  readonly rows: number
  readonly nodes: ReadonlyMap<string, RouteFlowNode>
  readonly parentOf: ReadonlyMap<string, string>
  readonly kids: ReadonlyMap<string, readonly string[]>
}

// ── THE TREE, pure (chat-route.md §4.2, §4.4.5) ────────────────────────────
//
// Module scope and no component state. The layout cannot live in essentials —
// folds are the participant's live view, and shared never imports essentials —
// and pure functions are what the worked layouts of §4.2.3 are checked
// against. Exported for that reason only.

/** One branch step, in rem — `$indent` in chat-route.scss. */
export const ROUTE_INDENT_REM = 1.75

/** The narrowest a card gets, in rem — `$card-min` in chat-route.scss. With
 *  the depth cap, 2 × ROUTE_INDENT_REM + ROUTE_CARD_MIN_REM = 12.5rem is the
 *  widest the canvas ever needs: at the 12rem column minimum a depth-3 branch
 *  pans about half a rem, and at every other width nothing pans at all. */
export const ROUTE_CARD_MIN_REM = 9

export type RouteSide = 'n' | 'e' | 's' | 'w'
export type RouteSeg = { readonly side: RouteSide | 'd'; readonly dashed: boolean }
export type RoutePipe = {
  readonly key: string
  readonly x: number
  readonly y: number
  /** The cell's sides as the DOM carries them — `n e s`. */
  readonly sides: string
  readonly segs: readonly RouteSeg[]
}

export type RouteTreeLayout = {
  /** The visible nodes in preorder — DOM order, key order and visual order. */
  readonly order: readonly string[]
  readonly place: ReadonlyMap<string, { readonly x: number; readonly y: number; readonly level: number }>
  readonly roots: readonly string[]
  /** The effective parent of every drawn node that has one. */
  readonly parentOf: ReadonlyMap<string, string>
  /** Every drawn node's children in record order, folded or not. */
  readonly kids: ReadonlyMap<string, readonly string[]>
  readonly descendants: ReadonlyMap<string, number>
  readonly treeRows: number
  /** Indent tracks + 1 — `data-route-cols`. */
  readonly cols: number
}

/** The deepest column a card takes. The record caps depth at 3, so x is 0–2
 *  and the canvas has at most three tracks: one CSS rule per count. */
const ROUTE_MAX_X = 2

/**
 * PLACE THE TREE (§4.2.1–§4.2.2). `nodes` are the flow's nodes in record
 * order, with `drawn` false for one that covers no turn below the rendered
 * length. A drawn node hangs from its nearest DRAWN ancestor, and with none it
 * is a root. Every card is its own row in preorder — a task, then its
 * branches (each followed by its own), then the task's next sibling — at
 * x = depth. A folded node's children are not visited: the rows below move up
 * and nothing is reserved, because reserved empty space reads as a missing
 * branch. The same input always gives the same coordinates, so a re-derived
 * flow that keeps its ids does not jump. The tail follows at x = 0 from
 * `treeRows`.
 */
export const layoutRouteTree = (
  nodes: readonly { readonly id: string; readonly parent?: string; readonly drawn?: boolean }[],
  folded: ReadonlySet<string>,
): RouteTreeLayout => {
  const index = new Map<string, number>()
  nodes.forEach((node, at) => { if (!index.has(node.id)) index.set(node.id, at) })
  const byId = new Map<string, (typeof nodes)[number]>()
  for (const node of nodes) if (!byId.has(node.id)) byId.set(node.id, node)
  const parentOf = new Map<string, string>()
  const depthOf = new Map<string, number>()
  const kids = new Map<string, string[]>()
  const roots: string[] = []
  nodes.forEach((node, at) => {
    if (node.drawn === false || index.get(node.id) !== at) return
    // The nearest drawn ancestor. A parent must come EARLIER in record order:
    // a later one is not a parent this pass has placed, and following it
    // could loop on a malformed record.
    let parent: string | undefined
    let id = node.parent
    for (let hops = 0; id !== undefined && hops < nodes.length; hops++) {
      const up = byId.get(id)
      if (!up || (index.get(id) ?? at) >= at) break
      if (depthOf.has(id)) { parent = id; break }
      id = up.parent
    }
    // Deeper than the cap re-hangs one level up: the canvas has three tracks.
    while (parent !== undefined && (depthOf.get(parent) ?? 0) >= ROUTE_MAX_X) parent = parentOf.get(parent)
    depthOf.set(node.id, parent === undefined ? 0 : (depthOf.get(parent) ?? 0) + 1)
    if (parent === undefined) { roots.push(node.id); return }
    parentOf.set(node.id, parent)
    const siblings = kids.get(parent) ?? []
    siblings.push(node.id)
    kids.set(parent, siblings)
  })
  const descendants = new Map<string, number>()
  for (const id of depthOf.keys()) {
    for (let up = parentOf.get(id); up !== undefined; up = parentOf.get(up)) {
      descendants.set(up, (descendants.get(up) ?? 0) + 1)
    }
  }
  const order: string[] = []
  const place = new Map<string, { x: number; y: number; level: number }>()
  const visit = (id: string, depth: number): void => {
    place.set(id, { x: depth, y: order.length, level: depth + 1 })
    order.push(id)
    if (folded.has(id)) return
    for (const child of kids.get(id) ?? []) visit(child, depth + 1)
  }
  for (const root of roots) visit(root, 0)
  let indents = 0
  for (const at of place.values()) indents = Math.max(indents, at.x)
  return { order, place, roots, parentOf, kids, descendants, treeRows: order.length, cols: indents + 1 }
}

/**
 * THE CONNECTORS (§4.2.4). `cards` are every card with its grid cell and its
 * parent's KEY — absent on the main line. A trunk runs down the parent's
 * column from the parent to each child, with an elbow into it; the spine runs
 * down column 0 through every main-line card, the tail included. The trunk is
 * always in free cells: every row between a parent and its child holds a
 * deeper descendant, so the parent's column is free there, and column 0 is
 * free on every branch's row. A mark on a card's own cell sets its joint (n,
 * w) or its stem (s); anywhere else it is a free cell. Solid wins a merge, so
 * the pipe flows up to the first card that is not flowing yet. A card whose
 * joint has w and no n gets a d, from the bus down to its square.
 */
export const routePipes = (
  cards: readonly { readonly key: string; readonly x: number; readonly y: number; readonly parent?: string; readonly dashed: boolean }[],
): {
  readonly joints: ReadonlyMap<string, readonly RouteSeg[]>
  readonly stems: ReadonlyMap<string, RouteSeg>
  readonly pipes: readonly RoutePipe[]
} => {
  const cardAt = new Map(cards.map(card => [`${card.x},${card.y}`, card]))
  const byKey = new Map(cards.map(card => [card.key, card]))
  const joints = new Map<string, Map<RouteSide, boolean>>()
  const stems = new Map<string, boolean>()
  const free = new Map<string, { readonly x: number; readonly y: number; readonly sides: Map<RouteSide, boolean> }>()
  const merge = (previous: boolean | undefined, dashed: boolean): boolean =>
    previous === undefined ? dashed : previous && dashed
  const mark = (x: number, y: number, side: RouteSide, dashed: boolean): void => {
    const card = cardAt.get(`${x},${y}`)
    if (card && side === 's') { stems.set(card.key, merge(stems.get(card.key), dashed)); return }
    let sides: Map<RouteSide, boolean>
    if (card) {
      sides = joints.get(card.key) ?? new Map()
      joints.set(card.key, sides)
    } else {
      const key = `p:${x},${y}`
      const cell = free.get(key) ?? { x, y, sides: new Map<RouteSide, boolean>() }
      free.set(key, cell)
      sides = cell.sides
    }
    sides.set(side, merge(sides.get(side), dashed))
  }
  const connectV = (x: number, fromY: number, toY: number, dashed: boolean): void => {
    mark(x, fromY, 's', dashed)
    for (let y = fromY + 1; y < toY; y++) { mark(x, y, 'n', dashed); mark(x, y, 's', dashed) }
    mark(x, toY, 'n', dashed)
  }
  for (const child of cards) {
    const parent = child.parent === undefined ? undefined : byKey.get(child.parent)
    if (!parent) continue
    connectV(parent.x, parent.y, child.y, child.dashed)
    mark(parent.x, child.y, 'e', child.dashed)   // the elbow: a child is always one column in
    mark(child.x, child.y, 'w', child.dashed)
  }
  const spine = cards
    .filter(card => card.parent === undefined || !byKey.has(card.parent))
    .sort((a, b) => a.y - b.y)
  for (let at = 1; at < spine.length; at++) connectV(0, spine[at - 1]!.y, spine[at]!.y, spine[at]!.dashed)

  const SIDES: readonly RouteSide[] = ['n', 'e', 's', 'w']
  const segsOf = (sides: ReadonlyMap<RouteSide, boolean>): RouteSeg[] =>
    SIDES.filter(side => sides.has(side)).map(side => ({ side, dashed: sides.get(side)! }))
  const outJoints = new Map<string, readonly RouteSeg[]>()
  for (const [key, sides] of joints) {
    const segs = segsOf(sides)
    if (sides.has('w') && !sides.has('n')) segs.push({ side: 'd', dashed: sides.get('w')! })
    outJoints.set(key, segs)
  }
  const outStems = new Map<string, RouteSeg>()
  for (const [key, dashed] of stems) outStems.set(key, { side: 's', dashed })
  const pipes = [...free.entries()]
    .map(([key, cell]): RoutePipe => {
      const segs = segsOf(cell.sides)
      return { key, x: cell.x, y: cell.y, sides: segs.map(seg => seg.side).join(' '), segs }
    })
    .sort((a, b) => a.y - b.y || a.x - b.x)
  return { joints: outJoints, stems: outStems, pipes }
}

/** The maximal runs of consecutive rows — `[3, 4, 5, 9]` → `[[3, 4, 5], [9]]`.
 *  A node's rows can be non-contiguous: its order is rational, not
 *  chronological. */
export const spansOf = (rows: readonly number[]): number[][] => {
  const sorted = [...new Set(rows)].filter(row => Number.isInteger(row)).sort((a, b) => a - b)
  const spans: number[][] = []
  for (const row of sorted) {
    const last = spans[spans.length - 1]
    if (last && last[last.length - 1] === row - 1) last.push(row)
    else spans.push([row])
  }
  return spans
}

/**
 * WHICH STEP IS BEING READ (§4.4.5). `anchor` is the thread row at the top of
 * the reading band, or the last row while the thread is at its bottom.
 *
 * - Inside the flow: the node owning the anchor's exchange, `newer` 0.
 * - Past the flow: the NEWEST organized step — the owner of the last mapped
 *   exchange — with `newer`, how many exchanges start at or after the flow's
 *   end. The last exchange stays unorganized until the thread has gone quiet,
 *   so choosing its dormant stage would put "not organized yet" in the pane
 *   the whole time the participant chats. A dormant stage becomes current
 *   only by a press or a key.
 * - No flow: the stage whose exchange holds the anchor.
 *
 * A folded node maps to its nearest visible ancestor, and the fold stays as it
 * is. An empty key changes nothing.
 */
export const routeKeyForRow = (
  flow: {
    readonly upToTurnCount: number
    readonly nodes: readonly { readonly id: string; readonly parent?: string; readonly turns: readonly number[]; readonly exchanges?: readonly number[] }[]
  } | undefined,
  items: readonly { readonly key: string; readonly kind: string; readonly row: number }[],
  rows: readonly { readonly index: number; readonly turn: { readonly role: string } }[],
  anchor: number,
): { readonly key: string; readonly newer: number } => {
  const shown = new Set(items.map(item => item.key))
  const nodes = flow?.nodes ?? []
  const byId = new Map(nodes.map(node => [node.id, node]))
  const visible = (id: string | undefined): string => {
    let at = id
    for (let hops = 0; at !== undefined && hops <= nodes.length; hops++) {
      if (shown.has(`n:${at}`)) return `n:${at}`
      at = byId.get(at)?.parent
    }
    return ''
  }
  const organized = flow && nodes.some(node => shown.has(`n:${node.id}`))
    ? Math.min(flow.upToTurnCount, rows.length)
    : 0
  if (organized > 0) {
    // The assignment gives every organized turn exactly one owner. An older
    // record listed turns rather than whole exchanges; there the nearest
    // covered turn above stands in for it.
    const ownerOf = (row: number): string | undefined => {
      const exact = nodes.find(node => node.turns.includes(row))
      if (exact) return exact.id
      let best: string | undefined
      let nearest = -1
      for (const node of nodes) for (const turn of node.turns) if (turn <= row && turn > nearest) { nearest = turn; best = node.id }
      return best
    }
    if (anchor < organized) return { key: visible(ownerOf(anchor)), newer: 0 }
    let newest: string | undefined
    let last = 0
    for (const node of nodes) for (const exchange of node.exchanges ?? []) if (exchange > last) { last = exchange; newest = node.id }
    const newer = rows.filter(row => row.index >= organized && row.turn.role === 'user').length
    return { key: visible(newest ?? ownerOf(organized - 1)), newer }
  }
  let key = ''
  for (const item of items) if (item.kind === 'stage' && item.row <= anchor) key = item.key
  return { key, newer: 0 }
}

/** WHY NO MODEL IS RUNNING, as the pane says it (§4.4.2) — by literal key so
 *  the catalogs' drift check sees every one. The probe states the shell
 *  already names reuse its own lines. Absent on an older essentials build:
 *  no line. */
const routeWhyKey = (state: RouteOrganizerState | undefined): string | null => {
  switch (state) {
    case 'off': return 'chat.route.summary.local.off'
    case 'unknown': return 'chat.route.summary.local.unknown'
    case 'asleep': return 'chat.link.local.down'
    case 'blocked': return 'chat.link.local.blocked'
    case 'needs-permission': return 'chat.link.local.permission'
    case 'empty': return 'chat.route.summary.local.empty'
    case 'no-model': return 'chat.route.summary.local.choose'
    default: return null
  }
}

type ConversationSummary = {
  readonly convoId: string
  readonly title: string
  readonly turnCount: number
  readonly lastAt: number
  /** PUT AWAY — kept whole, taken out of the list. Optional because an older
   *  essentials build has no archive at all, and there every thread is live. */
  readonly archived?: boolean
  readonly goal?: { readonly details: string; readonly at: number }
  /** HAS ANYTHING COME BACK? A sent question with no answer yet is a real
   *  conversation with no subject, so it is named by what it is doing rather
   *  than by the line you opened with. Optional because an older essentials
   *  build does not report it — and there, every thread reads as answered,
   *  which is exactly how this behaved before the flag existed. */
  readonly replied?: boolean
}

/** The threads module, reached through IoC — shell may never import essentials. */
type ChatThreadsLike = {
  appendTurn(convoId: string, role: TurnRole, text: string): Promise<boolean>
  readTurns(convoId: string): Promise<ChatTurn[]>
  listConversations(): Promise<ConversationSummary[]>
  /** One pass for the list AND the newest thread's turns — the resume path's
   *  read, so opening never re-reads the bucket the list walk just read. */
  listConversationsWithLatest?(): Promise<{ conversations: ConversationSummary[]; latestTurns: ChatTurn[] }>
  deleteConversation(convoId: string): Promise<boolean>
  /** Put a conversation away, or bring it back. Absent on an older essentials
   *  build — the control is hidden rather than dead when it is (see
   *  `canArchive`). */
  setConversationArchived?(convoId: string, archived: boolean): Promise<boolean>
  newConvoId(): string
  /** A tile's conversation id, derived from its path — every tile has one,
   *  dormant until something lands in it. Absent on an older essentials
   *  build, and then the sidebar simply opens free-floating chats. */
  tileConvoId?(segments: readonly string[]): string
  /** ANOTHER conversation about the same location — a tile is a subject, not
   *  one thread. Absent on an older essentials build; then a conversation
   *  started from an annotation is a free chat, which still carries the
   *  picture, it just is not filed under the tile. */
  newTileConvoId?(segments: readonly string[], seed?: string): string
  tilePath?(segments: readonly string[]): string
  tilePathOf?(convoId: string): string
  /** Unsent thinking, stored the moment it is typed and activating nothing. */
  readTileDraft?(path: string): Promise<string>
  saveTileDraft?(path: string, text: string): Promise<boolean>
  /** Read-marker for the list's unread mark. Per DEVICE, not per hive. */
  markConversationSeen?(convoId: string, at?: number): void
  /** Every held draft, so the roster can list what has no turns yet. */
  listTileDrafts?(): Promise<ReadonlyArray<{ path: string; text: string }>>
  /** IN-FLIGHT ANSWERS, written down while they arrive. A streamed answer is
   *  only a turn once its last chunk lands, so the partial is checkpointed as
   *  it accumulates and recovered on the next boot — otherwise a reload
   *  mid-answer takes the whole thing, including the half already read.
   *  Absent on an older essentials build: then the run is still durable
   *  against everything except the page going away. */
  saveStreamCheckpoint?(convoId: string, text: string): Promise<boolean>
  listStreamCheckpoints?(): Promise<ReadonlyArray<{ convoId: string; text: string; at: number }>>
  recoverStreamCheckpoints?(live?: ReadonlySet<string>): Promise<number>
  /** THE ROUTE'S WORK, read from the run ledger (chat-route.md §3.5). A
   *  method, not a field. The second argument is the LIVE RUN's id — the
   *  run the outstanding ask is making, `runIdForAsk(pendingSig)` — so its
   *  piece lands in the wait row rather than being placed by time. Resolves
   *  to an empty route for a conversation with no bucket and THROWS on a
   *  read fault, which is the one case that earns the notice line. Absent
   *  on an older essentials build: then the column shows junctions only,
   *  no notice. */
  readRoute?(convoId: string, liveRunId?: string): Promise<Route>
  /** The run an ask records under — `'ask:' + sha256(askSig)…` — which is
   *  the module's rule, not the shell's: the shell holds the outstanding
   *  ask's SIGNATURE and needs the module to say which run that is. Absent
   *  on a build that has not exposed it; then the route is read without a
   *  live run and the outstanding run is placed by the ledger's own rules. */
  runIdForAsk?(askSig: string): Promise<string>
  /** Mint the conversation's flow with the participant's OWN machine-local
   *  model (chat-route.md §3.5) — only when that model is already known awake,
   *  never a probe. `prefer` names the node the participant is looking at: its
   *  card, and the uncarded branches beneath it, are written first. No model
   *  call starts while `waiting`, or while the lane is paused after the
   *  participant's own local chat; a refused call resolves 0, reads nothing
   *  and emits nothing. A write announces `chat:route-flow-changed
   *  { convoId }`. Absent on an older essentials build: then every exchange
   *  stays dormant. */
  organizeRoute?(convoId: string, liveRunId?: string, waiting?: boolean, prefer?: string): Promise<number>
}

type QueenLike = {
  activeModel: string
  /** The queued ask's record SIGNATURE — what withdrawing it needs. Older
   *  essentials builds (hypercomb-web loads its bees from OPFS, so the module
   *  can lag the shell) return a bare boolean; then the ask is still queued,
   *  it simply cannot be taken back from here. */
  submitChat(
    convoId: string,
    message: string,
    targets: string[],
    transcript: ReadonlyArray<{ role: string; text: string }>,
    /** The references this request carries. An older essentials build ignores
     *  the argument and the ask simply carries less. */
    references?: readonly { kind: string; sig: string; label: string }[],
  ): Promise<string | boolean | null>
}

type LineageLike = { explorerSegments?(): readonly string[] }
type SelectionLike = { selected: ReadonlySet<string> }

/** The tiles rail — the full-screen view's left sidebar for choosing tiles.
 *  It lives in essentials (assistant/agent-tiles-rail.ts) and shared must
 *  never import essentials, so it arrives structurally through the factory
 *  it registers in IoC. */
type RailPickLike = {
  readonly key: string
  readonly path: readonly string[]
  readonly name: string
  readonly sig?: string
  readonly convoId?: string
  /** What the signature points at: one layer, a whole context group, or —
   *  when it is a media type — a picture attached to the question. */
  readonly kind?: string
  /** Bytes, for an attached picture. Absent for a tile: a tile's weight is
   *  not a fact about the reference. */
  readonly size?: number
}

/** A tile dragged out of the sidebar. The CONTRACT with essentials is this
 *  mime type and this shape — the shell may never import the module that
 *  sends it, so the wire is a string, not a type. */
/** WHAT AN ANNOTATION SENDS. The sheet stores the bytes and hands over a
 *  reference plus WHERE it was drawn; `fresh` asks for a new conversation on
 *  that location rather than a line on the open one's shelf. */
type AttachedPicture = {
  sig?: string
  name?: string
  kind?: string
  size?: number
  open?: boolean
  path?: readonly string[]
  fresh?: boolean
  /** An annotation cut into parts: every picture in ONE landing. Separate
   *  landings would race a fresh conversation emptying the shelf, and the bus
   *  replays only the last of them to a late subscriber. */
  pictures?: readonly AttachedPicture[]
}

export const TILE_DRAG_TYPE = 'application/x-hypercomb-tile'
export type DroppedTile = { readonly name: string; readonly path: string; readonly sig: string }
type TilesRailLike = {
  showConversation?(convoId: string): void
  onSubjectChanged: (subject: RailPickLike | null) => void
  onSelectionChanged: (selection: RailPickLike[]) => void
  readonly subject: RailPickLike | null
  /** Start ANOTHER conversation on the tile in hand, and list it there.
   *  False when no tile is in hand. Absent on an older essentials build —
   *  then the window mints a free chat as it always did. */
  newChatOnSubject?(): boolean
  /** Tiles ctrl-clicked as context, and the signatures they resolve to. */
  readonly selection: RailPickLike[]
  readonly selectionSigs: string[]
  mount(host: HTMLElement): void
  clearSubject(): void
  clearSelection(): void
  dispose(): void
}
type TilesRailFactoryLike = { create?: () => TilesRailLike }
type BridgeLike = { connected?: boolean }
type NavigationLike = { goRaw?(segments: readonly string[]): void }

/** The optimization pool, over the shared Store — the durable inbox a queued
 *  ask lives in until a Claude session drains it. Withdrawing is removing it. */
type StoreLike = {
  removeOptimization?(signature: string): Promise<boolean>
  putOptimization?(blob: Blob): Promise<string>
  /** THE DURABLE INBOX, read back. A queued question is a record in the
   *  optimization pool; reading them is how a reloaded window learns which of
   *  its conversations are still waiting on an answer. */
  listOptimizations?(): Promise<string[]>
  getOptimization?(signature: string): Promise<Blob | null>
  /** Content in, signature out — the same address a layer or a note gets.
   *  An image dropped into a question is content like any other. */
  putResource?(blob: Blob): Promise<string>
  getResource?(sig: string): Promise<Blob | null>
}

/** The notes module (notes/notes.drone.ts), over IoC. `addAtSegments` takes an
 *  EXPLICIT path — the `note:commit` effect writes to a child of wherever the
 *  participant is standing, which is not necessarily the tile they meant. */
type NotesLike = {
  addAtSegments?(
    parentSegments: readonly string[],
    cellLabel: string,
    text: string,
    shape?: unknown,
    mark?: string | null,
  ): Promise<void>
}

/** The host's AI — the SHALLOW immediate tier (assistant/host-ai.service.ts):
 *  a streamed answer from the operator's domain, no bridge involved. It is
 *  what `/ask` used before it folded in here, and its own header names "a
 *  future chat sheet" as a surface that should render it. `contextSigs` is the
 *  parameter it always accepted and nothing ever passed — the tile's attached
 *  context, capped host-side. */
type HostAiLike = {
  readonly configured?: boolean
  ask?(
    question: string,
    opts?: { contextSigs?: readonly string[]; signal?: AbortSignal },
  ): AsyncGenerator<string, string, void>
  /** Set (or clear with '') the participant's AI host — the guided setup's
   *  host door calls this instead of telling people to type a command. */
  setHost?(domain: string): void
}

/** WHO ANSWERS, decided by the participant's standing instructions rather
 *  than by a control in this window (assistant/model-policy.ts, over IoC —
 *  the shell may never import a module). `model` is the WIRE ID: the ask
 *  hint the bridge roster resolves, and the one string a model bee's vendor
 *  family and tier shade are read off. `tier` is the level of thinking the
 *  designation was made for, DECLARED by the provider. */
type ChatNeed = { tier?: string; readsHive?: boolean; streaming?: boolean; viaAsk?: boolean }

type PolicyLike = {
  designate?(need: ChatNeed): DesignationLike | undefined
  /** What a chat turn needs, owned by the policy. Absent on an older
   *  essentials build, which is why the caller keeps a fallback. */
  readonly chatNeed?: ChatNeed
}

type DesignationLike = {
  readonly providerId: string
  readonly label: string
  readonly vendor: string
  readonly tier: string
  readonly model: string
  readonly name: string
}

type RoutedChunkLike = {
  readonly text: string
  readonly toolCalls?: readonly HypercombToolCall[]
  readonly providerId: string
  readonly providerLabel: string
  readonly vendor: string
  readonly model: string
}

/** The native beehavior census/executor, reached through IoC so the shared
 * shell does not import essentials. Model output is validated against
 * `entries()` before this direct execution seam is ever called. */
type SlashBehaviourDroneLike = {
  entries?(): readonly HypercombBehaviour[]
  executePublicCanonical?(command: string, args: string): Promise<void> | void
}

type LlmMessageLike =
  | {
    readonly role: 'user' | 'assistant'
    readonly content: string
    readonly toolCalls?: readonly HypercombToolCall[]
  }
  | { readonly role: 'tool'; readonly content: string; readonly toolCallId: string }

type LlmRouterLike = {
  ready?(call?: { providerId?: string; model?: string; preferModel?: string; need?: { tier?: string; streaming?: boolean } }): boolean
  providerIdForModel?(model: string): string | undefined
  providerIsMachineLocal?(providerId: string): boolean
  providerMachineEndpoint?(providerId: string): string | undefined
  /** Why nothing can answer, as a token this shell turns into words of its
   *  own. The router never sends a sentence: the catalog owns the language. */
  reason?(): string
  stream?(call: {
    providerId?: string
    model?: string
    preferModel?: string
    need?: { tier?: string; streaming?: boolean }
    messages: readonly LlmMessageLike[]
    system?: string
    tools?: readonly HypercombFunctionTool[]
    maxTokens?: number
    signal?: AbortSignal
  }): AsyncGenerator<RoutedChunkLike>
}

/** The tile-context module (assistant/tile-context.ts), over IoC — the shell
 *  may never import essentials. `branchesFor` is the cheap synchronous count
 *  for the status chip; `signaturesFor` is the resolved union an ask carries. */
type TileContextLike = {
  branchesFor?(segments: readonly string[]): readonly string[][]
  signaturesFor?(segments: readonly string[]): Promise<readonly string[]>
}

/** The command line's bracket syntax passes the SHORT op — `[tile]/o ask me`
 *  sets the model to `o` (command-line.component.ts, the opus/sonnet/haiku
 *  branch). Unmapped, that is silently not a model and the request quietly
 *  lands on whatever tier the conversation was already in. */
const MODEL_ALIASES: Record<string, string> = { o: 'opus', s: 'sonnet', h: 'haiku', f: 'fable' }

/** Which model each conversation was last held in, participant-local. Per
 *  CONVERSATION, not global: a thread is about one thing, and the tier you
 *  chose for it is part of what you set up. */
const MODEL_KEY = 'hc:chat-models'
const HOST_TIER_MODEL = 'haiku'
const RAIL_WIDTH_KEY = 'hc:chat-rail-width'
const RAIL_MIN = 180
const RAIL_MAX = 640
const CONVERSATION_MIN = 260

const readRailWidth = (): number => {
  try {
    const raw = Number(localStorage.getItem(RAIL_WIDTH_KEY) ?? '')
    return Number.isFinite(raw) && raw >= RAIL_MIN ? Math.min(RAIL_MAX, raw) : 0
  } catch { return 0 }
}

/** The workflow sidebar's dragged width (chat-route.md §4.3.1). 0 = never
 *  dragged: the stylesheet's clamp decides. Its floor is the column's own
 *  `min-width` (12rem); its ceiling is measured against the split when set. */
const ROUTE_SIDE_WIDTH_KEY = 'hc:chat-route-side-width'
const ROUTE_SIDE_MIN_REM = 12
const ROUTE_SIDE_WANTED_KEY = 'hc:chat-route-side'

const readRouteSideWanted = (): boolean => {
  try { return localStorage.getItem(ROUTE_SIDE_WANTED_KEY) !== 'false' } catch { return true }
}

const readRouteSideWidth = (): number => {
  try {
    const raw = Number(localStorage.getItem(ROUTE_SIDE_WIDTH_KEY) ?? '')
    return Number.isFinite(raw) && raw > 0 ? Math.round(raw) : 0
  } catch { return 0 }
}
const DEFAULT_MODEL = 'auto'

/** Turns carried to a stateless responder. The stored thread can be any
 *  length; this is the window into it the ask record can afford. */
const TRANSCRIPT_TURNS = 12

/** How long the composer waits after the last keystroke before the thinking
 *  is written down. Long enough that a sentence is one write, short enough
 *  that a hand leaving the keyboard has already been saved. */
const DRAFT_HOLD_MS = 500
const HOST_AI_IOC_KEY = '@diamondcoreprocessor.com/HostAi'
const LLM_ROUTER_IOC_KEY = '@diamondcoreprocessor.com/LlmRouter'
const HIVE_TREE_READER_IOC_KEY = '@diamondcoreprocessor.com/HypercombHiveTreeReader'
const MAX_OBSERVATION_ROUNDS = 3
const MAX_OBSERVATION_CONTEXT_CHARS = 24_000
const hypercombPlanQueue = new HypercombPlanQueue()

/** How far back a pending ask record may reach and still be shown as waiting.
 *  Matches the agent registry's give-up window: past it nobody is coming, and
 *  a clock still ticking would be a lie rather than a reassurance. */
const RECOVER_MAX_AGE_MS = 45 * 60_000

/** How much of the durable inbox a recovery pass reads. Same bound the
 *  registry's own seed uses. */
const RECOVER_SCAN_LIMIT = 400
const CHAT_VISIBLE_STORAGE_KEY = 'hc:chat-visible'
/** The masthead's "where it stands" sentence, pinned open. Off by default —
 *  collapsed to its icon, peeking on hover — and sticky once turned on: the
 *  participant opens it once and it stays open across reloads until they
 *  close it again the same way (see feedback_hiding_chrome_is_opt_in_sticky). */
const STANDS_OPEN_KEY = 'hc:chat-mast-stands-open'

/** How close to the bottom still counts as reading the newest turn. Below it,
 *  the transcript stops chasing arrivals and offers the pill instead. One line
 *  of slack, so a stray wheel notch does not unpin the view. */
const NEAR_BOTTOM_PX = 56

/** The waiting row's clock. One second is the resolution people read; anything
 *  finer is a flicker and anything coarser feels stopped. */
const ELAPSED_TICK_MS = 1_000

/** Rendered turns are memoized by their text — a thread of 200 turns must not
 *  re-parse every one of them each time a chunk lands. Bounded, because a long
 *  session's cache is otherwise a slow leak of everything ever said. */
const RENDER_CACHE_MAX = 240

/** How long a refresh hint waits for its neighbours before the bucket is
 *  re-read. A run lands its steps in bursts, and `agent:step` fires per
 *  step; one read per burst is the honest cost, one per step is not. */
const ROUTE_REFRESH_MS = 150

/** The keymap suppression reasons this window holds while its own keys are
 *  in use. Two, not one: the wizard and the sidebar each hold and release on
 *  their own focus, and a shared reason would let one release the other's.
 *  Reason-keyed exactly as the command palette and the layout designer do it. */
const QUESTION_KEYS_REASON = 'chat-question'
const ROUTE_KEYS_REASON = 'chat-route'

/** How far the pointer travels before a press on the sidebar becomes a PULL.
 *  Under it the press is still a click on the card it started on. */
const ROUTE_PULL_PX = 4

/** A pull locks to one axis when it travels at least this many times further
 *  along it than across, so a vertical pull does not drift sideways where a
 *  narrow sidebar can pan. */
const ROUTE_AXIS_LOCK = 2

/** The tree follows the newest card only while it is at its bottom AND its
 *  inline start — the newest cards live in column 0 at the bottom, and a
 *  participant who panned right or scrolled up to read is never yanked back.
 *  This is how close counts as there, on either edge. */
const ROUTE_SIDE_BOTTOM_PX = 8

/** A tree reveal the THREAD caused waits this long after any pan by the
 *  participant: someone panning the tree is never fought. */
const ROUTE_PAN_HOLD_MS = 2000

/** Where a steer lands the first covered message — this far below the
 *  thread's top, in rem. The tree's reveals keep the same margin. */
const ROUTE_STEER_MARGIN_REM = 0.75

/** A steer is smooth only when it travels at most this many screens, and never
 *  under reduced motion: a long smooth flight through a thread is exactly the
 *  flashy effect this window avoids. */
const ROUTE_SMOOTH_SCREENS = 2

/** A steer ends on `scrollend`, or once no scroll event has come for this
 *  long, and never outlasts the cap. */
const ROUTE_STEER_QUIET_MS = 160
const ROUTE_STEER_MAX_MS = 1200

/** Walking the tree with the keys moves the thread only once the walk rests. */
const ROUTE_KEY_SETTLE_MS = 250

/** Reverse sync applies once the reading band has been still this long. */
const ROUTE_SYNC_MS = 120

/** The reading band, as fractions of the thread's height from its top. A
 *  covered row inside it is already on screen, and a press moves nothing. The
 *  reading observer's rootMargin (`-8% 0px -60% 0px`) is the same band. */
const ROUTE_BAND = { top: 0.08, bottom: 0.40 } as const

/** A node whose card is missing or stale, once it has been current this long,
 *  is passed to `organizeRoute` as `prefer`: its card is written first. */
const ROUTE_SUMMARY_ASK_MS = 700

/** The participant's own scroll keys — any of them inside the thread cancels
 *  a steer, as a wheel or a touch does. */
const ROUTE_STEER_KEYS: ReadonlySet<string> = new Set([
  'PageUp', 'PageDown', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', ' ',
])

/** The root font size in px, for the few measurements rem cannot make. */
const remPx = (): number => parseFloat(getComputedStyle(document.documentElement).fontSize) || 16

/** A scroll offset the element can actually reach. */
const clampScroll = (value: number, max: number): number => Math.max(0, Math.min(Math.max(0, max), value))

// ── guided setup ─────────────────────────────────────────────────────────
//
// The setup state is a CHECKLIST, not a notice. Each step verifies itself
// where reality can be asked: enabling flips the config gate, the broker
// step completes on the worker's own `bridge:status`, and the last step
// completes only when a real answer lands — the checklist is done exactly
// when the loop is proven. Only the tools step takes the participant's word.
/** Set once the whole checklist has been completed (or skipped). */
const SETUP_DONE_KEY = 'hc:bridge-setup-done'

/** The rail is on screen above this width — the twin of the `max-width: 700px`
 *  rule in the stylesheet, where the sidebar is hidden because a narrow shell
 *  has no room beside a conversation. Kept next to nothing else so the two
 *  numbers are one edit apart. */
const RAIL_QUERY = '(min-width: 701px)'

/** The most a single attached picture may weigh. A phone screenshot is ~2 MB;
 *  past this it is a file to keep in the hive deliberately, not something to
 *  staple to one question. */
const IMAGE_MAX_BYTES = 12 * 1024 * 1024
/** The one manual step — "I have Claude Code and the repo". */
const SETUP_TOOLS_KEY = 'hc:bridge-setup-tools'
/** A bridge answer has landed at least once — the loop is proven. */
const FIRST_REPLY_KEY = 'hc:bridge-first-reply'
/** A configured-but-down bridge re-dials on this cadence, so "start the
 *  broker" checks itself off with zero clicks. The worker's connect() is
 *  idempotent and silent, so the retry costs one refused socket at most. */
const BRIDGE_RETRY_MS = 4_000

const readFlag = (key: string): boolean => {
  try { return globalThis.localStorage?.getItem(key) === '1' } catch { return false }
}
const writeFlag = (key: string): void => {
  try { globalThis.localStorage?.setItem(key, '1') } catch { /* session-local */ }
}

/** WHAT WAS SHOWING when the page was last left wins on later page loads.
 *  Not what was intended: the shell parks this window on Escape and whenever
 *  another tool window opens, and a reload must agree with the screen the
 *  participant walked away from (see `session` below).
 *  With no choice yet, preserve the configured local bridge's companion-view
 *  default. Storage can be unavailable in private/locked-down browsers. */
const rememberedChatVisibility = (fallback: boolean): boolean => {
  try {
    const stored = globalThis.localStorage?.getItem(CHAT_VISIBLE_STORAGE_KEY)
    if (stored === '1') return true
    if (stored === '0') return false
  } catch { /* use the first-run fallback */ }
  return fallback
}

const rememberChatVisibility = (visible: boolean): void => {
  try { globalThis.localStorage?.setItem(CHAT_VISIBLE_STORAGE_KEY, visible ? '1' : '0') }
  catch { /* visibility remains sticky for this in-memory session */ }
}

const ioc = (): { get(k: string): unknown } | undefined =>
  (globalThis as { ioc?: { get(k: string): unknown } }).ioc

/** This window's name in the owner-counted `view:active` mode. */
const SURFACE_OWNER = 'chat-window'

/** THE VIEW THAT LEAVES THE BAR ITS EDGE.
 *
 *  `view:active` means "a view is covering the canvas, put the chrome away",
 *  and the control bar obeys it by hiding — correct for a takeover, wrong for
 *  this window. The chat covers the canvas but stops at the bar's reservation
 *  (see the stylesheet's `--hc-controls-left` / `--hc-controls-right`), so the
 *  bar has a place to be, and hiding it only cost the participant every control
 *  on it for as long as a conversation was open.
 *
 *  A second owner-counted mode says so, rather than the bar learning this
 *  window's name: any view that leaves the bar its edge can hold it, and the
 *  bar stays while ANY owner does. Claimed and released in lockstep with
 *  `view:active` — the fold releases both, which is what brings the hive AND
 *  its chrome back. */
const KEEPS_CONTROLS = 'view:keeps-controls'

const MODE_REGISTRY_IOC_KEY = '@diamondcoreprocessor.com/ModeRegistry'

type ModeRegistryLike = {
  enter(mode: string, owner: string): void
  exit(mode: string, owner: string): void
}

@Component({
  selector: 'hc-chat-window',
  standalone: true,
  imports: [NgTemplateOutlet, TranslatePipe, HcDockedPanelDirective, DockInsetDirective],
  templateUrl: './chat-window.component.html',
  // TWO SHEETS, in source order. Angular's `anyComponentStyle` budget is
  // measured per compiled stylesheet and one output is emitted per `styleUrls`
  // entry — so splitting is the only thing that lowers the number a `@use`'d
  // partial cannot. The markdown sheet is last because it styles the message
  // bodies the first sheet lays out.
  // Four sheets, not one: Angular's component style budget is per-sheet, and
  // the peek geometry and the picture viewer are self-contained states that
  // read better apart.
  // A fifth for the route and the question wizard (chat-route.scss): the
  // main sheet is at the budget, and the pipe is its own vocabulary.
  styleUrls: [
    './chat-window.component.scss', './chat-markdown.scss',
    './chat-peek.scss', './chat-look.scss', './chat-route.scss',
  ],
})
export class ChatWindowComponent implements OnDestroy {

  /** A direct/keyed/local provider can answer ordinary chat even when no
   * host or hive-reading bridge is configured. */
  readonly providerReady = signal(false)

  /** Chat stays discoverable, but only a participant-supplied responder makes
   *  it interactive. `configured` is stable through a temporary disconnect;
   *  `bridgeUp` below is merely the live transport state. */
  readonly bridgeConfigured = signal(isLocalClaudeBridgeConfigured())
  readonly hostConfigured = signal(isParticipantAiHostConfigured())
  readonly enabled = computed(() => this.providerReady() || this.bridgeConfigured() || this.hostConfigured())

  /** Whether the window was on screen when the page was last left survives a
   *  refresh. On the first visit only, a configured local bridge keeps the
   *  established companion-view default; everyone else begins with the
   *  launcher. */
  readonly visible = signal(rememberedChatVisibility(this.bridgeConfigured()))

  /** Parked while the hive is covered and brought back intact — the thread is
   *  durable, but the scroll position and the half-typed message are not.
   *
   *  PARKING IS THE SHELL TAKING THE WINDOW OFF SCREEN, and everything the
   *  fold turned on OUT IN THE HIVE has to go with it. `announce` fires only
   *  on park/unpark (open/close emit `chat:window-state` themselves), which
   *  makes this the one seam where that can be said once:
   *
   *    • the tile icon comes off. A parked window keeps `peeking` true — that
   *      is the whole point of parking — so without this the hexagons went on
   *      offering "add to the request" for a shelf that was not on screen,
   *      which is exactly the thing chat-context-action.drone.ts exists to
   *      prevent.
   *    • the `view:active` claim follows the SCREEN, not the intent: a parked
   *      window covers nothing, so it must not go on claiming the surface.
   *    • WHAT A RELOAD COMES BACK TO follows the screen as well. Escape puts
   *      every showing window away (tool-windows.ts) and the one-window rule
   *      parks this one the moment another opens (window-rule.ts) — neither
   *      is a close, so remembering only open()/close() left the stored
   *      choice saying "open" for a window that was not on screen, and the
   *      next refresh laid the chat back over a hive the participant had
   *      cleared. Parked still forgets nothing else; it simply is not
   *      SHOWING, and showing is what a reload brings back. */
  readonly session = signalSession(this.visible, open => {
    EffectBus.emit('chat:window-state', { open })
    rememberChatVisibility(open)
    this.#claimSurface(open && !this.peeking())
    this.#applyFold()
    // PARKED IS OFF SCREEN: a keymap the wizard or the route was holding is
    // let go, or the whole hive stays deaf behind a window nobody can see.
    // The open question itself survives as a record and is drawn again on
    // unpark — without re-firing the arrival focus (`#questionArrived`).
    if (!open) { this.#releaseQuestionKeys(); this.#releaseRouteKeys() }
  })

  readonly conversations = signal<readonly ConversationSummary[]>([])
  readonly activeId = signal('')
  readonly turns = signal<readonly ChatTurn[]>([])

  /** The conversation list, open. Collapsed by default: the thread you are in
   *  is the thing you came for, and the others are one click away. */
  readonly listOpen = signal(false)

  /** The masthead's "where it stands" sentence, pinned open — sticky
   *  (localStorage), default off. */
  readonly standsOpen = signal(readFlag(STANDS_OPEN_KEY))

  /** A question is out and its answer has not come back. Per window, not
   *  global — asking in one conversation must not make another look busy. */
  readonly waiting = signal(false)

  /** When the outstanding question left, and how long ago that was. A wait
   *  with no clock on it is indistinguishable from a wait that has died. */
  readonly askedAt = signal(0)
  readonly elapsed = signal(0)

  /** The host tier is mid-stream: interrupting it means aborting a live fetch.
   *  A bridge ask, by contrast, is a durable record — see `pendingSig`. */
  readonly hostStreaming = signal(false)

  /** The QUEUED bridge ask's record signature. Withdrawing an ask is removing
   *  that record from the optimization pool, so this is the whole handle on a
   *  question that has left but not been picked up. */
  readonly pendingSig = signal('')

  readonly bridgeUp = signal(false)
  /** A local broker socket can remain open while the machine is offline. It
   *  is transport plumbing, not proof that a remote model can answer. */
  readonly networkOnline = signal(typeof navigator === 'undefined' || navigator.onLine)
  readonly linkUp = computed(() => this.networkOnline() && (
    this.providerReady() || (this.bridgeUp() && !!this.designated())
  ))

  /** WHY THE LINE IS DOWN, when the router has something worth saying — one
   *  token ('local-down', 'local-blocked'), localized here. The local tier is
   *  the only one whose readiness is a running process rather than a stored
   *  key, so it is the only one that can be off without the participant
   *  having decided anything. */
  readonly linkReason = signal('')

  /** The link is up because a PROVIDER answers — a key, or this machine's own
   *  server — rather than because a bridge session is parked on the socket.
   *  The distinction is the whole difference between "Bridge connected" and a
   *  sentence that is true: a direct provider needs no bridge, and saying one
   *  is connected when none is was the line's oldest lie. */
  readonly directLink = computed(() => this.providerReady() && !this.bridgeUp())

  /** The availability line's key, for the branch that knows who answers. */
  readonly linkKey = computed(() =>
    this.linkUp() ? (this.directLink() ? 'chat.link.direct' : 'chat.link.ready')
      : this.#linkDownKey() || 'chat.link.pending')

  /** The same line with nobody designated: no {provider} to interpolate. */
  readonly linkKeyAny = computed(() =>
    this.linkUp() ? (this.directLink() ? 'chat.link.direct.any' : 'chat.link.ready.any')
      : this.#linkDownKey() || 'chat.link.pending.any')

  /** Shared by both: a host, or a local server that is off, is the same
   *  sentence whoever was designated. '' means "say the waiting line". */
  #linkDownKey(): string {
    if (this.hostConfigured()) return 'chat.link.host'
    if (this.linkReason() === 'local-permission') return 'chat.link.local.permission'
    if (this.linkReason() === 'local-blocked') return 'chat.link.local.blocked'
    if (this.linkReason() === 'local-down') return 'chat.link.local.down'
    return ''
  }

  /** THE MODEL SOMEBODY NAMED, for this conversation. `''` is the normal
   *  case: nobody named one, and the policy designates instead. Naming still
   *  wins — `/opus`, `[tile]/o …`, a `chat:open` carrying a model — because a
   *  participant overriding their own default is the whole point of being
   *  able to say it. */
  readonly model = signal<string>('')
  /** Whether `model` was named by the participant. A remembered actual model
   * is sticky, but remains fallback-capable. */
  readonly modelExplicit = signal(false)

  /** WHO THE POLICY DESIGNATED for a hive-reading question, refreshed from
   *  the providers console's standing instructions (assistant/model-policy.ts
   *  over IoC). Null while nothing is set up — then the composer says only
   *  what the availability line already says. */
  readonly designated = signal<DesignationLike | null>(null)

  /** THE MODEL THAT WILL ANSWER. A remembered fallback must not impersonate
   *  an active provider: vendor model names appear only when explicitly named
   *  by the participant or designated by the live policy. */
  readonly answering = computed(() =>
    this.modelExplicit()
      ? this.model() || DEFAULT_MODEL
      : this.designated()?.model || DEFAULT_MODEL)

  /** The designation said in full — "Claude Code · deep": whose model, and at
   *  what level of thinking. The footer's title, because the line itself
   *  carries the model and nothing else. Empty when nothing is designated;
   *  the template falls back to the standing explanation. */
  readonly answeringWhy = computed(() => {
    const chosen = this.designated()
    return chosen ? `${chosen.label} · ${chosen.tier}` : ''
  })

  /** An answer arriving a chunk at a time from the host tier. Held apart from
   *  `turns` because it is not a turn yet — it becomes one, once, when the
   *  stream closes and the text is on disk. */
  readonly streaming = signal('')

  /** Where the participant is standing, and what they have selected. This IS
   *  the context the question carries — reported, never operated. */
  readonly here = signal<readonly string[]>([])
  readonly targets = signal<readonly string[]>([])

  /** The tile whose conversation is open — clicked in the sidebar, which is
   *  a list of tiles AND therefore a list of chats. Every tile has one; it is
   *  dormant until something is said or written there. Null means a
   *  free-floating chat, about nothing in particular. */
  readonly railSubject = signal<RailPickLike | null>(null)

  // ── THE CLIPBOARD IS THE WAY IN ────────────────────────────────────
  //
  // One kind of thing — an op-less sig reference — and WHERE IT SITS is
  // what it means:
  //
  //   on the clipboard   gathered, not committed to anything. Filled from
  //                      anywhere in the hive (click a tile with the
  //                      clipboard window open, drag a row off the rail).
  //   on the SHELF       part of THIS request — what the responder reads.
  //
  // Moving between them is the whole interface: click a clipboard item to
  // PASTE it onto the shelf (it leaves the clipboard — one home per item,
  // and the clipboard empties as you use it), drag it back off the shelf
  // to RESTORE it, or × to drop it from the request outright.
  //
  // There is no references tab and no second pool: a set worth keeping
  // past this conversation is a named context group, not a compartment.

  /** THE SHELF — the references this request carries, in the order they
   *  were pasted. Chat-local: the clipboard is where things are gathered,
   *  this is where they are committed to the question. */
  readonly references = signal<readonly RailPickLike[]>([])

  /** What the clipboard is holding right now — the shelf's source, mirrored
   *  from `clipboard:changed` (last-value replayed, so the flyout is current
   *  the moment it opens). Read-only here; the clipboard owns it. */
  readonly clipboardHeld = signal<readonly RailPickLike[]>([])

  /** The clipboard flyout is showing. A small icon in the header, because
   *  what you are pasting FROM should be one press away from the composer
   *  rather than a docked panel across the screen. */
  readonly clipboardOpen = signal(false)

  toggleClipboardShelf(): void { this.clipboardOpen.update(open => !open) }

  /** PASTE AS REFERENCE — one click on a clipboard item puts it on the
   *  shelf and takes it off the clipboard. Same entry, new place. */
  pasteReference(pick: RailPickLike): void {
    if (!this.references().some(held => held.key === pick.key)) {
      this.references.set([...this.references(), pick])
      this.#announceSet()
      void this.#refreshContextThumbs()
    }
    EffectBus.emit('clipboard:discard-items', { labels: [pick.name] })
    if (this.clipboardHeld().length <= 1) this.clipboardOpen.set(false)
  }

  /** RESTORE — a reference dragged off the shelf goes back to the clipboard.
   *  The drag is the gesture; this is what it lands as. */
  restoreToClipboard(index: number): void {
    const held = this.references()[index]
    if (!held) return
    this.references.set(this.references().filter((_, at) => at !== index))
    this.#announceSet()
    EffectBus.emit('clipboard:take-entries', {
      entries: [{ label: held.name, sourceSegments: [...held.path], sig: held.sig || undefined }],
    })
  }

  /** What the next question is about, counted for the status row — the SAME
   *  deduped union `send()` will carry, so a tile both canvas-selected and
   *  sidebar-picked counts once. */
  readonly chosen = computed(() => this.#chosenTargets().length)

  /** The gathered tiles, named, for the chip's tooltip. */
  readonly contextNames = computed(() => this.references().map(pick => pick.name).join(', '))

  /** WHICH BRANCH IT CAME FROM. A shelf of pictures says how many references
   *  a request carries and never which — and a gathered set exists to relate
   *  things, so the relation has to be readable without hovering anything.
   *  The last two segments are what distinguishes two same-named tiles in
   *  practice; the whole address rides the title. */
  branchOf(pick: RailPickLike): string {
    return pick.path.length ? pick.path.slice(-2).join(' / ') : ''
  }

  /** The full address, for the hover — same ` / ` crumb the clipboard panel
   *  writes, so one path is spelled one way everywhere. */
  pathOf(pick: RailPickLike): string { return pick.path.join(' / ') }

  /** Is this reference a picture rather than something in the hive's tree? */
  isPicture(pick: RailPickLike): boolean { return !!pick.kind?.startsWith('image/') }

  /** A picture's weight, where a tile's branch would be — the one fact worth
   *  knowing about a file you just attached. */
  sizeOf(pick: RailPickLike): string {
    const bytes = pick.size ?? 0
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`
    return `${bytes} B`
  }

  /** pick.key → blob: URL of the tile's PICTURE ('large' — a square must
   *  never wear the hex capture when the tile has a real picture). Absent →
   *  the box falls back to its name chip. Shares the panel's resolver, so
   *  the two faces of the gathered set can never show different images. */
  readonly contextThumbs = signal<Record<string, string>>({})
  #thumbUrls = new Map<string, string>()
  #thumbToken = 0

  /** Same bounded-cache discipline as the panel: revoke what left the set,
   *  resolve only what is new, and let a superseding change win the race.
   *
   *  Resolve pictures for BOTH faces at once — the shelf and the flyout draw
   *  from one cache, so pasting an item never has to re-fetch the picture the
   *  flyout was already showing, and neither list can revoke the other's
   *  object-URLs by being refreshed on its own. */
  async #refreshContextThumbs(): Promise<void> {
    const entries = [...this.references(), ...this.clipboardHeld()]
    const token = ++this.#thumbToken
    const wanted = new Set(entries.map(entry => entry.key))
    for (const key of [...this.#thumbUrls.keys()]) {
      if (!wanted.has(key)) {
        const url = this.#thumbUrls.get(key)
        if (url) URL.revokeObjectURL(url)
        this.#thumbUrls.delete(key)
      }
    }
    const pending = entries.filter(entry => !this.#thumbUrls.has(entry.key))
    if (pending.length) {
      const store = ioc()?.get('@hypercomb.social/Store') as StoreLike | undefined
      await Promise.all(pending.map(async (entry) => {
        // An attached PICTURE is its own thumbnail: it has no tile to walk to,
        // only bytes at a signature.
        const url = entry.kind?.startsWith('image/')
          ? await this.#imageUrl(store, entry.sig ?? '')
          : await resolveEntryImageUrl(entry.name, entry.path, 'large').catch(() => null)
        if (token !== this.#thumbToken) { if (url) URL.revokeObjectURL(url); return }
        if (url) this.#thumbUrls.set(entry.key, url)
      }))
    }
    if (token !== this.#thumbToken) return
    const map: Record<string, string> = {}
    for (const [k, v] of this.#thumbUrls) map[k] = v
    this.contextThumbs.set(map)
  }

  // ── LOOKING AT WHAT THE REQUEST CARRIES ────────────────────────────
  //
  // The shelf shows a picture shrunk to a mark, which answers WHICH but not
  // WHAT — and a reference you cannot actually look at is one you have to
  // take on trust. So a shelf picture opens where it already is.
  //
  // IN PLACE, NOT IN A TAB. Leaving is the expensive move: the composer holds
  // an unsent question and a shelf you assembled, and on the native shell a
  // document navigation takes the window with it (a link out of a view is the
  // one thing a view may never do). The overlay lives inside the chat panel,
  // so nothing is put down to look at something.
  //
  // NO SECOND FETCH. It paints the URL the shelf is ALREADY holding —
  // `contextThumbs` resolves a tile's `large` picture and an attached image's
  // own bytes, both full-size — so opening one is free and closing it cannot
  // strand an object-URL: the thumbnail cache owns every URL and revokes them
  // on its own terms.

  /** The shelf picture on screen, by its entry key — or null. */
  readonly viewing = signal<{ key: string; name: string } | null>(null)

  /** What to paint. Derived from the live cache rather than captured at open,
   *  so a refresh that re-resolves a picture cannot leave the viewer showing
   *  a URL that has since been revoked. An entry that leaves the shelf while
   *  you are looking at it yields '' and the viewer closes itself. */
  readonly viewingUrl = computed(() => {
    const held = this.viewing()
    return held ? this.contextThumbs()[held.key] ?? '' : ''
  })

  /** The shelf's pictures, in shelf order — what ← and → step through. A
   *  reference with no picture is not in the set: stepping onto a hexagon
   *  glyph would be a blank screen with no way to tell it from a failure. */
  #picturesOnShelf(): RailPickLike[] {
    const thumbs = this.contextThumbs()
    return this.references().filter(pick => !!thumbs[pick.key])
  }

  /** Which of them is showing, or -1. */
  readonly viewingIndex = computed(() => {
    const held = this.viewing()
    if (!held) return -1
    return this.#picturesOnShelf().findIndex(pick => pick.key === held.key)
  })

  readonly viewingCount = computed(() => this.#picturesOnShelf().length)

  /** Open a shelf picture. Guarded on there BEING one: the box falls back to
   *  a name chip when nothing resolved, and that must not open an empty
   *  screen. */
  openPicture(pick: RailPickLike, event?: Event): void {
    event?.stopPropagation()
    if (!this.contextThumbs()[pick.key]) return
    this.viewing.set({ key: pick.key, name: pick.name })
  }

  closePicture(): void { this.viewing.set(null) }

  /** ← and → walk the shelf WITHIN the viewer — the same axis the rest of the
   *  product uses for "the next one of these", never for leaving. Wraps, so a
   *  shelf of three is a loop rather than a corridor with two dead ends. */
  stepPicture(delta: 1 | -1): void {
    const pictures = this.#picturesOnShelf()
    if (pictures.length < 2) return
    const at = this.viewingIndex()
    if (at < 0) return
    const next = pictures[(at + delta + pictures.length) % pictures.length]
    if (next) this.viewing.set({ key: next.key, name: next.name })
  }

  /** TAKE THE FOCUS WHEN IT OPENS. The overlay's keys are the whole
   *  interaction — step, step, done — and a surface you have to click before
   *  the arrows work is one whose arrows nobody finds. The press that opened
   *  it was on a button inside the shelf, so focus has to be moved
   *  deliberately. */
  readonly #focusLook = effect(() => {
    if (!this.viewing()) return
    const layer = this.lookLayer()?.nativeElement
    if (layer) queueMicrotask(() => layer.focus())
  })

  /** The viewer's own keys. Escape also unwinds through the window's cascade
   *  (see onKey) for when focus never reached the overlay. */
  onPictureKey(event: KeyboardEvent): void {
    if (event.key === 'ArrowRight') { event.preventDefault(); this.stepPicture(1); return }
    if (event.key === 'ArrowLeft') { event.preventDefault(); this.stepPicture(-1); return }
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); this.closePicture() }
  }

  /** The bytes at a signature, as something an <img> can show. Bounded by the
   *  same cache the rest of the shelf uses, so it is revoked with everything
   *  else when the reference leaves. */
  async #imageUrl(store: StoreLike | undefined, sig: string): Promise<string | null> {
    if (!store?.getResource || !/^[0-9a-f]{64}$/.test(sig)) return null
    try {
      const blob = await store.getResource(sig)
      return blob ? URL.createObjectURL(blob) : null
    } catch { return null }
  }

  // ── TWO KINDS OF DATA IN ONE REQUEST ──────────────────────────────────
  //
  // They are not the same thing and conflating them is why an answer can be
  // well-informed and still edit the wrong tile:
  //
  //   THE WORK BRANCH   the branch that needs CHANGES. One. It is what the
  //                     ask applies to, and what an answer is written onto.
  //   THE CONTEXT       supporting branches and resources the responder
  //                     should READ. Any number, in the order you added
  //                     them, carried as signatures so the payload is the
  //                     same bytes every time it is composed.
  //
  // Both are filled by dropping a tile from the sidebar, and both are
  // signatures the moment they land — a name would make the request depend
  // on where the hive stood when it was sent.
  //
  // THE CONTEXT LIVES ON THE CLIPBOARD. Not a private list: the same
  // op-less sig entries the clipboard window shows, the hive's swap takes
  // fill, and the panel's place/discard act on. Pin the chat, open the
  // clipboard window, walk the hive clicking tiles — they appear here as
  // they land, and dragging rows out of the sidebar lands in the same set.
  // The work branch stays chat-local: it is an ADDRESS for the answer, not
  // a gathered reference.

  // THE TARGET IS THE TILE YOU ARE IN. There is no box for it, because there
  // is nothing to choose: the conversation is about a tile, so that tile is
  // what an answer may change. An anchor rank used to sit here saying the
  // same thing a second time, and a second way of saying it is a second thing
  // to keep in step. What remains is one list of references — everything the
  // request should READ — and the target it is already standing on.

  /** A tile dropped straight onto the shelf — dragged off the sidebar rail,
   *  never through the clipboard. It lands as a reference directly, because
   *  a drag that has already crossed the window should not need a second
   *  gesture to finish. */
  addContext(tile: DroppedTile): void {
    if (!tile.sig && !tile.path) return
    const segments = tile.path.split('/').filter(Boolean)
    const name = tile.name || segments[segments.length - 1] || ''
    const key = tile.path.startsWith('/') ? tile.path : '/' + segments.join('/')
    if (this.references().some(held => held.key === key)) return
    this.references.set([...this.references(), {
      key,
      path: segments.slice(0, -1),
      name,
      sig: tile.sig || undefined,
    }])
    this.#announceSet()
    void this.#refreshContextThumbs()
  }

  /** AN ANNOTATION LANDING. Two shapes, one path in:
   *
   *    plain    the picture joins the open conversation's shelf, the way a
   *             pasted screenshot does.
   *    fresh    a NEW conversation about the location the picture was taken
   *             at, carrying the annotation and nothing else.
   *
   *  The order matters. The window is opened FIRST, because opening resumes
   *  the most recent conversation and would otherwise land on top of the one
   *  just started. The shelf is then emptied — a conversation started from an
   *  annotation is about that annotation, and references gathered for some
   *  earlier question would ride along unread. Nothing is lost by it: the
   *  shelf is filled FROM the clipboard, which this does not touch. */
  async #attachPicture(payload?: AttachedPicture): Promise<void> {
    const listed: readonly AttachedPicture[] = Array.isArray(payload?.pictures) ? payload!.pictures! : payload ? [payload] : []
    const pictures = listed.filter(picture => /^[0-9a-f]{64}$/.test(String(picture?.sig ?? '')))
    if (!pictures.length) return
    const path = (Array.isArray(payload?.path) ? payload!.path! : [])
      .map(segment => String(segment ?? '').trim())
      .filter(Boolean)
    const show = payload?.open !== false

    if (payload?.fresh) {
      if (show && !this.visible()) await this.open()
      this.#startAt(path)
      this.references.set([])
    }

    let shelf = this.references()
    for (const picture of pictures) {
      const sig = String(picture.sig)
      const key = `image:${sig}`
      if (shelf.some(held => held.key === key)) continue
      shelf = [...shelf, {
        key,
        path,
        name: String(picture.name || 'annotation'),
        sig,
        size: Number(picture.size) || undefined,
        kind: String(picture.kind || 'image/png'),
      }]
    }
    if (shelf !== this.references()) {
      this.references.set(shelf)
      this.#announceSet()
      void this.#refreshContextThumbs()
    }
    if (show && !this.visible()) await this.open()
  }

  /** WHAT THE REQUEST CARRIES, structured. A reference is a pointer plus what
   *  KIND of thing it points at, because "one layer" and "a whole context"
   *  are read differently by whoever answers:
   *
   *    layer  a single tile's own content
   *    group  a named set of tiles — a META CONTEXT, one reference standing
   *           for many, carried by the set's own signature
   *
   *  The TARGET is not in here: the tile whose conversation this is rides as
   *  the ask's target, because it is what may be changed rather than
   *  something to be read. */
  referencePayload(): { kind: string; sig: string; label: string }[] {
    return this.references()
      .filter(pick => !!pick.sig)
      .map(pick => ({ kind: pick.kind ?? 'layer', sig: pick.sig ?? '', label: pick.name }))
  }

  /** Tell the sidebar which tiles are in the set being asked about, so it can
   *  draw them as one handful. The window owns the set; the rail only shows
   *  it — it must never have to guess from its own selection state, which is
   *  a different thing that happens to overlap. */
  #announceSet(): void {
    const paths = this.references().map(pick =>
      pick.key.startsWith('/') ? pick.key : '/' + [...pick.path, pick.name].join('/'))
    EffectBus.emit('context:active-set', { paths })
  }

  /** ON OR OFF, from a press out in the hive. The tile icon that raises this
   *  is the SAME control both directions — pressing a tile that is already on
   *  the shelf takes it off — because a lit icon you cannot un-press is an
   *  icon you have to come back to the window to undo. */
  toggleContext(tile: DroppedTile): void {
    const segments = tile.path.split('/').filter(Boolean)
    const key = tile.path.startsWith('/') ? tile.path : '/' + segments.join('/')
    if (this.references().some(held => held.key === key)) {
      this.references.set(this.references().filter(held => held.key !== key))
      this.#announceSet()
      void this.#refreshContextThumbs()
      return
    }
    this.addContext(tile)
  }

  /** The × — take it off the shelf and out of the request. Deliberately NOT
   *  a restore: dragging it back is how you say "not now, but keep it".
   *  The tile itself is untouched either way. */
  removeContext(index: number): void {
    const held = this.references()[index]
    if (!held) return
    this.references.set(this.references().filter((_, at) => at !== index))
    this.#announceSet()
    void this.#refreshContextThumbs()
  }

  /** Read a dragged tile, whatever surface dropped it. Returns null for a
   *  drag that is not one of ours, so an accidental file drop does nothing. */
  readDrop(event: DragEvent): DroppedTile | null {
    const raw = event.dataTransfer?.getData(TILE_DRAG_TYPE)
    if (!raw) return null
    try {
      const parsed = JSON.parse(raw) as Partial<DroppedTile>
      const name = String(parsed?.name ?? '').trim()
      const path = String(parsed?.path ?? '').trim()
      if (!name && !path) return null
      return { name: name || path, path, sig: String(parsed?.sig ?? '') }
    } catch { return null }
  }

  onDropReference(event: DragEvent): void {
    event.preventDefault()
    this.dragOverReference.set(false)
    const tile = this.readDrop(event)
    if (tile) { this.addContext(tile); return }
    // A PICTURE IS A REFERENCE TOO. Files dropped here are kept in the hive
    // like everything else — content in, signature out — and ride on the
    // question by that signature.
    const files = [...(event.dataTransfer?.files ?? [])].filter(file => file.type.startsWith('image/'))
    if (files.length) void this.#attachImages(files)
  }

  // ── PICTURES ────────────────────────────────────────────────────────────
  //
  // A question about a screenshot is the most ordinary question there is, and
  // until now the only way to ask it was to describe the picture in words.
  //
  // The image is CONTENT: `putResource` stores the bytes at the content root
  // under their own signature, exactly like a layer or a note body, so the
  // same picture pasted twice is stored once and the reference is a 64-hex
  // string either way. What rides on the ask is that signature plus the media
  // type as its KIND — the responder resolves the bytes itself (the bridge
  // serves them base64) rather than being handed a copy inline.

  /** Paste an image straight into the composer. The clipboard is where a
   *  screenshot already is; making you save it to a file first would be a
   *  step invented by the software. */
  onComposerPaste(event: ClipboardEvent): void {
    const files = [...(event.clipboardData?.files ?? [])].filter(file => file.type.startsWith('image/'))
    if (!files.length) return
    // Only when it IS a picture — pasting text must stay ordinary pasting.
    event.preventDefault()
    void this.#attachImages(files)
  }

  /** Store each picture and put it on the shelf. Anything that will not store
   *  says so rather than sitting there looking attached. */
  async #attachImages(files: readonly File[]): Promise<void> {
    const store = ioc()?.get('@hypercomb.social/Store') as StoreLike | undefined
    if (!store?.putResource) {
      EffectBus.emit('toast:show', { type: 'warning', message: 'No hive to keep the picture in.' })
      return
    }
    for (const file of files) {
      if (file.size > IMAGE_MAX_BYTES) {
        EffectBus.emit('toast:show', {
          type: 'warning',
          message: `${file.name || 'That picture'} is too large to attach.`,
        })
        continue
      }
      let sig = ''
      try { sig = await store.putResource(file) } catch { sig = '' }
      if (!/^[0-9a-f]{64}$/.test(sig)) {
        EffectBus.emit('toast:show', { type: 'warning', message: 'Could not keep that picture.' })
        continue
      }
      const key = `image:${sig}`
      if (this.references().some(held => held.key === key)) continue
      this.references.set([...this.references(), {
        key,
        path: [],
        name: file.name || 'pasted image',
        sig,
        size: file.size,
        // The MEDIA TYPE is the kind: a responder reading the ask knows both
        // that this is a picture and how to open it, from one field.
        kind: file.type || 'image/png',
      }])
    }
    this.#announceSet()
    void this.#refreshContextThumbs()
  }

  // ── DRAG IT BACK OFF THE SHELF ─────────────────────────────────────
  // A reference dragged out of the shelf and released anywhere off it goes
  // back to the clipboard. The drop is not caught by a target — the shelf
  // is the only thing that would accept it, so LEAVING the shelf IS the
  // gesture, and dragend is where "it left" is known.

  /** Which reference is in the air, by index. */
  #draggingRef: number | null = null

  onReferenceDragStart(event: DragEvent, index: number): void {
    const held = this.references()[index]
    if (!held) return
    this.#draggingRef = index
    // It travels in the same shape the rail sends, so anything that accepts
    // a hive tile accepts this one too.
    const payload = JSON.stringify({
      name: held.name,
      path: held.key,
      sig: held.sig ?? '',
    })
    event.dataTransfer?.setData(TILE_DRAG_TYPE, payload)
    event.dataTransfer?.setData('text/plain', held.key)
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
  }

  /** The drag ended. Dropped back on the shelf → nothing happened (the shelf's
   *  own drop handler already cleared the mark). Dropped anywhere else → it
   *  left the request and goes home to the clipboard. */
  onReferenceDragEnd(): void {
    const index = this.#draggingRef
    this.#draggingRef = null
    if (index === null || this.dragOverReference()) { this.dragOverReference.set(false); return }
    this.restoreToClipboard(index)
  }

  /** A drop target has to LOOK like one while something is over it. */
  readonly dragOverReference = signal(false)

  onDragOver(event: DragEvent): void {
    if (!event.dataTransfer?.types?.includes(TILE_DRAG_TYPE)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
    this.dragOverReference.set(true)
  }

  onDragLeave(): void {
    this.dragOverReference.set(false)
  }

  // WHOSE CONVERSATION IS THIS? Read off the CONVERSATION, never off the
  // sidebar — the sidebar exists only in full screen, and a thread resumed
  // from the roster has no sidebar state at all. The id knows: a tile chat is
  // `chat:tile:/dolphin/site`, and everything else is about nothing in
  // particular. Without this the window opened on a thread and said only
  // "Chat", which is the one thing it could say that is never wrong and never
  // useful.

  /** The tile path this conversation belongs to, or '' for a free chat. */
  readonly subjectPath = computed(() => {
    void this.turns()   // recomputed as the thread moves, so it can never lag
    return this.#threads()?.tilePathOf?.(this.activeId()) ?? ''
  })

  /** What the header says: the tile's own name, or nothing to name. */
  readonly subjectName = computed(() => {
    const path = this.subjectPath()
    if (!path || path === '/') return ''
    const segments = path.split('/').filter(Boolean)
    return segments[segments.length - 1] ?? ''
  })

  // ── WHAT YOU PICKED, SHOWN AT THE TOP ───────────────────────────────────
  //
  // The sidebar says which row is selected; this says the same thing at the
  // head of the reading column, where your eye already is once you have
  // stopped choosing and started asking. A NAME alone was not enough — the
  // rail identifies a tile by its PICTURE, and the header identified the same
  // tile by a word, so the two did not obviously agree. Now the header wears
  // the tile's own picture, resolved through the SAME resolver the shelf
  // squares use, so one tile can never show two faces in one window.
  //
  // Best-effort and never load-bearing: no picture (or a cold index) leaves
  // the header exactly what it was — the name on its own.

  /** The selected tile's picture as a blob: URL, or '' for none. */
  readonly subjectThumb = signal('')
  #subjectThumbUrl: string | null = null
  #subjectThumbToken = 0

  /** Resolve the picture for whatever the window is now about. Every path
   *  through here revokes the URL it replaces, and a superseding change wins
   *  the race — the same discipline `#refreshContextThumbs` keeps. */
  async #refreshSubjectThumb(): Promise<void> {
    const token = ++this.#subjectThumbToken
    const path = this.subjectPath()
    const segments = path.split('/').filter(Boolean)
    const label = segments[segments.length - 1] ?? ''
    const url = label
      ? await resolveEntryImageUrl(label, segments.slice(0, -1), 'large').catch(() => null)
      : null
    if (token !== this.#subjectThumbToken) { if (url) URL.revokeObjectURL(url); return }
    if (this.#subjectThumbUrl) URL.revokeObjectURL(this.#subjectThumbUrl)
    this.#subjectThumbUrl = url
    this.subjectThumb.set(url ?? '')
  }

  /** Clear the shelf — the request carries nothing extra again. The tiles
   *  are untouched and the clipboard is left alone: this empties what THIS
   *  question would have carried, nothing more. */
  clearContext(): void {
    this.#rail?.clearSelection()
    this.references.set([])
    this.#announceSet()
    void this.#refreshContextThumbs()
    this.#focus()
  }

  /** How many context branches are ATTACHED to this tile (the portal-drop
   *  records) — they ride with every question, and a rider the participant
   *  cannot see is a surprise, so the count is shown beside the path. */
  readonly contextCount = signal(0)

  /** Unsent drafts, by their own key — a tile path, or a free chat's id.
   *  Held here so the roster can list a conversation that has NOTHING in it
   *  yet but your words. */
  readonly drafts = signal<readonly { key: string; text: string }[]>([])

  /** THE ROSTER — every conversation you could return to, which is not the
   *  same as every conversation that holds a turn.
   *
   *  A chat you typed into and left without sending has no turns, so the
   *  thread walk cannot see it, so it never appeared here — and the words
   *  were unreachable from the moment you clicked away. They were never
   *  lost (the drafts pool had them all along), but a thing you cannot get
   *  back to may as well be gone. Draft-only conversations are folded in,
   *  and tile chats are named by their TILE rather than by their first
   *  sentence, because that is what you would look for. */
  readonly roster = computed(() => {
    const threads = this.#threads()
    const tileOf = (id: string): string => threads?.tilePathOf?.(id) ?? ''
    const rows = this.conversations().map(convo => ({
      convoId: convo.convoId,
      tile: tileOf(convo.convoId),
      title: convo.title,
      turnCount: convo.turnCount,
      lastAt: convo.lastAt,
      draft: '',
      archived: !!convo.archived,
      // Only ever false for a question still out — see ConversationSummary.
      replied: convo.replied !== false,
    }))

    const known = new Set(rows.map(row => row.convoId))
    for (const held of this.drafts()) {
      // A tile's draft is keyed by its path; a free chat's by its own id.
      const convoId = held.key.startsWith('/')
        ? (threads?.tileConvoId?.(held.key.split('/').filter(Boolean)) ?? '')
        : held.key
      if (!convoId) continue
      const existing = rows.find(row => row.convoId === convoId)
      if (existing) { existing.draft = held.text; continue }
      if (known.has(convoId)) continue
      rows.push({
        convoId,
        tile: tileOf(convoId),
        title: held.text,
        turnCount: 0,
        lastAt: 0,
        draft: held.text,
        archived: false,
        // A draft is unsent thinking, not a question waiting on anybody —
        // it is named by what it says, which is all there is of it.
        replied: true,
      })
    }
    return rows.sort((a, b) => b.lastAt - a.lastAt)
  })

  /** The list as it is READ — everything that has not been put away. */
  readonly liveRoster = computed(() => this.roster().filter(row => !row.archived))

  /** And what has been. Shown only when asked for; see `archiveOpen`. */
  readonly filedRoster = computed(() => this.roster().filter(row => row.archived))

  /** Is the archive showing in this window's flat list? Not persisted:
   *  putting a conversation away is durable, wanting to look at what you put
   *  away is something you are doing right now. */
  readonly archiveOpen = signal(false)
  readonly goalOpen = signal(false)
  readonly activeGoal = computed(() =>
    this.conversations().find(convo => convo.convoId === this.activeId())?.goal)

  toggleGoal(): void { this.goalOpen.update(open => !open) }

  /** PUT AWAY, NOT THROWN AWAY. Delete was the only thing you could do with a
   *  conversation you were finished with, and it is the wrong verb for the
   *  common case: you are done needing the thread, not done having said it.
   *  Archiving keeps every turn and takes the row out of the list.
   *
   *  Same button both ways — un-archiving is this act with the flag flipped,
   *  so there is no separate "restore" somewhere else to go and find. The
   *  list is updated optimistically because this is a one-press act on a row
   *  under the pointer; the refresh behind it corrects a write that failed.
   *
   *  Archiving the conversation you are IN leaves you in it: it is still
   *  open, still readable, still where what you type goes. What changed is
   *  where it sits in the list. */
  async archive(convoId: string, archived: boolean, event?: MouseEvent): Promise<void> {
    event?.stopPropagation()
    // A row half-way through arming a DELETE must not silently keep that
    // arming after a different button was pressed.
    this.armed.set('')
    this.conversations.update(list => list.map(convo =>
      convo.convoId === convoId ? { ...convo, archived } : convo))
    if (!archived && !this.filedRoster().length) this.archiveOpen.set(false)
    await this.#threads()?.setConversationArchived?.(convoId, archived)
    await this.#refreshList()
  }

  toggleArchive(): void { this.archiveOpen.update(open => !open) }

  /** Is the conversation in hand put away? A fresh chat that has never been
   *  listed is not — nothing has been said in it to file. */
  readonly activeArchived = computed(() =>
    !!this.conversations().find(convo => convo.convoId === this.activeId())?.archived)

  /** ARCHIVE THE ONE YOU ARE READING. The per-row control in the list acts on
   *  a conversation you are pointing at; this acts on the one in hand, which
   *  is the common case — you finish with a thread while you are in it.
   *
   *  And then it MOVES ON. This is the one place where staying put would be
   *  wrong: a press that files the conversation and leaves it on screen looks
   *  like a press that did nothing. So the window lands on the next live
   *  thread, or on a fresh chat when that was the last one — the same thing
   *  deleting does, for the same reason.
   *
   *  Bringing one BACK does stay put: you navigated into it deliberately and
   *  being thrown somewhere else for un-filing it is not what the press asks
   *  for. */
  async archiveCurrent(): Promise<void> {
    const convoId = this.activeId()
    if (!convoId) return
    const filing = !this.activeArchived()
    this.goalOpen.set(false)
    await this.archive(convoId, filing)
    if (!filing) return

    const next = this.conversations().find(convo => !convo.archived && convo.convoId !== convoId)
    if (next) { await this.#load(next.convoId); await this.#restoreDraft(); this.#focus() }
    else this.newChat()
  }

  /** Does the loaded essentials build know how to archive? A control that
   *  cannot do anything is worse than one that is not there.
   *
   *  A method rather than a signal on purpose: the module registers itself
   *  whenever it lands, so the honest answer is "ask at read time". Writing a
   *  signal from `#threads()` — which the roster computed calls — would be a
   *  write inside a computed, which Angular rightly refuses. */
  canArchive(): boolean { return !!this.#threads()?.setConversationArchived }

  /** Deleting a thread destroys turns that cannot be dragged back, so the
   *  button ARMS on the first press and deletes on the second. A confirm
   *  dialog for a row action is too much furniture; doing it silently on one
   *  press is too little. */
  readonly armed = signal('')

  /** The transcript is following the newest turn. False once the participant
   *  has scrolled up to read something — then arrivals stop moving the view
   *  under them and the scroll-to-bottom pill appears instead. */
  readonly atBottom = signal(true)

  /** Which message's Copy just fired — a transient tick on that one row. */
  readonly copiedTurn = signal('')

  // ── guided setup state ──────────────────────────────────────────────────

  /** Checklist flags. `toolsDone` is the one manual step; the rest derive
   *  live (config gate, socket state) or from the proven first reply. */
  readonly setupDone = signal(readFlag(SETUP_DONE_KEY))
  readonly toolsDone = signal(readFlag(SETUP_TOOLS_KEY))
  readonly firstReply = signal(readFlag(FIRST_REPLY_KEY))

  /** Which command's Copy button just fired — a transient "Copied" flash. */
  readonly copied = signal('')

  /** The step-4 starter question is out; completes when its answer lands. */
  readonly tried = signal(false)

  /** The local bridge only exists on loopback — elsewhere the step explains
   *  instead of offering a button that could never work. */
  readonly loopback = ((): boolean => {
    try {
      const host = String(globalThis.location?.hostname ?? '').toLowerCase()
      return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]'
    } catch { return false }
  })()

  /** The commands the checklist hands out — copy targets, never typed. */
  readonly commands = {
    install: 'npm install -g @anthropic-ai/claude-code',
    clone: 'git clone https://github.com/hypercomb/social.git',
    build: 'cd social/src && npm install && npm run build:packages',
    broker: 'npm run bridge',
    claude: 'claude',
    listen: 'listen for hive asks',
  } as const

  /** The wizard shows until the checklist completes (or is skipped). A
   *  configured host needs no checklist; a veteran with existing threads is
   *  grandfathered in `#resume`. */
  readonly showSetup = computed(() =>
    !this.enabled() || (this.bridgeConfigured() && !this.hostConfigured() && !this.setupDone()))

  /** The one current step — everything before it is checked, everything
   *  after it waits. 5 = complete. */
  readonly setupStep = computed(() => {
    if (!this.toolsDone()) return 1
    if (!this.bridgeConfigured()) return 2
    if (!this.bridgeUp()) return 3
    if (!this.firstReply()) return 4
    return 5
  })

  readonly input = viewChild<ElementRef<HTMLTextAreaElement>>('input')
  readonly scroller = viewChild<ElementRef<HTMLElement>>('scroller')
  readonly chatRail = viewChild<ElementRef<HTMLDivElement>>('chatRail')
  readonly lookLayer = viewChild<ElementRef<HTMLElement>>('lookLayer')
  readonly panel = viewChild<ElementRef<HTMLElement>>('panel')

  readonly railWidth = signal(readRailWidth())
  /** The workflow sidebar's width once dragged (px), else 0 — the stylesheet's
   *  default. Written to `--chat-route-side-w` on the split. */
  readonly routeSideWidth = signal(readRouteSideWidth())
  readonly routeSideStyle = computed<string | null>(() => (this.routeSideWidth() > 0 ? `${this.routeSideWidth()}px` : null))
  readonly routeResizing = signal(false)
  readonly railDragging = signal(false)

  readonly #railWidthEffect = effect(() => {
    const element = this.panel()?.nativeElement
    if (!element) return
    const width = this.railWidth()
    if (width) element.style.setProperty('--chat-rail-width', `${width}px`)
    else element.style.removeProperty('--chat-rail-width')
  })

  /** ONE rail per window lifetime, mounted whenever full screen puts its host
   *  in the DOM — so the trail you drilled and the tiles you chose survive
   *  leaving and re-entering full screen. */
  #rail: TilesRailLike | null = null

  /** The rail picks last reported, keyed by row key — what lets a selection
   *  change flow into the clipboard as ADDS and REMOVES rather than a
   *  wholesale replace that would clobber entries gathered elsewhere. */
  #railSeen = new Map<string, RailPickLike>()
  /** The text last written to the drafts pool for the open conversation —
   *  so an unchanged box is never re-written. */
  #heldDraft = ''
  #draftTimer: ReturnType<typeof setTimeout> | null = null
  /** Questions that are out, by conversation — see #startWait. */
  readonly #outstanding = new Map<string, { sig: string; askedAt: number }>()

  /** The active thread's name — its first message. Read from the list when it
   *  is there, else from the turns in hand, so a brand-new conversation is
   *  named the moment you send rather than after the next list refresh. */
  readonly activeTitle = computed(() => {
    const id = this.activeId()
    const listed = this.conversations().find(c => c.convoId === id)?.title
    return listed || this.#titleFrom(this.turns())
  })

  /** IS THE THREAD IN HAND STILL WAITING FOR ITS FIRST ANSWER? Then it has no
   *  subject to be named after, and the bar says so instead of naming the
   *  conversation after the thing you did not know when you opened it. A
   *  streaming answer already counts as arrived — the words are on screen. */
  readonly activeAwaiting = computed(() =>
    this.turns().length > 0
    && !this.streaming()
    && !this.turns().some(turn => turn.role === 'assistant'))

  /** First line of the first user turn — the same naming rule the threads
   *  module applies, so the in-memory list bump and a cold re-list agree. */
  #titleFrom(turns: readonly ChatTurn[]): string {
    const lead = turns.find(t => t.role === 'user') ?? turns[0]
    const line = String(lead?.text ?? '').split('\n').map(s => s.trim()).find(Boolean) ?? ''
    return line.length > 72 ? line.slice(0, 71).trimEnd() + '…' : line
  }

  readonly path = computed(() => {
    const segments = this.here()
    return segments.length ? '/' + segments.join('/') : '/'
  })

  readonly empty = computed(() => this.turns().length === 0 && !this.streaming())

  // ── markdown ────────────────────────────────────────────────────────────
  //
  // Answers arrive as markdown, so they are read as markdown. The rendering is
  // a pure function (chat-markdown.ts) whose entire safety story is escape-
  // first — nothing unescaped from a model ever reaches the string — which is
  // what makes bypassing Angular's sanitizer sound here. The bypass is needed
  // at all because the sanitizer strips the `data-` attributes the hive-path
  // chips and code-copy buttons are addressed by.

  readonly #sanitizer = inject(DomSanitizer)

  /** text → rendered HTML. Bounded; keyed by content, so an identical turn
   *  reaching two threads is parsed once. */
  readonly #rendered = new Map<string, SafeHtml>()

  #markdown(text: string): SafeHtml {
    const hit = this.#rendered.get(text)
    if (hit) return hit
    const html = this.#sanitizer.bypassSecurityTrustHtml(renderChatMarkdown(text))
    if (this.#rendered.size >= RENDER_CACHE_MAX) {
      // Oldest first — Map preserves insertion order, and the oldest turn in a
      // long thread is the one furthest from the screen.
      const oldest = this.#rendered.keys().next().value
      if (oldest !== undefined) this.#rendered.delete(oldest)
    }
    this.#rendered.set(text, html)
    return html
  }

  /** The thread, rendered. Recomputed when a turn lands; the cache above makes
   *  that a lookup per existing turn rather than a re-parse.
   *
   *  EACH TURN IS SPLIT FIRST (chat-route.md §2.2): the question a reply asked
   *  is machinery, so `html` is the markdown of the PROSE alone and the
   *  question is drawn by the template, where every string goes through
   *  interpolation and never `innerHTML`. `question` is the settled state
   *  from `settleQuestions` — open, settled or superseded — dense over the
   *  turns, so row i reads `settled[i]`.
   *
   *  KEYED BY POSITION, not by `at`: the route's join (§3.2) replaces the
   *  in-memory turns with the sig-bearing list read back from disk, whose
   *  `at` is the manifest's and not the receipt's. A key that moved on that
   *  swap rebuilt every row — and took the focus off an option the
   *  participant was walking with the arrow keys. A thread is append-only,
   *  so an index names its turn for good. */
  readonly rendered = computed(() => {
    const turns = this.turns()
    const settled = settleQuestions(turns)
    return turns.map((turn, index) => {
      const split = splitQuestion(turn.text)
      return {
        turn,
        index,
        key: `${index}:${turn.role}`,
        prose: split.prose,
        html: this.#markdown(split.prose),
        question: settled[index],
      }
    })
  })

  // ── THE RESPONSE WIZARD — a question asked inside a reply ───────────────
  //
  // A responder that needs a direction decided ends its reply with one
  // `hypercomb-question` fence (documentation/chat-route.md §2). The parser
  // is core's; what lives here is the DRAWING and the PICK. An open question
  // is a radiogroup with roving focus; a settled one collapses to a single
  // line; the composer is always the other answer. Picking sends the label
  // through `send()` — same turn, same wait, same queue — so the record is
  // the same as if it had been typed.

  /** The one open question, or null. Only the last assistant turn can hold
   *  one (§2.3), and never while a reply is streaming: a question read from
   *  a partial is a question that may not be finished being asked. */
  readonly openQuestion = computed(() => {
    if (this.streaming()) return null
    const rows = this.rendered()
    const last = rows[rows.length - 1]
    return last?.question?.state === 'open' ? last : null
  })

  /** Which option is the group's tab stop — the roving focus index. */
  readonly questionCursor = signal(0)

  /** The keymap is held while the group contains focus; released on blur,
   *  settle, close and park. A held suppression the window forgot would
   *  deafen the whole hive, so every path out goes through `#releaseKeys`. */
  #questionKeysHeld = false

  /** The question last given the arrival focus, so unpark, a re-read that
   *  swaps the turns, or any later recompute cannot fire it twice. Keyed by
   *  position and prompt, which survive the sig-bearing re-read. */
  #questionArrived = ''

  /** FOCUS ON ARRIVAL, under a real precondition (§2.2). "Composer empty" is
   *  always true after a send, so it cannot be the test on its own; focus
   *  moves only when it is somewhere the participant is not USING — the
   *  composer, the body, or the panel root — never the rail's find field, a
   *  rail row, the command line, or a button elsewhere. And only while the
   *  transcript is at the bottom, with `preventScroll` so the move itself
   *  cannot overrule the at-bottom rule. Otherwise focus stays put and the
   *  `aria-live` group announces the prompt. */
  readonly #questionArrival = effect(() => {
    const open = this.openQuestion()
    if (!open) return
    const key = `${open.index}:${open.question?.prompt ?? ''}`
    if (key === this.#questionArrived) return
    this.#questionArrived = key
    this.questionCursor.set(0)
    // After the group is in the DOM, not before.
    setTimeout(() => this.#focusQuestionOnArrival(open.index), 0)
  })

  #focusQuestionOnArrival(index: number): void {
    if (this.openQuestion()?.index !== index) return
    const composer = this.input()?.nativeElement ?? null
    const active = document.activeElement
    const panel = this.panel()?.nativeElement ?? null
    const resting = active === null || active === document.body || active === composer || active === panel
    if (!resting) return
    if (composer && composer.value.trim()) return
    if (!this.atBottom()) return
    const first = this.#questionOptions()[0]
    if (!first) return
    first.focus({ preventScroll: true })
    this.#scrollDown()
  }

  /** The open group's option buttons, in order. */
  #questionOptions(): HTMLButtonElement[] {
    const scroller = this.scroller()?.nativeElement
    return scroller ? [...scroller.querySelectorAll<HTMLButtonElement>('.chat-question-option')] : []
  }

  /** Release every held suppression the moment no question is open — the
   *  group leaving the DOM does not reliably blur, so the settle itself is a
   *  release path (§2.2: "on blur, settle, close and park"). */
  readonly #questionSettled = effect(() => {
    if (!this.openQuestion()) this.#releaseQuestionKeys()
  })

  /** The group took focus: the hive's keymap runs on `window` in the capture
   *  phase and treats a focused button as non-interactive, so ↑/↓ would move
   *  the hex selection and Enter would paste before the group ever saw the
   *  key. Suppression is the defence; `stopPropagation` protects nothing. */
  onQuestionFocusIn(): void {
    if (this.#questionKeysHeld) return
    this.#questionKeysHeld = true
    EffectBus.emit('keymap:suppress', { reason: QUESTION_KEYS_REASON })
  }

  /** Moving between the group's own options is not leaving it. */
  onQuestionFocusOut(event: FocusEvent): void {
    const to = event.relatedTarget as Node | null
    if (to && (event.currentTarget as HTMLElement).contains(to)) return
    this.#releaseQuestionKeys()
  }

  #releaseQuestionKeys(): void {
    if (!this.#questionKeysHeld) return
    this.#questionKeysHeld = false
    EffectBus.emit('keymap:unsuppress', { reason: QUESTION_KEYS_REASON })
  }

  /** The group's keys: ↑/↓ move the roving focus, Enter or Space pick, the
   *  digits 1–4 pick by number. Each is `preventDefault`ed so a Space cannot
   *  also scroll the transcript and an Enter cannot reach anything else. No
   *  Escape rung here — the cascade owns Escape, and a press with focus on
   *  an option parks the window, as it would anywhere in it. */
  onQuestionKey(event: KeyboardEvent, row: number, options: readonly string[]): void {
    const buttons = this.#questionOptions()
    const at = Math.max(0, buttons.indexOf(document.activeElement as HTMLButtonElement))
    const move = (to: number): void => {
      const next = (to + buttons.length) % buttons.length
      this.questionCursor.set(next)
      buttons[next]?.focus({ preventScroll: true })
    }
    switch (event.key) {
      case 'ArrowDown': case 'ArrowRight':
        event.preventDefault(); move(at + 1); return
      case 'ArrowUp': case 'ArrowLeft':
        event.preventDefault(); move(at - 1); return
      case 'Home':
        event.preventDefault(); move(0); return
      case 'End':
        event.preventDefault(); move(buttons.length - 1); return
      case 'Enter': case ' ':
        event.preventDefault(); this.pickOption(row, at, options); return
      default: {
        const digit = Number(event.key)
        if (Number.isInteger(digit) && digit >= 1 && digit <= options.length) {
          event.preventDefault()
          this.pickOption(row, digit - 1, options)
        }
      }
    }
  }

  /** PICK — send the option's label as the next user turn through the
   *  ordinary path. Refused while a question is out (the options are also
   *  `disabled` then, the idiom retry already uses); `send()` itself is
   *  unchanged. The keys are released first: the group is about to leave. */
  pickOption(row: number, index: number, options: readonly string[]): void {
    if (this.waiting()) return
    if (this.openQuestion()?.index !== row) return
    const label = options[index]
    if (!label) return
    this.#releaseQuestionKeys()
    void this.send(label)
  }

  /** The settled line's answer — the option's label, or that the participant
   *  answered in their own words. */
  answerOf(question: SettledQuestion): string {
    if (typeof question.outlet === 'number') return question.options[question.outlet] ?? ''
    const i18n = ioc()?.get('@hypercomb.social/I18n') as { t?: (key: string) => string } | undefined
    return i18n?.t?.('chat.question.own') || 'answered in your own words'
  }

  /** The outlets NOT taken, for the settled line's title and the card. */
  otherOutlets(question: SettledQuestion): string {
    return question.options
      .filter((_, at) => at !== question.outlet)
      .join(' · ')
  }

  // ── THE ROUTE — the conversation's workflow, fixed in place beside it ───
  //
  // A vertical pipe down the sidebar on the right of the thread, one stage per
  // exchange (documentation/chat-route.md). Junctions are the questions above,
  // derived here; work pieces are runs read from the ledger by essentials; the
  // end is a reversible state. The route is a VIEW over records that already
  // exist. It writes nothing.

  /** What `readRoute` returned for the open conversation, or null when it is
   *  absent, has not been read, or could not be. */
  readonly route = signal<Route | null>(null)

  /** The read THREW — a store fault, not an empty ledger. Draws one quiet
   *  line at the thread's foot, never an empty pipe. */
  readonly routeError = signal(false)

  /** Work rows by turn signature — the join with the drawn rows. */
  readonly #routeBySig = computed(() => {
    const map = new Map<string, readonly RoutePiece[]>()
    for (const row of this.route()?.rows ?? []) map.set(row.turnSig, row.pieces)
    return map
  })

  /** A reply's own runs, matched on the turn's sig — a turn without one gets
   *  none. `unfinishedAfter` is the runs no reply followed after a row. */
  workOf(entry: { turn: ChatTurn; index: number }): readonly RoutePiece[] {
    const sig = entry.turn.sig
    return sig ? this.#routeBySig().get(sig) ?? [] : []
  }

  unfinishedAfter(index: number): readonly RoutePiece[] {
    return (this.route()?.unfinished ?? [])
      .filter(item => item.afterIndex === index)
      .map(item => item.piece)
  }

  /** The pipe's last row: open while the conversation goes on, a cap that
   *  says goal reached or put away. Both are states the participant can
   *  reverse, and the cap says so. */
  readonly routeEnd = computed<'open' | 'goal' | 'archived'>(() =>
    this.activeArchived() ? 'archived' : this.activeGoal() ? 'goal' : 'open')

  /** The end cap's glyph. A resolver rather than a template ternary: the
   *  icon extractor reads every literal in a `.mat-sym` interpolation, and
   *  `routeEnd() === 'goal' ? …` shipped the WORD "goal" into the subset
   *  request (it is not a Material Symbol). Written as two returns so rule 4
   *  of scripts/icon-names.cjs sees both glyphs. */
  endIcon(): string {
    if (this.routeEnd() === 'goal') return 'task_alt'
    return 'archive'
  }

  /** The glyph for a run: its first attempt's verb, through the map. */
  pieceIcon(piece: RoutePiece): string {
    const verb = piece.attempts[0]?.verb ?? ''
    return (VERB_ICONS.find(entry => entry.verb === verb) ?? VERB_ICON_FALLBACK).icon
  }

  /** The failed attempt a leak is named for — the first one. */
  leakOf(piece: RoutePiece): RouteAttempt | undefined {
    return piece.attempts.find(attempt => attempt.outcome === 'failed')
  }

  /** The sidebar's one roving tab stop, by card key (`n:<id>`, `s:<row>`,
   *  `live`, `wait`, `end`). '' means the first card. Every other card is
   *  `tabindex=-1`; the ARIA tree keys walk between them under the column's
   *  keymap hold. */
  readonly routeCursor = signal('')

  #routeKeysHeld = false

  /** What a work piece says to a screen reader — and its title. A leak
   *  names the failure in words: failed, the verb, the target. Colour never
   *  carries the meaning alone. */
  pieceLabel(piece: RoutePiece, kind: 'work' | 'live' | 'unfinished'): string {
    const parts: string[] = []
    const leak = this.leakOf(piece)
    if (leak) parts.push(this.#t('chat.route.leak', { verb: leak.verb, target: leak.cell || '—' }))
    parts.push(this.#t('chat.route.work', { count: piece.attempts.length }))
    if (kind === 'live') parts.push(this.#t('chat.route.live'))
    else if (piece.inProgress) parts.push(this.#t('chat.route.inProgress'))
    else if (kind === 'unfinished') parts.push(this.#t('chat.route.unfinished'))
    if (piece.placedByTime) parts.push(this.#t('chat.route.placedByTime'))
    return parts.join(' — ')
  }

  /** A catalog string, for the labels the component builds itself. */
  #t(key: string, params?: Record<string, string | number>): string {
    const i18n = ioc()?.get('@hypercomb.social/I18n') as
      { t?: (key: string, params?: Record<string, string | number>) => string } | undefined
    return i18n?.t?.(key, params) ?? key
  }

  #releaseRouteKeys(): void {
    if (!this.#routeKeysHeld) return
    this.#routeKeysHeld = false
    EffectBus.emit('keymap:unsuppress', { reason: ROUTE_KEYS_REASON })
  }

  // ── THE SIDEBAR — the workflow, working its way down ────────────────────
  //
  // Jaime, 2026-09-10: "a visual workflow of what you accomplished on the
  // right hand sidebar working its way down. It can be a viewport where you
  // can pull it or you can just have it all on screen." And for v2: "give you
  // a full summary at every state and kind of move you down the chat as well
  // to find that spot … create a tree when this deviation happens for each of
  // the nodes and show it vertically visually spread out … move it up and
  // down inside to side slightly."
  //
  // So the column is two surfaces (chat-route.md §4). On top, the TREE: when
  // the participant's own local model has organized the conversation, its
  // tasks in preorder, each branch one indent step in with the pipe elbowing
  // into it; then, on the main line, one dormant card per exchange it has not
  // read, the live run or the wait, and the end. Under it, the SUMMARY PANE:
  // where the current step stands, its branches, its decisions and its work.
  // A step becomes current by a press, by the keys, or by scrolling the thread
  // to its messages; a press or a key HOLDS until the participant scrolls the
  // thread. Steering happens in the handlers and reverse sync only selects,
  // so the two can never loop. Derived from the rows above and the route
  // essentials reads; it writes nothing and never shows a message.

  /** The tree viewport and the summary pane, while they are on screen. */
  readonly routeSide = viewChild<ElementRef<HTMLElement>>('routeSide')
  readonly routeSummary = viewChild<ElementRef<HTMLElement>>('routeSummary')

  /** For the after-render hooks: a fold's anchor and a card not drawn yet —
   *  never an animation frame, which a hidden tab is never served. */
  readonly #injector = inject(Injector)

  /** PRESENCE: any open conversation with a turn in it, when there is room
   *  beside the thread (the rail's own query — below 701 px the settled lines
   *  inside the turns carry the decisions and nothing is drawn). Not gated on
   *  junctions or work: a plain chat's workflow is its exchanges. */
  // HIDDEN (Jaime, 2026-09-11: "hide the workflow sidebar for now and stop").
  // Everything that draws the route or asks the local model to organize it
  // gates on this, so false hides the column and stops the attended call.
  // Flip to true to bring it back.
  readonly routeSideShown = computed(() =>
    this.routeSideWanted() && this.railVisible() && !!this.activeId() && this.turns().length > 0)

  /** The participant's choice to show the workflow column at all — a header
   *  icon toggles it (Jaime, 2026-09-11: "hide and show it when we want more
   *  chat screen real estate"). Shown by default; sticky per device. */
  readonly routeSideWanted = signal(readRouteSideWanted())
  toggleRouteSide(): void {
    const next = !this.routeSideWanted()
    this.routeSideWanted.set(next)
    try { localStorage.setItem(ROUTE_SIDE_WANTED_KEY, next ? 'true' : 'false') } catch { /* private mode */ }
  }

  /** Branches folded away (←, or the fold mark), by conversation, for as long
   *  as the window lives. Not a record: how the participant is looking. */
  readonly #routeFolds = signal<ReadonlyMap<string, ReadonlySet<string>>>(new Map())

  /** THE TREE AS DRAWN (§4.2). The flow's drawn nodes laid out in preorder
   *  (`layoutRouteTree`), then the tail, then the pipes between them
   *  (`routePipes`). It never reads the current step, so selecting one never
   *  re-lays the tree. */
  readonly routeTree = computed<RouteTree>(() => {
    const none: RouteTree = { items: [], pipes: [], cols: 1, rows: 0, nodes: new Map(), parentOf: new Map(), kids: new Map() }
    if (!this.routeSideShown()) return none
    const rendered = this.rendered()
    const route = this.route()
    const flow = route?.flow
    const limit = flow ? Math.max(0, Math.min(flow.upToTurnCount, rendered.length)) : 0
    const ownRows = (node: RouteFlowNode): number[] =>
      [...new Set(node.turns)].filter(row => Number.isInteger(row) && row >= 0 && row < limit).sort((a, b) => a - b)
    const flowNodes = flow?.nodes ?? []
    const drawn = new Set(flowNodes.filter(node => ownRows(node).length > 0).map(node => node.id))
    // A flow that draws nothing is no flow: the whole conversation is the tail.
    const upTo = drawn.size ? limit : 0
    const folded = this.#routeFolds().get(this.activeId() || '') ?? new Set<string>()
    const layout = layoutRouteTree(
      flowNodes.map(node => ({ id: node.id, parent: node.parent, drawn: drawn.has(node.id) })), folded)
    const nodes = new Map<string, RouteFlowNode>()
    for (const node of flowNodes) if (drawn.has(node.id) && !nodes.has(node.id)) nodes.set(node.id, node)

    /** What a set of thread rows recorded: each reply's own runs, then the runs
     *  no reply followed after that row; every question; the first reply. */
    const recorded = (rows: readonly number[]) => {
      const runs: RoutePiece[] = []
      const unfinished = new Set<string>()
      const questions: SettledQuestion[] = []
      let replyRow = -1
      for (const row of rows) {
        const entry = rendered[row]
        if (!entry) continue
        runs.push(...this.workOf(entry))
        for (const piece of this.unfinishedAfter(row)) { runs.push(piece); unfinished.add(piece.runId) }
        if (entry.question) questions.push(entry.question)
        if (entry.turn.role === 'assistant' && replyRow < 0) replyRow = row
      }
      return { runs, unfinished, questions, replyRow }
    }

    type Draft = Omit<RouteItem, 'dashed' | 'joint' | 'jointSides' | 'stem' | 'setSize' | 'posInSet'>
    const drafts: Draft[] = []
    for (const id of layout.order) {
      const node = nodes.get(id)
      const at = layout.place.get(id)
      if (!node || !at) continue
      const rows = ownRows(node)
      const beneath = layout.descendants.get(id) ?? 0
      const collapsed = beneath > 0 && folded.has(id)
      const first = collapsed ? undefined : layout.kids.get(id)?.[0]
      drafts.push({
        key: `n:${id}`, kind: 'node', row: rows[0] ?? -1, rows, node, ...recorded(rows),
        x: at.x, y: at.y, level: at.level, parent: layout.parentOf.get(id),
        firstChild: first === undefined ? undefined : `n:${first}`, descendants: beneath, collapsed,
      })
    }

    // THE TAIL, on the main line: ONE quiet card holding every exchange the flow has not read.
    // An exchange opens at a user turn; the first one past the flow opens
    // wherever the flow stopped, so turns before the first user turn — or a
    // reply that grew inside the last organized exchange — still ride a card.
    let y = layout.treeRows
    const starts = rendered
      .filter(entry => entry.index >= upTo && (entry.index === upTo || entry.turn.role === 'user'))
      .map(entry => entry.index)
    if (starts.length) {
      const start = starts[0]!
      const rows = Array.from({ length: rendered.length - start }, (_, offset) => start + offset)
      drafts.push({
        key: `s:${start}`, kind: 'stage', row: start, rows, ...recorded(rows), exchanges: starts.length,
        x: 0, y: y++, level: 1, descendants: 0, collapsed: false,
      })
    }
    const bare = {
      row: -1, rows: [] as readonly number[], runs: [] as readonly RoutePiece[], unfinished: new Set<string>(),
      questions: [] as readonly SettledQuestion[], replyRow: -1, x: 0, level: 1, descendants: 0, collapsed: false,
    }
    const live = route?.live
    if (live) drafts.push({ ...bare, key: 'live', kind: 'live', piece: live, runs: [live], y: y++ })
    else if (this.waiting()) drafts.push({ ...bare, key: 'wait', kind: 'wait', y: y++ })
    drafts.push({ ...bare, key: 'end', kind: 'end', y: y++ })

    // Every length of pipe after an open question, in reading order, is dashed.
    let open = false
    const dashed = drafts.map(draft => {
      const into = open
      if (draft.questions.some(question => question.state === 'open')) open = true
      return into
    })
    const pipes = routePipes(drafts.map((draft, at) => ({
      key: draft.key, x: draft.x, y: draft.y,
      parent: draft.parent === undefined ? undefined : `n:${draft.parent}`, dashed: dashed[at]!,
    })))
    const sets = new Map<string, string[]>()
    for (const draft of drafts) {
      const set = draft.parent ?? ''
      const members = sets.get(set) ?? []
      members.push(draft.key)
      sets.set(set, members)
    }
    const items = drafts.map((draft, at): RouteItem => {
      const siblings = sets.get(draft.parent ?? '') ?? []
      const joint = pipes.joints.get(draft.key) ?? []
      return {
        ...draft, dashed: dashed[at]!, joint, jointSides: joint.map(seg => seg.side).join(' '),
        stem: pipes.stems.get(draft.key) ?? null, setSize: siblings.length, posInSet: siblings.indexOf(draft.key) + 1,
      }
    })
    return { items, pipes: pipes.pipes, cols: layout.cols, rows: y, nodes, parentOf: layout.parentOf, kids: layout.kids }
  })

  /** A node's state as a glyph — four returns, so the icon subset extractor
   *  (scripts/icon-names.cjs, rule 4) sees every one. */
  nodeIcon(state: RouteFlowState): string {
    switch (state) {
      case 'open': return 'hourglass_empty'
      case 'decided': return 'alt_route'
      case 'dropped': return 'block'
      default: return 'task_alt'
    }
  }

  /** A step's glyph: what it WAS when its card says so, else its state. */
  stepIcon(node: Pick<RouteFlowNode, 'state' | 'card'>): string {
    const kind = node.card?.kind
    return (kind && KIND_ICONS.find(entry => entry.kind === kind)?.icon) || this.nodeIcon(node.state)
  }

  /** THE MASTHEAD's words: the conversation's name, where it stands, its counts. */
  readonly sessionHead = computed<RouteHead | null>(() => {
    if (!this.activeId()) return null
    const flow = this.route()?.flow
    if (!flow?.nodes.length) return null
    const counts = flow.counts ?? {}
    const done = (counts.done ?? 0) + (counts.decided ?? 0)
    const open = counts.open ?? 0
    const session = flow.session
    const root = flow.nodes.find(node => !node.parent) ?? flow.nodes[0]!
    const newestCarded = [...flow.nodes].reverse().find(node => node.card?.outcome && !node.card.stale)
    const openStep = [...flow.nodes].reverse().find(node => node.state === 'open')
    return {
      name: String(session?.name || root.title || '').trim(),
      stands: String(session?.stands || newestCarded?.card?.outcome || '').trim(),
      stale: !!session?.stale,
      icon: open > 0 ? this.stepIcon(openStep ?? root) : 'task_alt',
      done, open, total: flow.nodes.length,
    }
  })

  /** THE STEP RULES: the thread row each step begins at. */
  readonly stepRules = computed<ReadonlyMap<number, StepRule>>(() => {
    const limit = this.turns().length
    const rules = new Map<number, StepRule>()
    for (const node of this.route()?.flow?.nodes ?? []) {
      const rows = node.turns.filter(row => Number.isInteger(row) && row >= 0 && row < limit)
      if (!rows.length) continue
      const row = Math.min(...rows)
      if (!rules.has(row)) rules.set(row, { title: node.title, icon: this.stepIcon(node), state: node.state })
    }
    return rules
  })

  /** The fold mark: folded shows the way in, unfolded the way it opened. */
  foldIcon(item: RouteItem): string {
    return item.collapsed ? 'chevron_right' : 'expand_more'
  }

  /** A node state's words, by literal key so the catalogs' drift check can
   *  see every one. */
  routeStateKey(state: RouteFlowState): string {
    switch (state) {
      case 'open': return 'chat.route.flow.state.open'
      case 'decided': return 'chat.route.flow.state.decided'
      case 'dropped': return 'chat.route.flow.state.dropped'
      default: return 'chat.route.flow.state.done'
    }
  }

  /** The turns a card covers, as the thread numbers them for a person:
   *  one-based, consecutive runs joined — `1–3, 6`. */
  routeTurnRange(rows: readonly number[] | undefined): string {
    return spansOf(rows ?? [])
      .map(span => span.length > 1 ? `${span[0]! + 1}–${span[span.length - 1]! + 1}` : `${span[0]! + 1}`)
      .join(', ')
  }

  /** A card's work, compacted to one mark: the first run's glyph, every
   *  attempt counted, broken when any failed. Null when it holds no work. */
  routeWorkOf(item: RouteItem): { readonly first: RoutePiece; readonly count: number; readonly leak: boolean } | null {
    const first = item.runs[0]
    if (!first) return null
    return { first, count: this.routeAttemptCount(item), leak: item.runs.some(run => run.leak) }
  }

  routeAttemptCount(item: RouteItem): number {
    return item.runs.reduce((sum, run) => sum + run.attempts.length, 0)
  }

  routeLeakCount(item: RouteItem): number {
    return item.runs.reduce((sum, run) => sum + run.attempts.filter(attempt => attempt.outcome === 'failed').length, 0)
  }

  /** Any question on the card still open — its mark is dashed. */
  routeQuestionOpen(item: RouteItem): boolean {
    return item.questions.some(question => question.state === 'open')
  }

  /** `data-route-card`: whether a node's card is current, stale, or absent. */
  routeCardState(node: RouteFlowNode): 'current' | 'stale' | 'none' {
    return node.card ? (node.card.stale ? 'stale' : 'current') : 'none'
  }

  /** The one roving tab stop: the cursor's card while it exists, else the
   *  first card of the tree. */
  isRouteStop(key: string): boolean {
    const cursor = this.routeCursor()
    const items = this.routeTree().items
    const stop = cursor && items.some(item => item.key === cursor) ? cursor : items[0]?.key
    return stop === key
  }

  /** The end's words: open, goal reached, put away — all reversible. */
  endLabelKey(): string {
    const end = this.routeEnd()
    return end === 'goal' ? 'chat.route.end.goal' : end === 'archived' ? 'chat.route.end.archived' : 'chat.route.end.open'
  }

  endHintKey(): string {
    const end = this.routeEnd()
    return end === 'goal' ? 'chat.route.end.goalHint' : end === 'archived' ? 'chat.route.end.archivedHint' : 'chat.route.end.openHint'
  }

  /** What a card says to a screen reader. The live card leads with its leak
   *  when there is one — colour never carries it alone. */
  routeItemLabel(item: RouteItem): string {
    switch (item.kind) {
      case 'node': {
        if (!item.node) return ''
        const said = this.#t('chat.route.flow.node', {
          title: item.node.title || this.#t('chat.route.flow.untitled'),
          state: this.#t(this.routeStateKey(item.node.state)),
        })
        return item.collapsed ? `${said} — ${this.#t('chat.route.flow.hidden', { count: item.descendants })}` : said
      }
      case 'stage': return this.#t(this.routeTailKey(), { count: item.exchanges ?? 1 })
      case 'wait': return this.#t('chat.route.waiting')
      case 'end': return this.#t(this.endLabelKey())
      default: return item.piece ? this.pieceLabel(item.piece, 'live') : ''
    }
  }

  /** The dormant tail's words: NEWER exchanges past an organized flow, or the
   *  whole conversation while nothing is organized. Literal keys. */
  routeTailKey(): string {
    return this.routeTree().nodes.size ? 'chat.route.tail.newer' : 'chat.route.tail.all'
  }

  // ── THE CURRENT STEP (§4.4.3) — one signal, four sources ─────────────────

  readonly routeCurrent = signal<{ readonly key: string; readonly source: RouteSource } | null>(null)
  /** The active span of the current card — which run of its rows. */
  readonly routeSpanAt = signal(0)
  /** A steer of the thread is running (`.chat-thread[data-route-steering]`). */
  readonly routeSteering = signal(false)
  /** Exchanges past the flow, when reading past it chose the current step. */
  readonly routeNewer = signal(0)
  /** A press, key or span choice holds until the participant scrolls the thread. */
  readonly routeHold = signal(false)
  /** The tree is at its bottom and its inline start (`data-route-follow`). */
  readonly routeFollowing = signal(true)
  readonly routePulling = signal(false)
  /** The pointer is over the column: the thread only moves by itself then
   *  (streaming, a steer), so reverse sync keeps the pane still. Focus does
   *  not pause it — a pressed card keeps the focus. */
  routePointerInside = false

  readonly #routeCurrentKey = computed(() => this.routeCurrent()?.key ?? '')

  /** The current card as the tree now draws it. */
  readonly routeCurrentItem = computed<RouteItem | null>(() => {
    const key = this.#routeCurrentKey()
    return key ? this.routeTree().items.find(item => item.key === key) ?? null : null
  })

  /** WHAT THE PANE SHOWS — never nothing while the tree draws anything: the
   *  current step, else the newest open step, else the last step, else the tail. */
  readonly routePaneItem = computed<RouteItem | null>(() => {
    const current = this.routeCurrentItem()
    if (current) return current
    const items = this.routeTree().items
    const steps = items.filter(item => item.kind === 'node' && !!item.node)
    return [...steps].reverse().find(item => item.node!.state === 'open')
      ?? steps[steps.length - 1]
      ?? items.find(item => item.kind === 'stage')
      ?? null
  })

  /** The thread's lit rows: exactly the current card's. */
  readonly routeLitRows = computed<ReadonlySet<number>>(() => new Set(this.routeCurrentItem()?.rows ?? []))

  readonly routeSpans = computed(() => spansOf(this.routePaneItem()?.rows ?? []))

  /** The row the start line marks — only while a hold stands. */
  readonly routeAnchorRow = computed(() =>
    this.routeHold() ? this.routeSpans()[this.routeSpanAt()]?.[0] ?? -1 : -1)

  /** The start line's offset in the thread, measured after the render. */
  readonly routeAnchorTop = signal<number | null>(null)

  /** When the current key last changed — `prefer` waits ROUTE_SUMMARY_ASK_MS. */
  #routeCurrentSince = 0
  /** A card that became current by focus alone (Tab-in): its first press is a
   *  press, not "again". */
  #routeTabbedKey = ''
  #keySettle: ReturnType<typeof setTimeout> | null = null
  #preferTimer: ReturnType<typeof setTimeout> | null = null

  /** What the pane says, by state (§4.4.2) — `data-route-summary-state`. */
  readonly routeSummaryState = computed(() => {
    const item = this.routePaneItem()
    if (!item) return 'empty'
    const route = this.route()
    if (item.kind === 'stage') {
      if (route?.organizing?.stage === 'structure') return 'dormant-organizing'
      return route?.organizer ? 'dormant-waiting' : 'dormant-no-model'
    }
    if (item.kind !== 'node' || !item.node) return 'item'
    const card = item.node.card
    if (card) return card.stale ? 'stale' : 'summary'
    const organizing = route?.organizing
    if (organizing?.stage === 'card' && organizing.nodeId === item.node.id) return 'summarizing'
    if (route?.organizer) return route.cardBackoff?.includes(item.node.id) ? 'unusable' : 'pending'
    // An essentials build older than cards still hands its one-line detail.
    if (route?.organizerState === undefined && item.node.detail) return 'summary'
    return 'no-model'
  })

  /** THE STATUS LINE: what the local model is doing about the current step,
   *  or why nothing is. With a card it shows only while the card's replacement
   *  is being written or is due. Keys are literal; the model's name is
   *  interpolated, never translated. */
  readonly routeStatus = computed((): { readonly key: string; readonly params: Record<string, string | number> } | null => {
    const item = this.routePaneItem()
    const route = this.route()
    if (!item || !route) return null
    const model = route.organizer?.model ?? route.flow?.model ?? ''
    const id = item.node?.id
    const writing = route.organizing?.stage === 'card' && route.organizing.nodeId === id
    const state = this.routeSummaryState()
    switch (state) {
      case 'summarizing': return { key: 'chat.route.summary.summarizing', params: { model } }
      case 'pending': return { key: 'chat.route.summary.pending', params: { model } }
      case 'unusable': return { key: 'chat.route.summary.unusable', params: {} }
      case 'dormant-organizing': return { key: 'chat.route.summary.dormant.organizing', params: { model } }
      case 'dormant-waiting': return { key: 'chat.route.summary.dormant.waiting', params: { model } }
      case 'summary':
      case 'stale': {
        if (writing) return { key: 'chat.route.summary.summarizing', params: { model } }
        if (state !== 'stale' || !route.organizer) return null
        return id && route.cardBackoff?.includes(id)
          ? { key: 'chat.route.summary.unusable', params: {} }
          : { key: 'chat.route.summary.pending', params: { model } }
      }
      case 'no-model':
      case 'dormant-no-model': {
        const key = routeWhyKey(route.organizerState)
        return key ? { key, params: {} } : null
      }
      default: return null
    }
  })

  /** A branch's path, root to parent, for the pane's "Part of" line. */
  routePathOf(item: RouteItem): string {
    const tree = this.routeTree()
    const titles: string[] = []
    for (let id = item.parent; id !== undefined; id = tree.parentOf.get(id)) {
      titles.unshift(tree.nodes.get(id)?.title || this.#t('chat.route.flow.untitled'))
    }
    return titles.join(' › ')
  }

  /** A parent's branches, visible or folded, in record order. */
  routeBranchesOf(item: RouteItem): readonly RouteFlowNode[] {
    if (!item.node) return []
    const tree = this.routeTree()
    return (tree.kids.get(item.node.id) ?? [])
      .map(id => tree.nodes.get(id))
      .filter((node): node is RouteFlowNode => !!node)
  }

  /** "This summary by" — only when the card's model is not the flow's. */
  routeCardBy(item: RouteItem): string {
    const model = item.node?.card?.model ?? ''
    return model && model !== (this.route()?.flow?.model ?? '') ? model : ''
  }

  /** Goal and what was done: opened once, it stays open while walking the
   *  steps of that conversation, for the window's life. */
  readonly #routeMoreOpen = signal<ReadonlySet<string>>(new Set())

  routeMoreOpen(): boolean {
    return this.#routeMoreOpen().has(this.activeId() || '')
  }

  onRouteMoreToggle(event: Event): void {
    const open = (event.target as HTMLDetailsElement).open
    const convoId = this.activeId() || ''
    if (!convoId || open === this.routeMoreOpen()) return
    const next = new Set(this.#routeMoreOpen())
    if (open) next.add(convoId); else next.delete(convoId)
    this.#routeMoreOpen.set(next)
  }

  /**
   * SELECT A STEP (§4.4.4). A press, a key or a span chip holds and moves the
   * thread — a press and a chip at once, a key once the walk rests. Reading
   * (`thread`) only selects: it never moves the thread, so pressing and
   * scrolling cannot loop. The tree reveals the card either way. Steering is
   * done here, imperatively — never as an effect reacting to the signal.
   */
  selectRouteItem(item: RouteItem, source: RouteSource, span?: number): void {
    if (source === 'press' && this.#routePulled) return
    if (this.#keySettle !== null) { clearTimeout(this.#keySettle); this.#keySettle = null }
    const previous = this.routeCurrent()
    const same = previous?.key === item.key && this.#routeTabbedKey !== item.key
    this.#routeTabbedKey = ''
    if (source !== 'thread') {
      this.routeCursor.set(item.key)
      this.routeHold.set(true)
      this.routeNewer.set(0)
    }
    if (previous?.key !== item.key) {
      this.#routeCurrentSince = performance.now()
      this.#armPrefer(item.key)
    }
    this.routeCurrent.set({ key: item.key, source })
    const element = this.#routeElement(item.key)
    if (element) this.#revealRoute(element, source === 'thread' ? 'thread' : 'participant')
    if (source === 'thread') return
    if (source === 'key') {
      const key = item.key
      this.#keySettle = setTimeout(() => {
        this.#keySettle = null
        const settled = this.routeTree().items.find(entry => entry.key === key)
        if (settled && document.activeElement === this.#routeElement(key)) this.#steerTo(settled, 'key')
      }, ROUTE_KEY_SETTLE_MS)
      return
    }
    this.#steerTo(item, source, span, same)
  }

  /** A card's press, as the sidebar is now. A press that turned into a pull
   *  is not a press. */
  onRouteItemClick(item: RouteItem): void {
    this.selectRouteItem(this.routeTree().items.find(entry => entry.key === item.key) ?? item, 'press')
  }

  /** Tab-in, or programmatic focus, moves the roving cursor only. It sets the
   *  current step only when nothing is current, and never moves the thread. */
  onRouteItemFocus(item: RouteItem): void {
    this.routeCursor.set(item.key)
    if (this.routeCurrent()) return
    this.#routeTabbedKey = item.key
    this.#routeCurrentSince = performance.now()
    this.routeCurrent.set({ key: item.key, source: 'key' })
  }

  /** A span chip: straight to that run of the current step's messages. */
  onRouteSpan(index: number): void {
    const item = this.routePaneItem()
    if (item) this.selectRouteItem(item, 'span', index)
  }

  /** A pane branch line selects that child as a press would. A child inside a
   *  folded branch unfolds its ancestors first and lands after the render. The
   *  focus goes to its card, since the line it was on is about to leave. */
  pressRouteBranch(nodeId: string): void {
    const convoId = this.activeId() || ''
    const tree = this.routeTree()
    const held = new Set(this.#routeFolds().get(convoId) ?? [])
    let unfolded = false
    for (let id = tree.parentOf.get(nodeId); id !== undefined; id = tree.parentOf.get(id)) {
      if (held.delete(id)) unfolded = true
    }
    const land = (): void => {
      const key = `n:${nodeId}`
      const item = this.routeTree().items.find(entry => entry.key === key)
      if (!item) return
      this.#routeElement(key)?.focus({ preventScroll: true })
      this.selectRouteItem(item, 'press')
    }
    if (!unfolded || !convoId) { land(); return }
    const all = new Map(this.#routeFolds())
    all.set(convoId, held)
    this.#routeFolds.set(all)
    afterNextRender(land, { injector: this.#injector })
  }

  onRouteBranchKey(event: KeyboardEvent, nodeId: string): void {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    this.pressRouteBranch(nodeId)
  }

  /** THE OPEN QUESTION, from its step's pane: the thread steers to the
   *  question and its current option takes the focus — what pressing v1's
   *  open junction card did. It is answered in the thread, never here. */
  pressRouteQuestion(question: SettledQuestion): void {
    if (question.state !== 'open' || this.openQuestion()?.index !== question.index) return
    const options = this.#questionOptions()
    const option = options[this.questionCursor()] ?? options[0]
    if (!option) return
    this.routeHold.set(true)
    this.#steerThreadTo(question.index, option.closest<HTMLElement>('.chat-question') ?? undefined)
    if (!option.disabled) option.focus({ preventScroll: true })
  }

  onRouteQuestionKey(event: KeyboardEvent, question: SettledQuestion): void {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    this.pressRouteQuestion(question)
  }

  // ── MOVING THE PARTICIPANT DOWN THE CHAT TO THE SPOT (§4.4.4) ────────────

  /** Pick the span and move the thread to it — unless a covered row is
   *  already in the reading band, when that span becomes the active one and
   *  nothing moves. Pressing the current card again walks to its next span. */
  #steerTo(item: RouteItem, source: RouteSource, span?: number, same = false): void {
    // The live run, the wait and the end live at the thread's foot.
    if (item.row < 0) { this.#scrollDown(true); return }
    const spans = spansOf(item.rows)
    if (!spans.length) return
    const inBand = spans.findIndex(run => run.some(row => this.#rowInBand(row)))
    const walk = same && source === 'press'
    const at = span ?? (walk ? (this.routeSpanAt() + 1) % spans.length : inBand >= 0 ? inBand : 0)
    const active = Math.max(0, Math.min(spans.length - 1, at))
    this.routeSpanAt.set(active)
    if (span === undefined && !walk && inBand >= 0) return
    this.#steerThreadTo(spans[active]![0]!)
  }

  /** A thread row is in the reading band: 8%–40% of the thread's height. */
  #rowInBand(row: number): boolean {
    const scroller = this.scroller()?.nativeElement
    const message = scroller?.querySelector<HTMLElement>(`.chat-msg[data-route-row="${row}"]`)
    if (!scroller || !message) return false
    const view = scroller.getBoundingClientRect()
    const rect = message.getBoundingClientRect()
    const top = view.top + view.height * ROUTE_BAND.top
    const bottom = view.top + view.height * ROUTE_BAND.bottom
    return rect.bottom > top && rect.top < bottom
  }

  #steer: {
    readonly token: number
    quiet: ReturnType<typeof setTimeout> | null
    readonly cap: ReturnType<typeof setTimeout>
    readonly scroller: HTMLElement
  } | null = null
  #steerToken = 0

  /** The thread position this component last set itself — a steer's target, a
   *  follow of the newest turn. A thread scroll anywhere else, outside a
   *  steer, is the participant's own, and it releases the hold. */
  #threadExpect: number | null = null

  /**
   * STEER THE THREAD so the row (or `target` inside it) sits 0.75rem below
   * the thread's top. Scoped: the position comes from rects and is set on the
   * scroller alone — `scrollIntoView` would scroll every scrollable ancestor.
   * Smooth only when short and motion is allowed. `atBottom` is declared false
   * BEFORE the first scroll event, or follow-newest would yank a steer that
   * started at the bottom back mid-flight. The participant's own wheel, touch,
   * press or scroll key cancels it; it ends on `scrollend`, or a quiet spell,
   * capped — timers only, never an animation frame.
   */
  #steerThreadTo(row: number, target?: HTMLElement): void {
    const scroller = this.scroller()?.nativeElement
    const element = target ?? scroller?.querySelector<HTMLElement>(`.chat-msg[data-route-row="${row}"]`)
    if (!scroller || !element) return
    this.#cancelSteer(false)
    const view = scroller.getBoundingClientRect()
    const rect = element.getBoundingClientRect()
    const max = scroller.scrollHeight - scroller.clientHeight
    const top = clampScroll(scroller.scrollTop + (rect.top - view.top) - ROUTE_STEER_MARGIN_REM * remPx(), max)
    const distance = Math.abs(top - scroller.scrollTop)
    if (distance < 1) return
    const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
    const smooth = !reduced && distance <= scroller.clientHeight * ROUTE_SMOOTH_SCREENS
    if (max - top > NEAR_BOTTOM_PX) this.atBottom.set(false)
    const token = ++this.#steerToken
    this.#steer = { token, quiet: null, cap: setTimeout(() => this.#endSteer(token), ROUTE_STEER_MAX_MS), scroller }
    scroller.addEventListener('wheel', this.#onSteerInput, { passive: true })
    scroller.addEventListener('touchstart', this.#onSteerInput, { passive: true })
    scroller.addEventListener('pointerdown', this.#onSteerInput, { passive: true })
    scroller.addEventListener('keydown', this.#onSteerKey)
    scroller.addEventListener('scrollend', this.#onSteerEnd)
    this.#threadExpect = top
    this.routeSteering.set(true)
    scroller.scrollTo({ top, behavior: smooth ? 'smooth' : 'auto' })
    this.#armQuiet(token)
  }

  #onSteerInput = (): void => { this.#cancelSteer(true) }
  #onSteerKey = (event: KeyboardEvent): void => { if (ROUTE_STEER_KEYS.has(event.key)) this.#cancelSteer(true) }
  #onSteerEnd = (): void => { if (this.#steer) this.#endSteer(this.#steer.token) }

  #armQuiet(token: number): void {
    const steer = this.#steer
    if (!steer || steer.token !== token) return
    if (steer.quiet !== null) clearTimeout(steer.quiet)
    steer.quiet = setTimeout(() => this.#endSteer(token), ROUTE_STEER_QUIET_MS)
  }

  /** Drop a steer's timers and listeners; the scroller it ran on, if any. */
  #disarmSteer(): HTMLElement | null {
    const steer = this.#steer
    if (!steer) return null
    this.#steer = null
    if (steer.quiet !== null) clearTimeout(steer.quiet)
    clearTimeout(steer.cap)
    steer.scroller.removeEventListener('wheel', this.#onSteerInput)
    steer.scroller.removeEventListener('touchstart', this.#onSteerInput)
    steer.scroller.removeEventListener('pointerdown', this.#onSteerInput)
    steer.scroller.removeEventListener('keydown', this.#onSteerKey)
    steer.scroller.removeEventListener('scrollend', this.#onSteerEnd)
    this.routeSteering.set(false)
    return steer.scroller
  }

  #endSteer(token: number): void {
    if (this.#steer?.token !== token) return
    this.#disarmSteer()
    setTimeout(() => this.#measureAnchor(), 0)
  }

  /** THE PARTICIPANT ALWAYS WINS. Their input stops the steer where it is,
   *  and the scroll that follows is theirs, so it clears the hold. `stop`
   *  false only ends the bookkeeping: a follow of the newest turn is about to
   *  take the view. */
  #cancelSteer(stop: boolean): void {
    const scroller = this.#disarmSteer()
    if (!scroller || !stop) return
    this.#threadExpect = null
    scroller.scrollTo({ top: scroller.scrollTop, behavior: 'auto' })
  }

  /** THE START LINE's offset: the row's top, half the thread's gap above it —
   *  measured after the render, static, never animated. */
  readonly #routeAnchorWatch = effect(() => {
    this.routeAnchorRow()
    this.rendered()
    setTimeout(() => this.#measureAnchor(), 0)
  })

  #measureAnchor(): void {
    const row = this.routeAnchorRow()
    const scroller = this.scroller()?.nativeElement
    const message = row < 0 ? null : scroller?.querySelector<HTMLElement>(`.chat-msg[data-route-row="${row}"]`)
    if (!scroller || !message) { this.routeAnchorTop.set(null); return }
    const gap = parseFloat(getComputedStyle(scroller).rowGap) || 0
    this.routeAnchorTop.set(message.offsetTop - gap / 2)
  }

  /** The pane reads from its top whenever the current step changes. */
  readonly #routePaneTop = effect(() => {
    this.#routeCurrentKey()
    setTimeout(() => {
      const pane = this.routeSummary()?.nativeElement
      if (pane) pane.scrollTop = 0
    }, 0)
  })

  // ── REVERSE SYNC (§4.4.5) — the current step follows your reading ───────

  #readingObserver: IntersectionObserver | null = null
  #observed = new WeakSet<Element>()
  readonly #reading = new Set<number>()
  #readingTimer: ReturnType<typeof setTimeout> | null = null

  /** Watch which thread rows sit in the reading band. Re-armed after every
   *  render; each row is observed once, and a fresh observer reports every
   *  row's state on `observe`. */
  readonly #readingWatch = effect(() => {
    this.rendered()
    const shown = this.routeSideShown()
    const scroller = this.scroller()?.nativeElement
    setTimeout(() => {
      if (!shown || !scroller || typeof IntersectionObserver === 'undefined') { this.#disconnectReading(); return }
      if (!this.#readingObserver || this.#readingObserver.root !== scroller) {
        this.#disconnectReading()
        this.#readingObserver = new IntersectionObserver(entries => {
          for (const entry of entries) {
            const row = Number((entry.target as HTMLElement).dataset['routeRow'])
            if (!Number.isInteger(row)) continue
            if (entry.isIntersecting) this.#reading.add(row); else this.#reading.delete(row)
          }
          this.#scheduleReading()
        }, { root: scroller, rootMargin: '-8% 0px -60% 0px', threshold: 0 })
      }
      for (const element of scroller.querySelectorAll('.chat-msg[data-route-row]')) {
        if (this.#observed.has(element)) continue
        this.#observed.add(element)
        this.#readingObserver.observe(element)
      }
    }, 0)
  })

  /** Rows are tracked by position, so switching conversations reuses the same
   *  message elements — and an observer reports only CHANGES. Without a fresh
   *  observer, rows already in the band would never be re-added. */
  #disconnectReading(): void {
    this.#readingObserver?.disconnect()
    this.#readingObserver = null
    this.#observed = new WeakSet()
    this.#reading.clear()
    if (this.#readingTimer !== null) { clearTimeout(this.#readingTimer); this.#readingTimer = null }
  }

  #scheduleReading(): void {
    if (this.#readingTimer !== null) clearTimeout(this.#readingTimer)
    this.#readingTimer = setTimeout(() => {
      this.#readingTimer = null
      this.#applyReading()
    }, ROUTE_SYNC_MS)
  }

  /** Select the step being read. Never on leaving the column — that flipped a
   *  press back the moment the pointer left — and paused while a steer runs,
   *  a pull is in progress, the pointer is inside the column, or a choice
   *  holds. The current step stays while any of its rows is still being read;
   *  a gap between cards keeps what is current. */
  #applyReading(): void {
    if (!this.routeSideShown() || this.peeking() || this.#steer || this.#routeDrag?.pulling || this.routeHold()) return
    if (this.routePointerInside) return
    const rows = this.rendered()
    if (!rows.length) return
    const current = this.routeCurrentItem()
    if (current && current.rows.some(row => this.#reading.has(row))) return
    const anchor = this.atBottom() ? rows[rows.length - 1]!.index : this.#reading.size ? Math.min(...this.#reading) : null
    if (anchor === null) return
    const tree = this.routeTree()
    const { key, newer } = routeKeyForRow(this.route()?.flow, tree.items, rows, anchor)
    this.routeNewer.set(newer)
    if (!key || key === current?.key) return
    const item = tree.items.find(entry => entry.key === key)
    if (!item) return
    this.selectRouteItem(item, 'thread')
    this.routeSpanAt.set(Math.max(0, spansOf(item.rows).findIndex(run => run.includes(anchor))))
  }

  // ── THE VIEWPORT (§4.3) ─────────────────────────────────────────────────

  /** The last key a reveal was made for, whether the tree had to move or not. */
  #routeRevealedKey = ''
  /** The current card was fully inside the viewport, as last measured. */
  #routeCurrentVisible = false
  /** The position the component last scrolled the viewport to itself. Any
   *  other scroll — a pull, a wheel, a scrollbar, PageDown — is a pan. */
  #routeExpect: { readonly top: number; readonly left: number } | null = null
  #routePannedAt = -Infinity
  /** A fold anchored the toggled card in this render: do not follow over it. */
  #routeFoldAnchored = false

  #routeItemElements(): HTMLElement[] {
    const side = this.routeSide()?.nativeElement
    return side ? [...side.querySelectorAll<HTMLElement>('.chat-route-item')] : []
  }

  #routeElement(key: string): HTMLElement | null {
    return this.#routeItemElements().find(element => element.dataset['routeKey'] === key) ?? null
  }

  #routeInside(element: HTMLElement, side: HTMLElement): boolean {
    const view = side.getBoundingClientRect()
    const rect = element.getBoundingClientRect()
    return rect.top >= view.top - 1 && rect.bottom <= view.bottom + 1
      && rect.left >= view.left - 1 && rect.right <= view.right + 1
  }

  /** WHEN THE TREE CHANGES (§4.3.4), after the render: reveal the current
   *  card when its key changed since the last reveal, or when it was fully in
   *  view and a fold or an insertion moved it out; otherwise follow the newest
   *  while following; otherwise leave the viewport where the participant put
   *  it. A refresh that changes neither the current step nor its place moves
   *  nothing. */
  readonly #routeTreeWatch = effect(() => {
    this.routeTree()
    const before = this.#routeCurrentVisible
    setTimeout(() => this.#afterRouteTree(before), 0)
  })

  #afterRouteTree(before: boolean): void {
    const side = this.routeSide()?.nativeElement
    if (!side) return
    const current = this.routeCurrent()
    const element = current ? this.#routeElement(current.key) : null
    const anchored = this.#routeFoldAnchored
    this.#routeFoldAnchored = false
    if (element && current && current.key !== this.#routeRevealedKey) {
      this.#revealRoute(element, current.source === 'thread' ? 'thread' : 'participant')
    } else if (element && before && !this.#routeInside(element, side)) {
      this.#revealRoute(element, 'participant')
    } else if (this.routeFollowing() && !anchored) {
      const top = Math.max(0, side.scrollHeight - side.clientHeight)
      if (Math.abs(side.scrollTop - top) >= 1 || Math.abs(side.scrollLeft) >= 1) {
        this.#routeExpect = { top, left: 0 }
        side.scrollTo({ top, left: 0, behavior: 'auto' })
      }
    }
    this.#routeCurrentVisible = element ? this.#routeInside(element, side) : false
  }

  /** REVEAL a card: instant, minimal, scoped to the viewport — never
   *  `scrollIntoView`, which also scrolls the thread and the panel. Instant
   *  because the tree's own moves are small, and a smooth tree scroll while the
   *  thread may be moving too is two things animating at once. A reveal the
   *  thread caused is skipped mid-pull and within the pan hold. */
  #revealRoute(element: HTMLElement, reason: 'participant' | 'thread'): void {
    const side = this.routeSide()?.nativeElement
    if (!side) return
    if (reason === 'thread' && (this.#routeDrag?.pulling || performance.now() - this.#routePannedAt < ROUTE_PAN_HOLD_MS)) {
      this.#routeCurrentVisible = this.#routeInside(element, side)
      return
    }
    this.#routeRevealedKey = this.routeCurrent()?.key ?? ''
    const margin = ROUTE_STEER_MARGIN_REM * remPx()
    const view = side.getBoundingClientRect()
    const rect = element.getBoundingClientRect()
    const near = (lo: number, hi: number, vlo: number, vhi: number): number =>
      hi - lo > vhi - vlo - 2 * margin ? lo - vlo - margin
        : lo < vlo + margin ? lo - vlo - margin
          : hi > vhi - margin ? hi - vhi + margin
            : 0
    const top = near(rect.top, rect.bottom, view.top, view.bottom)
    const left = near(rect.left, rect.right, view.left, view.right)
    const next = {
      top: clampScroll(side.scrollTop + top, side.scrollHeight - side.clientHeight),
      left: clampScroll(side.scrollLeft + left, side.scrollWidth - side.clientWidth),
    }
    if (Math.abs(next.top - side.scrollTop) >= 1 || Math.abs(next.left - side.scrollLeft) >= 1) {
      this.#routeExpect = next
      side.scrollTo({ top: next.top, left: next.left, behavior: 'auto' })
    }
    this.#routeCurrentVisible = this.#routeInside(element, side)
  }

  /** Whose scroll it was: within a pixel of the position the component set,
   *  its own; anything else the participant's pan. Follow is recomputed on
   *  both edges. */
  onRouteSideScroll(): void {
    const side = this.routeSide()?.nativeElement
    if (!side) return
    const expect = this.#routeExpect
    if (expect && Math.abs(side.scrollTop - expect.top) <= 1 && Math.abs(side.scrollLeft - expect.left) <= 1) {
      this.#routeExpect = null
    } else {
      this.#routePannedAt = performance.now()
    }
    this.routeFollowing.set(
      side.scrollHeight - side.scrollTop - side.clientHeight <= ROUTE_SIDE_BOTTOM_PX
      && Math.abs(side.scrollLeft) <= ROUTE_SIDE_BOTTOM_PX)
    const key = this.routeCurrent()?.key
    const element = key ? this.#routeElement(key) : null
    this.#routeCurrentVisible = element ? this.#routeInside(element, side) : false
  }

  // THE PULL. The wheel scrolls the viewport natively; a mouse or pen can also
  // grab it and drag, on both axes. The press becomes a pull only past
  // ROUTE_PULL_PX, and only then is the pointer captured — capturing on the
  // press would retarget the click away from the card it started on. The axis
  // locks once one direction clearly leads. Touch pans natively.

  #routeDrag: { id: number; x: number; y: number; left: number; top: number; pulling: boolean; axis: 'x' | 'y' | 'both' } | null = null
  #routePulled = false

  onRouteSidePointerDown(event: PointerEvent): void {
    if (event.pointerType === 'touch' || event.button !== 0) return
    const side = event.currentTarget as HTMLElement
    this.#routeDrag = {
      id: event.pointerId, x: event.clientX, y: event.clientY,
      left: side.scrollLeft, top: side.scrollTop, pulling: false, axis: 'both',
    }
    this.#routePulled = false
  }

  onRouteSidePointerMove(event: PointerEvent): void {
    const drag = this.#routeDrag
    if (!drag || drag.id !== event.pointerId) return
    const side = event.currentTarget as HTMLElement
    const dx = event.clientX - drag.x
    const dy = event.clientY - drag.y
    if (!drag.pulling) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) < ROUTE_PULL_PX) return
      drag.pulling = true
      drag.axis = Math.abs(dy) >= ROUTE_AXIS_LOCK * Math.abs(dx) ? 'y'
        : Math.abs(dx) >= ROUTE_AXIS_LOCK * Math.abs(dy) ? 'x'
          : 'both'
      side.setPointerCapture(event.pointerId)
      this.routePulling.set(true)
    }
    event.preventDefault()
    if (drag.axis !== 'x') side.scrollTop = drag.top - dy
    if (drag.axis !== 'y') side.scrollLeft = drag.left - dx
  }

  /** The release that ends a pull swallows the click it would otherwise
   *  become; the flag outlives this task by one tick, no longer. */
  onRouteSidePointerUp(event: PointerEvent): void {
    const drag = this.#routeDrag
    if (!drag || drag.id !== event.pointerId) return
    this.#routeDrag = null
    this.routePulling.set(false)
    const side = event.currentTarget as HTMLElement
    if (side.hasPointerCapture(event.pointerId)) side.releasePointerCapture(event.pointerId)
    if (!drag.pulling) return
    this.#routePulled = true
    setTimeout(() => { this.#routePulled = false }, 0)
  }

  /** Shift + wheel pans sideways — only when the platform did not already
   *  convert it, so the viewport never pans twice. The vertical wheel and a
   *  trackpad's horizontal scroll stay native. */
  onRouteSideWheel(event: WheelEvent): void {
    const side = event.currentTarget as HTMLElement
    if (!event.shiftKey || event.deltaX !== 0 || event.deltaY === 0 || side.scrollWidth <= side.clientWidth) return
    event.preventDefault()
    side.scrollLeft += event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY
  }

  // ── FOLDS AND KEYS (§4.2.2, §4.3.5) ─────────────────────────────────────

  /** Fold a node's branch away, or bring it back. The toggled card stays
   *  where it was: its rect is read before, and the viewport moves by the
   *  difference after the render. A current step folded away becomes the
   *  fold itself — the pane never describes a card nobody can see. */
  setRouteFold(nodeId: string, folded: boolean): void {
    const convoId = this.activeId() || ''
    if (!convoId || !nodeId) return
    const key = `n:${nodeId}`
    const before = this.#routeElement(key)?.getBoundingClientRect() ?? null
    const all = new Map(this.#routeFolds())
    const held = new Set(all.get(convoId) ?? [])
    if (folded) held.add(nodeId); else held.delete(nodeId)
    all.set(convoId, held)
    const current = this.routeCurrent()
    if (folded && current && this.#routeIsBeneath(current.key, nodeId)) this.routeCurrent.set({ key, source: current.source })
    if (folded && this.#routeIsBeneath(this.routeCursor(), nodeId)) this.routeCursor.set(key)
    this.#routeFolds.set(all)
    if (!before) return
    afterNextRender(() => {
      const side = this.routeSide()?.nativeElement
      const after = this.#routeElement(key)?.getBoundingClientRect()
      if (!side || !after) return
      this.#routeFoldAnchored = true
      const top = after.top - before.top
      const left = after.left - before.left
      if (Math.abs(top) < 1 && Math.abs(left) < 1) return
      const next = {
        top: clampScroll(side.scrollTop + top, side.scrollHeight - side.clientHeight),
        left: clampScroll(side.scrollLeft + left, side.scrollWidth - side.clientWidth),
      }
      this.#routeExpect = next
      side.scrollTo({ top: next.top, left: next.left, behavior: 'auto' })
    }, { injector: this.#injector })
  }

  #routeIsBeneath(key: string, ancestor: string): boolean {
    if (!key.startsWith('n:')) return false
    const parentOf = this.routeTree().parentOf
    for (let id = parentOf.get(key.slice(2)); id !== undefined; id = parentOf.get(id)) if (id === ancestor) return true
    return false
  }

  /** The fold mark on a node with a branch beneath it. Not the card's press:
   *  it neither moves the thread nor moves the roving stop. */
  onRouteFoldClick(event: MouseEvent, item: RouteItem): void {
    event.stopPropagation()
    if (this.#routePulled || !item.node || !item.descendants) return
    this.setRouteFold(item.node.id, !item.collapsed)
  }

  /**
   * THE WAI-ARIA TREE KEYS, exactly. ↓/↑ walk DOM order — the visible
   * preorder, then the tail — which is also the visual order, since siblings
   * stack; Home and End jump; Enter and Space press. On a node, → unfolds a
   * collapsed one, or walks into an expanded one's first child; ← folds an
   * expanded one, or walks to the parent. No sibling walk on ←/→: it would fold
   * an expanded sibling on the way. Every one of them is `preventDefault`ed, so
   * a focused card never pans the viewport natively. Escape is the cascade's.
   */
  onRouteItemKey(event: KeyboardEvent, item: RouteItem): void {
    // THE CARD AS THE SIDEBAR IS NOW. A fold from the previous key may not
    // have been drawn yet, and the template hands over the item it last drew
    // with — two quick ← presses would both read "unfolded" and the second
    // would fold again instead of walking to the parent.
    const items = this.routeTree().items
    const current = items.find(entry => entry.key === item.key) ?? item
    const at = items.findIndex(entry => entry.key === current.key)
    const walk = (key: string | undefined): void => {
      if (key !== undefined && key !== current.key) this.#walkRouteTo(key)
    }
    switch (event.key) {
      case 'ArrowDown': event.preventDefault(); walk(items[Math.min(items.length - 1, at + 1)]?.key); return
      case 'ArrowUp': event.preventDefault(); walk(items[Math.max(0, at - 1)]?.key); return
      case 'Home': event.preventDefault(); walk(items[0]?.key); return
      case 'End': event.preventDefault(); walk(items[items.length - 1]?.key); return
      case 'Enter': case ' ': event.preventDefault(); this.selectRouteItem(current, 'press'); return
      case 'ArrowRight': {
        event.preventDefault()
        if (!current.node || !current.descendants) return
        if (current.collapsed) { this.setRouteFold(current.node.id, false); return }
        walk(current.firstChild)
        return
      }
      case 'ArrowLeft': {
        event.preventDefault()
        if (!current.node) return
        if (current.descendants && !current.collapsed) { this.setRouteFold(current.node.id, true); return }
        if (current.parent !== undefined) walk(`n:${current.parent}`)
        return
      }
    }
  }

  /** A key move: focus without scrolling, then select — the arrival makes the
   *  card current and reveals it. A card not drawn yet (a branch unfolded a
   *  moment ago) lands after the next render. */
  #walkRouteTo(key: string): void {
    const land = (): boolean => {
      const element = this.#routeElement(key)
      const item = this.routeTree().items.find(entry => entry.key === key)
      if (!element || !item) return false
      element.focus({ preventScroll: true })
      this.selectRouteItem(item, 'key')
      return true
    }
    if (!land()) afterNextRender(() => { land() }, { injector: this.#injector })
  }

  /** THE KEYMAP HOLD. The hive's keymap runs on `window` in the capture phase,
   *  so ↑/↓ would move the hex selection and Enter would paste before a card
   *  saw the key. Held while focus is anywhere in the column — the pane's
   *  controls too — and released when it leaves, and on close, park and
   *  destroy. */
  onRouteColFocusIn(): void {
    if (this.#routeKeysHeld) return
    this.#routeKeysHeld = true
    EffectBus.emit('keymap:suppress', { reason: ROUTE_KEYS_REASON })
  }

  onRouteColFocusOut(event: FocusEvent): void {
    const to = event.relatedTarget as Node | null
    if (to && (event.currentTarget as HTMLElement).contains(to)) return
    this.#releaseRouteKeys()
  }

  // ── reading the route ───────────────────────────────────────────────────
  //
  // On every refresh hint the bucket is re-read, never appended to from a
  // payload (§3.5): `agent:step` filtered on the conversation (EffectBus
  // replays the last value, so the filter is not optional), the thread
  // changing, the goal landing, a flow landing or a model call for it starting
  // or ending, and the local model's probe state flipping. `ask:chat-reply`
  // ends the wait and is NOT a hint — the reply's own step is written after
  // that effect fires, and a read triggered by it would see a run with no
  // reply for one refresh.

  #routeTimer: ReturnType<typeof setTimeout> | null = null

  #scheduleRouteRefresh(convoId: string): void {
    if (!convoId || convoId !== this.activeId()) return
    if (this.#routeTimer !== null) clearTimeout(this.#routeTimer)
    this.#routeTimer = setTimeout(() => {
      this.#routeTimer = null
      void this.#refreshRoute(convoId)
    }, ROUTE_REFRESH_MS)
  }

  /** THE JOIN (§3.2): re-read the turns and adopt the sig-bearing list when
   *  it is at least as long as what is in memory — a shorter read is a write
   *  still landing, and the in-memory turn it lacks must not vanish. Then
   *  the route, if the module can read one. */
  async #refreshRoute(convoId: string): Promise<void> {
    const threads = this.#threads()
    if (!threads || convoId !== this.activeId()) return
    try {
      const turns = await threads.readTurns(convoId)
      if (convoId !== this.activeId()) return
      if (turns.length >= this.turns().length) this.turns.set(turns)
    } catch { /* the in-memory turns stand; the route below may still read */ }

    if (!threads.readRoute) { this.route.set(null); this.routeError.set(false); return }
    try {
      // The live run is named by the module's rule from the outstanding
      // ask's signature; a build that does not expose the rule reads the
      // route with no live run named.
      const askSig = this.#outstanding.get(convoId)?.sig || ''
      const liveRunId = askSig && threads.runIdForAsk ? await threads.runIdForAsk(askSig) : undefined
      const route = await threads.readRoute(convoId, liveRunId)
      if (convoId !== this.activeId()) return
      this.route.set(route)
      this.routeError.set(false)
      // THE FLOW. The participant is looking at this route, so this is an
      // attended moment to (re-)organize it — with their own machine-local
      // model only, when it is already known awake (the module decides and
      // never knocks). Unawaited. `prefer` names the step they have been
      // looking at for ROUTE_SUMMARY_ASK_MS while its card is missing or
      // stale, so that card is written first. The module refuses while we
      // wait on a reply or while the lane is paused after their own local
      // chat, and a refused call reads nothing and emits nothing — so the
      // refresh hints cannot turn this into a loop.
      if (this.turns().length > 0 && threads.organizeRoute) {
        void threads.organizeRoute(convoId, liveRunId, this.waiting(), this.#routePrefer())
          .catch(() => { /* the flow stays as it was */ })
      }
    } catch {
      if (convoId !== this.activeId()) return
      this.route.set(null)
      this.routeError.set(true)
    }
  }

  /** The current node's id once it has been current ROUTE_SUMMARY_ASK_MS with
   *  no card or a stale one; otherwise nothing to prefer. */
  #routePrefer(): string | undefined {
    const node = this.routeCurrentItem()?.node
    if (!node || performance.now() - this.#routeCurrentSince < ROUTE_SUMMARY_ASK_MS) return undefined
    return !node.card || node.card.stale ? node.id : undefined
  }

  /** A node that became current with no card, or a stale one, asks once it
   *  has stayed current long enough: one re-read, whose attended call then
   *  carries it as `prefer`. Only while the local model is awake — otherwise
   *  there is nobody to ask. */
  #armPrefer(key: string): void {
    if (this.#preferTimer !== null) { clearTimeout(this.#preferTimer); this.#preferTimer = null }
    if (!key.startsWith('n:')) return
    this.#preferTimer = setTimeout(() => {
      this.#preferTimer = null
      if (this.routeCurrent()?.key !== key || !this.route()?.organizer || this.#routePrefer() === undefined) return
      this.#scheduleRouteRefresh(this.activeId())
    }, ROUTE_SUMMARY_ASK_MS + 20)
  }

  /** Leaving a conversation leaves its route behind — its current step, its
   *  hold, its steer, and the reading observer, whose rows are about to be
   *  reused by the next conversation's turns. */
  #clearRoute(): void {
    if (this.#routeTimer !== null) { clearTimeout(this.#routeTimer); this.#routeTimer = null }
    if (this.#keySettle !== null) { clearTimeout(this.#keySettle); this.#keySettle = null }
    if (this.#preferTimer !== null) { clearTimeout(this.#preferTimer); this.#preferTimer = null }
    this.route.set(null)
    this.routeError.set(false)
    this.#cancelSteer(false)
    this.routeCurrent.set(null)
    this.routeSpanAt.set(0)
    this.routeNewer.set(0)
    this.routeHold.set(false)
    this.routeCursor.set('')
    this.routeAnchorTop.set(null)
    this.routeFollowing.set(true)
    this.#routeRevealedKey = ''
    this.#routeCurrentVisible = false
    this.#routeExpect = null
    this.#routeTabbedKey = ''
    this.#disconnectReading()
  }

  /** The half-arrived answer. Its own computed and deliberately NOT cached —
   *  every chunk is a new string, and caching them would be a leak with a
   *  hit rate of zero. */
  readonly streamHtml = computed(() =>
    this.#sanitizer.bypassSecurityTrustHtml(renderChatMarkdown(this.streaming())))

  // ── waiting honesty ─────────────────────────────────────────────────────

  /** Something can be called back: a live stream can be aborted, a queued ask
   *  can be taken out of the pool. */
  readonly canStop = computed(() => this.waiting() && (this.hostStreaming() || !!this.pendingSig()))

  /** NOBODY IS LISTENING. The question is a durable record in the optimization
   *  pool and no Claude session is connected to drain it — so it is not slow,
   *  it is unattended, and saying "Thinking…" would be a lie. */
  readonly unattended = computed(() =>
    this.waiting() && !this.hostStreaming() && !this.bridgeUp() && this.bridgeConfigured())

  /** m:ss once past a minute — a bare "127s" makes people do arithmetic. */
  readonly elapsedLabel = computed(() => {
    const seconds = this.elapsed()
    if (seconds < 60) return `${seconds}s`
    return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`
  })

  // ── WHERE A CONVERSATION IS LISTED ────────────────────────────────────
  //
  // A conversation about a tile is listed UNDER THAT TILE, in the rail, and
  // nowhere else. A tile is a subject and its threads hang off it — walk to
  // another page and each tile there carries its own. The window used to
  // print a second, flat list of every chat above the transcript; two homes
  // for one thing is how you end up not knowing which is the real one, and
  // the flat one could not say what any of it was ABOUT.
  //
  // The list survives in exactly one case: a window with NO rail (the narrow
  // shell hides it below 700px, the twin of the rule in the stylesheet).
  // There the rail cannot carry it, so the window still must.

  /** Is the sidebar on screen — i.e. is the rail carrying the chat list? */
  readonly railVisible = signal(true)
  #railQuery: MediaQueryList | null = null

  // ── PEEK: the hive, without leaving the conversation ────────────────────
  //
  // The window is full screen, which is right while you are reading an answer
  // and wrong while you are deciding WHICH tiles the next question should
  // carry. The rail names tiles; it does not show you the hive.
  //
  // So: peek. The transcript, the rail and the conversation bar fold away and
  // the panel stops taking pointer events, leaving the header (the shelf) and
  // the footer (the input) floating over the LIVE hive. Navigation is the
  // hive's own — an ordinary click walks in, and nothing about that changes,
  // because a second navigation grammar over the same hexagons is a second
  // thing to learn for no gain. Putting a tile ON the shelf is a per-tile icon
  // that arrives with the fold (assistant/chat-context-action.drone.ts); it
  // could not be a chord, because ctrl-click on a hexagon is already the
  // selection toggle.
  //
  // Peek is a state of the OPEN window, not a second shape: the conversation,
  // the draft and the shelf are all still there, and unfolding returns to
  // exactly what you left, now carrying whatever you picked up.
  readonly peeking = signal(false)

  /** Whether the providers console is standing. Reported BY the console, never
   *  guessed here: the same press opens and shuts it, and a toggle that draws
   *  itself from its own last press goes wrong the moment the console is shut
   *  any other way (Escape, `/providers`, the command line). */
  readonly providersOpen = signal(false)

  /** Fold the window away to the hive, or bring it back. */
  togglePeek(): void {
    const next = !this.peeking()
    this.peeking.set(next)
    // Folding away closes the things that only make sense over a transcript —
    // and a full-bleed picture would cover the live hive the fold exists to
    // show. Closed, not merely hidden: an invisible surface still standing is
    // one Escape would unwind before the fold, which reads as a dead key.
    if (next) { this.clipboardOpen.set(false); this.listOpen.set(false); this.closePicture() }
    this.#claimSurface(!next)
    this.#applyFold()
    if (!next) this.#focus()
  }

  /** EVERYTHING THAT FOLLOWS THE FOLD, in one place — so park, close, open
   *  and the toggle cannot disagree about it. Two things follow:
   *
   *  1. WHO IS GATHERING. The hexagons grow a per-tile "add to the request"
   *     icon while folded away and lose it again when the window comes back
   *     (assistant/chat-context-action.drone.ts) — an affordance for a shelf
   *     nobody can see would be an affordance for nothing.
   *  2. THE LAYER'S SAVED FRAMING IS NOT OURS TO CHANGE. Reserving the bars
   *     resizes the canvas, and the canvas owner answers a resize by
   *     recentring and (when the saved zoom was a fit) refitting — which is
   *     exactly what we want to SEE and exactly what must not be WRITTEN. A
   *     fit computed for the band between two bars is not the framing this
   *     layer should open with next time. `suspend()` blocks automatic writes
   *     only, so a pan or zoom the participant performs while folded is still
   *     theirs and still persists. Unfolding resumes, the bars stop
   *     reserving, and the same resize path restores the framing from the
   *     value that was never overwritten. */
  #applyFold(): void {
    const folded = this.visible() && this.peeking()
    EffectBus.emit('chat:peek', { peeking: folded })

    if (folded === this.#foldSuspendedViewport) return
    const viewport = ioc()?.get('@diamondcoreprocessor.com/ViewportPersistence') as
      { suspend?(): void; resume?(): void } | undefined
    if (!viewport?.suspend || !viewport.resume) return
    // Only ever resume what THIS window suspended — the flag is global and a
    // blanket resume would clear somebody else's.
    if (folded) viewport.suspend()
    else viewport.resume()
    this.#foldSuspendedViewport = folded
  }

  /** Whether the fold is currently holding viewport persistence down. */
  #foldSuspendedViewport = false

  /** THE SURFACE IS OWNED, and the owner is counted (ModeRegistry). A full
   *  screen window is a view covering the canvas by any honest reading, and
   *  everything that hides itself for a view — the pixi canvas, the post-it
   *  stickies, the empty-collection prompt — was drawing straight over this
   *  window because it never said so. Peeking releases the claim, which is
   *  what makes the hive underneath live and clickable again. */
  #claimSurface(active: boolean): void {
    this.#surfaceWanted = active
    const modes = ioc()?.get(MODE_REGISTRY_IOC_KEY) as ModeRegistryLike | undefined
    if (!modes) {
      // The registry is an essentials bee and the window can boot open before
      // it lands. Claim on the SETTLED intent when it arrives, never on the
      // intent that was current when this call was made.
      if (active) this.#whenModes(late => {
        if (!this.#surfaceWanted) return
        late.enter('view:active', SURFACE_OWNER)
        late.enter(KEEPS_CONTROLS, SURFACE_OWNER)
      })
      return
    }
    if (active) {
      modes.enter('view:active', SURFACE_OWNER)
      modes.enter(KEEPS_CONTROLS, SURFACE_OWNER)
    } else {
      modes.exit('view:active', SURFACE_OWNER)
      modes.exit(KEEPS_CONTROLS, SURFACE_OWNER)
    }
  }

  /** Is the surface claimed, as far as this window is concerned. */
  #surfaceWanted = false

  #whenModes(run: (modes: ModeRegistryLike) => void): void {
    (globalThis as { ioc?: { whenReady?: (k: string, cb: (v: unknown) => void) => void } }).ioc
      ?.whenReady?.(MODE_REGISTRY_IOC_KEY, value => run(value as ModeRegistryLike))
  }

  #cleanups: (() => void)[] = []
  #elapsedTimer: ReturnType<typeof setInterval> | null = null

  #onSync = (): void => { if (this.visible()) this.#refreshContext() }
  #onNetworkChange = (): void => {
    this.networkOnline.set(navigator.onLine)
    this.#refreshDesignation()
  }
  #onRailQuery = (event: MediaQueryListEvent): void => { this.railVisible.set(event.matches) }
  #onStorage = (event: StorageEvent): void => {
    if (event.key !== PARTICIPANT_AI_HOST_STORAGE_KEY && event.key !== null) return
    const configured = isParticipantAiHostConfigured()
    this.hostConfigured.set(configured)
    if (configured && this.visible() && !this.activeId()) void this.#resume()
  }

  constructor() {
    window.addEventListener('online', this.#onNetworkChange)
    window.addEventListener('offline', this.#onNetworkChange)
    // Code blocks are highlighted AFTER the turn is in the DOM — highlight.js
    // works on live elements, and the loader is lazy, so the first fenced block
    // in a session pays for the library and none of the later ones do.
    effect(() => {
      this.rendered()
      this.streaming()
      setTimeout(() => void highlightBlocks(this.scroller()?.nativeElement), 0)
    })

    // The header follows the selection. `subjectPath` is the one signal that
    // knows what the window is about — it already recomputes as the thread
    // moves — so reading it here is the whole subscription.
    effect(() => {
      this.subjectPath()
      void this.#refreshSubjectThumb()
    })

    // The left sidebar. Its host `<div>` exists only while the window is open,
    // so this effect re-fires as the window comes and goes; the rail itself is
    // created once and re-mounted, keeping its trail and subject. Essentials
    // may register the factory AFTER this window is up (web loads its bees
    // from OPFS), so a miss WAITS on the key instead of leaving the sidebar
    // empty until the next refocus. Without any factory ever arriving the
    // sidebar stays empty — the chat loses nothing it had before.
    effect(() => {
      const host = this.chatRail()?.nativeElement
      if (!host) return
      if (this.#rail) { this.#rail.mount(host); return }
      const registry = ioc() as { get?(k: string): unknown; whenReady?(k: string, cb: (v: unknown) => void): void } | undefined
      const key = '@diamondcoreprocessor.com/AgentTilesRailFactory'
      const bring = (factory: TilesRailFactoryLike | undefined): void => {
        if (this.#rail || !factory?.create) return
        this.#rail = factory.create()
        this.#rail.onSubjectChanged = subject => { void this.#enterSubject(subject) }
        // Rail picks flow INTO the clipboard as deltas — never a wholesale
        // replace, because the clipboard also holds what the hive's takes
        // and the header's drops gathered, and a ctrl-click in the sidebar
        // must not blow those away.
        this.#rail.onSelectionChanged = selection => {
          const before = this.#railSeen
          const now = new Map(selection.map(pick => [pick.key, pick]))
          this.#railSeen = now
          const added = selection.filter(pick => !before.has(pick.key))
          const removed = [...before.values()].filter(pick => !now.has(pick.key))
          if (added.length) {
            EffectBus.emit('clipboard:take-entries', {
              entries: added.map(pick => ({
                label: pick.name,
                sourceSegments: [...pick.path],
                sig: pick.sig || undefined,
              })),
            })
          }
          if (removed.length) {
            EffectBus.emit('clipboard:discard-items', { labels: removed.map(pick => pick.name) })
          }
        }
        // The host captured here may have been replaced by the time a late
        // factory lands — mount into whatever full screen is showing NOW.
        const live = this.chatRail()?.nativeElement
        if (live) this.#rail.mount(live)
      }
      const now = registry?.get?.(key) as TilesRailFactoryLike | undefined
      if (now) bring(now)
      else registry?.whenReady?.(key, value => bring(value as TilesRailFactoryLike))
    })

    // A TILE PRESSED OUT IN THE HIVE. The hexagons carry the icon while the
    // window is folded away; the window owns the shelf, so the press arrives
    // here as a plain reference rather than the canvas reaching into it.
    this.#cleanups.push(EffectBus.on<DroppedTile>(
      'chat:add-context', payload => {
        if (!payload?.path && !payload?.sig) return
        this.toggleContext({
          name: String(payload.name ?? ''),
          path: String(payload.path ?? ''),
          sig: String(payload.sig ?? ''),
        })
      }))

    this.#cleanups.push(EffectBus.on<{ model?: string; prefill?: string; convoId?: string }>(
      'chat:open', payload => { void this.open(payload) }))

    this.#cleanups.push(EffectBus.on('chat:toggle', () => {
      if (this.visible()) this.close()
      else void this.open()
    }))

    // THE KEY IS THE SAME ACT. `c` (keyboard/default-keymap.ts) dispatches
    // through the keymap's one lane rather than a second toggle event, so
    // the shortcut, the command-line icon and the palette all end up in the
    // branch above — there is one way this window opens, however you ask.
    this.#cleanups.push(EffectBus.on<{ cmd?: string }>('keymap:invoke', payload => {
      if (payload?.cmd !== 'chat.toggle') return
      if (this.visible()) this.close()
      else void this.open()
    }))

    this.#cleanups.push(EffectBus.on('chat:close', () => { if (this.visible()) this.close() }))

    // A PICTURE ARRIVING FROM ELSEWHERE. The annotation sheet (markup-overlay)
    // photographs the screen and stores the bytes itself, so what reaches the
    // shelf is the same {sig, kind} reference a pasted screenshot becomes —
    // the surface that took the picture never has to know how this window
    // holds one. The window opens on arrival: a context nobody can see is a
    // context nobody will use.
    //
    // `fresh` is the annotation's second door: not "add this to what we are
    // talking about" but "here is a new thing to talk about", at the location
    // the picture was taken.
    this.#cleanups.push(EffectBus.on<AttachedPicture>(
      'chat:attach-picture', payload => { void this.#attachPicture(payload) }))

    // A draft landing anywhere — this composer, another window, a sweep — is
    // a change to the roster, because a conversation that holds only unsent
    // words is still a conversation you must be able to get back to.
    this.#cleanups.push(EffectBus.on('chat:drafts-changed', () => { void this.#refreshDrafts() }))
    this.#cleanups.push(EffectBus.on<{ convoId?: string }>('chat:goal-reached', payload => {
      this.#scheduleRouteRefresh(String(payload?.convoId ?? ''))
      void this.#refreshList().then(() => {
        if (payload?.convoId === this.activeId()) this.goalOpen.set(true)
      })
    }))

    // THE ROUTE'S REFRESH HINTS (chat-route.md §3.5). A step landing in the
    // ledger, or the thread changing, means the route may have moved; both
    // are hints to RE-READ, never payloads to append. Filtered on the
    // conversation because EffectBus replays the last `agent:step` to every
    // new subscriber, and a step from some other thread's run must not
    // re-read this one. `ask:chat-reply` is deliberately not here.
    this.#cleanups.push(EffectBus.on<{ convoId?: string }>('agent:step', payload => {
      this.#scheduleRouteRefresh(String(payload?.convoId ?? ''))
    }))
    this.#cleanups.push(EffectBus.on<{ convoId?: string }>('chat:threads-changed', payload => {
      this.#scheduleRouteRefresh(String(payload?.convoId ?? ''))
    }))
    // A workflow landed, or a model call for this conversation started or
    // ended. Filtered on the conversation for the same replay reason as
    // `agent:step` (#scheduleRouteRefresh only acts on the open one) — the
    // passive drain organizes EVERY conversation, not only this.
    this.#cleanups.push(EffectBus.on<{ convoId?: string }>('chat:route-flow-changed', payload => {
      this.#scheduleRouteRefresh(String(payload?.convoId ?? ''))
    }))
    this.#cleanups.push(EffectBus.on<{ convoId?: string }>('chat:route-flow-organizing', payload => {
      this.#scheduleRouteRefresh(String(payload?.convoId ?? ''))
    }))
    // The local model's probe state flipped, so what the pane says about why
    // no model runs may have changed. It names no conversation: the open one
    // is re-read.
    this.#cleanups.push(EffectBus.on('llm:policy-changed', () => {
      this.#scheduleRouteRefresh(this.activeId())
    }))

    // ── WHAT THERE IS TO PASTE ───────────────────────────────────────
    // The clipboard's own contents, for the header's flyout. Last-value
    // replay means the shelf's source is current the moment the window
    // opens — including everything gathered before it existed. This is
    // the ONLY writer of `clipboardHeld`; the clipboard owns the truth,
    // and the shelf is filled by pasting FROM it, never by mirroring it.
    this.#cleanups.push(EffectBus.on<{ items?: readonly { label: string; sourceSegments: readonly string[]; sig?: string }[] }>(
      'clipboard:changed', (payload) => {
        const items = Array.isArray(payload?.items) ? payload!.items! : []
        const picks = items.map(item => ({
          key: '/' + [...item.sourceSegments, item.label].join('/'),
          path: [...item.sourceSegments],
          name: item.label,
          sig: item.sig,
        }))
        this.clipboardHeld.set(picks)
        if (!picks.length) this.clipboardOpen.set(false)
        // Both faces draw from one thumbnail cache: an item pasted onto the
        // shelf must not have to re-resolve a picture the flyout just had.
        void this.#refreshContextThumbs()
      }))

    // The retired ask screen's channel. Kept because other surfaces open a
    // conversation through it — the skills window's "use" action and the
    // context window's "ask about this tile" — and their meaning is unchanged:
    // start a chat, here, about this.
    this.#cleanups.push(EffectBus.on<{ model?: string; prefill?: string }>(
      'ask:open', payload => { void this.open(payload) }))

    // A reply landed. It is already ON DISK by the time this fires
    // (chat-thread.deliverTurn writes, then announces) — the text rides along
    // only so an open window can paint without a re-read.
    this.#cleanups.push(EffectBus.on<{ convoId: string; text: string }>(
      'ask:chat-reply', payload => this.#onReply(payload)))

    // THE SHALLOW TIER'S OWN LANE. Its run outlives this component
    // (host-stream.ts), so the answer reaches the window the same way the
    // bridge's does: as an announcement about a conversation, not as the
    // return value of a call this instance happens to be awaiting.
    this.#cleanups.push(EffectBus.on<{ convoId?: string; text?: string }>(
      'chat:host-chunk', payload => this.#onHostChunk(payload)))
    this.#cleanups.push(EffectBus.on<{ convoId?: string; text?: string; outcome?: string }>(
      'chat:host-done', payload => this.#onHostDone(payload)))

    // WHO ANSWERS CAN CHANGE WHILE YOU ARE LOOKING AT IT — a key arrives, a
    // bridge announces itself, a provider reports its headroom nearly spent,
    // a tier gets pinned. One effect carries all of it (model-policy.ts) and
    // replays its last value, so this both keeps the readout live and does
    // the FIRST read: an essentials build landing after the shell still
    // announces once on load.
    this.#cleanups.push(EffectBus.on('llm:policy-changed', () => this.#refreshDesignation()))

    // The console says when it is up or down; the header's toggle draws
    // itself from that. Replayed, so a window opened while the console is
    // already standing shows it pressed straight away.
    this.#cleanups.push(EffectBus.on<{ open?: boolean }>(
      'providers:state', payload => this.providersOpen.set(!!payload?.open)))

    this.#cleanups.push(EffectBus.on<{ connected?: boolean }>(
      'bridge:status', payload => {
        this.bridgeConfigured.set(isLocalClaudeBridgeConfigured())
        this.bridgeUp.set(!!payload?.connected)
        // A bridge arriving or leaving changes who can answer at all, so the
        // designation is re-read on the same signal the footer's light is.
        this.#refreshDesignation()
      }))

    this.#cleanups.push(EffectBus.on<{ configured?: boolean }>(
      'host-ai:configuration', payload => {
        const configured = !!payload?.configured
        this.hostConfigured.set(configured)
        if (configured && this.visible() && !this.activeId()) void this.#resume()
      }))

    // Attach/detach of context lands between synchronize pulses — the chip
    // must follow the act, not the next unrelated one.
    this.#cleanups.push(EffectBus.on('context:tile-changed', () => {
      if (this.visible()) this.#refreshContext()
    }))

    // The processor's post-pulse beat — the app's canonical "something moved".
    // Cheaper and more honest than polling: the context line follows the hive.
    window.addEventListener('synchronize', this.#onSync)
    window.addEventListener('storage', this.#onStorage)

    // Is the rail on screen? A media query, not a resize handler: the browser
    // already knows, and the stylesheet is asking the same question one line
    // away. Answered once now so the first paint is right.
    if (typeof window.matchMedia === 'function') {
      this.#railQuery = window.matchMedia(RAIL_QUERY)
      this.railVisible.set(this.#railQuery.matches)
      this.#railQuery.addEventListener('change', this.#onRailQuery)
    }

    // A configured-but-down bridge re-dials quietly, so the checklist's
    // broker step (and an ordinary dropped connection) recovers hands-free.
    // The worker never retries a first attempt on its own — this is the nudge.
    this.#retryTimer = setInterval(() => {
      if (this.visible() && this.bridgeConfigured() && !this.bridgeUp()) {
        EffectBus.emit('claude-bridge:connect', {})
      }
    }, BRIDGE_RETRY_MS)

    // ── configured bridge boot-open ───────────────────────────────────────
    // A local-bridge participant keeps the existing boot-open behavior without
    // stealing command-line focus. Everyone else opens chat deliberately; an
    // unconfigured participant then sees the setup-required view.
    this.#refreshAvailability()
    this.#refreshDesignation()
    EffectBus.emit('chat:window-state', { open: this.visible() })
    if (this.visible()) {
      this.#claimSurface(true)
      this.#refreshContext()
      void this.#resume()
    }
    ;(globalThis as { ioc?: { whenReady?: (k: string, cb: () => void) => void } }).ioc
      ?.whenReady?.('@diamondcoreprocessor.com/ChatThreads', () => {
        if (this.enabled() && this.visible() && this.turns().length === 0 && !this.waiting()) void this.#resume()
        // WHETHER OR NOT THE WINDOW IS OPEN. A question left out over a reload
        // is marked on its TILE as much as in here, and the rail's thinking
        // mark is the only sign of it for someone who has the panel folded
        // away. So the pass runs on the threads module arriving, not on the
        // window being looked at.
        void this.#recoverWaits()
      })
    ;(globalThis as { ioc?: { whenReady?: (k: string, cb: (value: unknown) => void) => void } }).ioc
      ?.whenReady?.(HOST_AI_IOC_KEY, value => {
        this.hostConfigured.set(!!(value as HostAiLike | undefined)?.configured)
      })
    ;(globalThis as { ioc?: { whenReady?: (k: string, cb: () => void) => void } }).ioc
      ?.whenReady?.(LLM_ROUTER_IOC_KEY, () => this.#refreshDesignation())
  }

  ngOnDestroy(): void {
    // A leaked enter() strands `view:active` on forever — the canvas and the
    // stickies would never come back.
    this.#claimSurface(false)
    for (const cleanup of this.#cleanups) cleanup()
    window.removeEventListener('synchronize', this.#onSync)
    window.removeEventListener('storage', this.#onStorage)
    window.removeEventListener('online', this.#onNetworkChange)
    window.removeEventListener('offline', this.#onNetworkChange)
    this.#railQuery?.removeEventListener('change', this.#onRailQuery)
    this.#railQuery = null
    if (this.#retryTimer) clearInterval(this.#retryTimer)
    this.#stopClock()
    // A suppression left behind deafens the whole hive, and `focusout` never
    // arrives when the window is destroyed out from under the focus.
    this.#releaseQuestionKeys()
    this.#releaseRouteKeys()
    if (this.#routeTimer !== null) { clearTimeout(this.#routeTimer); this.#routeTimer = null }
    // A steer's listeners, the reading observer and the step timers go with it.
    this.#cancelSteer(false)
    this.#disconnectReading()
    if (this.#keySettle !== null) { clearTimeout(this.#keySettle); this.#keySettle = null }
    if (this.#preferTimer !== null) { clearTimeout(this.#preferTimer); this.#preferTimer = null }
    // A DESTROY IS NOT A STOP. This used to abort the host's stream, so
    // folding the panel away — or any surface swap that rebuilds this
    // component — threw away an answer mid-arrival, unstored. The run lives in
    // host-stream.ts precisely so it can carry on without a window; only the
    // participant pressing Stop calls it back.
    this.#rail?.dispose()
    this.#rail = null
    this.#thumbToken++
    for (const url of this.#thumbUrls.values()) URL.revokeObjectURL(url)
    this.#thumbUrls.clear()
    this.#subjectThumbToken++
    if (this.#subjectThumbUrl) URL.revokeObjectURL(this.#subjectThumbUrl)
    this.#subjectThumbUrl = null
  }

  #retryTimer: ReturnType<typeof setInterval> | null = null

  // ── the wait, told honestly ─────────────────────────────────────────────

  /** Begin waiting: the clock starts, and every state that describes a
   *  previous wait is cleared so nothing from it can be read as current. */
  // A WAIT BELONGS TO ITS CONVERSATION, not to the window.
  //
  // It used to be one flag: opening another thread cleared it, so a question
  // still out on the thread you left lost its clock, its Stop button and its
  // withdraw handle — permanently, since nothing put them back when you
  // returned. With a chat per tile that is the ordinary move, not an edge
  // case: you ask on one tile and step to the next while it thinks.
  //
  // So outstanding asks are held per convoId and the window merely SHOWS the
  // active one. It is also what lets the list mark a tile as thinking: the
  // same record is announced on the bus, keyed by the tile's path.

  // ── A QUESTION SURVIVES THE PAGE ────────────────────────────────────
  //
  // THE ASK WAS ALWAYS DURABLE; THE WAITING WAS NOT.
  //
  // A bridge question is a record in the optimization pool and its answer is
  // written to the thread by the worker, with or without a window open — that
  // half was never in doubt. What died on every reload was everything that
  // SAID SO: `#outstanding` is in-memory, so a refresh mid-question came back
  // with no clock, no Stop, no Withdraw handle, no bee, and no thinking mark on
  // the tile. The question was still out there and the hive showed nothing at
  // all happening — which reads, to the person who asked, exactly like the
  // question having been dropped.
  //
  // So the wait is REBUILT FROM THE RECORD. The pool is the truth about what is
  // outstanding; this is the window catching up to it.

  #recovered = false

  /**
   * Put back every wait the page interruption took away.
   *
   * Two sources, because the two tiers are interrupted differently:
   *
   *   the pool     a bridge ask still marked pending — the answer is coming,
   *                so the clock, Stop and the bee come back and the tile is
   *                marked as thinking again
   *   checkpoints  a host answer that was mid-stream — its connection cannot
   *                outlive the page, so what IS recoverable is the text, filed
   *                as the turn it was becoming (chat-thread.ts)
   *
   * Idempotent and cheap to miss: everything it restores is a re-derivation of
   * something already on disk.
   */
  async #recoverWaits(): Promise<void> {
    if (this.#recovered) return
    this.#recovered = true

    // The interrupted host answers first: they are turns, and a turn wants to
    // be on the thread before the list is walked for it.
    try {
      const recovered = await this.#threads()?.recoverStreamCheckpoints?.(liveHostConvos())
      if (recovered) {
        void this.#refreshList()
        if (this.activeId()) void this.#load(this.activeId())
      }
    } catch { /* the checkpoint stays on disk; the next boot tries again */ }

    const store = ioc()?.get('@hypercomb.social/Store') as StoreLike | undefined
    if (!store?.listOptimizations || !store?.getOptimization) return

    let sigs: string[] = []
    try { sigs = await store.listOptimizations() } catch { return }

    // A withdrawn ask leaves a tombstone naming the record it retired. Read
    // them in the same pass, or a question the participant already called back
    // comes home wearing a clock.
    const stopped = new Set<string>()
    const pending: Array<{ sig: string; convoId: string; askedAt: number; prompt: string; model: string }> = []

    for (const sig of sigs.slice(0, RECOVER_SCAN_LIMIT)) {
      let record: {
        kind?: string
        payload?: {
          mode?: string
          askSig?: string
          status?: string
          convoId?: string
          askedAt?: number
          prompt?: string
          model?: string
        }
      } | undefined
      try {
        const blob = await store.getOptimization(sig)
        if (!blob) continue
        record = JSON.parse(await blob.text())
      } catch { continue }
      if (record?.kind !== 'ask') continue
      const payload = record.payload ?? {}
      const mode = String(payload.mode ?? '')
      if (mode === 'stop') { stopped.add(String(payload.askSig ?? '')); continue }
      if (mode !== 'chat') continue
      if (String(payload.status ?? 'pending') !== 'pending') continue
      const convoId = String(payload.convoId ?? '')
      if (!convoId) continue
      pending.push({
        sig,
        convoId,
        askedAt: Number(payload.askedAt) || 0,
        prompt: String(payload.prompt ?? ''),
        model: String(payload.model ?? ''),
      })
    }

    const now = Date.now()
    for (const ask of pending) {
      if (stopped.has(ask.sig)) continue
      // A wait this window already knows about outranks the record: it was
      // started here, this session, and its sig is already on it.
      if (this.#outstanding.has(ask.convoId)) continue
      if (!ask.askedAt || now - ask.askedAt > RECOVER_MAX_AGE_MS) continue

      this.#outstanding.set(ask.convoId, { sig: ask.sig, askedAt: ask.askedAt })
      this.#announceBusy(ask.convoId, true)
      // The bee is raised with the model the RECORD names, not the composer's:
      // what is out there was asked of a particular tier, and re-branding it
      // with whatever the window happens to be set to now would be the
      // confident-looking wrong answer the registry re-brands to avoid.
      this.#raiseBee(ask.convoId, ask.prompt, ask.model || this.#answeringModel())
      if (ask.convoId === this.activeId()) this.#syncWait(ask.convoId)
    }
  }

  #startWait(convoId: string, question = ''): void {
    this.#outstanding.set(convoId, { sig: '', askedAt: Date.now() })
    this.#announceBusy(convoId, true)
    this.#raiseBee(convoId, question)
    this.#syncWait(convoId)
  }

  // ── A QUESTION IS A UNIT OF WORK, so it gets a bee ──────────────────
  //
  // Every other kind of work in the hive raises one — an ask from the ask
  // screen, a routine, a sync — and the one thing a person does most often
  // did not. A chat question was visible only inside this window: send it,
  // fold the window away, and the hive showed nothing at all happening, on
  // the tile it was happening to.
  //
  // WHOSE MODEL IT IS COMES FOR FREE. The registry derives kind → vendor →
  // tier from the model at spawn (`#identity` / `identifyModel`), so
  // declaring `kind: 'model'` and the model in hand is the whole of the
  // branding — this surface never names a colour, which is what keeps the
  // vendor accent bounds a contract rather than a convention.
  //
  // WHERE THE BEE SITS is the tile's own label, with the rest of its path as
  // the segments — the shape the bee drone matches against the cells painted
  // on the current layer. A chat about no tile (the hive's own) leaves both
  // empty, which is exactly how that drone spells "hive-wide": it flies at
  // the root instead of over a cell.
  //
  // Shared UI must never import essentials, and does not: this is the same
  // `agent:start` / `agent:end` lane any behaviour uses, and a shell with no
  // registry simply has nobody listening.

  /** One bee per conversation — `#outstanding` is keyed the same way, so a
   *  second question cannot exist while the first is out. */
  #beeId(convoId: string): string { return `chat:${convoId}` }

  /** WHO IS ABOUT TO ANSWER. With a session on the bridge it is the model the
   *  composer is set to; without one the shallow host takes it, and that tier
   *  has its own model. Not a guess and not something to be discovered from
   *  the reply — the same `bridgeUp()` the send path branches on, read one
   *  moment earlier. */
  #answeringModel(): string {
    return this.providerReady() ? this.answering() : this.bridgeUp() ? this.answering() : HOST_TIER_MODEL
  }

  #raiseBee(convoId: string, question: string, model = this.#answeringModel()): void {
    const path = this.#threads()?.tilePathOf?.(convoId) ?? ''
    const parts = path.split('/').filter(Boolean)
    EffectBus.emit('agent:start', {
      id: this.#beeId(convoId),
      behavior: model,
      kind: 'model',
      model,
      request: question,
      // The tile it is about; empty for the hive's own conversation.
      targets: parts.length ? [parts[parts.length - 1]] : [],
      segments: parts.slice(0, -1),
    })
  }

  /** Stop waiting, whatever ended it — an answer, a failure, a withdrawal.
   *  Defaults to the conversation on screen; an answer landing on a thread
   *  you have since left ends THAT one. */
  #endWait(convoId: string = this.activeId()): void {
    if (this.#outstanding.delete(convoId)) {
      this.#announceBusy(convoId, false)
      // Guarded on the delete for the same reason the announce is: every path
      // that ends a wait comes through here, and several of them can fire for
      // one question (an answer that also fails a bump, a withdrawal that
      // races an arrival). Ending a bee twice would be harmless; raising the
      // toast of a second `agent:end` on an id the registry has already
      // retired is noise in its log.
      EffectBus.emit('agent:end', { id: this.#beeId(convoId), ok: true })
    }
    if (convoId === this.activeId()) this.#syncWait(convoId)
  }

  /** Paint the wait state of one conversation — called on every arrival at a
   *  thread, so a question still out is found exactly as it was left. */
  #syncWait(convoId: string): void {
    const out = this.#outstanding.get(convoId)
    this.#stopClock()
    if (!out) {
      this.waiting.set(false)
      this.hostStreaming.set(false)
      this.streaming.set('')
      this.pendingSig.set('')
      this.elapsed.set(0)
      return
    }
    this.waiting.set(true)
    this.askedAt.set(out.askedAt)
    this.pendingSig.set(out.sig)
    // A HOST ANSWER STILL ARRIVING ON THIS THREAD. The run kept the text while
    // the window was elsewhere; arriving is where it gets picked back up.
    this.#attachHostRun(convoId)
    this.elapsed.set(Math.max(0, Math.round((Date.now() - out.askedAt) / 1000)))
    this.#elapsedTimer = setInterval(() => {
      if (!this.waiting()) { this.#stopClock(); return }
      this.elapsed.set(Math.max(0, Math.round((Date.now() - this.askedAt()) / 1000)))
    }, ELAPSED_TICK_MS)
  }

  /** Tell the list which tile is thinking. The rail cannot see this window's
   *  state and must not try — it hears the fact and paints it. */
  #announceBusy(convoId: string, busy: boolean): void {
    const path = this.#threads()?.tilePathOf?.(convoId)
    if (!path) return
    EffectBus.emit('chat:tile-busy', { path, busy })
  }

  #stopClock(): void {
    if (!this.#elapsedTimer) return
    clearInterval(this.#elapsedTimer)
    this.#elapsedTimer = null
  }

  /**
   * Call the question back.
   *
   * The two tiers fail differently and so they are stopped differently. A host
   * answer is a live HTTP stream: aborting it is all there is, and whatever had
   * already arrived is kept, because the host really did say it. A bridge ask
   * is a durable RECORD sitting in the optimization pool — stopping it means
   * taking that record out, so no session can ever pick it up, plus the same
   * `mode:'stop'` marker AgentRegistry leaves for a responder already mid-flight.
   */
  async stop(): Promise<void> {
    if (this.hostStreaming()) {
      // The run keeps whatever had already arrived and stores it — stopping is
      // not discarding. Its `chat:host-done` ends the wait.
      stopHostRun(this.activeId())
      return
    }
    await this.withdraw()
  }

  /** Retire a queued ask. Idempotent, and safe when the record is already
   *  gone — a responder that drained it a moment ago simply answers anyway. */
  async withdraw(): Promise<void> {
    const sig = this.pendingSig()
    this.#endWait()
    if (!sig) return

    const store = ioc()?.get('@hypercomb.social/Store') as StoreLike | undefined
    if (!store?.removeOptimization) return
    try {
      await store.removeOptimization(sig)
      // The courtesy marker: a responder that already has this ask in hand
      // learns it was withdrawn. Same shape AgentRegistry.#retireAsk writes.
      if (store.putOptimization) {
        const marker = {
          kind: 'ask',
          appliesTo: [...this.targets()],
          payload: { mode: 'stop', askSig: sig, status: 'stopped', askedAt: Date.now() },
          mark: 'persistent',
        }
        await store.putOptimization(new Blob([JSON.stringify(marker)], { type: 'application/json' }))
      }
    } catch { /* the ask is out of the pool or was never in it — either way, done */ }
  }

  // ── guided setup actions ────────────────────────────────────────────────

  /** Step 1 — the only step that takes the participant's word. */
  markTools(): void {
    this.toolsDone.set(true)
    writeFlag(SETUP_TOOLS_KEY)
  }

  /** Step 2 — opt this tab in and dial the broker now. The worker's
   *  connect() re-reads the gate, so no reload is needed. */
  enableBridge(): void {
    try { localStorage.setItem(CLAUDE_BRIDGE_ENABLED_STORAGE_KEY, '1') } catch { /* private mode */ }
    this.bridgeConfigured.set(isLocalClaudeBridgeConfigured())
    EffectBus.emit('claude-bridge:connect', {})
  }

  /** Step 4 — prove the loop with a real question. Completes when the
   *  answer lands (`#onReply` sets the first-reply flag). */
  tryAsk(): void {
    const i18n = ioc()?.get('@hypercomb.social/I18n') as { t?: (key: string) => string } | undefined
    const starter = i18n?.t?.('chat.setup.starter') || 'What do you see in this hive?'
    this.tried.set(true)
    void this.send(starter)
  }

  /** Copy a checklist command; the button flashes "Copied" briefly. */
  copyCmd(id: string, text: string): void {
    void navigator.clipboard?.writeText(text).then(() => {
      this.copied.set(id)
      setTimeout(() => { if (this.copied() === id) this.copied.set('') }, 1_400)
    }).catch(() => { /* clipboard unavailable — the text is still visible */ })
  }

  /** Complete (or skip) the checklist and land in the chat. */
  finishSetup(): void {
    this.setupDone.set(true)
    writeFlag(SETUP_DONE_KEY)
    this.#focus()
  }

  /** The host door — configure a participant-controlled AI host directly.
   *  `setHost` announces `host-ai:configuration`, which this window already
   *  follows into `hostConfigured` and a resume. */
  connectHost(domain: string): void {
    const bare = String(domain ?? '').trim()
    if (!bare) return
    const host = ioc()?.get(HOST_AI_IOC_KEY) as HostAiLike | undefined
    if (!host?.setHost) {
      EffectBus.emit('toast:show', { type: 'warning', message: 'Host service unavailable — try again in a moment.' })
      return
    }
    host.setHost(bare)
  }

  /** A participant with existing conversations predates the checklist —
   *  never greet them with a wizard for a loop they already run. */
  #grandfather(): void {
    if (!this.setupDone() && this.conversations().length > 0) {
      this.setupDone.set(true)
      writeFlag(SETUP_DONE_KEY)
    }
  }

  // ── services ────────────────────────────────────────────────────────────

  #threads(): ChatThreadsLike | undefined {
    return ioc()?.get('@diamondcoreprocessor.com/ChatThreads') as ChatThreadsLike | undefined
  }

  #queen(): QueenLike | undefined {
    return ioc()?.get('@diamondcoreprocessor.com/LlmQueenBee') as QueenLike | undefined
  }

  #refreshAvailability(): void {
    this.bridgeConfigured.set(isLocalClaudeBridgeConfigured())
    const host = ioc()?.get(HOST_AI_IOC_KEY) as HostAiLike | undefined
    this.hostConfigured.set(host ? !!host.configured : isParticipantAiHostConfigured())
  }

  // ── opening and closing ─────────────────────────────────────────────────

  /**
   * Show the window.
   *
   * With a PREFILL this is a new question, so it starts a NEW conversation and
   * sends immediately — `/opus what links these tiles?` should answer, not fill
   * a box you then have to press Enter on, and it must not graft an unrelated
   * question onto whatever thread happened to be last.
   *
   * With no prefill it RESUMES the most recent conversation, which is what
   * reopening a chat window should do.
   */
  async open(payload?: { model?: string; prefill?: string; convoId?: string }): Promise<void> {
    this.#refreshAvailability()
    this.#refreshDesignation()
    const prefill = String(payload?.prefill ?? '').trim()
    this.visible.set(true)
    rememberChatVisibility(true)
    // Reopening always lands on the conversation, never folded away.
    this.peeking.set(false)
    this.#claimSurface(true)
    this.#applyFold()
    // Announce symmetrically with close() — the controls-bar launcher light
    // (and anything else watching) reads this state.
    EffectBus.emit('chat:window-state', { open: true })
    if (!this.enabled()) return
    this.#refreshContext()
    this.bridgeUp.set(!!(ioc()?.get('@diamondcoreprocessor.com/ClaudeBridgeWorker') as BridgeLike | undefined)?.connected)
    this.#refreshDesignation()

    if (payload?.convoId) { await this.#refreshList(); await this.#load(payload.convoId) }
    else if (prefill) { await this.#refreshList(); this.newChat() }
    else await this.#resume()

    // After the conversation is settled, so it is not overwritten by the
    // remembered model of the thread we just loaded.
    if (payload?.model) this.setModel(payload.model)

    if (prefill) { await this.send(prefill); return }
    await this.#restoreDraft()
    this.#focus()
  }

  /** Land on the most recent conversation without taking focus — the boot
   *  path, the re-run once the threads service registers, and open()'s
   *  no-payload branch. One pass: the list walk already read the newest
   *  thread's turns, so resuming adopts them instead of re-reading the bucket. */
  async #resume(): Promise<void> {
    const threads = this.#threads()
    if (!threads) return
    if (threads.listConversationsWithLatest) {
      const { conversations, latestTurns } = await threads.listConversationsWithLatest()
      this.conversations.set(conversations)
      this.#grandfather()
      // ANY current conversation is kept — including a just-minted empty New
      // chat, which is a thing the participant explicitly created and must
      // survive a close/reopen. (Guarding on turns.length here silently threw
      // that new chat away and landed back in the previous thread.)
      if (this.activeId()) return
      // AN ARCHIVED THREAD IS NEVER "where you were" — resuming into one
      // would undo the act on the next reload. `latestTurns` skips them for
      // the same reason, so the two agree about which thread this is.
      const recent = conversations.find(convo => !convo.archived)
      if (recent) {
        this.activeId.set(recent.convoId)
        this.model.set(this.#rememberedModel(recent.convoId))
        this.modelExplicit.set(false)
        this.streaming.set('')
        this.turns.set(latestTurns)
        this.#syncWait(recent.convoId)
        // The one-pass read carried no route; ask for it now that the thread
        // is the open one (the two-read path below gets it from `#load`).
        this.#clearRoute()
        this.#scheduleRouteRefresh(recent.convoId)
        this.#scrollDown(true)
      } else if (!this.activeId()) {
        this.newChat(false)
      }
      return
    }
    // Older module build without the one-pass read — the two-read path.
    await this.#refreshList()
    this.#grandfather()
    if (this.activeId()) return
    const recent = this.conversations().find(convo => !convo.archived)
    if (recent) await this.#load(recent.convoId)
    else this.newChat(false)
  }

  close(): void {
    if (!this.visible()) return
    this.visible.set(false)
    rememberChatVisibility(false)
    this.peeking.set(false)
    this.#claimSurface(false)
    this.#applyFold()
    this.listOpen.set(false)
    this.armed.set('')
    // A keymap held by the wizard or the route goes with the window.
    this.#releaseQuestionKeys()
    this.#releaseRouteKeys()
    this.#cancelSteer(false)
    // Closing the window is a real close: the sidebar's trail and subject go
    // down with it.
    // The half-written thought does NOT: it is flushed first, so closing the
    // window is never how you lose it.
    void this.#flushDraft()
    this.#rail?.dispose()
    this.#rail = null
    this.railSubject.set(null)
    // The shelf is NOT reset: coming back to a conversation you were part-way
    // through composing must find the references you had put on it. What
    // dies with the window is the flyout and the rail's pick bookkeeping.
    this.clipboardOpen.set(false)
    this.#railSeen = new Map()
    EffectBus.emit('chat:window-state', { open: false })
  }

  #railBounds(): { min: number; max: number } {
    const panel = this.panel()?.nativeElement
    // The route column's minimum is room the rail cannot take either, so a
    // dragged-wide rail never pushes the split past the panel.
    const column = this.routeSideShown() ? 12 * remPx() : 0
    const room = panel ? panel.getBoundingClientRect().width - CONVERSATION_MIN - column : RAIL_MAX
    return { min: RAIL_MIN, max: Math.max(RAIL_MIN, Math.min(RAIL_MAX, room)) }
  }

  #setRailWidth(next: number): void {
    const { min, max } = this.#railBounds()
    const width = Math.round(Math.min(max, Math.max(min, next)))
    this.railWidth.set(width)
    try { localStorage.setItem(RAIL_WIDTH_KEY, String(width)) } catch { /* private mode */ }
  }

  startRailDrag(event: PointerEvent): void {
    const grip = event.target as HTMLElement | null
    const rail = this.chatRail()?.nativeElement
    if (!grip || !rail) return
    event.preventDefault()
    const startX = event.clientX
    const startWidth = rail.getBoundingClientRect().width
    this.railDragging.set(true)
    grip.classList.add('dragging')
    try { grip.setPointerCapture(event.pointerId) } catch { /* older engines use the window listeners */ }
    const move = (moved: PointerEvent): void => this.#setRailWidth(startWidth + moved.clientX - startX)
    const up = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      grip.classList.remove('dragging')
      this.railDragging.set(false)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }

  resetRailWidth(): void {
    this.railWidth.set(0)
    try { localStorage.removeItem(RAIL_WIDTH_KEY) } catch { /* private mode */ }
  }

  onRailGripKey(event: KeyboardEvent): void {
    const step = event.shiftKey ? 40 : 12
    const rail = this.chatRail()?.nativeElement
    const current = this.railWidth() || rail?.getBoundingClientRect().width || RAIL_MIN
    if (event.key === 'ArrowLeft') { event.preventDefault(); this.#setRailWidth(current - step) }
    else if (event.key === 'ArrowRight') { event.preventDefault(); this.#setRailWidth(current + step) }
    else if (event.key === 'Home') { event.preventDefault(); this.resetRailWidth() }
  }

  // ── the workflow sidebar's grip ───────────────────────────────────────
  //
  // The same gesture as the rail's, mirrored: the column sits at the inline
  // end, so dragging its start edge LEFT widens it. Bounded by the column's
  // own minimum and by the thread's (`CONVERSATION_MIN`), measured against
  // the split at drag time. Double-click or Home hands the width back to the
  // stylesheet's clamp.

  #routeSideBounds(): { min: number; max: number } {
    const split = this.panel()?.nativeElement.querySelector<HTMLElement>('.chat-route-split')
    const min = ROUTE_SIDE_MIN_REM * remPx()
    const room = split ? split.getBoundingClientRect().width - CONVERSATION_MIN : min
    return { min, max: Math.max(min, room) }
  }

  #setRouteSideWidth(next: number): void {
    const { min, max } = this.#routeSideBounds()
    const width = Math.round(Math.min(max, Math.max(min, next)))
    this.routeSideWidth.set(width)
    try { localStorage.setItem(ROUTE_SIDE_WIDTH_KEY, String(width)) } catch { /* private mode */ }
  }

  startRouteSideDrag(event: PointerEvent): void {
    const grip = event.target as HTMLElement | null
    const column = grip?.closest<HTMLElement>('.chat-route-col')
    if (!grip || !column) return
    event.preventDefault()
    const startX = event.clientX
    const startWidth = column.getBoundingClientRect().width
    this.routeResizing.set(true)
    grip.classList.add('dragging')
    try { grip.setPointerCapture(event.pointerId) } catch { /* older engines use the window listeners */ }
    const move = (moved: PointerEvent): void => this.#setRouteSideWidth(startWidth + startX - moved.clientX)
    const up = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      grip.classList.remove('dragging')
      this.routeResizing.set(false)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }

  resetRouteSideWidth(): void {
    this.routeSideWidth.set(0)
    try { localStorage.removeItem(ROUTE_SIDE_WIDTH_KEY) } catch { /* private mode */ }
  }

  onRouteGripKey(event: KeyboardEvent): void {
    const step = event.shiftKey ? 40 : 12
    const column = this.panel()?.nativeElement.querySelector<HTMLElement>('.chat-route-col')
    const current = this.routeSideWidth() || column?.getBoundingClientRect().width || ROUTE_SIDE_MIN_REM * remPx()
    // Mirrored: the column grows toward the start edge.
    if (event.key === 'ArrowLeft') { event.preventDefault(); this.#setRouteSideWidth(current + step) }
    else if (event.key === 'ArrowRight') { event.preventDefault(); this.#setRouteSideWidth(current - step) }
    else if (event.key === 'Home') { event.preventDefault(); this.resetRouteSideWidth() }
  }

  onKey(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return
    event.preventDefault()
    // The cascade unwinds the smallest commitment first: the tile you are
    // talking to, then the window — matching the escape-cascade's
    // outermost-first rule.
    // The flyout is the smallest thing open, so it unwinds first.
    if (this.clipboardOpen()) { this.clipboardOpen.set(false); return }
    // Folded away is a smaller commitment than the window itself: Escape
    // brings the conversation back before it takes the window down.
    if (this.peeking()) { this.togglePeek(); return }
    // Then the RAIL'S OWN picks; a reference on the shelf is let go with its
    // × or by dragging it back, never by a keystroke that means "go up".
    if (this.#railSeen.size) { this.#rail?.clearSelection(); return }
    if (this.railSubject()) { this.#rail?.clearSubject(); return }
    this.close()
  }

  // ── conversations ───────────────────────────────────────────────────────

  async #refreshList(): Promise<void> {
    const threads = this.#threads()
    if (!threads) return
    this.conversations.set(await threads.listConversations())
    await this.#refreshDrafts()
  }

  /** Read every held draft, so the roster can show the conversations that
   *  exist only as something you were part-way through saying. */
  async #refreshDrafts(): Promise<void> {
    const threads = this.#threads()
    if (!threads?.listTileDrafts) return
    try {
      const held = await threads.listTileDrafts()
      this.drafts.set(held.map(entry => ({ key: entry.path, text: entry.text })))
    } catch { /* the roster degrades to turns-only, never to an error */ }
  }

  /** Move a conversation to the top of the IN-MEMORY list after a turn lands —
   *  the pool is already the truth (the turn was stored before this), so a
   *  full re-list per send/reply paid a walk over every thread to learn what
   *  this window just did itself. Returns false when the conversation is not
   *  in the list and cannot be derived here (a reply to a thread this session
   *  has never listed) — the caller falls back to the real walk.
   *
   *  `added` is how many turns landed since the last bump, used only when the
   *  conversation is NOT the active one (then the in-memory turns can't be
   *  counted). The host tier stores TWO turns per send (question + streamed
   *  answer) in one bump — a mid-stream switch to another thread must not
   *  leave that row undercounting the pool it mirrors. */
  #bumpList(convoId: string, added = 1): boolean {
    const turnsHere = convoId === this.activeId() ? this.turns() : null
    const list = this.conversations()
    const index = list.findIndex(c => c.convoId === convoId)
    if (index < 0 && !turnsHere) return false
    const prev = index >= 0 ? list[index] : null
    const summary: ConversationSummary = {
      convoId,
      title: prev?.title || this.#titleFrom(turnsHere ?? []),
      turnCount: turnsHere ? turnsHere.length : (prev?.turnCount ?? 0) + added,
      lastAt: turnsHere?.[turnsHere.length - 1]?.at ?? Date.now(),
      // The turns in hand are the truth for the thread being read; for any
      // other, a bump only ever ADDS turns, and the only turn that can arrive
      // for a thread you are not in is an answer.
      replied: turnsHere
        ? turnsHere.some(turn => turn.role === 'assistant')
        : (prev?.replied ?? true),
    }
    const rest = index >= 0 ? [...list.slice(0, index), ...list.slice(index + 1)] : [...list]
    this.conversations.set([summary, ...rest].sort((a, b) => b.lastAt - a.lastAt))
    return true
  }

  async #load(convoId: string): Promise<void> {
    const threads = this.#threads()
    if (!threads || !convoId) return
    this.activeId.set(convoId)
    this.#rail?.showConversation?.(convoId)
    this.model.set(this.#rememberedModel(convoId))
    this.modelExplicit.set(false)
    this.streaming.set('')
    const turns = await threads.readTurns(convoId)
    // A slow read landing after the participant moved on must not paint one
    // thread's turns under another thread's name — checked BEFORE the paint
    // (it used to sit after the set, guarding only the scroll).
    if (this.activeId() !== convoId) return
    this.turns.set(turns)
    this.#syncWait(convoId)
    // The last thread's route must not stand beside this one's turns for the
    // 150 ms until the re-read lands; the announce below schedules that read.
    this.#clearRoute()
    // Arriving IS reading: the newest turn here is no longer unread, which is
    // what takes the bold off this tile's row in the list.
    threads.markConversationSeen?.(convoId, turns[turns.length - 1]?.at ?? Date.now())
    EffectBus.emit('chat:threads-changed', { convoId })
    // Switching threads re-pins: you are arriving at a conversation, and its
    // newest turn is where arriving means.
    this.#scrollDown(true)
  }

  // ── a conversation per tile ─────────────────────────────────────────────
  //
  // Clicking a row in the sidebar IS entering that tile's chat, so two things
  // move together: the transcript becomes that tile's thread, and the composer
  // becomes that tile's unsent thinking. Neither ACTIVATES anything — arriving
  // at a tile starts nothing, and the words you left there start nothing until
  // you send them.
  //
  // What you type is held as you type it. That is the whole point: you can
  // think tactically across the hive — a line here, a line three tiles over —
  // and come back to finish, delete, or send any of them. An orchestrator
  // coming through later reads the same pool and can decide what is worth
  // doing; until then the thinking just sits where you left it.

  /** Where the composer's text is held: the tile, when the open conversation
   *  belongs to one, else the conversation itself (a free-floating chat keeps
   *  its draft too — it is a conversation like any other, it just has no row). */
  #draftKey(): string {
    const id = this.activeId()
    return this.#threads()?.tilePathOf?.(id) || id
  }

  /** Hold what is in the composer. Debounced: typing must not be a write per
   *  keystroke, and the flushes on the way out of anything (switching tiles,
   *  sending, closing) mean the debounce can never be the last word. */
  #holdDraft(): void {
    if (this.#draftTimer !== null) clearTimeout(this.#draftTimer)
    this.#draftTimer = setTimeout(() => { this.#draftTimer = null; void this.#flushDraft() }, DRAFT_HOLD_MS)
  }

  /** Write the composer's text where it belongs, now. */
  async #flushDraft(key?: string): Promise<void> {
    if (this.#draftTimer !== null) { clearTimeout(this.#draftTimer); this.#draftTimer = null }
    const threads = this.#threads()
    const target = key ?? this.#draftKey()
    if (!threads?.saveTileDraft || !target) return
    const text = this.input()?.nativeElement?.value ?? ''
    if (text === this.#heldDraft) return
    this.#heldDraft = text
    await threads.saveTileDraft(target, text)
  }

  /** Put a conversation's unsent thinking back in the composer. */
  async #restoreDraft(): Promise<void> {
    const threads = this.#threads()
    const key = this.#draftKey()
    const text = key && threads?.readTileDraft ? await threads.readTileDraft(key) : ''
    // A slow read must not overwrite a box the participant has since moved on
    // from — the key it was read for has to still be the open one.
    if (key !== this.#draftKey()) return
    this.#heldDraft = text
    const element = this.input()?.nativeElement
    if (!element) return
    element.value = text
    this.autosize(element)
  }

  /** The sidebar clicked a row: leave the current thinking where it is, then
   *  arrive in that tile's conversation. A tile nobody has spoken to reads as
   *  an empty thread — dormant, not missing. */
  async #enterSubject(subject: RailPickLike | null): Promise<void> {
    await this.#flushDraft()
    this.railSubject.set(subject)
    if (!subject) return
    // WHICH conversation, not just which tile. The rail hands the exact id —
    // a tile holds several, and the hive's own row hands a global one whose
    // path is `/`, which no tile-name derivation could ever produce. Falling
    // back to the derivation only for an older rail that sends no id.
    const convoId = subject.convoId
      || this.#threads()?.tileConvoId?.([...subject.path, subject.name])
    if (convoId) await this.#load(convoId)
    await this.#restoreDraft()
    this.listOpen.set(false)
    this.#focus()
  }

  /** Start a fresh thread. It does not appear in the list until it holds a
   *  turn — an empty conversation is not yet a conversation. `focus` is false
   *  only on the boot path: the default view opens beside the command line and
   *  must not steal its cursor. */
  newChat(focus = true): void {
    const threads = this.#threads()
    void this.#flushDraft()
    // A CHAT ABOUT A TILE BELONGS UNDER THAT TILE. When the rail has a tile
    // in hand it mints the id and lists the new row itself — the window would
    // otherwise start a thread about nothing in particular, which is
    // unlistable: no row can hold it. It answers false when there is no tile,
    // and then a free chat is the honest thing to make.
    if (this.#rail?.newChatOnSubject?.()) { if (focus) this.#focus(); return }
    this.#mint(threads?.newConvoId() ?? '', focus)
  }

  /** Start a conversation ABOUT A LOCATION — the door an annotation comes
   *  through. The rail's "new chat" needs a tile in hand and the sidebar is
   *  where that hand lives; here the location arrives with the picture, so
   *  nothing has to be pointed at first. ANOTHER conversation, not the tile's
   *  first one: an annotation is a new subject, and grafting it onto whatever
   *  was last said about that tile is how threads become unreadable.
   *
   *  The rail's subject is dropped: it named a tile you clicked, and the
   *  conversation is no longer about that tile. */
  #startAt(segments: readonly string[]): void {
    const threads = this.#threads()
    void this.#flushDraft()
    this.railSubject.set(null)
    this.#rail?.clearSubject()
    this.#mint(
      threads?.newTileConvoId?.(segments) ?? threads?.newConvoId() ?? '',
      true,
    )
  }

  /** Become a named conversation that holds nothing yet. Shared by the free
   *  chat and the located one, so the two can never drift about what a fresh
   *  thread starts out as. */
  #mint(convoId: string, focus: boolean): void {
    this.activeId.set(convoId)
    this.#heldDraft = ''
    const box = this.input()?.nativeElement
    if (box) { box.value = ''; this.autosize(box) }
    this.turns.set([])
    this.streaming.set('')
    this.#clearRoute()
    // A NEW CONVERSATION HAS NAMED NOBODY. Carrying the last thread's named
    // model into it was survivable while a picker showed what it was; with
    // the policy designating, an inherited name is a silent override of the
    // participant's own standing instructions.
    this.model.set('')
    this.modelExplicit.set(false)
    this.#refreshDesignation()
    this.#endWait()
    this.listOpen.set(false)
    this.armed.set('')
    this.atBottom.set(true)
    if (focus) this.#focus()
  }

  async pick(convoId: string): Promise<void> {
    this.listOpen.set(false)
    this.armed.set('')
    await this.#flushDraft()
    this.railSubject.set(null)
    this.#rail?.clearSubject()
    await this.#load(convoId)
    // Every conversation holds its own unsent thinking, whether or not it
    // belongs to a tile — arriving anywhere puts it back.
    await this.#restoreDraft()
    this.#focus()
  }

  /** First press arms, second deletes. */
  async remove(convoId: string, event: MouseEvent): Promise<void> {
    event.stopPropagation()
    if (this.armed() !== convoId) { this.armed.set(convoId); return }
    this.armed.set('')
    const threads = this.#threads()
    if (!threads) return

    // A DRAFT-ONLY ROW IS THE DRAFT. Deleting the (empty) bucket would leave
    // the words in the pool and the row would come straight back on the next
    // refresh. A conversation that HOLDS TURNS is different: its tile's
    // unsent thinking is standing intent about the tile, not part of the
    // thread being thrown away, and it stays.
    const row = this.roster().find(entry => entry.convoId === convoId)
    if (row && row.turnCount === 0 && row.draft) {
      const key = threads.tilePathOf?.(convoId) || convoId
      await threads.saveTileDraft?.(key, '')
    }

    // Leaving the conversation being deleted must not carry its words into
    // the next one: the box is emptied and the pending debounce cancelled
    // BEFORE anything else is loaded.
    if (this.activeId() === convoId) {
      if (this.#draftTimer !== null) { clearTimeout(this.#draftTimer); this.#draftTimer = null }
      this.#heldDraft = ''
      const box = this.input()?.nativeElement
      if (box) { box.value = ''; this.autosize(box) }
    }

    await threads.deleteConversation(convoId)
    await this.#refreshList()
    if (this.activeId() === convoId) {
      // Never land in something that was put away — the same rule resume follows.
      const next = this.conversations().find(convo => !convo.archived)
      if (next) { await this.#load(next.convoId); await this.#restoreDraft() }
      else this.newChat()
    }
  }

  toggleList(): void {
    this.armed.set('')
    this.listOpen.update(open => !open)
  }

  toggleStands(): void {
    const next = !this.standsOpen()
    this.standsOpen.set(next)
    try { globalThis.localStorage?.setItem(STANDS_OPEN_KEY, next ? '1' : '0') } catch { /* session-local */ }
  }

  // ── model ───────────────────────────────────────────────────────────────

  #modelMap(): Record<string, string> {
    try { return JSON.parse(localStorage.getItem(MODEL_KEY) ?? '{}') as Record<string, string> }
    catch { return {} }
  }

  /** What this thread was last held in, or `''` — a thread nobody has named a
   *  model for is not a thread that chose the default, and the difference is
   *  what lets the policy designate for it. */
  #rememberedModel(convoId: string): string {
    const remembered = this.#modelMap()[convoId]
    return typeof remembered === 'string' ? remembered.trim().toLowerCase() : ''
  }

  /** NAMING A MODEL for this conversation — the command line's `/opus`, its
   *  bracket form, or a `chat:open` that carried one. No longer restricted to
   *  the four Claude words: a bridge announces its own model words
   *  (llm.queen's slash provider), and a word the participant typed is an
   *  override whichever roster it came from. */
  setModel(requested: string): void {
    const next = String(MODEL_ALIASES[requested] ?? requested ?? '').trim().toLowerCase()
    if (!next) return
    this.model.set(next)
    this.modelExplicit.set(true)
    this.#remember(next)
  }

  /** Write what this conversation is being held in. Called when a model is
   *  NAMED and again when a question actually leaves — the map is a record of
   *  who took the last question, which is what the render layer brands a
   *  tile's resting bee from. */
  #remember(model: string): void {
    const id = this.activeId()
    if (!id || !model) return
    try {
      const map = this.#modelMap()
      if (map[id] === model) return
      map[id] = model
      localStorage.setItem(MODEL_KEY, JSON.stringify(map))
    } catch { /* participant-local convenience — never worth failing a send */ }
  }

  /** ASK THE POLICY WHO ANSWERS. A chat question is the deep, hive-reading
   *  kind — that is the whole difference between this window and a routine's
   *  one-shot call — so the need is stated once, here.
   *
   *  Read at the moments the answer could have changed (opening, the bridge
   *  coming or going, sending) rather than watched: the providers console is
   *  where it changes, and you cannot be in it and in here at once. */
  /** THE ONE PLACE IT IS CHOSEN. Company, model and level of thinking are set
   *  in the providers console — pinned per tier, or left to the policy — and
   *  this window points at it rather than keeping a second, smaller answer to
   *  the same question. */
  openProviders(): void {
    EffectBus.emit('providers:open', {})
  }

  #refreshDesignation(): void {
    const policy = ioc()?.get('@diamondcoreprocessor.com/LlmPolicyStore') as PolicyLike | undefined
    // THE POLICY OWNS THE NEED. Stating it here as a literal is what let this
    // window ask for something its own docstring contradicts — a `fast` call
    // that named no ask path, which no bridge could ever be chosen for. The
    // fallback is for an older essentials build that has no `chatNeed`.
    const need: ChatNeed = policy?.chatNeed ?? { streaming: true, viaAsk: true }
    this.designated.set(policy?.designate?.(need) ?? null)
    const router = ioc()?.get(LLM_ROUTER_IOC_KEY) as LlmRouterLike | undefined
    this.providerReady.set(!!router?.ready?.({
      model: this.modelExplicit() ? this.model() || undefined : undefined,
      preferModel: !this.modelExplicit() ? this.model() || undefined : undefined,
      need,
    }))
    this.linkReason.set(router?.reason?.() ?? '')
  }

  // ── context ─────────────────────────────────────────────────────────────

  /** Where we are and what is selected. Read live from the hive, never stored
   *  on the conversation: a thread outlives the page it was started on. */
  #refreshContext(): void {
    const lineage = ioc()?.get('@hypercomb.social/Lineage') as LineageLike | undefined
    const segments = (lineage?.explorerSegments?.() ?? [])
      .map(s => String(s ?? '').trim()).filter(Boolean)
    this.here.set(segments)

    const selection = ioc()?.get('@diamondcoreprocessor.com/SelectionService') as SelectionLike | undefined
    this.targets.set([...(selection?.selected ?? [])])

    // Attached context — the cheap unresolved read (decoration index verbatim).
    try {
      const tileContext = ioc()?.get('@diamondcoreprocessor.com/TileContext') as TileContextLike | undefined
      this.contextCount.set(tileContext?.branchesFor?.(segments)?.length ?? 0)
    } catch { this.contextCount.set(0) }
  }

  /** What the question is about: the canvas selection, plus the tile whose
   *  conversation is open. A subject on the CURRENT page rides as a bare name
   *  — exactly the shape a selection target has always had — and one from a
   *  drilled level rides as its full `/path/name`, which is self-describing
   *  to the responder without any protocol change. */
  #chosenTargets(): string[] {
    // THE TARGET IS THE CONVERSATION'S OWN TILE. Nothing to choose and
    // nothing to keep in step: you are talking to a tile, so that tile is
    // what the answer may change. (Reading it off the sidebar instead meant a
    // chat opened from the roster — or in the docked window, which has no
    // sidebar — asked its question about nothing.)
    const path = this.subjectPath()
    if (!path || path === '/') return [...new Set(this.targets())]
    const segments = path.split('/').filter(Boolean)
    const hereJson = JSON.stringify(this.here())
    const parent = segments.slice(0, -1)
    const named = JSON.stringify(parent) === hereJson ? segments[segments.length - 1] : path
    return [...new Set([...this.targets(), named])]
  }

  /** The tile's attached context, resolved to content sigs for the SHALLOW
   *  tier (the host caps them server-side). Best-effort: context is a grade
   *  of service, never a reason a question fails to leave. */
  async #contextSigs(): Promise<readonly string[]> {
    try {
      const tileContext = ioc()?.get('@diamondcoreprocessor.com/TileContext') as TileContextLike | undefined
      return await tileContext?.signaturesFor?.(this.here()) ?? []
    } catch { return [] }
  }

  // ── sending ─────────────────────────────────────────────────────────────

  /**
   * Send a message on the active conversation.
   *
   * The user's turn is written to the thread BEFORE the ask goes out. It used
   * not to be — only replies were stored — so a reload showed answers with no
   * questions above them. The reply's own durability was never the half that
   * was missing.
   */
  async send(text?: string): Promise<void> {
    this.#refreshAvailability()
    this.#refreshDesignation()
    if (!this.enabled()) return
    // BEFORE the bee is raised: the wait indicator brands one, and a bee
    // wearing a designation that is one question out of date is exactly the
    // confident-looking wrong answer the registry re-brands to avoid.
    const element = this.input()?.nativeElement
    const message = String(text ?? element?.value ?? '').trim()
    if (!message) return

    const threads = this.#threads()
    const queen = this.#queen()
    if (!threads) {
      EffectBus.emit('toast:show', {
        type: 'warning',
        message: 'Chat service unavailable — try again in a moment.',
      })
      return
    }

    let convoId = this.activeId()
    if (!convoId) { convoId = threads.newConvoId(); this.activeId.set(convoId) }

    if (element && text === undefined) { element.value = ''; this.autosize(element) }
    // SENT IS NOT HELD. The thinking became a turn; leaving a copy in the
    // drafts pool would show the tile as still having something unsaid.
    void this.#flushDraft()

    const turn: ChatTurn = { kind: 'chat-turn', convoId, role: 'user', text: message, at: Date.now() }
    this.turns.update(list => [...list, turn])
    this.#startWait(convoId, message)
    // Sending is the one arrival the participant caused, so it re-pins the
    // transcript even if they had scrolled up to read something.
    this.#scrollDown(true)

    const stored = await threads.appendTurn(convoId, 'user', message)
    if (!stored) console.warn('[chat] the question was not stored — it will be missing after a reload')
    // ANNOUNCE THE QUESTION, not just the answer. A thread is a row from its
    // first turn — waiting for its reply, which is the state you most want to
    // see — and the rail cannot know that until somebody says so. Without
    // this the row appeared only when the answer came back, which is the one
    // moment you no longer needed telling.
    else EffectBus.emit('chat:threads-changed', { convoId })

    // THREE TIERS, one window. The provider router is first: it covers local
    // Ollama and participant-keyed APIs, applies policy, and owns bounded
    // fallback. It cannot take an explicitly named bridge model, so those
    // choices fall through without silently changing vendor.
    const routed = await this.#askProvider(convoId, message)
    if (routed === 'answered' || routed === 'aborted') return

    // The two legacy transports remain honest fallbacks.
    //
    // With a session on the bridge, the question goes to it: that is the deep
    // tier, and the only one that can read the hive. With nothing listening,
    // the host's AI answers immediately instead — that is what `/ask` did
    // before it folded in here, and folding it in must not cost it.
    //
    // If the host tier is unreachable and a local bridge is configured, the
    // question is QUEUED there: its durable record can be picked up when a
    // session connects. Without that bridge, host failure is reported now.
    if (!this.bridgeUp()) {
      // THE ENDING IS NOT THIS CALL'S RETURN VALUE. `chat:host-done` paints,
      // stores and counts it (`#onHostDone`), because the run outlives this
      // component and its answer must land whether or not anybody is still
      // awaiting here. What comes back is only the ROUTING decision.
      const outcome = await this.#askHost(convoId, message)
      if (outcome === 'answered') return
      // STOPPED BY THE PARTICIPANT. Handing a question they just called back
      // to the durable bridge queue would be the opposite of what Stop means.
      if (outcome === 'aborted') return
    }

    // A participant-host failure is retryable, but without a configured local
    // bridge there is nobody who could ever drain the durable bridge queue.
    if (!this.bridgeConfigured() || !queen?.submitChat) {
      this.#endWait()
      EffectBus.emit('toast:show', {
        type: 'warning',
        message: 'Your AI host is unavailable. Check its setup and try again.',
      })
      return
    }

    const transcript = this.turns()
      .slice(-TRANSCRIPT_TURNS)
      .map(t => ({ role: t.role, text: t.text }))

    // THE TIER CHANGED UNDER THE QUESTION. Getting here with the bridge down
    // means the shallow host declined it and the durable queue will answer
    // instead — with the composer's model, not the host's. The bee was
    // branded for the tier that was going to take it, so it is re-branded
    // for the one that actually did.
    if (!this.bridgeUp()) this.#raiseBee(convoId, message, this.answering())

    // WHAT ANSWERED IS WHAT THE THREAD IS HELD IN. The hint and the brand are
    // one string (`answering`), and writing it down here is what lets the
    // tile's resting bee wear the designation after this window is closed.
    queen.activeModel = this.answering()
    this.#remember(this.answering())
    const queued = await queen.submitChat(
      convoId, message, this.#chosenTargets(), transcript, this.referencePayload())
    if (!queued) {
      this.#endWait()
      EffectBus.emit('toast:show', { type: 'warning', message: 'Could not send — try again.' })
    } else if (typeof queued === 'string') {
      // The ask's record signature: the handle Withdraw pulls on. An older
      // essentials build answers `true` instead, and then the question is
      // queued but not recallable from here. It is stored ON the conversation
      // so stepping away and back finds Withdraw still armed.
      const out = this.#outstanding.get(convoId)
      if (out) this.#outstanding.set(convoId, { ...out, sig: queued })
      if (convoId === this.activeId()) this.pendingSig.set(queued)
    }
    if (!this.#bumpList(convoId)) void this.#refreshList()
  }

  /** Direct provider route (local Ollama or a configured API key). The
   * transcript is the context these providers can honestly see; unlike a
   * bridge, this path never claims it can walk the hive. It may nevertheless
   * EDIT the hive by returning native, validated beehavior grammar: reading
   * state and applying a named action are deliberately different powers. */
  async #askProvider(convoId: string, message: string): Promise<'answered' | 'declined' | 'aborted'> {
    const router = ioc()?.get(LLM_ROUTER_IOC_KEY) as LlmRouterLike | undefined
    const need = { tier: 'fast', streaming: true }
    const namedModel = this.modelExplicit() ? this.model() || undefined : undefined
    const preferModel = !this.modelExplicit() ? this.model() || undefined : undefined
    const slash = ioc()?.get('@diamondcoreprocessor.com/SlashBehaviourDrone') as SlashBehaviourDroneLike | undefined
    const treeReader = ioc()?.get(HIVE_TREE_READER_IOC_KEY) as HypercombTreeReader | undefined
    const behaviourEntries = slash?.entries?.() ?? []
    const canAct = !!slash?.executePublicCanonical && callableBehaviours(behaviourEntries).length > 0
    const canObserve = !!treeReader?.readTree && !!treeReader?.validateSnapshots
    // Native grammar is LOCAL AUTHORITY. Automatic conversations prefer the
    // participant's own model; an explicitly named remote model remains a
    // normal answer-only provider and never receives tree data or action tools.
    const namedProvider = namedModel ? router?.providerIdForModel?.(namedModel) : undefined
    const localEndpoint = router?.providerMachineEndpoint?.('local')
    const localReadyAndTrusted = router?.providerIsMachineLocal?.('local') === true
      && !!localEndpoint
      && router.ready?.({ providerId: 'local', need }) === true
    const nativeProviderId = hypercombActionProviderId(
      canAct || canObserve, namedModel, namedProvider, localReadyAndTrusted,
    )
    const actionProviderId = canAct ? nativeProviderId : undefined
    const observationProviderId = canObserve ? nativeProviderId : undefined
    // An unavailable local model loses only its action capability. Automatic
    // chat may still be answered by the ordinary provider policy, with no
    // grammar tool attached; an explicitly named local model still declines
    // honestly instead of changing vendor.
    const route = nativeProviderId
      ? { providerId: nativeProviderId, model: namedModel, preferModel, need }
      : { model: namedModel, preferModel, need }
    if (!router?.stream || !router.ready?.(route)) return 'declined'

    const messages: LlmMessageLike[] = this.turns().slice(-TRANSCRIPT_TURNS).map(turn => ({
      role: turn.role,
      content: turn.text,
    }))
    const about = this.#chosenTargets()
    const baseSystem = about.length
      ? `You are helping inside Hypercomb. The participant says this conversation is about: ${about.join(', ')}. Do not claim to have read tile contents unless they are present in the messages.`
      : 'You are helping inside Hypercomb. Be accurate and concise. Do not claim to have read hive contents unless they are present in the messages.'
    // THE SAME ASKING PARAGRAPH the bridge instruction carries
    // (documentation/chat-route.md §2.4): a direction that must be decided is
    // asked as ONE hypercomb-question fence at the end of the reply, and the
    // answer arrives as the next turn. Core spells it once, from the parser's
    // own limits, so every tier teaches the rule the parser enforces.
    const askingSystem = `${baseSystem}\n\n${QUESTION_ASKING_INSTRUCTION}`
    const readGrammarContext = (): {
      readonly key: string
      readonly page: string
      readonly segments: readonly string[]
      readonly selected: readonly string[]
    } => {
      const lineage = ioc()?.get('@hypercomb.social/Lineage') as LineageLike | undefined
      const pageParts = (lineage?.explorerSegments?.() ?? []).map(String).filter(Boolean)
      const selection = ioc()?.get('@diamondcoreprocessor.com/SelectionService') as SelectionLike | undefined
      const selected = [...(selection?.selected ?? [])].map(String).filter(Boolean).sort()
      return {
        key: hypercombContextKey(pageParts, selected),
        page: `/${pageParts.join('/')}`,
        segments: pageParts,
        selected,
      }
    }
    const grammarContext = readGrammarContext()
    const system = nativeProviderId
      ? [
        askingSystem,
        observationProviderId ? hypercombObservationInstruction() : '',
        actionProviderId ? hypercombGrammarInstruction(behaviourEntries) : '',
        `The native grammar context is page ${grammarContext.page || '/'} with selected tiles: ${grammarContext.selected.join(', ') || '(none)'}. Bare /tree and the word "here" mean that page, which may differ from the conversation subject. You may make at most ${MAX_OBSERVATION_ROUNDS} observation rounds before answering or acting.`,
      ].filter(Boolean).join('\n\n')
      : askingSystem

    const component = this
    const ask: HostAsk = async function* (_question, opts) {
      let wrote = false
      let observationRounds = 0
      let observationChars = 0
      let continuationModel = namedModel
      const snapshotIds: string[] = []

      const assertNativeAuthority = (providerId: string): void => {
        if (!nativeProviderId || providerId !== nativeProviderId
          || router.providerIsMachineLocal?.(providerId) !== true
          || router.providerMachineEndpoint?.(providerId) !== localEndpoint) {
          throw new Error('the native grammar exchange is no longer attached to the same local model endpoint')
        }
      }
      const callName = (call: HypercombToolCall | undefined): string =>
        call?.function?.name ?? call?.name ?? ''
      const normalizeToolCall = (
        call: HypercombToolCall,
        round: number,
      ): Required<Pick<HypercombToolCall, 'id' | 'name'>> & { readonly arguments: string } => {
        const name = callName(call)
        const rawArguments = call.function?.arguments ?? call.arguments
        const args = typeof rawArguments === 'string'
          ? rawArguments
          : JSON.stringify(rawArguments)
        if (!name || typeof args !== 'string') throw new Error('the local model returned a malformed tool call')
        return {
          id: call.id || `hypercomb-${round}-${Date.now().toString(36)}`,
          name,
          arguments: args,
        }
      }

      while (true) {
        if (opts?.signal?.aborted) throw new DOMException('The model request was aborted', 'AbortError')
        if (nativeProviderId) {
          assertNativeAuthority(nativeProviderId)
          if (readGrammarContext().key !== grammarContext.key) {
            throw new Error('the page or tile selection changed during the native grammar exchange')
          }
        }

        const roundTools = nativeProviderId ? [
          ...(observationProviderId && observationRounds < MAX_OBSERVATION_ROUNDS
            && observationChars < MAX_OBSERVATION_CONTEXT_CHARS
            ? [hypercombObservationTool()]
            : []),
          ...(actionProviderId ? [hypercombGrammarTool(behaviourEntries)] : []),
        ] : []
        let roundText = ''
        const roundCalls: HypercombToolCall[] = []
        let roundProviderId = ''
        let roundModel = continuationModel ?? ''

        for await (const chunk of router.stream!({
          providerId: nativeProviderId,
          model: continuationModel,
          preferModel: observationRounds === 0 ? preferModel : undefined,
          need,
          messages,
          system,
          tools: roundTools.length ? roundTools : undefined,
          signal: opts?.signal,
        })) {
          if (roundProviderId && roundProviderId !== chunk.providerId) {
            throw new Error('a provider changed during one model round')
          }
          roundProviderId = chunk.providerId
          roundModel = chunk.model
          if (nativeProviderId) assertNativeAuthority(chunk.providerId)

          // The route that emitted output is the truth. Observation rounds
          // are buffered so internal pre-tool prose never becomes a durable
          // assistant turn; ordinary answer-only providers still stream live.
          component.designated.set({
            providerId: chunk.providerId,
            label: chunk.providerLabel,
            vendor: chunk.vendor,
            tier: 'fast',
            model: chunk.model,
            name: chunk.model,
          })
          component.model.set(chunk.model)
          component.modelExplicit.set(false)
          component.#remember(chunk.model)
          if (chunk.text) {
            if (nativeProviderId) roundText += chunk.text
            else {
              wrote = true
              yield chunk.text
            }
          }
          if (chunk.toolCalls?.length) roundCalls.push(...chunk.toolCalls)
        }

        if (roundCalls.length === 0) {
          if (snapshotIds.length && treeReader
            && !await treeReader.validateSnapshots(snapshotIds, opts?.signal)) {
            const lead = wrote ? '\n\n' : ''
            wrote = true
            yield `${lead}Hypercomb's tree changed while the local model was exploring it. Ask again to read the new tree.`
            return ''
          }
          if (roundText) {
            wrote = true
            yield roundText
          }
          return ''
        }

        const lead = wrote ? '\n\n' : ''
        try {
          if (!nativeProviderId || roundCalls.length !== 1) {
            throw new Error('one native grammar request is allowed per model round')
          }
          assertNativeAuthority(roundProviderId)
          if (readGrammarContext().key !== grammarContext.key) {
            throw new Error('the page or tile selection changed while the local model was answering; ask again in the new context')
          }

          const name = callName(roundCalls[0])
          const normalized = normalizeToolCall(roundCalls[0], observationRounds + 1)
          if (name === HYPERCOMB_OBSERVATION_TOOL_NAME) {
            if (!observationProviderId || !treeReader || observationRounds >= MAX_OBSERVATION_ROUNDS) {
              throw new Error('no more tree observation rounds are available')
            }
            const remaining = MAX_OBSERVATION_CONTEXT_CHARS - observationChars
            if (remaining < 1_500) throw new Error('the bounded tree observation context is full')
            const plan = parseHypercombObservationToolCalls(roundCalls, grammarContext.segments)
            const perReadBytes = Math.max(1_024, Math.min(
              8_000,
              Math.floor((remaining - 512) / plan.observations.length),
            ))
            const receipt = await executeHypercombObservationPlan(plan, treeReader, {
              maxDepth: 2,
              maxNodes: 48,
              maxBytes: perReadBytes,
              signal: opts?.signal,
            })
            const content = formatHypercombObservationReceipt(receipt)
            if (content.length > remaining) throw new Error('the bounded tree observation context is full')
            const allSnapshots = [...snapshotIds, ...receipt.snapshots]
            if (allSnapshots.length
              && !await treeReader.validateSnapshots(allSnapshots, opts?.signal)) {
              throw new Error('the tree changed during exploration; ask again to read the new tree')
            }
            observationRounds++
            observationChars += content.length
            snapshotIds.push(...receipt.snapshots)
            messages.push(
              { role: 'assistant', content: roundText, toolCalls: [normalized] },
              { role: 'tool', content, toolCallId: normalized.id },
            )
            continuationModel = roundModel
            continue
          }

          // Parse EVERY action line before the first Queen is invoked, then
          // await native execution in order. The snapshot check happens in the
          // serialized lane, immediately before the first action, so waiting
          // behind another plan cannot stale the observation unnoticed.
          if (!actionProviderId || name !== HYPERCOMB_GRAMMAR_TOOL_NAME || !slash?.executePublicCanonical) {
            throw new Error('the local model returned a native grammar it was not offered')
          }
          const plan = parseHypercombToolCalls(roundCalls, behaviourEntries)
          let snapshotAdmitted = snapshotIds.length === 0
          const guardedExecutor: HypercombBehaviourExecutor = {
            execute: async (command, args) => {
              assertNativeAuthority(actionProviderId)
              if (readGrammarContext().key !== grammarContext.key) {
                throw new Error('the Hypercomb grammar context changed before execution')
              }
              if (!snapshotAdmitted) {
                if (!treeReader || !await treeReader.validateSnapshots(snapshotIds, opts?.signal)) {
                  throw new Error('the observed Hypercomb tree changed before execution')
                }
                snapshotAdmitted = true
              }
              const live = new Set(callableBehaviours(slash.entries?.() ?? []).map(entry => entry.name))
              if (!live.has(command)) throw new Error(`/${command} is no longer machine-callable`)
              return slash.executePublicCanonical!(command, args)
            },
          }
          if (roundText) {
            wrote = true
            yield `${lead}${roundText}`
          }
          const receipt = await hypercombPlanQueue.run(plan, guardedExecutor, opts?.signal)
          const receiptLead = wrote ? '\n\n' : ''
          wrote = true
          yield `${receiptLead}${formatHypercombReceipt(receipt)}`
          return ''
        } catch (error) {
          // Stop belongs to the participant. Do not turn it into a model
          // receipt or continue the sequence.
          if (opts?.signal?.aborted) throw error
          wrote = true
          if (error instanceof HypercombActionExecutionError) {
            const prefix = error.completed.length
              ? `Ran ${error.completed.length} before stopping. `
              : ''
            yield `${lead}${prefix}Hypercomb stopped at ${error.grammar}.`
          } else {
            const detail = error instanceof Error ? error.message : 'invalid native grammar request'
            yield `${lead}Hypercomb could not use that local-model request: ${detail}.`
          }
          return ''
        }
      }
    }

    EffectBus.emit('agent:progress', {
      id: this.#beeId(convoId),
      activity: `routing to ${this.designated()?.label ?? 'a configured provider'}`,
    })
    if (convoId === this.activeId()) this.hostStreaming.set(true)
    const threads = this.#threads()
    return startHostRun(convoId, message, { ask }, {
      appendTurn: (id, role, text) => threads?.appendTurn(id, role as 'user' | 'assistant', text) ?? Promise.resolve(false),
      saveStreamCheckpoint: (id, text) => threads?.saveStreamCheckpoint?.(id, text) ?? Promise.resolve(false),
    })
  }

  /**
   * The shallow tier: stream an answer from the host's AI.
   *
   * Three outcomes, because two are not enough to route the caller correctly:
   *
   *   'answered'  the host said something and it is stored
   *   'declined'  the host cannot answer — fall through to the bridge queue
   *   'aborted'   the PARTICIPANT stopped it — never re-queue a recalled ask
   *
   * THE RUN IS NOT THIS COMPONENT'S. It lives in `host-stream.ts`, at module
   * scope, keyed by conversation — because a streamed answer must survive
   * everything short of the page itself going away, and this window is one of
   * the things that can end without the question having been answered. The
   * loop stores the turn itself; what is left here is the painting.
   *
   * A partial answer is KEPT on abort: the host really did say those words,
   * and throwing them away punishes the person for stopping a stream they had
   * already read half of.
   *
   * The text is accumulated whatever the participant does next: they may switch
   * conversations mid-stream, and the answer still belongs to the thread that
   * asked. Only the PAINTING is conditional on still being in that thread.
   */
  async #askHost(convoId: string, message: string): Promise<'answered' | 'declined' | 'aborted'> {
    const host = ioc()?.get(HOST_AI_IOC_KEY) as HostAiLike | undefined
    // The bundled address is not a shared/free allowance. Only a host the
    // participant explicitly configured may be used as the shallow fallback.
    if (!host?.configured || !host.ask) return 'declined'

    // The attached-context sigs the host inlines server-side from its own
    // heap — the parameter host-ai always accepted and nothing ever passed.
    const contextSigs = await this.#contextSigs()

    // The shallow tier cannot read the hive, so chosen tiles reach it the
    // only way they can: named in the question itself. Wire-only — the
    // stored turn stays the participant's own words.
    //
    // AND IT IS STATELESS, so an answer to a question the responder asked
    // (chat-route.md §2.4) goes over the wire as the question restated with
    // the answer — `hostWireText` finds the open question ignoring the user
    // turn `send()` has already appended — while the stored turn stays the
    // bare answer. Null when the message answers nothing.
    const about = this.#chosenTargets()
    const body = hostWireText(this.turns(), message) ?? message
    const question = about.length ? `${body}\n\n(About: ${about.join(', ')})` : body

    EffectBus.emit('agent:progress', {
      id: this.#beeId(convoId),
      activity: 'answering on the shallow tier — your AI host',
    })

    if (convoId === this.activeId()) this.hostStreaming.set(true)

    // The threads module is resolved ONCE and handed to the run, because the
    // run may still be going when this window is not: it must not have to come
    // back through a component to find somewhere to put the answer.
    const threads = this.#threads()
    return startHostRun(convoId, question, host as { ask?: HostAsk }, {
      appendTurn: (id, role, text) => threads?.appendTurn(id, role as 'user' | 'assistant', text) ?? Promise.resolve(false),
      saveStreamCheckpoint: (id, text) => threads?.saveStreamCheckpoint?.(id, text) ?? Promise.resolve(false),
    }, { contextSigs })
  }

  /** A chunk landed. Only the conversation on screen is painted — the text
   *  itself is accumulated in the run, not here, so switching away and back
   *  finds the answer exactly as far along as it really is. */
  #onHostChunk(payload?: { convoId?: string; text?: string }): void {
    const convoId = String(payload?.convoId ?? '')
    if (!convoId || convoId !== this.activeId()) return
    this.hostStreaming.set(true)
    this.streaming.set(String(payload?.text ?? ''))
    this.#scrollDown()
  }

  /**
   * A host answer finished — stored by the run before this fired.
   *
   * Every ending comes through here, including the ones that used to be
   * unreachable from a destroyed component: the wait ends, the bee is retired,
   * and the turn is painted if this window is still on that thread. A window
   * that has since moved on paints nothing and re-reads the list instead; a
   * window that was rebuilt mid-stream re-attached on arrival and is holding
   * the same conversation, so it takes the same branch as the one that asked.
   */
  #onHostDone(payload?: { convoId?: string; text?: string; outcome?: string }): void {
    const convoId = String(payload?.convoId ?? '')
    if (!convoId) return
    const text = String(payload?.text ?? '')
    const outcome = String(payload?.outcome ?? '')

    if (convoId === this.activeId()) {
      this.streaming.set('')
      this.hostStreaming.set(false)
    }

    // DECLINED IS NOT AN ENDING. The host could not take the question, and
    // `send()` is still standing there deciding whether the durable bridge
    // queue gets it — ending the wait here would blink the indicator off
    // under a question that is about to be asked again.
    if (outcome === 'declined' && !text.trim()) return

    if (text.trim()) {
      if (convoId === this.activeId()) {
        this.turns.update(list => [...list, {
          kind: 'chat-turn', convoId, role: 'assistant', text, at: Date.now(),
        }])
        this.#threads()?.markConversationSeen?.(convoId, Date.now())
        this.#scrollDown()
      }
      if (!this.#bumpList(convoId, 2)) void this.#refreshList()
      EffectBus.emit('chat:threads-changed', { convoId })
    }
    this.#endWait(convoId)
  }

  /** Re-attach to an answer still arriving on the conversation being shown.
   *  A window rebuilt mid-stream (folded away and back, a surface swap, a
   *  route change) finds the partial where the run kept it. */
  #attachHostRun(convoId: string): void {
    const live = liveHostRun(convoId)
    if (!live) return
    this.hostStreaming.set(true)
    this.streaming.set(live.text)
  }

  #onReply(payload?: { convoId?: string; text?: string }): void {
    const convoId = String(payload?.convoId ?? '')
    const text = String(payload?.text ?? '')
    if (!convoId || !text) return

    // The loop is PROVEN — an answer came back over the bridge. This is the
    // checklist's final verification, whichever thread it landed in.
    if (!this.firstReply()) {
      this.firstReply.set(true)
      writeFlag(FIRST_REPLY_KEY)
    }

    // A reply for another thread: it is on disk, so all that is owed here is a
    // list that shows it moved to the top — a bump when the thread is listed,
    // the real walk only when it is not. Its wait ends all the same (the
    // question really was answered), and its tile is left UNREAD, which is
    // the mark that brings you back to it.
    if (convoId !== this.activeId()) {
      this.#endWait(convoId)
      if (!this.#bumpList(convoId)) void this.#refreshList()
      EffectBus.emit('chat:threads-changed', { convoId })
      return
    }

    const at = Date.now()
    this.turns.update(list => [...list, {
      kind: 'chat-turn', convoId, role: 'assistant', text, at,
    }])
    this.#endWait(convoId)
    // Read as it lands: you are looking straight at it.
    this.#threads()?.markConversationSeen?.(convoId, at)
    this.#scrollDown()
    if (!this.#bumpList(convoId)) void this.#refreshList()
    EffectBus.emit('chat:threads-changed', { convoId })
  }

  // ── input ───────────────────────────────────────────────────────────────

  /**
   * Enter sends, Shift+Enter opens a line.
   *
   * Propagation is stopped on EVERY key, not just the ones handled here: the
   * hive binds bare letters as shortcuts, so a message typed into an input that
   * let its keys through would drive the canvas as it was written.
   */
  onInputKey(event: KeyboardEvent): void {
    event.stopPropagation()
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void this.send()
      return
    }
    // Through the SAME cascade the window itself runs — the caret lives in
    // this box (every focus() lands here), so an Escape that closed the whole
    // window directly would throw away picked tiles and the drilled trail
    // from the one place Escape is most likely to be pressed.
    if (event.key === 'Escape') this.onKey(event)
  }

  /** Grow with the message, to a ceiling — past that the box scrolls, so the
   *  transcript never loses the screen to a long draft. */
  autosize(element: HTMLTextAreaElement): void {
    element.style.height = 'auto'
    element.style.height = `${Math.min(element.scrollHeight, 160)}px`
  }

  onInput(event: Event): void {
    this.autosize(event.target as HTMLTextAreaElement)
    this.#holdDraft()
  }

  #focus(): void {
    setTimeout(() => this.input()?.nativeElement?.focus(), 0)
  }

  // ── scroll anchoring ────────────────────────────────────────────────────
  //
  // The transcript used to pin `scrollTop` to the bottom on every chunk, which
  // meant a streaming answer could not be read from the top and scrolling up to
  // check what you asked was physically impossible — the next chunk snatched
  // the view back. So: follow the bottom only while the participant is AT the
  // bottom, and when they are not, say so with a pill instead of overruling them.

  onScroll(): void {
    const element = this.scroller()?.nativeElement
    if (!element) return
    const distance = element.scrollHeight - element.scrollTop - element.clientHeight
    // A steer declared the view off the bottom before its first scroll event;
    // its own flight does not get to take that back.
    const bottom = distance <= NEAR_BOTTOM_PX && !(this.#steer && !this.atBottom())
    const flipped = bottom !== this.atBottom()
    this.atBottom.set(bottom)
    if (this.#steer) {
      // A steer's own scroll events keep it alive and release nothing.
      this.#armQuiet(this.#steer.token)
    } else if (this.#threadExpect === null || Math.abs(element.scrollTop - this.#threadExpect) > 1) {
      // THE PARTICIPANT SCROLLED THE THREAD — a wheel, a scrollbar, a touch
      // pan, the scroll keys — at a position this component did not set. That,
      // and only that, releases a pressed step's hold: streaming chunks that
      // follow the newest never do. Reading runs as the hold clears.
      this.#threadExpect = null
      if (this.routeHold()) { this.routeHold.set(false); this.#scheduleReading() }
    }
    if (flipped) this.#scheduleReading()
  }

  /** After the turn is in the DOM, not before. `force` is for arrivals the
   *  participant caused — their own message, a thread they just opened — and
   *  it takes the view from any steer. The position it sets is recorded, so
   *  its scroll never reads as the participant's. */
  #scrollDown(force = false): void {
    if (force) this.#cancelSteer(false)
    if (!force && !this.atBottom()) return
    setTimeout(() => {
      const element = this.scroller()?.nativeElement
      if (!element) return
      // A steer that started after this was scheduled owns the view now.
      if (!force && this.#steer) return
      element.scrollTop = element.scrollHeight
      this.#threadExpect = element.scrollTop
      this.atBottom.set(true)
    }, 0)
  }

  /** The pill. Back to the newest turn, and following again from here. It is
   *  the participant's own act, so it releases a held step: the step read at
   *  the bottom — the newest organized one — becomes current. */
  scrollToBottom(): void {
    if (this.routeHold()) { this.routeHold.set(false); this.#scheduleReading() }
    this.#scrollDown(true)
  }

  // ── per-message actions ─────────────────────────────────────────────────
  //
  // An answer you cannot act on is a screenshot. Copy takes it out of the hive,
  // note puts it IN — and retry and edit exist because the first phrasing of a
  // question is usually not the good one.
  //
  // Nothing here rewrites history: a thread is append-only (the same rule the
  // rest of the hive keeps), so editing a question sends a NEW turn rather than
  // silently replacing the one above it and orphaning the answer it produced.

  /** The question that produced this turn: itself, if it is the question. */
  #questionFor(turn: ChatTurn): string {
    if (turn.role === 'user') return turn.text
    const list = this.turns()
    const index = list.indexOf(turn)
    for (let i = (index < 0 ? list.length : index) - 1; i >= 0; i--) {
      if (list[i].role === 'user') return list[i].text
    }
    return ''
  }

  /** Copy, note and edit act on the PROSE — the question fence is machinery,
   *  not what was said, so it never rides along (chat-route.md §2.2). */
  copyTurn(text: string, key: string): void {
    void navigator.clipboard?.writeText(text).then(() => {
      this.copiedTurn.set(key)
      setTimeout(() => { if (this.copiedTurn() === key) this.copiedTurn.set('') }, 1_400)
    }).catch(() => {
      EffectBus.emit('toast:show', { type: 'warning', message: 'Could not reach the clipboard.' })
    })
  }

  /** Ask it again, unchanged. The answer lands as a new turn. */
  retryTurn(turn: ChatTurn): void {
    const question = this.#questionFor(turn)
    if (question) void this.send(question)
  }

  /** Put it back in the composer to be rewritten. Explicitly NOT a truncation
   *  of the thread — send it and it appends, like anything else you type. */
  editTurn(text: string): void {
    const element = this.input()?.nativeElement
    if (!element) return
    element.value = text
    this.autosize(element)
    element.focus()
    element.setSelectionRange(element.value.length, element.value.length)
  }

  /**
   * Put this answer on the tile it is about, as a note.
   *
   * The tile is the ONE selected tile if there is exactly one, else the page
   * the participant is standing in. `NotesService.addAtSegments` takes an
   * explicit path for exactly this reason — the `note:commit` effect writes to
   * a child of the current location, which is a different tile than the one the
   * status line above the composer has been naming all along.
   */
  async noteTurn(text: string): Promise<void> {
    const here = [...this.here()]
    const selected = this.targets()
    const [parents, label] = selected.length === 1
      ? [here, selected[0]]
      : [here.slice(0, -1), here[here.length - 1] ?? '']

    if (!label) {
      EffectBus.emit('toast:show', {
        type: 'warning',
        message: 'Stand on a tile (or select one) to put this answer on it.',
      })
      return
    }

    const notes = ioc()?.get('@diamondcoreprocessor.com/NotesService') as NotesLike | undefined
    if (!notes?.addAtSegments) {
      EffectBus.emit('toast:show', { type: 'warning', message: 'Notes are not available yet.' })
      return
    }

    try {
      await notes.addAtSegments(parents, label, text, null, null)
      EffectBus.emit('toast:show', { type: 'tip', message: `Noted on ${label}.` })
    } catch {
      EffectBus.emit('toast:show', { type: 'warning', message: `Could not write the note on ${label}.` })
    }
  }

  // ── links inside an answer ──────────────────────────────────────────────

  /**
   * One delegated click for the whole transcript.
   *
   * Rendered markdown is not a template, so its interactive parts cannot carry
   * Angular bindings; they carry `data-` attributes and this reads them. The
   * anchor branch is the important one: an `<a href>` left to itself navigates
   * the shell document, which on the native client means the window is gone and
   * on the web means every drone unloads (see document-view-links.ts).
   */
  onThreadClick(event: MouseEvent): void {
    const target = event.target as Element | null
    if (!target?.closest) return

    const chip = target.closest('[data-hive-path]')
    if (chip) {
      event.preventDefault()
      this.goPath(chip.getAttribute('data-hive-path') ?? '')
      return
    }

    const copy = target.closest('[data-copy-code]')
    if (copy) {
      event.preventDefault()
      const code = copy.closest('.chat-code')?.querySelector('code')?.textContent ?? ''
      void navigator.clipboard?.writeText(code).then(() => {
        copy.textContent = 'copied'
        setTimeout(() => { copy.textContent = 'copy' }, 1_400)
      }).catch(() => { /* the code is still on screen and selectable */ })
      return
    }

    const anchor = target.closest('a')
    if (!anchor) return
    // Prevented first and unconditionally — whatever we decide below, the
    // shell's own document must not act on this click.
    event.preventDefault()
    event.stopPropagation()
    this.#openExternal(anchor.getAttribute('href') ?? '')
  }

  /** Go where the answer said. Raw segments: an answer names a place with the
   *  characters it is spelled with, not a normalized guess at them. */
  goPath(path: string): void {
    const segments = hivePathSegments(path)
    if (!segments.length) return
    const navigation = ioc()?.get('@hypercomb.social/Navigation') as NavigationLike | undefined
    navigation?.goRaw?.(segments)
  }

  /** Outside the hive: the OS browser on native, a new tab on the web. Never
   *  this document, on either. */
  #openExternal(href: string): void {
    if (!/^(https?:|mailto:)/i.test(href)) return
    const invoke = (globalThis as { __TAURI__?: { core?: { invoke?: (cmd: string, args: unknown) => unknown } } })
      .__TAURI__?.core?.invoke
    if (typeof invoke === 'function') {
      void Promise.resolve(invoke('open_external', { url: href }))
        .catch(err => console.warn('[chat] host could not open', href, err))
      return
    }
    window.open(href, '_blank', 'noopener,noreferrer')
  }

}

// Registry-fed shell surface — mounted by <hc-shell-surfaces>, never by an
// app.html tag (see shell-surface-registry.ts).
registerShellSurface({
  name: 'hc-chat-window',
  owner: '@hypercomb.shared/ChatWindowComponent',
  component: ChatWindowComponent,
  order: 113,
})
