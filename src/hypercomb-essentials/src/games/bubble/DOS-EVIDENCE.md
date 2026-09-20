# Bubble Bobble DOS evidence ledger

Audit date: 2026-09-20. This is the source-of-truth ledger for what has been
verified from static inspection, rather than a claim of complete DOS parity.
Statuses mean **verified** (directly traced from the identified unpacked
image), **partial** (some direct evidence but not a complete state machine),
and **unknown** (not investigated enough to support an implementation claim).

## Evidence identity and scope

**Verified.** The inspected inert program image is
`C:/Users/Jaime/AppData/Local/Temp/hc-bubble-zenchan-e4e35e932198405a953a846be684d7c5/image.bin`,
131,856 bytes, SHA-256
`c0ab3aec0519cfbf22cee3fc3e3c6642e5a270f6fa8e68726dd172b9cecb0771`.
Disassembly used Capstone in 16-bit x86 mode with code addresses equal to image
offsets. No DOS executable, resource, or downloaded program was run. `d.py`
was deliberately not used: it slices the packed image and is not valid for
this evidence.

This audit is intentionally limited to descriptor loading, entrance,
activation, and Zen-Chan's first walking state. It does not establish the rest
of Zen-Chan AI or the other archetypes.

## Zen-Chan activation state machine

### Descriptor loader and dispatch

**Verified.** `A81F..A8D1` consumes a three-byte descriptor and allocates an
actor. It stores `A917` as the actor procedure at `[bx+0512]`
(`A842..A84D`), sets target y from descriptor byte 1 bits 7..3 with the
nonzero `-8` adjustment (`A886..A89A`), sets current y to `FFFFh`/`-1`
(`A896`), sets x from descriptor byte 0 bits 7..3 plus `28h`
(`A89C..A8A7`), preserves the six-bit delay in `[bx+0514]`
(`A8A9..A8B1`), and writes the heading field at `[di+1051]`
(`A8B2..A8C0`).

**Verified.** The eight word entries beginning at `A8F7` are, in descriptor
archetype order: `D1C5`, `D471`, `D83D`, `DB93`, `DABD`, `D657`,
`D28B`, and `DC5B`. Thus descriptor kind 0 (Zen-Chan) selects `D1C5`.
Although `A84E..A858` introduces descriptor byte-2 bit 6 into bit 0 of `ax`,
`A85A..A85F` copies it to `di` and masks `di` with `0Eh` before reading both
the behavior pointer (`[bx+0518]`) and its paired value (`[bx+0510]`). The
variant bit therefore does **not** select a second behavior-dispatch family.
`A871..A87E` retains that bit in `ax` for a later lookup; its exact visual or
other role is not established by this audit.

### Entrance and ready gates

**Verified.** `A917..A94F` first tests `DS:4D65`; while it is nonzero it
returns without changing the enemy (`A917..A91E`). The player-entry routine
checks its *current* y against `20h` and clears the guard before calculating
and adding that invocation's two-pixel descent (`896A..89C1`; it begins set to
`FFh` at `87AD`). A player invocation beginning at y=`1Eh` therefore advances
to `20h` without opening the guard; the next player invocation can open it.
An enemy moves only when its own later `A917` invocation observes the cleared
byte. The relative actor-slot order within that same scheduler pass was not
established here, so this ledger makes no stronger same-interrupt ordering
claim. Native enemies nevertheless do not begin their y=`-1` entrance from
the first round tick.

**Verified.** Once that gate is open, `A91F..A94F` computes
`targetY - currentY`, clamps the unsigned positive delta to one screen pixel
(`A92D..A936`), then shifts the clamped amount left five bits before the
`DS:[0132h + index]` lookup (`A936..A93C`). For the one-pixel case that is the
table slot corresponding to code `10h`, not speed code 1. It extracts the
integer pixel component after adding `80h` and returns for that invocation
(`A93C..A94F`); it does not schedule activation on the movement invocation
that reaches target y. `0775..07A5` populates the signed 8.8 table. The full
display-rate setup feeding this table is outside this bounded audit.

**Verified.** At target y, `A950..A973` decrements the entrance count and,
only after `DS:4D67` is zero, replaces the procedure with `A974`. It computes
the deadline as `u16(generalTick + floor(delay * 5 / 2))`, where
`generalTick` is `DS:011E` and delay is the retained descriptor byte-2 low
six bits (`A95B..A96D`). `4D67` starts nonzero (`87B2`) and the player
ready routine clears it after its `3Ch` counter (`89F7..8A08`).

### Deadline and initializer

**Verified.** `A974..A985` uses an *unsigned* 16-bit comparison:
`mov ax,[011E]; cmp ax,[bx+0514]; jb A985`. It activates when
`u16(generalTick) >= u16(deadline)`. It is not a signed, wrap-safe elapsed-time
comparison. On success it merely installs the selected archetype initializer
from `[bx+0518]`; it does not execute that initializer in the same invocation.

**Verified.** Zen-Chan initializer `D1C5..D203` is a distinct no-motion tick:
it writes the walking counter `4` to `[bx+0514]`, installs walking procedure
`D204` at `[bx+0512]`, writes `FFFFh` at `[bx+050E]`, derives signed speed
code `+10h` or `-10h` from heading bit 0 and stores the converted 8.8 x
velocity at `[di+1052]`, then selects its initial facing sprite (`45h` or
`49h`). It returns without calling the movement routine.

**Partial.** `D204..D26F` is confirmed as the next Zen-Chan walking procedure:
it runs the shared guards/probes, decrements the four-frame counter, applies
the walking animation, tests horizontal movement/collision, reverses x velocity
and heading on collision, then invokes the actor update. This audit does not
yet assign complete semantic names to every shared call or prove all
jump/reversal branches.

### TypeScript comparison and bounded recommendation

The native sequence is:

`entering (guarded) -> entering (rise) -> waiting/target -> deadline procedure
-> activating initializer -> walking procedure`.

The bounded implementation mapping is:

1. Native levels preserve `entering` at y=`-1` until an internal latch opens
   when the engine's ready-step begins with player y at least `20h`. The latch
   remains open for that round and resets on level load/restart. This maps the
   directly verified current-y player guard; exact native actor-slot order in
   the guard-opening scheduler pass remains unproven.
2. Native levels compare deadline as raw unsigned 16-bit values (`now >=
   deadline` after both are masked to `FFFFh`), matching `A974`. Custom levels
   retain their prior signed elapsed-time behavior for compatibility.
3. Preserve Zen-Chan's initializer as an internal one-tick pending state after
   public activation: set its direction-derived code-`10h` x speed without a
   position change, then let walking run on the following tick. The native
   walking counter and sprite write have no engine representation and must not
   become unused simulation fields. The engine's 60 px/s representation is one
   pixel per 60 Hz tick, consistent with the code-`10h` conversion at the
   documented 60 Hz baseline, but remains an implementation mapping rather
   than a substitute for the native initializer.

**Implementation status (2026-09-20).** All three bounded items are implemented
for native levels only. Tests cover the first entrance tick, persistent latch,
restart and next-round reset, raw delays 0/1/63 via their decoded
`floor(delay * 5 / 2)` tick values, a wrapped unsigned deadline, and 60 Hz
versus split 120 Hz cadence. `engine.ts` keeps public enemy-state compatibility
and uses an internal Zen-Chan pending-init flag. Its deterministic tests also
cover both heading directions, no displacement during the init tick, movement
on the following tick, and legacy/custom immediate walking. Capture,
pop/defeat, and release clear the pending flag; a native activation-tick capture
regression verifies that trapped and subsequently released Zen-Chan cannot
replay a stale initializer.

Required deterministic tests for that change:

- a descriptor enemy remains at y=`-1` while the `4D65`-equivalent player
  entrance guard is active, then starts only after the y=`20h` opening;
- reaching target y consumes its movement invocation and schedules
  `floor(delay * 5 / 2)` only after the ready gate; delays 0, 1, and 63 are
  covered;
- a synthetic tick near wrap (for example now `FFF0h`, delay 10, deadline
  `0009h`) activates immediately under the native unsigned comparator; a
  normal non-wrapping deadline remains waiting until equality;
- after a successful deadline comparison Zen-Chan has one init tick with no
  x/y displacement, then walks on the subsequent tick with code-`10h`
  direction and initialized counter;
- a split `1/120 + 1/120` update trace matches one `1/60` update across each
  of the above transitions.

## Other parity domains

| Domain | Status | Ledger boundary |
| --- | --- | --- |
| Campaign terrain, descriptor decoding, airflow/collision patches | partial | Existing transcriptions are documented in `DOS-REFERENCE.md`; this audit only rechecked the enemy loader fields used above. |
| Player entrance, movement, bubbles, contacts | partial | Player entrance guards supplied the activation evidence; no full player state machine was traced here. |
| Zen-Chan gravity, jump selection, ascent/descent, contact, reversal | partial | `D204` entry and its calls were identified, but shared routines/branch outcomes were not fully traced. |
| Other seven enemy machines and projectiles | unknown | Dispatch locations are known; no behavior claims made in this audit. |
| Fruit, special items, bonus scoring, terminal/round rules | unknown | Not investigated. |
| Two-player rules, sprites, sound and presentation | unknown | Not investigated. |
| Living-layer persistence and hydration | partial | Outside this DOS-code trace; retain its separate integration evidence. |
