# Bubble Bobble DOS normal collectible evidence

Audit date: 2026-09-20. This is a bounded static trace of the ordinary
collectible path after a normal player pop. It is **not** evidence for every
entry to `BC41`, special-item rules, or a complete item physics system.

## Method and address convention

**Verified.** Inspection used only the inert unpacked image at
`C:/Users/Jaime/AppData/Local/Temp/hc-bubble-zenchan-e4e35e932198405a953a846be684d7c5/image.bin`,
131,856 bytes, SHA-256
`c0ab3aec0519cfbf22cee3fc3e3c6642e5a270f6fa8e68726dd172b9cecb0771`.
Capstone 5.0.7 was used in 16-bit mode through the image's sibling `python`
directory. No DOS, downloaded, or unpacking program was executed. `d.py` was
not used.

All code addresses below are CS/image offsets. A 16-bit near-call target is
the IP modulo `10000h`: for example Capstone's printed `call 11B0Ch` from this
region resolves to CS:`1B0C`, not image offset `11B0C`. DS addresses refer to
DS base `10580h`; hence `DS:4D1C` is image offset `1529C`.

## Bounded ordinary-pop entry

**Verified.** `9C48..9C7B` is the normal player-pop chain entry. It increments
`DS:4C64`, resets that count to zero when `u16(DS:011E - DS:4D18) >= 0Ah`,
stores the current general tick in `DS:4D18`, calls the current actor's
callback at `[bx+0510]+9`, fetches an item ID from `DS:4D1C[DS:4C64]`, sets
`CL=1`, and calls `BBB4`.

**Verified.** The initialized ordinary-chain table at DS:`4D1C` (image
`1529C`) is:

| chain index | item ID |
| ---: | ---: |
| 0 | `12h` |
| 1 | `10h` |
| 2 | `11h` |
| 3 | `14h` |
| 4 | `46h` |
| 5 | `47h` |
| 6 | `50h` |
| 7 | `50h` |

This identifies the ordinary-pop input set. It does not name the art asset
associated with any ID.

## Defeated flight to BC41

**Verified.** The normal-pop call at `9C6D` invokes the fourth entry of the
archetype callback bundle: it calls `u16([bx+0510] + 9)`. The descriptor
loader at `A85F..A86D` fills `[bx+0510]` from the paired table at CS:`A907`.
For the eight descriptor archetypes in order, that table contains `D1B8`,
`D464`, `D830`, `DB86`, `DAB0`, `D64A`, `D27E`, and `DC4E`; their `+9`
entries jump respectively to `D277`, `D62E`, `DAA9`, `DC47`, `DB7E`, `D813`,
`D447`, and `DDA1`. In particular, Zen-Chan's callback is
`D1C1 -> D277`, which writes display value `51h` through CS:`196B`; `D270`
is the preceding third callback entry, not the ordinary-pop callback.

**Verified.** `BBB4` does not initialize flight velocity. Immediately after
the `BBB4` call returns, `9C7E..9C9A` chooses the x speed-table entry from
heading bit 0 and writes y unconditionally:

- bit 0 set: DS:`0132 + 0040h`;
- bit 0 clear: DS:`0132 + 01C0h`;
- y: DS:`0132 + 01C0h`.

These are byte offsets into the word speed table, not speed codes. Since
CS:`0775..07A3` stores each code at `DS:0132 + 2 * code`, they represent
signed codes `+20h`, `-20h`, and `-20h` respectively. At the documented
60 Hz baseline, this is x `+120`/`-120` pixels/s and y `-120` pixels/s.
`9C9E` then refreshes bounds via `1B0C`. The flight's initial y velocity is
therefore definitely negative.

**Verified.** `BBB4..BBE4` stores the supplied item ID at `[di+104C]`, changes
the actor flags to `0080h`, installs procedure `BBE5`, clears `[bx+050E]` to
`FFFFh`, and stores `u16(DS:011E + 003Ch)` at `[bx+0514]`.

**Verified.** Each `BBE5..BC28` invocation applies vertical then horizontal
fixed-point movement through CS:`1C52` and CS:`1C87`, respectively; it clamps
and reflects x at `38h` and `108h`. When unsigned `DS:011E >= [bx+0514]`, it
sets a new deadline `u16(now + 41h)` and negates the y velocity. Only when
that negated y velocity is negative (`BC26` `js`) does it continue to
`BC29..BC40`, which calls `BC41` with the stored item ID and a selector
derived from `[di+1051]`, then aligns x down to an 8-pixel boundary.

**Verified flag interpretation and timing.** `BC15..BC19` is `cmp now,
deadline; jb BC28`, so it returns only while unsigned `now < deadline`; equal
time enters the deadline block. `BC22` executes `neg [di+1054]`; `BC26` is
`js BC29`, so it enters `BC29` precisely when the *result* of the negation is
negative (SF=1), not when it is positive. With the verified normal initial y
code `-20h`, the first eligible invocation at `now >= popTick+3Ch` moves first,
sets a new deadline `now+41h`, and negates y to `+20h`; SF is clear, so it
returns. The next eligible invocation at `now >= thatStoredDeadline` again
moves first, sets another deadline, negates y to `-20h`; SF is set, so it
executes `BC29 -> BC41` in that same invocation.

**Verified clock relation; conditional cadence result.** The timer interrupt
at `0931..0942` increments `DS:011E` when its fixed-point accumulator carries.
Round setup at `0403..040F` resets both `DS:011E` and `DS:001C` to zero. The
main scheduler at `03AC..03CC` derives a work quantum from its display-count
delta, forces a minimum of 1, caps it at 6, and adds that quantum to
`DS:001C`. Thus `DS:001C` is a scheduler/work counter, not directly the timer
interrupt counter; the conversion deadlines use `DS:011E`, not `DS:001C`.

If the actor procedure is called on every general-tick increment, a normal pop
at general tick `T` reaches `BC41` on tick `T + 3Ch + 41h = T + 7Dh` (125
ticks): movement precedes both deadline tests, and conversion occurs on the
second test. That is a conditional arithmetic result, **not** an established
native wall-clock duration. The precise native dispatcher contract below
proves no fixed one-call-per-`011E` relationship. Do not infer a
`DS:001C`/60-Hz equivalence.

### Scheduler/work-clock contract

**Verified.** `03B0..03CC` obtains `delta = u16(DS:0124 - old DS:0038)` by
exchanging the old sample into `DS:0038`. It changes a zero delta to 1 at
`03B9..03BD`, caps values above 6 to 6 at `03C1..03C6`, stores the resulting
`q` in `DS:003A`, and performs `DS:001C = u16(DS:001C + q)` at `03CC`.

**Verified.** The outer loop calls the actor dispatcher `114D` at `038B`
*before* decrementing `DS:003A` (`0394`). When that decrement reaches zero it
runs the display/work scheduling block, calculates the next `q`, advances
`DS:001C`, and starts the next batch. Therefore, after the advance, there are
exactly `q` subsequent outer-loop actor-dispatch passes while `DS:001C` remains
unchanged, unless an unrelated mode/state guard exits the outer loop.

**Verified for this fruit state.** `BC41` and `BCAA` write `FFFFh` to
`[bx+050E]`. In dispatcher `11A0..11BF`, `stc; adc [bx+050C],[bx+050E]` with
that value leaves `[bx+050C]` unchanged and always sets carry; execution thus
reaches `call [bx+0512]` once on every `114D` pass for an active fruit actor.
The actor does not receive a variable-rate divider in this state.

Consequences, stated without an unproven display-rate assumption:

- Under a non-backlogged scheduler sample with `1 <= delta <= 6`, `q=delta`;
  `DS:001C` gains `q` immediately and the fruit procedure is subsequently
  invoked `q` times at that same new value. Averaged over that batch, there is
  one ordinary fruit invocation per `DS:001C` unit, but equality-sensitive
  code observes the increment before the batch's first invocation.
- For `delta=0`, the forced `q=1` still advances `DS:001C` by one and runs one
  fruit invocation in the following batch.
- For a backlog `delta>6`, `q=6`: both the `DS:001C` advance and the following
  fruit-invocation count are six, not the full measured delta. The code does
  not perform a larger fruit-time catch-up in that batch.
- `DS:011E` is advanced independently in the timer interrupt. The inspected
  code does not establish how many `114D` passes occur between two `011E`
  carries, nor the instantaneous phase at which a timer interrupt occurs.
  Thus `BBE5`'s general-tick deadlines can be represented exactly as raw
  unsigned deadlines, but their wall-clock and actor-invocation count must not
  be claimed from this trace alone.

## BC41 state transition and post-conversion states

**Verified.** `BC41..BC6A` writes its AX item ID to `[di+104C]`, writes
`0080h` to `[bx+0508]`, sets procedure `[bx+0512]` to `BC6B`, clears
`[bx+050E]` to `FFFFh`, transforms the selector/status byte at `[di+1051]`,
and calls CS:`1F44` (which clamps x to the 8-pixel grid and range
`38h..110h`). `BC41` itself does not write x/y velocity.

**Verified.** `BC6B..BC8F` first calls `BDA0`. If that routine returns carry,
it goes directly to `BCAA`. Otherwise it calls CS:`1CEB`; if that returns
carry, it only calls CS:`1B0C` before returning. If `1CEB` returns clear,
`BC77` takes `BC7D`, reloads the item ID and derives the transformed selector,
then directly calls `BCAA` at `BC8C` before returning. The indirect `B62E`
table dispatch begins at `BC90`; it is not the `1CEB`-clear branch of `BC6B`.
The directly decoded instructions in `BC6B..BC8F` contain no x/y position or
velocity write. `1CEB` is not side-effect free: on several branches it calls
`1D14`, which temporarily swaps in
DS:`0152` as y velocity and calls `1C52` (a y movement/update helper).
`0152h` is not a separately unknown variable: it is exactly
`0132h + 2 * 10h`, the populated speed-table entry for signed code `10h`.
Consequently `1D14` makes one positive-y code-`10h` movement attempt, restores
the actor's prior y velocity, and returns the `1C52` flags. At the documented
60 Hz baseline code `10h` is one pixel down per invocation.

**Verified bounded falling transition.** `1CEB` returns carry while it keeps
the actor in `BC6B`; `BC6B` then refreshes bounds through `1B0C` and returns.
`1CEB` returns clear only through `1D24`'s carry branch (`1CF7..1D12`), at
which point `BC6B` takes `BC7D..BC8F` and installs the timed `BCAA` state
rather than executing another fall step. The other observed `1CEB` branches
call `1D14` and return carry;
the `1CFC..1D0B` branch additionally clears y fractional state, aligns y down
to an 8-pixel boundary, and returns carry. `1E63` and `1D24` are native
terrain-mask predicates over the actor's current x/y; their complete
human-readable collision semantics are not assigned here. This is sufficient
to reject the engine's unqualified `vy=72` gravity model: the normal path uses
native code `10h`, predicate-gated one-pixel downward attempts, and a
predicate-selected transition.

**Verified predicate shapes and existing-helper comparison.** Both predicates
read occupancy bit 0 directly from the native surface at DS:`3690`, rather
than calling the directional-mask routines:

- `1E63..1E9A` computes
  `row = floor((y + 15) / 8)`, `column = floor((x - 40) / 8)`, ORs occupancy
  at columns `column` and `column + 1`, and additionally `column + 2` when
  `(x - 40) & 7 != 0`. It returns carry exactly when that OR has bit 0 set.
- `1D24..1D66` is the same direct occupancy-footprint test at
  `row = floor((y + 16) / 8)` and returns carry exactly when the OR has bit 0
  set, except that y outside `[10h, D7h]` returns clear.

Accordingly, `1CEB` behavior is exact at the control-flow level: y below
`10h` takes the `1D14` down-step; otherwise an `1E63` carry takes that step;
otherwise an `1D24` carry returns clear with no down-step and moves `BC6B`
into `BCAA`; otherwise it takes `1D14` and returns carry (snapping y only when
the `1D14/1C52` call itself returns carry).

**No existing exact helper reuse.** `dosCollisionWord`/`dosBlocksDirection`
and engine `moveNativeBody` model CS:`1ED1` plus the directional predicates:
they move first and then query a packed two-byte collision word using the
`down` predicate. They do not perform the direct `y+15`/`y+16` raw occupancy
queries, their 1/2/3-column footprint selection, or `1CEB`'s carry protocol.
The current `moveFruit` additionally supplies `vy=72` and a 12-by-12 body.
It is therefore not an exact implementation of the normal `BC6B` fall/support
path. Safe reuse is limited to the existing fixed-point `advanceFixedValue`,
vertical wrapping, and collision-mask source data; an exact item path needs a
dedicated direct-occupancy helper that returns the native carry outcome.

**Verified boolean boundary for `BDA0`; semantic name unknown.** `BDA0..BDBF`
returns carry only when `(status & C0h) == 0` and either `DS:4D64 == 0` or
`DS:4DA0 == 0`; on that carry path it calls `19D7` before returning. In all
other cases it returns clear. The fields' game-rule meanings were not traced,
so this must be implemented as an explicit removal guard only after their
owners are audited, not renamed as a pickup or expiry condition.

**Verified.** `BCAA..BCE2` is a distinct timed collectible state: it stores
the AX item ID, flags `0080h`, procedure `BD0F`, and `FFFFh` in the same
fields. It then stores `u16(DS:001C + duration[CX])` in `[bx+0514]`, where the
four CS:`BD07` duration words are `01A4h`, `0258h`, `0708h`, and `0E10h` for
selectors 0 through 3. It transforms `[di+1051]`, updates the actor's
priority/list position with CS:`1A34`, assigns a display entry via the table
at CS:`B500`, updates its bounds with CS:`1B0C`, and probes `BDA0` once more.

**Verified.** `BD0F..BD30` checks `BDA0`, then `BDC0`. On a `BDC0` carry it
installs `BD72` and saves `DS:4D8C` in `[bx+0518]`. Otherwise it refreshes
bounds through `1B0C` and waits while unsigned `[bx+0514] > DS:001C`; on
equality or after, it installs `BD3F`.

**Verified.** `BD3F..BD71` advances its deadline by six `DS:001C` ticks, steps
the display value `[di+104E]` toward `112h`, refreshes bounds, and frees the
actor through CS:`19D7` once that display value reaches `112h`. This is the
verified expiry sequence. It is neither a ten-second `age` comparison nor a
single fixed expiry duration: the `BCAA` selector selects one of four initial
durations, then `BD3F` performs six-tick visual steps.

**Verified.** `BDC0..BE0C` tests the actor rectangle `[di+1092]` against the
two player rectangles at DS:`4C5A` and DS:`4CAE` using CS:`1B85`. An overlap
selects the player identity in `DS:4D8C`, increments one of the counters at
`4E08/4E06` depending on whether the item ID is below `60h`, and returns
carry. Thus `BD0F`'s transition to `BD72` is a verified player-overlap pickup
transition. The far callback at DS:`518A` and the counters' complete game-rule
meaning were not traced.

## Ordinary rewards versus special routes

**Verified, bounded.** In the normal-pop path above, the `CL=1` argument at
`9C7B` flows through the status transforms used by `BBB4`, `BC41`, and `BC6B`.
At `BC7D..BC8C`, that ordinary path derives `BCAA` selector 1, hence the
`0258h` `DS:001C` duration. The later ordinary pickup routes reach these
chain handlers:

| ordinary item ID | handler | verified AX score |
| ---: | ---: | ---: |
| `12h` | `C080` | 500 |
| `10h` | `C05E` | 1,000 |
| `11h` | `C06F` | 2,000 |
| `14h` | `C091` | 4,000 |
| `46h` | `C0A2` | 8,000 |
| `47h` | `C0B3` | 16,000 |
| `50h` | `C164` | 6,000 |

Each listed handler calls `BE0D` with that score and `BE21` to select its
score-display value; `BE0D` credits the player selected in `DS:4D8C`.

**Verified distinction.** `BC41` is shared code, not an ordinary-fruit-only
entry: direct callers also exist at `AD3A` and `B4DF`, and the CS:`B62E`
dispatch table includes routes such as `BFC5`, `C051`, `C0C4`, and later
`C17x/C18x/C19x` handlers. Their special-item triggering conditions and full
effects were not traced. Do not route every `BC41` call through the ordinary
fruit scoring table.

## Minimal implementation specification and tests

The current generic `moveFruit` model (`vy=72` and `age < 10`) is **not
verified** by this trace. A scoped exactness change should:

1. Preserve the defeated actor through the `BBB4 -> BBE5 -> BC29 -> BC41`
   transition, including fixed-point flight, x reflection, the `3Ch` deadline,
   and the subsequent `41h`/negative-result-of-`NEG` gate. Initialize x/y from
   signed speed codes `+20h` or `-20h` and `-20h`; do not treat the table
   offsets `40h/1C0h` as speed codes. Under one actor update per general tick,
   conversion is at pop tick `+7Dh`, not `+3Ch` or an arbitrary local timer.
2. Model `BC41`, `BC6B`, `BCAA`, `BD0F`, `BD3F`, and `BD72` as explicit
   states. Store the selector-dependent duration in the native `DS:001C`
   clock domain, using unsigned comparison semantics.
3. On player rectangle overlap, take the `BD0F -> BD72` pickup transition and
   credit only the verified normal-chain mapping above. Keep non-normal
   `BC41` dispatches separate until their routes are traced.
4. Model the pre-`BCAA` `BC6B` fall as predicate-gated positive code-`10h`
   vertical movement (one pixel per 60-Hz invocation) through `1CEB/1D14`,
   with its native fixed-point/wrap update. The `1D24` carry branch takes the
   ordinary `BC7D..BC8F -> BCAA` transition. Do not substitute generic gravity
   or a continuous `vy=72` integration; preserve the unresolved predicates as
   named native collision operations until independently mapped.

Required deterministic tests for such a patch:

- seed each of the eight normal-chain IDs and verify the seven score values
  (`50h` twice), including a chain reset when the unsigned general-tick gap is
  `>= 0Ah`;
- prove the `3Ch` flight deadline alone does not force `BC41`: with normal
  initial y `-20h`, equality moves first, flips y to `+20h`, and returns;
  equality at the stored `+41h` deadline moves first, flips y to `-20h`, and
  enters `BC41`. Under 60 Hz one-call-per-tick cadence assert pop tick `+7Dh`.
  Cover x reflection at `38h/108h` and both heading-derived x signs;
- cover `BC6B` branches that retain carry and take a code-`10h` down-step,
  including fractional-state clear/8-pixel alignment where `1CFC..1D0B`
  applies, versus the `1D24` carry branch that returns clear and takes the
  ordinary `BC7D..BC8F -> BCAA` transition; do not encode untraced predicate
  labels in the test;
- test the direct occupancy footprint at `y+15` and `y+16`: columns `c/c+1`
  when x is 8-pixel aligned and `c/c+1/c+2` otherwise, including `1D24`'s
  y-range clear result. These cases must not be delegated to
  `dosBlocksDirection(..., 'down')`;
- cover all four `BCAA` duration words, equality versus one-tick-before under
  unsigned `DS:001C` comparison, then six-tick `BD3F` display advances and
  deletion at display value `112h`;
- cover overlap of each player rectangle, transition to `BD72`, and credit to
  the selected player; and
- assert that a non-normal `BC41` entry cannot silently receive ordinary
  fruit points.

## Unknown / intentionally excluded

- Exact semantic names for the transformed selector/status byte and all four
  duration selections outside the normal actor-status class.
- The complete behavior and side effects of helpers `BDA0`, `1CEB`, the far
  callback in `BDC0`, and the `B62E` routes outside the ordinary pickup
  mapping.
- Special-item triggers, effects, art, bonus/life rules, two-player policy
  beyond the rectangle selection above, and every score-display detail.
- The exact gameplay labels and all cell-mask cases of `1E63` and `1D24`.
  Their flag outcomes and the resulting falling/transition control flow are
  traced above, but this audit does not collapse them into guessed terms such
  as floor, platform, or wall.
