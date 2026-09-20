# NovaLogic DOS reference

The campaign data in this directory was reconstructed from the supplied 1989
NovaLogic/Taito MS-DOS release. Windows never launched either DOS program, and
no original executable, machine code, compressed container, or installer is
included in Hypercomb. Analysis used static byte inspection, format decoding,
and disassembly only.

## Safety and identity

- Microsoft Defender, signatures `1.459.239.0` dated 2026-09-16, completed a
  custom scan of the supplied directory with no detection.
- `BUBBOB.DAT` SHA-256 is
  `665bb4b164d710cbfb77c58b97e7b7958668df45b2b1501b2d5af2fa0ce81e64`.
  It matches the independently preserved archive copy byte-for-byte.
- `BUBBLE.EXE` SHA-256 is
  `95b6f7e31e357c269b70b71eb237550fb588c5c570eba1b5223bc15cf6d160a6`.
  Against the archive copy, only MZ-header byte `0x0b` differs (`02` versus
  `00`). That changes the minimum-memory request, not an instruction.
- All primary resource containers match the preserved set. Two graphics files
  differ only inside one 512-byte region; neither is executable and neither is
  copied into Hypercomb.

Those checks are strong evidence that this is the expected historical release,
not proof that native execution is risk-free. Keep the DOS folder as untrusted
reference material. If runtime observation is eventually necessary, use a
disposable, offline virtual machine rather than the Windows host.

## Compression

Each `.CF` resource starts with a little-endian paragraph allocation followed
by a 9-to-12-bit, least-significant-bit-first LZW stream. Codes 256 and 257 are
reset and end markers. `BDATA.CF` declares `0x0300` paragraphs and expands to
12,288 bytes.

The packed program image was recovered with a purpose-built EXEPACK decoder.
The decoder treated the file as inert bytes: it did not transfer control to the
program or expose a DOS, filesystem, process, network, or firmware interface.
The resulting image, SHA-256
`c0ab3aec0519cfbf22cee3fc3e3c6642e5a270f6fa8e68726dd172b9cecb0771`,
was used only for disassembly in the operating-system temporary directory.

## Terrain and native cell model

The executable indexes `BDATA.CF` as `round * 0x64`. The first 10,000 decoded
bytes are therefore exactly 100 campaign records of 100 bytes. Each record is
25 big-endian 32-bit rows.

The row expander at unpacked offsets `24CC..2536` produces 32 cells and advances
through a 40-column work area. For each source row:

- bits 31..2 are the 30 interior occupancy bits;
- bits 1..0 become two airflow bits on every cell in that row;
- output cells 0 and 1 are overwritten with value 3;
- output cells 30 and 31 are overwritten with value 7;
- scratch cell 32 receives the row airflow bits with no occupancy;
- seven more work/scratch columns follow the 32-cell cave.

Thus cell bit 0 is occupancy and bits 1-2 are airflow. `dos-level-data.ts`
contains the exact 100 records. `levels.ts` recreates the cell expander rather
than interpreting the data as a generic tile map.

## Airflow and collision patches

`AIRFLOW.CF` expands to 1,792 bytes. Its first three 100-byte arrays are loaded
for the selected round into native variables `42A4..42A6`. Starting at byte
300, it contains 100 length-prefixed command records; a high-bit single-byte
record aliases an earlier round.

A three-byte airflow command packs:

- x in byte 0 bits 0..4;
- airflow in byte 0 bits 5..6;
- y in byte 1 bits 3..7;
- width-minus-one across byte 1 bits 0..2 and byte 2 bits 6..7;
- height-minus-one in byte 2 bits 0..4.

The command paints bits 1-2 while preserving occupancy. A one-byte command
mirrors the first 32 columns' airflow, reversing its horizontal component while
preserving the destination terrain.

`AIRBLOCK.CF` uses the same rectangle packing. High-bit commands paint airflow;
other commands paint or clear occupancy from byte 0 bit 5. `dos-air-data.ts`
transcribes all 200 decoded command records and the three setting arrays.
`levels.ts` applies them in the same order as native offsets `2342..23CF`.

## Enemy descriptors

The 100 terrain records are followed at `BDATA.CF` byte `0x2710` by 100 enemy
lists. Each list contains three-byte records and a zero terminator. The native
consumer at unpacked offset `A81F` decodes them as follows:

- archetype: byte 0 bits 0..2;
- screen x: `(byte0 & 0xF8) + 40`;
- screen y: `byte1 & 0xF8`, then minus 8 when nonzero;
- delay: byte 2 bits 0..5;
- heading code: rotate-left-two of little-endian `(byte1, byte2)`, take five
  bits, then XOR 1;
- byte 2 bit 6 is retained as a descriptor `variant`; static inspection shows
  it is masked from the behavior-table selection, while its later role remains
  unproven. Byte 2 bit 7 participates in the heading code but not that table
  selection.

Enemies enter from native y=-1 toward the decoded target y. Once the target is
reached, the loader schedules the selected behavior after
`floor(delay * 5 / 2)` general ticks.

The dispatch order is Zen-Chan, Hidegonsu, Banebou, Pulpul, Monsta, Drunk,
Mighta, and Invader. The first appearances are rounds 1, 41, 31, 21, 11, 51,
7, and 61 respectively. `dos-enemy-data.ts` contains all 575 native records.

Round 1, for example, contains three Zen-Chans at x=160/y=0 with delay values
10, 17, and 24. This replaces the earlier procedural placement.

## Screen and timing architecture

Native actor collision subtracts 40 from screen x before converting it to an
8-pixel grid column. The logical framebuffer is 320x200, while the 32x25 cave
occupies x=40..295 and y=0..199. Hypercomb now retains that coordinate system;
it no longer stretches the cave itself into a 256x224 arcade raster.

Offsets `2537..25E6` extend the cave across its vertical wrap seam, compact the
40-column work rows into the native 33-column collision surface, and build the
`0x3C0` neighborhood-mask bytes used by actors. `dos-mechanics.ts` reproduces
that transformation and the four directional predicates at `1FA4..2023`.
Native actors advance their signed 8.8 x/y values first, query the same six-cell
contact word, and use the original eight-pixel snap rule on impact. The two
native guard rows account for the 16-pixel offset between collision and visible
coordinates.

The timer interrupt increments the general tick at data offset `011E` through
a fixed-point divider targeting PIT divisor `0x4DAE`, approximately 60 Hz. The
main scheduler separately counts measured display interrupts and presents after
two interrupts while catching gameplay work up by at most six ticks.

The TypeScript engine uses a 60 Hz accumulator and advances gameplay only in
whole native ticks. The native speed conversion at unpacked offset `0775`
computes `ceil(abs(code) * 16 * 60 / displayHz)` in 8.8 fixed-point units and
then restores the sign. At 60 Hz, speed code `0x10` is one pixel per tick.

The native pseudo-random generator at unpacked offset `12DF` shifts a 16-bit
state right and XORs `0xB400` when the shifted-out bit is set, returning the
new state minus one. Hypercomb uses the game's deterministic seed `0xABCD` and
the same repeated-parity tests for power-of-two probability gates.

## Player, enemies, and bubbles

Every DOS round starts the player at x=`0x38` (56). The entrance descends from
y=0 to y=`0xB0` (176) at two pixels per tick, followed by a `0x3C`-tick ready
wait. Normal ground movement uses speed code `0x10`. The reconstructed jump
pair is -720/+24 in 8.8 units per native tick; bouncing on a bubble substitutes
-416/+18. A hit schedules the native `0xB4`-tick respawn delay.

Ground reversal consumes its own tick, and installing the jump state consumes
the input tick before the first accelerated movement pass. The firing input is
gated by the original `0x1F`-tick state counter. Contact with an untrapped
floating bubble enters the moving-support state at `8BD6`: the player copies
the bubble-relative position until jumping away, again with movement beginning
on the following tick. A held jump while descending instead installs the
-416/+18 bubble-bounce state. Unlike the transitional browser mechanic, this
path has no impact-strength or bubble-age pop threshold. Contact with a trapped
bubble calls the captured archetype's defeat callback immediately.

The TypeScript engine distinguishes the eight descriptor kinds and implements
selected reconstructed movement, shot, heading, entrance, activation-delay and
probability behavior. Direct static evidence currently establishes Zen-Chan's
loader/entrance/activation initializer and selected shared movement constants;
the remaining per-archetype handlers and deeper branches are partial rather
than a claim of eight complete native state machines. The common high-jump gate
includes its four-tick `AA4A` windup and its move-before-acceleration rising
step; the `AAF6` open-gap probe installs the separate small-hop state. The
horizontal enemy-shot paths use the native 16x16 directional collision masks;
Invader's falling shot ignores terrain and expires at y=`0xD8`. See
`DOS-EVIDENCE.md` for the bounded Zen-Chan evidence ledger.

A fired bubble uses speed code `0x30`, the native 16x16 directional collision
masks, and a travel budget of `0x50`, becoming a floating bubble on exhaustion
or terrain contact. Empty bubbles live `0x1FE` ticks and captured bubbles
`0x23F` ticks. The native empty-bubble list holds `0x12` floating entries;
adding another schedules the oldest for expiry. While floating, the current
native cell's airflow bits move the bubble up, right, down, or left at speed
code 8. Expired captured enemies return angry.

Consecutive pops fewer than ten ticks apart use the native item/points chain:
500, 1,000, 2,000, 4,000, 8,000, 16,000, 6,000, and 6,000 points. A defeated
enemy launches at horizontal speed +120 or -120 and vertical speed -120, wraps
vertically, and reflects at x=`0x38`/`0x108`. For the normal-pop path, its first
eligible unsigned deadline at `popTick + 0x3C` moves first, then reverses y and
stores a new `+0x41` deadline; only the next eligible deadline that leaves y
negative enters `BC41` collectible conversion. The static trace does not yet
prove actor-call cadence, so it does not support an exact elapsed-tick claim.
See `DOS-FRUIT-EVIDENCE.md` for the bounded transition evidence.

For native-cell levels, the normal `CL=1` item route now uses a bounded
ordinary-item state machine: raw `1E63`/`1D24` occupancy footprints, the
selector-1 `0x258` work-clock duration, pickup-before-expiry, six-work-tick
expiry display steps, and one score credit. Its general and work clocks remain
explicitly separate even though the browser adapter advances each once per
fixed-60 step. This is not a claim of native interrupt/batch timing, special
item behavior, or every `BC41` entry. Legacy custom-level fruit keeps the
pre-existing generic motion and expiry behavior.

For an ordinary native round clear, setup stores `0x258` in the traced
`DS:0018` counter. A separate active control actor decrements it once per
reached callback only while the tracked `DS:4D64` enemy count is zero; an
addition pauses rather than resets the count. The browser models this as one
eligible fixed-60 adaptation pass per step, keeping entering/trapped actors
counted and removing a popped defeated actor. It preserves legacy custom
three-second clear behavior. This does not prove DOS actor-slot timing,
alternate clear routes, or a final-round ending: the browser's `won` state is
still an explicitly transitional terminal adaptation.

## Current parity boundary

### Shared high-jump wind-up audit

Static reinspection uses the 131856-byte unpacked image, SHA-256
`c0ab3aec0519cfbf22cee3fc3e3c6642e5a270f6fa8e68726dd172b9cecb0771`.
Offsets below are unpacked CS offsets, not offsets into packed `BUBBOB.DAT`.
The scratch helper that slices the packed file at `0x200` is not a valid
source for these disassemblies.

`AA30` installs `AA4A`; `AA36` loads a four-call counter. After the common
contact/status guard (`AA4E..AA51`), `AA53..AA69` selects the opposite-facing
sprite and XORs facing bit 0 at `AA64`. `AA6F` decrements the counter. On the
fourth call, `AA75..AA84` installs ascent `AA89` and loads the jump impulse;
the position does not change until the following call. Thus uninterrupted
wind-up flips facing four times and finishes in the original direction.

The shared TypeScript wind-up now preserves these facing transitions for
walkers and Banebou. Regression tests cover both initial directions for all
five high-jumping kinds, every 60 Hz transition, no change on the intervening
half-ticks, and delayed first ascent. This audits the wind-up, not the entire
common contact/status guard or every archetype's selection logic.

The exact campaign geometry, patched cell bytes, airflow settings, screen
coordinates, enemy roster, placements, encoded spawn metadata, fixed-60
adaptation, deterministic RNG, entrance timing, principal movement constants, bubble phases,
deterministic RNG, entrance timing, principal movement constants, bubble phases,
directional collision masks and predicates, player turn/jump/fire states,
floating-bubble support/bounce/direct trapped pop, airflow motion, lifetimes and
empty-list cap, projectile masks, common enemy high/small-hop states,
flying-enemy reflection, horizontal-shot masks, Invader drop cutoff, pop-score
chain, timed defeat flight, bounded ordinary native items, and native
Mighta/Hidegonsu/Drunk first-cycle launch speeds are now in TypeScript and
covered by tests.
On first entry each round becomes a native Hypercomb layer with 800 child cell
layers; reopening reads current authored cell heads, and the engine waits
rather than advancing into an unhydrated round.

This is not yet a cycle-exact rewrite of every DOS routine. The deeper
per-archetype AI and projectile branches, some dynamic bubble/contact edge
cases, collectible motion/collection beyond the defeat transition,
simultaneous two-player rules, special items, bonus scoring, audio, and
presentation still contain transitional or browser-native behavior. The
renderer uses the pinned GPL sprite sheets described in `UPSTREAM.md`, not
graphics extracted from the supplied DOS files.
