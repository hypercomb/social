# DOS Mighta evidence

Status legend: **verified** means statically decoded from the inert reference
image only; **partial** is a narrowly bounded mapping; **unknown** is not a
reason to alter gameplay.  No DOS executable or data file was run.

## Source and address rule

- **Verified:** source is
  `C:\Users\Jaime\AppData\Local\Temp\hc-bubble-zenchan-e4e35e932198405a953a846be684d7c5\image.bin`,
  SHA-256 `c0ab3aec0519cfbf22cee3fc3e3c6642e5a270f6fa8e68726dd172b9cecb0771`
  (131856 bytes).
- **Verified:** code is 16-bit.  Capstone's apparent targets such as
  `0x11346` are wrapped CS offsets: the calls below are to `1346`, `19BA`,
  `1B0C`, `1C87`, `1EB6`, and `1FC9`, respectively.

## Dispatch, initialization, and walking

- **Verified — dispatch:** table entries at `D27E..D28A` jump to `D28B`
  (initializer), `D2D0` (walking), `D440`, and `D447`.
- **Verified — `D28B..D2CF`:** sets actor `[BX+514]=4`, clears the linked
  actor field `[DI+104C]` to `FFFFh`, installs `[BX+512]=D2D0`, sets
  `[BX+50E]=FFFFh`, selects signed speed-table offsets `20h` or `1E0h` from
  facing bit `[DI+1051]&1`, stores the selected word in `[DI+1052]`, and
  selects animation `97h`/`9Bh` by facing.  The paired offsets encode the
  normal direction reversal rather than two separate behaviors.
- **Verified — first walking pass `D2D0..D342`:** calls shared activity/
  gravity/high-jump/hop helpers (`ABE8`, `A986`, `A99F`, `AAF6`) in that order;
  a carry from any helper short-circuits to `1B0C`/return.  Otherwise it
  decrements `[BX+514]`, updates facing-dependent animation, moves through
  `1C87`, and runs collision helpers `1FC9` and `1EB6`.  Collision reversal
  negates `[DI+1052]`, flips facing bit 0, then performs `1B0C`.

## First projectile staging cycle

- **Verified — exact eligibility at `D343..D37E`:** staging first requires
  `[DI+104C]==FFFFh` and `[DI+1094]&7==0`.  It then requires
  `abs([DI+1092]-[4C52]) < 8` (the `sub; jae; neg; cmp 8; jae` sequence), and
  a signed facing-relative difference derived from `[DI+1094]-[4C54]` of at
  least `18h` (`test facing; optional neg; cmp 18h; jl` rejects).  Field names
  are deliberately retained because this trace alone does not prove the
  engine's coordinate-field mapping.
- **Verified — random gate at `D378`:** it calls `1346`, and takes the attack
  path only when that helper returns carry set (`jb D37F`).  `1346..1358`
  invokes `1326` up to four times, stopping at the first carry-clear result.
  `1326` advances the `12DF` LFSR once, then executes `or ax,ax; jnp 132E;
  stc; ret`: PF=0 (odd parity) returns carry clear; PF=1 (even parity) returns
  carry set.  Therefore attack requires four consecutive even-parity trials.
  Under an unbiased parity stream its probability is 1/16, but it consumes
  **one through four** LFSR words (not always four).
- **Verified — allocation/linking at `D37F..D3DC`:** successful `19BA` actor
  allocation receives class `A3h`, count `7`; it gets `[+508]=40h`, callback
  `D3DD`, counter zero, and the speed-table word at `DS:0132+40h`, negated for
  one facing.  Its `1092`, `1094`, and link field are copied/linked to the
  Mighta.  Allocation failure returns carry clear and creates nothing.
- **Verified — first projectile callback `D3DD..D419`:** it runs `A2B8` as an
  overlap guard, updates animation only when `[0034]` is nonzero, advances
  through `1C87` (which reads `[DI+1052]`), tests `1FC9`, and unlinks/destroys
  at `D419..D43F` on its carry-controlled termination route.  On the clear,
  non-overlap path this callback does not reset the launch speed.  Exact
  collision and lifespan semantics beyond this first cycle are unknown.

## Current-engine comparison

- **Implemented (native-only):** [`maybeFireHorizontal`](./engine.ts) now
  selects `120 px/s` for native Mighta rocks, matching table offset `40h` and
  signed code `20h`.  Custom/legacy levels retain their prior `240 px/s`
  tuning.
- **Verified alignment:** native `chance(4)` already matches `1346`'s
  four-even-parity cascade and short-circuit random consumption; it must not
  be replaced with a modulo roll or an odd-parity helper.
- **Covered regression:** [`engine.spec.ts`](./engine.spec.ts) exercises both
  directions for the native table speed and the first clear 60 Hz movement
  (`+/-2 px`), while a separate legacy-custom case retains `240 px/s`.
- **Unknown:** the exact engine mapping for DOS fields `1092/1094/4C52/4C54`,
  the resource-pool correspondence of `19BA`, and the entire later projectile
  behavior.  Do not infer a global shot cap, expiry duration, collision rules,
  or a shared rule for the other enemy families from this bounded trace.
