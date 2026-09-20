# DOS Drunk evidence

Status legend: **verified** is static decoding of the inert reference image;
**partial** is a first-cycle implementation mapping; **unknown** is explicitly
out of scope.  No DOS executable or data was run.

## Source and address rule

- **Verified:** source is
  `C:\Users\Jaime\AppData\Local\Temp\hc-bubble-zenchan-e4e35e932198405a953a846be684d7c5\image.bin`,
  SHA-256 `c0ab3aec0519cfbf22cee3fc3e3c6642e5a270f6fa8e68726dd172b9cecb0771`
  (131856 bytes).
- **Verified:** near targets are 16-bit wrapped CS offsets; apparent
  `11346`, `119BA`, `11B0C`, `11C87`, and `11FC9` mean `1346`, `19BA`,
  `1B0C`, `1C87`, and `1FC9`.

## Root and attack staging

- **Verified — dispatch/root:** `D64A..D656` selects initializer `D657` and
  walking handler `D69C`.  `D657..D69B` stores counter `4`, clears
  `[DI+104C]`, installs `D69C`, writes `[BX+50E]=FFFFh`, selects signed
  direction-table offsets `20h`/`1E0h` by facing bit, and selects animation
  `86h`/`8Ah`.
- **Verified — walking path:** `D69C..D70E` calls `ABE8`, `A986`, `A99F`, and
  `AAF6` before the ordinary movement/collision chain.  Its collision route
  enters `D70F`; helper carry exits go to `D70B` (`1B0C`, return).
- **Verified — exact gate `D70F..D74A`:** it rejects unless
  `[DI+104C]==FFFFh`, `[DI+1094]&7==0`,
  `abs([DI+1092]-[4C52]) < 8`, and signed facing-adjusted
  `[DI+1094]-[4C54] >= 18h`.  `call 1346; jb D74B` is the final stage branch;
  every rejected path reaches `D749: clc; ret`.
- **Verified — probability/flags:** `1346` calls `1326` up to four times,
  stopping on first carry clear.  `1326` performs `or ax,ax` (clearing CF),
  then `jnp` skips `stc` when PF=0 (odd parity); PF=1 (even parity) executes
  `stc`.  Consequently D74B needs four consecutive even-parity LFSR trials,
  consuming one through four LFSR words; it is 1/16 only for unbiased parity.

## First bottle projectile callback

- **Verified — allocation/staging `D74B..D7A8`:** `19BA` is called with class
  `92h`, count `7`.  On success the new actor gets `[+508]=40h`, callback
  `D7A9`, and zero counter.  `D769` reads `DS:0132+50h` (signed speed code
  `28h`), negates it only when the source facing bit is clear, stores it in
  `[new+1052]`, copies `1092`/`1094`, and creates a two-way `104C` link.
  `D7A2..D7A8` returns carry clear on allocation failure.
- **Verified — first callback `D7A9..D80B`:** `A2B8` carry branches to cleanup
  `D7E5`; otherwise animation is optionally updated, `1C87` advances using
  staged `[1052]`, and `1FC9` carry also takes cleanup.  The clear first pass
  retains launch speed.  `D7E5..D804` unlinks/destroys on the cleanup route;
  `D804..D80B` makes a far call with `AX=13h` before return.

## Current-engine comparison

- **Implemented (native-only):** [`maybeFireHorizontal`](./engine.ts) now
  selects `150 px/s` for Drunk bottles, matching table offset `50h` and signed
  code `28h`; custom/legacy levels retain `300 px/s`.
- **Verified alignment:** the engine's native `chance(4)` implements the
  same four-even-parity, short-circuiting LFSR cascade.  Do not substitute a
  modulo test or reverse the parity branch.
- **Covered regression:** [`engine.spec.ts`](./engine.spec.ts) checks both
  facing directions at `+/-150 px/s`, first clear-pass motion of `+/-2.5 px`,
  and the retained `300 px/s` custom-level speed.
- **Unknown:** whether `AX=13h` or any later linked actor behavior changes a
  bottle's lifecycle, its collision/expiry rules, resource pool capacity, or
  how it should differ visually from generic shots.  Those require a separate
  trace and are not assumed here.
