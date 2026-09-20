# DOS terminal-round evidence

Status legend: **verified** is decoded from the inert, statically inspected
`image.bin`; **partial** is a bounded control-flow inference; **unknown** is
not an implementation requirement.

## Scope and method

- **Verified:** no DOS executable or data file was run.  Evidence is from
  `C:\Users\Jaime\AppData\Local\Temp\hc-bubble-zenchan-e4e35e932198405a953a846be684d7c5\image.bin`
  (SHA-256 `c0ab3aec0519cfbf22cee3fc3e3c6642e5a270f6fa8e68726dd172b9cecb0771`,
  131856 bytes), decoded as 16-bit x86 with code offsets interpreted modulo
  `0x10000`.
- **Partial:** this records the ordinary clear counter and final-round
  transition, not the complete in-game ending presentation or every alternate
  phase transition.

## Round index and record-100 branch

- **Verified — `DS:00DA` is the zero-based round index used by the map
  loader.**  `2342..` loads `AX=[00DA]`, multiplies it by `0x64`, and uses the
  result when decoding a level record; `23DF..23F0` displays/iterates
  `[00DA]+1`.
- **Verified — normal transition at `041B..042F`:** it copies `DA` to `DC`,
  increments `DA`, then does unsigned `cmp ax,64h; jb 0450`.  Thus the path
  with `DA=63h` (record 100) increments to `64h` and does not load another
  ordinary record.  It instead near-calls `ED6A` at `042A`.
- **Verified — `ED6A` presents and waits before returning carry set.**  Its
  direct `ED6A` entry performs external display/UI calls, then `ED89..ED90`
  zeroes both participant counters via `827B`/`828A`.  `EDDE..EDE7` calls
  `0694` (which clears actors and sets `[0018]=FFFFh`), then allocates an
  active `0200h` actor with callback `[BX+512]=EEB9` and raw 16-bit deadline
  `[BX+514]=[011E]+384h`.  It calls `06B3`, whose own loop dispatches `114D`
  independently of the participant counters, before `stc; ret` at `EE03`.
  Back at `042D`, `jae 0432` therefore fails and `042F` jumps to `036B`.
  The deadline is in the general-tick domain; no exact wall-clock duration
  follows from the fixed-60 browser adapter.

## `DS:0018` and the callback

- **Verified — `EEB9..EEC8`:** it performs unsigned `cmp [011E],[BX+514]`;
  `jb EEC8` returns while current tick is below the deadline.  At equality or
  after it writes `word [0018]=0` and returns.  It does not directly set a
  win state or advance the round.
- **Verified — the wait loop is not blocked by the cleared participant
  counters:** `06B3` calls `114D`, performs frame/input service at `2939`
  and two external calls conditional on bytes `0476`/`0477`, then tests byte
  `047E`.  If `047E` is sign-negative it repeats while `[0018]!=0`; once
  `EEB9` clears `[0018]`, `06EC` returns carry clear.  If `047E` is
  sign-nonnegative, `06DC` instead clears `[0018]` and returns carry set.
  `ED6A` does not branch on that carry; either exit reaches its final
  `stc; ret`.  The producer/semantic meaning of `047E` is not established
  by this bounded trace, so this is a conditional interruption, not a named
  keyboard shortcut.
- **Verified — the relevant consumer is `03F8..0400`:**
  `test word [0018],ffffh; je 0403; jmp 04C3`.  Zero reaches `0403`, which
  clears `[011E]`, calls `113C` and `1AD2`, then reaches the `041B` round-index
  increment.  A nonzero value instead enters the separate `04C3` branch.
- **Partial — effect of the terminal callback:** clearing `[0018]` can enable
  the later `0403` route only if execution reaches `03F8`; it is not a direct
  gate at `036B`.  The preceding `036B..0387` loop tests the two participant
  counters `[4BE6]|[4C06]`; when either is nonzero it dispatches actors at
  `038B`.  The zero-participant path calls `E606` and `E98F` instead.
- **Verified — ordinary initialization:** `04AE` calls `87A1`, which sets
  `[0018]=0258h` (600) and creates an active control actor at `881B..8831`.
  Other writers (`06A6`, `8AF9`, `D104`, and the clearing callbacks below)
  mean `[0018]` is not exclusively an ordinary-clear counter.

### Bounded `[0018]` writer and consumer ledger

| Offsets | Verified operation | Bounded consequence |
| --- | --- | --- |
| `03F8..0400` | Tests `[0018]`; zero takes `0403`, nonzero jumps `04C3`. | This is the only terminal-path decision traced here. |
| `04E1..0526` | The `04C3` branch adjusts/wraps `DA` by `-2`, `+9`, or `-11`, then clears `[0018]` and returns to `036B`; otherwise it falls through into unrelated control at `0529`. | A nonzero latch selects an alternate round-index adjustment path, not a direct ending routine.  The flag/byte predicates at `04C3..0529` remain unnamed. |
| `06A6`, `06DC`, `06E4..06ED` | Stores `FFFFh`, later clears it, and tests it before returning carry clear. | `[0018]` participates in an independently scheduled state, so `EEB9` is not its sole owner. |
| `87A1`, `8AF9`, `96B6..96CA` | Ordinary setup stores `258h`; another path stores `1Eh`.  When `[4D64]==0`, `96BD` subtracts one from `[0018]`; `jae` retains the result unless it borrowed, in which case `96C4` clamps it at zero. | In the ordinary actor path, zero tracked enemies allows one decrement per reached control-actor callback, not one decrement per display frame or `[011E]` tick. |
| `E71A..E75A` | If `[0018]!=0`, derives decimal digits from `[4F72]-2-[011E]` divided by `3Ch` and renders them. | Nonzero also gates a countdown-style display whose deadline is `[4F72]`, not `[0018]` itself. |
| `C63A..C649`, `CF35..CF63`, `E6AA..E719`, `E86F..E87E`, `EB99..EBB1`, `EEB9..EEC8` | Several callback/state paths clear `[0018]`, several after unsigned clock comparisons. | The terminal callback is one of several phase-completion clearers.  No unique ending ownership follows. |

## `04C3`, `E606`, and `E98F` callsite ledger

- **Verified — `04C3` is an alternate round-index branch, not a direct
  terminal presentation.**  It is reached only when the `03F8` test sees a
  nonzero `[0018]`.  Its first gate compares `[0054]` to `DF49h`; on that
  match, sign tests/XORs over bytes `0464`, `0470`, `0474`, and `046C` select
  one of the `DA` changes documented in the table.  If that initial compare
  fails, control continues at `0529`; that downstream lifecycle is outside
  this trace.  This prevents treating `[0018]` as a simple “advance round”
  boolean.
- **Verified — `E606` is a guarded setup helper, not a direct `[0018]`
  consumer.**  `E606..E616` first tests `[0016]`; if nonzero it explicitly
  returns carry clear.  Otherwise `86DF` returns `[4C3B]-30h`; `sub al,1;
  jae E617` takes the setup route exactly when the original byte is at least
  `31h` (unsigned).  `E617..E6A9` sets bit `30h` through `86E5`, configures a
  callback/deadline `[4F72]=[011E]+258h`, and returns.  Its eventual callbacks
  at `E6AA..E719` can clear `[0018]`.  This static trace does not name
  `[0016]` or `[4C3B]`, and does not infer a last-enemy predicate from them.
- **Verified — `E98F` is DOS console-input polling plus a scheduled
  callback.**  `E98F..E9A5` uses `int 21h`/`AH=0Bh` to poll and `AH=07h` to
  consume available characters, then `0694` clears actors/sets
  `[0018]=FFFFh`; `E9BF..E9CE` installs the `E9DA` callback and enters
  `06B3`.  `E9DA` scans six records at `4FE4..502F` in `0Fh` strides for
  byte `04h`.  With no matching record it installs `EB99` and deadline
  `u16([011E]+B4h)`; with a match it installs `EA75` and deadline
  `u16([011E]+708h)`.  `EA75..EB5F` polls DOS input, accepts printable
  ASCII letters/digits/space, backspace, and CR, and can synthesize CR when
  the raw unsigned deadline is reached without a key.  These operations
  support a score/table-entry interpretation, but the exact visible text is
  not decoded here.  At `EB99..EBB1`, an external call through `[51A2]`
  must leave zero flag set; then unsigned `[011E] >= [BX+514]` clears
  `[0018]`.  Thus a no-key path *can* end the `06B3` wait and return carry
  clear without a user reset, but its elapsed duration also depends on that
  external guard and the entry substate.  A carry-set exit remains possible
  through `06D5..06E3`.

### Terminal input and presentation limits

- **Verified:** `ED6A` uses four source pointers `DS:5082`, `5093`, `50AB`,
  `50C9` with `13EA` after external drawing calls; its alternate internal
  branch `EE05` uses more pointers from `50E4..516E`.  These are concrete
  text/UI source references, not evidence for matching pixels, font, color,
  or screen layout in a browser renderer.  Raw image offsets are not assumed
  to equal those DS addresses.
- **Verified:** the bounded code references to byte `[047E]` at `0434`,
  `055D`, `062C`, `06D7`, and `1855` are sign tests.  No direct immediate-address
  store to `[047E]` appears in the validated image; an indirect write or
  external input service may supply it.  Its producer and user-facing input
  mapping therefore remain **unknown**.  Do not attach a particular key to
  `06D5`'s carry-set interruption.
- **Partial — ordinary no-key continuation:** after `ED6A`'s wait, its
  unconditional `stc; ret` forces `042F -> 036B`; the two participant
  counters are zero, so the branch calls `E606` and then `E98F` if still
  zero.  If the latter's `EB99` deadline/guard clears `[0018]` and no new
  participant is initialized, `06B3` returns carry clear and `0387` jumps
  `02CE` into session setup.  This is a conditional return to a mode/session
  path, not proof of an immutable win screen, an immediate automatic restart,
  or a compulsory user key press.

## Ownership of the `036B` pair of gates

- **Verified — `[4BE6]` and `[4C06]` are separate maintained participant
  counters, not one remaining-enemy counter.**  `827B..8298` assign them
  through paired selector-dependent paths; `829F..82C6` decrement them; and
  `82CD..82F6` increment them.  Each side has adjacent private bookkeeping
  (`4BE8/4BEA/4BF5` versus `4C08/4C0A/4C15`).  Their nonzero state
  independently gates actor setup at `8832..88BA` and `88BB..`, whose actor
  pointers are retained separately at `4C58` and `4CAC`.
- **Verified — two-domain startup ownership:** `0337` calls `8758`; `033A..0343`
  calls paired `8784` only when byte `[0027]==32h`.  `8758..8783` reaches
  `827B`, the `[4BE6]` initializer; `8784..87A0` reaches `828A`, the
  `[4C06]` initializer.  The same pair is called from the paired `E6AA`/
  `E6E2` callback branches.  This proves first/second participant-domain
  ownership, while the exact UI name of mode `[0027]` is not needed here.
- **Verified — terminal helper affects both domains:** `ED89..ED90` calls
  `827B` then `828A` with `AX=0`, clearing both counters before it installs
  `EEB9`.  This is distinct from an enemy defeat callback.
- **Verified — `036B..0387` uses their OR as an outer activity gate.**  If
  either word is nonzero, execution enters `038B`; only if both are zero does
  it call `E606`, then `E98F`, before looping to `02CE` or returning by carry.
  The pair is therefore upstream of the `03F8`/`[0018]` decision rather than
  evidence that the latter alone identifies a completed round.
- **Verified — post-`ED6A` routing with zero participant counters:** the
  `042F -> 036B` branch takes the zero-pair path through `E606` and, if that
  leaves both counters zero, `E98F`.  `E606` tests `[0016]`, then a selector
  derived from `[4C3B]`; its conditional start route can initialize one
  participant counter and run its own `06B3` wait.  The `E98F` entry drains
  DOS console input (`int 21h`, `AH=0Bh/07h`), clears actors through `0694`,
  allocates an `E9DA` callback, and also waits in `06B3`.  If both helpers
  return carry clear without restoring a participant counter, `0387` jumps
  to `02CE`, whose `0313..034C` reset path eventually sets `[0018]=0` and
  starts round/session setup.  A carry-set return at `0377`/`0385` instead
  returns from this loop.  This establishes a conditional mode/session
  handoff, not a permanent terminal freeze or a one-step win flag.
- **Verified — `[4D64]` is a tracked enemy count in ordinary setup.**  `A815`
  zeros it before the descriptor-loading loop; `A8C1` increments it once per
  successfully allocated enemy descriptor, and `A8CB` copies the result to
  `[4D66]`.  Defeat/removal routes decrement `[4D64]` at `A09B`, `A655`,
  `AD69`, and `AD53`; `B125` can increment it for a later addition.  The
  bounded trace establishes count ownership, not that every visible enemy
  object maps one-to-one to this byte at every moment.
- **Verified — the ordinary last-enemy-to-clear connection:** `87A1` sets
  `[0018]=600` and allocates the `9675` control actor with active flags
  `0200h`.  Allocator `10EC..1134` initializes its cadence words
  `[BX+050C]=[BX+050E]=FFFFh`; dispatcher `11A0..11A9` computes
  `FFFFh + FFFFh + carry(1) = FFFFh` with carry, so the actor callback runs
  once each time this actor is reached in a `114D` pass.  Its flags have
  neither `0400h` nor `0010h` (the optional extra-call paths in `114D`).
  At `96B6..96CA`, nonzero `[4D64]` skips the countdown; zero decrements
  `[0018]` once, saturating at zero.  At old value one, subtraction yields
  zero without borrow; `11C0..11CA` returns carry to the main loop, which
  tests `[0018]` at `03F8` after dispatch and reaches `0403 -> 041B`.
  In the unmodified ordinary path this is a cumulative **600 reached actor
  passes with zero tracked enemies**, paused (not reset) whenever the count
  becomes nonzero.  It is not proven to be 600 display frames, 600 hardware
  timer ticks, or ten seconds.
- **Partial — route boundaries:** the participant-counter OR at `036B` must
  permit the `038B` dispatcher.  Other `[0018]` writers can cut short or
  redirect the ordinary countdown.  The direct decrement chain is established,
  but this bounded trace does not classify every special phase that can change
  the counter, nor does it validate a generic visible-roster-empty predicate.

## Is `ED6A` an ending-only entry?

- **Verified:** the only decoded, instruction-boundary direct near-call to
  `ED6A` in this image is `042A`, whose immediate predecessor is the
  `DA+1 >= 64h` branch above.  The raw byte stream contains incidental
  opcode-like bytes elsewhere and is not evidence of another call.
- **Partial:** this makes `ED6A` the direct record-100 terminal-transition
  helper in the traced main path, not an ordinary next-round loader.  It is
  not proof that no indirect/far entry, alternate entry point, or surrounding
  life-transition flow can reach equivalent behavior.

## Implementation boundary

- **Ordinary clear is not a generic three-second empty-roster timer.**  A
  native implementation needs a tracked-enemy count corresponding to
  `[4D64]`, a 600-unit countdown in the actor-pass/work domain (paused while
  that count is nonzero), and a transition test after each dispatch pass.
  A fixed-60-Hz browser adapter may choose when to issue passes, but must not
  label that mapping original hardware timing.  Custom/legacy policy is a
  separate compatibility behavior.
- **Do not implement a guessed `0x384`/"15 second" win rule.**  Reaching
  record 100 takes `DA=63h -> 64h -> ED6A` rather than another ordinary map
  load.  Its UI/wait loop and conditional return-to-mode path are verified,
  but external drawing/input calls, the meaning of byte `047E`, and the full
  `E9DA` callback state machine are not resolved.  A browser presentation
  can be labelled an adaptation; an immediate immutable `won` state is not
  an exact transcription of this branch.
