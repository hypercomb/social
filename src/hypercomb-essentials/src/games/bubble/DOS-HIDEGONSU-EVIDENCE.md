# DOS Hidegonsu evidence

Status legend: **verified** is statically decoded from the inert reference
image only; **partial** is a bounded implementation mapping; **unknown** is
outside this first-projectile scope.  No DOS executable or data was run.

## Source and address rule

- **Verified:** source is
  `C:\Users\Jaime\AppData\Local\Temp\hc-bubble-zenchan-e4e35e932198405a953a846be684d7c5\image.bin`,
  SHA-256 `c0ab3aec0519cfbf22cee3fc3e3c6642e5a270f6fa8e68726dd172b9cecb0771`
  (131856 bytes).
- **Verified:** calls displayed as `11xxxx` by a linear disassembler wrap to
  16-bit CS offsets.  Relevant targets here are `1346`, `19BA`, `1B0C`,
  `1C87`, `1EB6`, and `1FC9`.

## Dispatch and walking root

- **Verified — dispatch:** `D46A..D470` selects `D471` then `D4B6` for this
  family (with `D627`/`D62E` as later display/link handling entries).
- **Verified — `D471..D4B5`:** stores actor counter `4`, clears
  `[DI+104C]=FFFFh`, installs callback `D4B6`, stores `[BX+50E]=FFFFh`, then
  selects signed walk-table offsets `20h`/`1E0h` by `[DI+1051]&1` and stores
  the word to `[DI+1052]`.  Facing also selects animation `52h`/`56h`.
- **Verified — `D4B6..D523`:** invokes `ABE8`, `A986`, and `A99F` in that
  order; each carry branch goes to `D520` (`1B0C`, return).  Its ordinary
  walking path ends in `1C87`; collision-return branches call `D524` before
  `1B0C`.  Unlike Mighta's root, this path has no `AAF6` call before walking.

## First fire projectile cycle

- **Verified — eligibility `D524..D55F`:** requires `[DI+104C]==FFFFh`,
  `[DI+1094]&7==0`, `abs([DI+1092]-[4C52]) < 8`, and signed
  facing-adjusted `[DI+1094]-[4C54] >= 18h`.  Failure of any exact branch
  reaches `D55E: clc; ret`.  The final random gate is `call 1346; jb D560`.
- **Verified — probability/flags:** `1346` runs `1326` up to four times,
  stopping at first carry clear.  At `1326`, `or ax,ax` clears CF; `jnp`
  (PF=0, odd parity) skips `stc`, while PF=1 (even parity) executes it.
  Thus D560 requires four even-parity LFSR trials; it consumes one through
  four LFSR words, and is 1/16 only under an unbiased parity stream.
- **Verified — staging `D560..D5C7`:** allocator `19BA` receives animation
  class `5Eh` for facing-clear or `62h` for facing-set, and count `7`.
  Success sets `[new+508]=40h`, `[new+512]=D5C8`, `[new+514]=0`.  It reads
  `DS:0132+48h`, negates only for facing-clear, stores it to `[new+1052]`,
  copies `1092`/`1094`, and creates the bidirectional `104C` link.  Allocation
  failure takes `D5C1..D5C7` and returns carry clear.
- **Verified — first callback `D5C8..D626`:** `A2B8` carry goes directly to
  cleanup `D607`; otherwise it conditionally advances animation, calls `1C87`,
  then routes `1FC9` carry to the same cleanup.  The clear first callback
  retains the staged `[1052]` speed; `D607..D626` unlinks and destroys only on
  that carry-controlled route.

## Current-engine comparison

- **Implemented (native-only):** [`maybeFireHorizontal`](./engine.ts) now
  selects `135 px/s` for Hidegonsu fire, matching byte-table offset `48h` and
  signed code `24h`; custom/legacy levels retain `270 px/s`.
- **Verified alignment:** native branching's existing `chance(4)` maps to
  the parity cascade above, including short-circuit LFSR consumption; a modulo
  helper or odd-parity replacement would be incorrect.
- **Covered regression:** [`engine.spec.ts`](./engine.spec.ts) checks both
  facing directions at `+/-135 px/s`, first clear-pass motion of `+/-2.25 px`,
  and the retained `270 px/s` custom-level speed.
- **Unknown:** field-to-render-coordinate naming, later fire collision or
  expiry behavior, resource-pool capacity, and whether the generic engine
  shot lifecycle maps to DOS `A2B8`/`1FC9`.  Do not infer any of these from
  this first-cycle trace.
