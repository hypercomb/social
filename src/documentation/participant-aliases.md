# Participant Aliases — the names you gave the behaviours

A behaviour has ONE name: its canonical `command`. Code never declares
another — the doctrine ratchet in `doctrine.spec.ts` ("no behaviour declares
an alias in code", empty allowlist) has kept alias declarations out of source
since `45afe8c9f`. Aliases are the participant's to give, and this document
describes the machinery of the giving.

## The window

`/aliases` opens a right-docked tool window (the hosts-panel standard:
`registerShellSurface`, `hcDockedPanel` + `hcDockInset` + `signalSession`,
`tw.panel`/`tw.header`, order 158). One row per behaviour the census admits
to, as an accordion — one row open at a time:

- **closed** — the ledger at a glance: canonical name, then the given names.
- **open** — the giving: the given names as removable chips, the candidates
  on offer as addable chips, and a free-text field (Enter gives the name).

`/aliases present` opens the window already filtered to, and expanded on,
that behaviour.

## The inventory

The 54 code-declared alias lists that were removed live on as **inventory**:
`commands/aliases/alias-suggestions.ts` maps canonical command → candidate
names. Nothing reads this catalogue into the census — a suggestion that is
never picked has no effect on any surface, which is why the file honours the
ratchet in spirit as well as letter. A candidate that collides with a live
canonical command (solomon's old `game`) is filtered at render time and
simply not offered.

## The ledger

`commands/aliases/participant-aliases.ts` (`ParticipantAliases`, IoC
`@diamondcoreprocessor.com/ParticipantAliases`) holds one doc:

```json
{ "entries": { "<command>": { "names": ["..."], "at": 1756716000000 } } }
```

- **Where:** the `sign('commands:aliases')` pool of meaning — colon-scoped,
  seeded in core's `pool-registry.ts`. A pool and not localStorage for the
  reason spoken habits are: a name that did not follow you to your other
  machine was not your name for it. localStorage (`hc:participant-aliases`)
  holds a boot cache only — the census reads synchronously.
- **Merge:** newer entry wins, PER COMMAND. Habits max-merge because a habit
  is a tally; an alias set is a CHOICE, and a union-merge would resurrect
  every name deliberately taken away. Each entry carries the moment it was
  decided; the later decision replaces the earlier one whole.
- **Refusals carry reasons**, shown under the row: `not-a-name` (a name is
  one word — letters, digits, dashes), `is-the-command`,
  `is-another-command` (it would shadow a verb someone can already say),
  `taken` (given to a different behaviour).

## The seams

Two, both of which existed before this feature and are why the plumbing was
kept when the code-declared lists were removed:

1. **The queen instances.** `QueenBee.aliases` is a readonly *binding* over a
   mutable array; `applyToQueens()` rewrites the contents in place. The
   common tongue's bare-word path (`queen.matches()`) and the slash drone's
   auto-wrap provider (which captured the same array reference) both follow
   without being told. Late-registering queens are covered by an
   `ioc.onRegister` subscription.
2. **The slash census.** `SlashBehaviourDrone.#names()` folds
   `ParticipantAliases.aliasesFor()` into every name walk (`all`, `match`,
   `complete`, `execute`, `has`, `entries`) — which is what reaches the
   manual providers no queen stands behind, and what carries the given names
   onto every display surface (autocomplete alias folding, the shortcut
   sheet, the action card) with no changes to any of them.

A name given in the window works on the very next keystroke and appears on
every reference surface exactly where a code-declared alias used to.

## Files

| File | Role |
|---|---|
| `hypercomb-core/src/core/pool-registry.ts` | `commands:aliases` reserved |
| `hypercomb-essentials/src/commands/aliases/participant-aliases.ts` | the ledger |
| `hypercomb-essentials/src/commands/aliases/alias-suggestions.ts` | the inventory |
| `hypercomb-essentials/src/commands/aliases/aliases.queen.ts` | `/aliases` |
| `hypercomb-essentials/src/commands/aliases/aliases.drone.ts` | data side, `aliases:render` / intents |
| `hypercomb-shared/ui/aliases-panel/` | the window |
| `hypercomb-essentials/src/commands/slash-behaviour.drone.ts` | the census fold |
