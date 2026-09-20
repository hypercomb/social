# Bubble Bobble DOS scheduler evidence

Audit date: 2026-09-20. This is a bounded static trace of the clock producers,
video wait, outer loop, and actor dispatcher. It does not claim exact interrupt
phase, wall-clock cadence for an individual state, or complete game parity.

## Image and address convention

The only inspected image was the inert 131,856-byte unpacked image at
`C:/Users/Jaime/AppData/Local/Temp/hc-bubble-zenchan-e4e35e932198405a953a846be684d7c5/image.bin`,
SHA-256 `c0ab3aec0519cfbf22cee3fc3e3c6642e5a270f6fa8e68726dd172b9cecb0771`.
Inspection used `scripts/bubble-static-inspect.py` and Capstone in 16-bit mode.
No DOS code was executed. Code offsets below are CS/IP offsets in that image;
direct near targets must wrap IP to 16 bits. Data offsets are DS-relative.

## Clock producers and calibration

**Verified.** The setup at CS:`07D5..08A4` samples video synchronization
while reading the PIT counter, stores a measured display period in PIT cycles
at DS:`0118`, then programs an interrupt period at DS:`011A`. CS:`0861..0874`
computes the fixed-point increment at DS:`0108` as the measured period divided
by `4DAEh` in 16-bit fractional units, saturating at `FFFFh`. `4DAEh` PIT
cycles are approximately 1/60 second. CS:`074F..076C` independently derives
the rounded measured display rate at DS:`0128`; CS:`0775..07A5` uses that
rate to initialize signed 8.8 velocity entries as
`ceil(abs(speedCode) * 16 * 60 / displayHz)` before restoring the sign.

**Verified.** The interrupt handler at CS:`08C2..096A` has two separate clock
paths. With DS:`0130` zero, CS:`08DC..092C` polls a display-status bit, invokes
the video callback, increments DS:`0124` at `0928`, and shifts DS:`0126` at
`092C`. CS:`0931..0942` then adds DS:`0108` to a fractional accumulator at
DS:`0106`; carry increments DS:`011E`. The `0130` guard skips the video path
but still reaches the `011E` accumulator. In the inspected code,
CS:`3D55..3D61` increments/decrements `0130` around BIOS video interrupt
`10h`. A search for the direct `inc word ptr [0124]` encoding in the validated
image found the single site at `0928`; this does not exclude indirect writes.

Therefore `0124` counts successful video-path interrupt events, while `011E`
is the approximately 60 Hz general clock produced by fractional carry. They
are not the same counter. At a nominal 60 Hz display their *average* rates
are close; their exact values and instantaneous phase need not match.

## Outer-loop ordering

**Verified.** CS:`0352..0365` initializes the previous display sample to
`u16(DS:0124 - 1)` and the first work quantum to one. On each outer-loop pass
CS:`038B` calls actor dispatcher `114D` before `0394` decrements DS:`003A`.
Only when that quantum reaches zero does CS:`039A..03CC` perform the
display/synchronization block and choose the *next* quantum:

```text
delta = u16(DS:0124 - old DS:0038)   // xchg stores the new sample
q = min(6, max(1, delta))
DS:003A = q
DS:001C = u16(DS:001C + q)
```

CS:`03A6` sets DS:`0126 = 2`; CS:`09E4..09EF` waits until the interrupt's
video-path shifts (`092C`) reduce it to zero. Thus the ordinary display block
waits for two successful video-path events before sampling `0124`. With no
backlog or unusual interrupt timing, `delta` and `q` will commonly be two.
This is an expectation from the control flow, not a measured runtime trace.

After `001C += q`, the next `q` outer-loop dispatcher passes observe that
same `001C` value, unless a mode/state guard leaves the loop. The interrupt
may independently increment `011E` at any point between them; no static
instruction sequence makes one `011E` increment coincide with one dispatcher
pass. For `delta > 6`, both the `001C` advance and next pass count are capped
at six; the full measured delta is not replayed in that batch. For `delta = 0`,
one pass and one `001C` increment are forced.

**Verified for an ordinary fruit actor, not all actor types.** Dispatcher
CS:`114D..11C9` scans active slots. The fruit states in
`DOS-FRUIT-EVIDENCE.md` set `[bx+050E] = FFFFh`; `stc; adc [bx+050C], FFFFh`
at `11A0..11A9` preserves the phase accumulator and sets carry, so the
procedure at `[bx+0512]` is called once per dispatcher pass in the ordinary
fruit state. Other actors can use the phase divider and flags at `115F..1198`
for different call counts; this audit does not generalize one call per pass
to them.

## Consequence for the TypeScript model

`engine.ts` currently calls one `step()` per accumulated 1/60 second, increments
its sole `nativeTick` on that step, and updates each actor once in that step.
It maps both the `011E` deadline clock and an actor-work pass to one browser
tick. That is a reasonable **fixed-60-Hz adaptation** of nominal average
movement and the 60 Hz speed-table baseline, but not an exact representation
of the native scheduler. It should not be described as the DOS scheduler
advancing all gameplay *on* its 60 Hz interrupt.

For a cycle-level native mode, keep at least three distinguishable values:
`generalTick` (`011E`, fractional PIT carry), `displayCount` (`0124`, video
events), and `workTick` (`001C`, advanced before a `q`-pass batch), plus a
remaining-pass counter (`003A`). Any native deadline directly reading `011E`
must use `generalTick` (for example enemy activation, pop-chain gap, defeated
flight). The verified timed collectible deadline reading `001C` must use
`workTick`. Actor movement and state transitions that run from `[bx+0512]`
need procedure invocations according to the dispatcher, including batch
ordering and any actor-specific phase divider. The current one-step model
cannot express multiple fruit movement invocations at one `workTick` or
different `011E` phases within one batch.

This evidence **does not invalidate** tests explicitly scoped to the browser's
fixed-60 adaptation, including code-`10h` one-pixel-per-pass tuning, split
120-Hz `update()` accumulation, and isolated one-pass state transitions. It
**does limit** any claim that their elapsed tick numbers, half-tick timing,
or exact state sequence are verified DOS wall-clock behavior. In particular,
the normal fruit conversion at `popTick + 7Dh` is conditional on one eligible
fruit invocation per general tick, not a native timing guarantee. A native
parity test must use explicit clock and dispatcher events rather than relying
on the browser `step()` cadence.

## Minimal deterministic scheduler traces

The following are test fixtures for scheduler ordering, not assertions about
an observed physical display. Hold `generalTick = 50` unless an explicit
timer carry is injected; start `workTick = 100` and previous `0124` sample
at 200. In each case the sample advances `workTick` before dispatch:

| new `0124` | `delta` | `q` | `workTick` seen on successive fruit passes |
| ---: | ---: | ---: | --- |
| 201 | 1 | 1 | 101 |
| 202 | 2 | 2 | 102, 102 |
| 209 | 9 | 6 | 106, 106, 106, 106, 106, 106 |

For the `q=2` case, inject one `011E` carry between the passes: the first
fruit invocation sees `(generalTick, workTick) = (50, 102)` and the second
sees `(51, 102)`. Without the injected carry both see `(50, 102)`. A separate
`delta=0` case must yield `q=1`, `workTick=101`, and one subsequent pass.
These tests expose precisely why `generalTick`, `workTick`, and pass count
cannot be aliases. They do not require simulating a DOS machine or assuming
an exact real-world interrupt phase.

## Remaining boundary

The static trace does not establish the distribution of interrupt arrivals
inside each batch, exact display behavior across hardware variants, the
phase-divider configuration of every gameplay actor, or every routine's
choice of clock. Those require separately bounded audits or a safe offline
runtime trace before cycle-exact claims.
