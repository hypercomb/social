# Workflow inputs — answering AI with less typing

**Status: design — first slice not built (2026-07-30).** Companions:
[feedback-channel.md](feedback-channel.md) (the durable question inbox),
[workflow-designer.md](workflow-designer.md) (a workflow and its steps are
tiles), [agents.md](agents.md) (live work and context), and
[mobile-usable-first-plan.md](mobile-usable-first-plan.md) (the existing
push-to-talk effects).

## The intent

An AI should not turn every missing fact into a blank text box. Often the
participant only needs to approve, choose one of three directions, select a
few items, or speak a sentence. Those answers should be quick, legible, and
usable by a workflow without asking the participant to encode a decision in
prose.

The product has most of the places already:

- the **feedback window** is the durable inbox for questions addressed to the
  participant;
- the **workflow hive** gives every workflow and every step a tile;
- `qa` / `qa-answer` already carry a question out and its answer back;
- the mobile command bar already emits tap-to-talk and hold-to-talk effects.

What is missing is one small response contract shared by all of them.

## The simplifying decision

> One question card, several answer shapes, one inbox.

There is no separate AI form builder, workflow form window, or generated HTML.
A producer describes the answer it needs. The feedback window renders the
smallest known control for that description and writes one ordinary
`qa-answer`.

The same card serves:

- a feedback-loop follow-up;
- an AI clarification;
- an approval gate;
- a workflow waiting for participant input.
- a choose-your-own-adventure run that moves through branching concepts.

The hive remains visible behind the docked window. A question may link back to
the tile it concerns, but answering never navigates the participant away.

## Ask less before making answers faster

The first simplification belongs to the AI, not the UI:

1. Infer values that are safe and reversible.
2. Ask only when the answer materially changes the result.
3. Put the recommended choice first and say briefly why it is recommended.
4. Offer two to five concrete options when the likely answers are known.
5. Add **Something else** when the list may be incomplete.
6. Ask one decision per card. A related run may contain several cards, but a
   single card must not become a survey.
7. Never make a default click itself. The participant still makes the choice.

This keeps the interface from becoming an efficient way to ask unnecessary
questions.

## The first response vocabulary

| response | UI | result |
|---|---|---|
| `approval` | **Approve** / **Discard**, pinned as today | `approved` or `declined` |
| `choice` | two to five large option buttons | one stable option id |
| `multi-choice` | toggle buttons plus **Continue** | stable option ids |
| `text` | one text area with a microphone button | the transcript/text |
| `tile-pick` | **Pick from hive**, then **Use selection** | tile signatures |

`approval` remains explicit because it carries authorization semantics, even
though it looks like a two-option choice. `tile-pick` reuses the ordinary
selection service; the panel must not invent another tile picker.

Range, number, date, file, ordering, and other controls can be added when a
real workflow needs one. There is no control registry in the first slice. Add
one only when a second independently shipped module must contribute a control.

Unknown response kinds fall back to `text`, with a small note that the intended
control is unavailable. A new producer can therefore never make an old client
unable to answer.

## The record contract

The descriptor travels inside the `qa` record so the receiving browser can
render it without fetching another resource:

```jsonc
{
  "kind": "qa",
  "appliesTo": ["research", "audience"],
  "payload": {
    "qId": "audience-1",
    "question": "Who is this explanation for?",
    "origin": "workflow",
    "reason": "The outline changes with the reader's experience.",
    "response": {
      "kind": "choice",
      "required": true,
      "allowOther": true,
      "options": [
        {
          "id": "new",
          "label": "Newcomers",
          "description": "Explain terms and include a small example.",
          "recommended": true
        },
        {
          "id": "experienced",
          "label": "Experienced users",
          "description": "Use the project vocabulary and move faster."
        }
      ]
    },
    "workflow": {
      "workflowSig": "…",
      "stepSig": "…",
      "runId": "local-run-…",
      "bind": "audience"
    }
  },
  "mark": "persistent"
}
```

Option ids are machine values and remain stable when labels are translated.
The descriptor is data, never executable markup or script.

The answer retains the existing human-readable `answer` for compatibility and
adds a typed `value` for the workflow:

```jsonc
{
  "kind": "qa-answer",
  "payload": {
    "qId": "audience-1",
    "qSig": "…",
    "question": "Who is this explanation for?",
    "answer": "Newcomers",
    "value": "new",
    "answeredAt": 1785400000000
  }
}
```

For `multi-choice` and `tile-pick`, `value` is an array. For `text`, it is a
string. Approval continues to write the existing machine-readable `decision`
as well as `value`, so current consumers do not break.

Existing `payload.responseKind:'approval'` records remain valid. Readers treat
that as the compatibility spelling of `response.kind:'approval'`; new
producers write `response`.

## How it belongs to a workflow hive

A new `question` workflow step gathers information from the participant. It is
distinct from the existing `ask` step:

| step | asks whom | purpose |
|---|---|---|
| `question` | the participant | collect a value the workflow needs |
| `ask` | an AI pass, behind its participant gate | request generated work |

The question itself is the step tile. Its signed step resource holds the
prompt, response descriptor, and binding name. That makes it renameable,
reorderable, shareable, and inspectable like every other workflow part. Radio
buttons, checkboxes, and microphones do **not** become separate child tiles;
they are presentations of that one question step.

When a run reaches `question`, it:

1. mints the self-contained `qa` record;
2. checkpoints the run participant-locally, never in the hive layer;
3. reports `waiting for your answer`;
4. resumes from the next step when the answer is committed.

If the browser reloads, the feedback card remains and offers **Continue
workflow** after answering. An AI-producing step still meets the existing ask
gate; answering an earlier factual question is not blanket authorization for
later generation.

Several questions from one run share `runId`. The feedback window may show
`2 of 4` and move focus to the next unanswered card, but each answer remains
an independent `qa-answer`. There is no compound form record to partially
save or reconcile.

## Adventure runs — branching without a second graph

Advanced concepts often have several useful directions rather than one linear
sequence. A workflow may therefore open an **adventure run**: a focused,
click-through sequence in which each answer chooses the next branch.

The hive remains the graph. A branching `question` tile owns one child workflow
tile per option:

```text
Choose the kind of explanation
├─ Visual tour
│  ├─ Choose diagram depth
│  └─ Choose examples
├─ Working prototype
│  ├─ Choose platform
│  └─ Choose fidelity
└─ Written brief
   ├─ Choose audience
   └─ Choose length
```

The child tile's stable step id is the option id, its name is the option label,
and its note may supply the short description. Child order is option order.
The question resource does not keep a second list of branch names that can
drift from the hive.

Choosing an option enters that child workflow. A question inside it may branch
again, up to the workflow runner's existing nesting cap. Reaching the end of a
branch returns to the parent sequence. There are no arbitrary `next` pointers,
edge records, or separate node-graph canvas.

### The lightning path

Adventure mode is a **decision phase**, not an execution phase. It gathers a
path before any branch performs commands, writes content, invokes AI, or causes
other effects. That separation is what makes every interaction reversible:

1. The current question fills the answer area. Its option rows are already
   present—no network round trip is required.
2. One click selects an option and replaces the card with the next question
   immediately. There is no per-question **Submit** or confirmation.
3. A large, sticky **Back** button is always in the same place. It returns to
   the previous branch point with the previous choice still selected.
4. Choosing a different option replaces that answer and prunes only the
   abandoned draft path.
5. A terminal branch shows a prominent **Done** button. **Done** writes the
   selected values as ordinary individual `qa-answer` records, then hands the
   completed path back to the workflow.

Clicks update a participant-local draft synchronously. Draft persistence
happens behind the interaction and must never hold up the next card. Channel
publication begins only after **Done**, and it also stays off the visual
transition path. If the panel closes or the browser reloads before **Done**,
reopening the run restores the draft at the same question.

**Done means “these are my answers,” not “authorize every later effect.”** If
the selected path reaches AI generation, publishing, deletion, payment, or
another protected action, that step keeps its own existing approval boundary.

### Adventure controls

- A sticky top bar holds **Back**, the workflow name, and concise progress.
  Progress is a breadcrumb or “3 answered,” not a misleading fixed percentage
  when different branches have different lengths.
- The entire option row is the target; a small radio circle is never the only
  clickable area.
- The next card replaces the current one without a closing animation, spinner,
  toast, or focus loss.
- Keyboard keys `1`–`5` choose visible options. Backspace goes back only when
  focus is not inside a text field. Enter activates **Done** at a terminal.
- On touch, **Back** and **Done** remain in the thumb-safe action area and use
  at least 44px targets.
- A short breadcrumb shows the chosen direction and may be clicked to jump
  back several branch points. The prominent one-step **Back** remains the
  primary correction control.
- Text and multi-choice questions use **Next** because their answer cannot be
  complete on the first click. Single-choice questions always advance
  instantly.

There is no summary screen that forces the participant to reconfirm every
answer. The breadcrumb is the review surface; **Back** is the correction; one
**Done** finishes the run.

## Fast answering

- The full option row is clickable, with a minimum 44px touch target.
- Number keys choose visible options; Space toggles a focused multi-choice;
  Ctrl/Cmd+Enter submits text.
- A single-choice click advances immediately. Text and multi-choice use one
  **Next** action; an adventure run uses one final **Done**.
- After an answer, focus moves to the next open question from the same run
  without waiting for transport.
- **Something else** reveals the normal text field without discarding the
  listed choices.
- The question always shows why it is being asked and which workflow or agent
  is waiting.
- **Ask later** may defer the card, but does not manufacture an answer or
  advance the workflow.

No bulk **Approve all**: approvals are authorization boundaries, not inbox
cleanup.

## Voice is an input method

Every participant-authored text area in this surface—question answer, feedback
compose, and reply—uses the same microphone affordance:

- tap toggles listening;
- hold is push-to-talk, using the existing 450ms boundary;
- partial speech appears in the text field while listening;
- releasing or tapping stop ends transcription but never submits;
- the participant can edit the transcript before sending;
- a visible listening state and a cancel action are mandatory;
- denial or absence of speech permission leaves an ordinary text field.

Only the transcript is stored in `qa-answer` or `feedback`. Audio is not
persisted or sent through the feedback channel. The command line and feedback
window should share one voice-input service/effect path rather than implement
speech recognition twice.

## First slice

1. Teach the feedback viewer to parse `payload.response`, while preserving the
   current approval compatibility path.
2. Render `choice`, `multi-choice`, and `text`; write `value` alongside
   `answer`.
3. Put the shared mic button on answer, feedback, and reply text areas.
4. Let feedback-loop and bridge producers emit response descriptors.
5. Add `tile-pick` only by connecting to ordinary hive selection.
6. Add the workflow `question` step and resumable local checkpoint after the
   card contract is proven.
7. Add adventure traversal as a decision-only pass: instant single-choice
   advance, sticky **Back**, draft recovery, and one terminal **Done**.

The first useful proof is small: an AI asks one three-option question, the
participant answers with one click, and the responder receives both the
stable id and readable label.

## Questions to settle in the prototype

- **Panel name:** keep **Feedback** for now; add a visible **Questions** band
  rather than creating or renaming a global surface before usage proves the
  need.
- **Automatic workflow resume:** resume a still-live deterministic run;
  require **Continue workflow** after reload, where the participant can see
  what will continue.
- **Adventure execution:** collect and revise the whole path first; execute
  only after **Done** so Back never has to undo side effects.
- **Maximum options:** five before the producer should use search, tile-pick,
  or text. More buttons stop being a simplification.
- **Voice availability:** ship where browser speech support exists, with no
  disabled microphone placeholder on unsupported clients.

These defaults are intentionally conservative and can be changed from
evidence without changing the record contract.
