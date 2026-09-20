# DOS Banebou ordinary hop evidence

Status legend: **verified** is static decoding of the inert reference image;
**partial** is a bounded mapping; **unknown** is not a license to alter runtime
behavior.  No DOS executable or data was run.

## Source and address rule

- **Verified:** source is
  `C:\Users\Jaime\AppData\Local\Temp\hc-bubble-zenchan-e4e35e932198405a953a846be684d7c5\image.bin`,
  SHA-256 `c0ab3aec0519cfbf22cee3fc3e3c6642e5a270f6fa8e68726dd172b9cecb0771`
  (131856 bytes).  Direct near targets are interpreted modulo 16 bits.

## Loader callback and ordinary ground transition

- **Verified — dispatch:** `A8F7` entry index 2 is `D83D`; `D83D..D881`
  installs `D882` in `[BX+512]`, initializes normal signed horizontal table
  offset `20h/1E0h` by facing, and selects animation `67h/6Bh`.
- **Verified — callback table:** during descriptor load, `A85A..A86D` masks
  the behavior-table selector with `0Eh` and stores `CS:[A907+DI]` to
  `[BX+510]`.  Banebou's index-2 entry is `D830`.  Variant bit handling later
  at `A871..A87E` is separate and does not alter this behavior-table index.
- **Verified — `D882..D8A5`:** after `ABE8` and `A986` guards, it calls
  `A99F`.  A carry from any of those helpers exits through `1B0C` without
  installing the ordinary hop.  If `A99F` returns clear, `D895..D89E`
  installs `[BX+512]=D9E4` and loads `[DI+1054]=[4D70]`, then calls `1B0C`.
  It does not rewrite `[DI+1052]` in this transition.

## First ground -> hop -> land -> repeat cycle

- **Verified — hop handler `D9E4..DA76`:** it first uses `ABE8`, then `DA77`
  for animation.  It advances horizontal state through `1C87` and vertical
  state through `1C52`; the horizontal collision route at `DA0A..DA2B`
  negates `[DI+1052]` and flips facing.
- **Verified — landing/repeat branch:** after the vertical collision checks,
  the branch `DA4A..DA4D` installs `[BX+512]=D882`.  On the next actor call,
  that re-enters the ground transition above, including the fresh `A99F`
  decision and, if clear, a new `[4D70]` hop impulse.  This is the confirmed
  ordinary collision-driven repeat transition.
- **Verified — non-landing velocity threshold is different:** every `D9E4`
  pass updates `[DI+1054] += [4D72]` at `DA53..DA5B`, then tests the signed
  sum with `[4D70]`.  If nonnegative it zeros `[DI+1054]` and indirect-calls
  `[BX+510]` at `DA6B..DA71`; for the loader-installed Banebou callback this
  starts at `D830` and reaches `DAA2` (animation `6Fh`).  That path does not
  itself write `[BX+512]=D882`, so it must not be collapsed into the
  collision/repeat transition.

## Comparison boundary

- **Verified state-machine agreement:** native `moveBanebou` already models
  the important no-motion install behavior: it can enter shared high-jump
  windup from the `A99F` decision, otherwise installs a small hop before the
  first movement pass, and resumes its ground decision after a detected
  landing.  The static routine confirms Banebou uses `A99F`, not `AAF6`, at
  `D882`.
- **Partial numeric mapping:** the current engine uses hop impulse `-90 px/s`
  and per-pass acceleration `+4.6875 px/s` (`DOS_ENEMY_HOP`).  This routine
  proves the exact read/order of runtime words `[4D70]` and `[4D72]`, but the
  inert image does not contain their initialized runtime values; this trace
  alone cannot independently certify those two numeric conversions.
- **Verified missing distinction:** the current high-level state does not
  represent the loader-installed `D830 -> DAA2` threshold animation callback
  separately from collision landing.  This is a visual/control-callback gap,
  not sufficient evidence for a gameplay change until the actor callback and
  rendering mapping are traced.
- **Unknown:** special/angry paths, the exact `A986` support predicate,
  numerical initialization source for `4D70/4D72`, and all Banebou branches
  beyond this ordinary first cycle.  Do not add a generic `AAF6` hop, change
  speed constants, or infer a new repeat timer from this evidence.
