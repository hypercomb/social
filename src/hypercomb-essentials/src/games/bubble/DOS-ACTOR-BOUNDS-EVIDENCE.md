# DOS actor bounds evidence

Status legend: **verified** is static decoding of the inert reference image;
**unavailable** marks data that is runtime-populated or external rather than
inventing an adapter.  No DOS executable, renderer, or resource loader ran.

## Source and address rule

- **Verified:** source is
  `C:\Users\Jaime\AppData\Local\Temp\hc-bubble-zenchan-e4e35e932198405a953a846be684d7c5\image.bin`,
  SHA-256 `c0ab3aec0519cfbf22cee3fc3e3c6642e5a270f6fa8e68726dd172b9cecb0771`
  (131856 bytes).  Direct near targets are interpreted as 16-bit wrapped CS
  offsets.

## Bounds builder and overlap rule

- **Verified — `1B0C..1B5B`:** for an actor at `DI`, the builder writes the
  inclusive rectangle `[1092,1094,1096,1098]`.  It calculates
  `1096 = 1092 + byte[1087] - 1` and
  `1098 = 1094 + byte[1088] - 1`.  It also derives display/source pointers
  from the animation stream, but those pointer writes are not bounds sizes.
- **Verified — `1B85..1BB1`:** overlap compares those two inclusive rectangles
  with signed `jl`/`jg` separation tests.  Equality at an edge is therefore
  an overlap (CF set); only strict separation returns CF clear.
- **Verified — ordinary item collection uses these rectangles:** `BDC0..BDE8`
  passes `lea AX,[DI+1092]` for the item and `DX=[4C5A]` for the first player
  rectangle to `1B85`; it retries against `[4CAE]` for the paired participant.
  Thus descriptor dimensions govern collectible/player contact rather than an
  assumed fixed `16x16` box.

## Descriptor dimension source

- **Verified — `196B..198A`:** sprite ID is clamped to `16Eh`, converted to
  `4*(id-1)`, then reads the far stream pointer from runtime table entries
  `DS:[0A8A+index]` and `DS:[0A8C+index]` before calling the descriptor reader.
- **Verified — `78DE..7914`:** for the selected `ES:SI` four-byte descriptor,
  byte 1 becomes `[DI+1087]`; byte 0 becomes `[DI+1086]`; and byte 0 (minus
  one when descriptor byte 3 is not `8`) times eight becomes `[DI+1088]`.
  `1B0C` then uses `1087` and `1088` exactly as the two rectangle dimensions.
- **Verified pointer locations for requested ordinary item IDs:** IDs
  `12,10,11,14,46,47,50` use table byte indexes
  `2C,24,28,34,114,118,124`, respectively, from both bases `0A8A` and `0A8C`.
  The player likewise uses this ID-to-table route, but the player animation ID
  is state-dependent and was not specified by this bounded audit.

## Data boundary and consequence

- **Unavailable numeric sizes:** the inert image does not include initialized
  values for the `0A8A/0A8C` far-pointer table.  Its static resource manifest
  names `B:SPRITES.CCF`, `B:SPRITES.TCF`, and `A:SPRITES.ECF`; the actual
  selected stream/table population was not decoded in this bounded pass.
  Therefore numeric width/height for the listed item IDs and any player frame
  cannot be claimed from the code image alone.
- **Verified fruit-coordinate limit:** `BC41..BC6A` installs the ordinary
  collectible handler without a demonstrated visual-coordinate conversion, and
  `BDC0` consumes actor source coordinates directly.  This evidence does not
  prove the browser renderer's `enemy.y + 16` conversion, nor does it prove a
  universal 16-pixel item/player size.
- **Implementation boundary:** keep the existing presentation-size adapter
  explicitly provisional.  A geometry change requires a separate static
  decode of the runtime-populated sprite descriptor stream and an identified
  player animation ID, not a guessed change to item placement or pickup boxes.
