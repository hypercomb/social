# 🔧 Byte Protocol — 1-byte navigation

hypercomb movement is encoded in a **single byte per step**. this keeps it fast on any device and easy to reason about.

---

## tl;dr

- one byte carries direction, intent, and flow control  
- invalid values are ignored gracefully  
- ui renders hints (pheromones) but never stores ratings

---

## layout

bits: 7 6 | 5 4 | 3 | 2 1 0
m m | p p | d | n n n

markdown
Copy code

| field | bits | meaning |
|------|------|---------|
| `nnn` | 0–2 | neighbor within the hex layer (0–5) |
| `d`   | 3   | direction (0 = backward, 1 = forward) |
| `pp`  | 4–5 | pheromone intent (00 neutral, 01 beacon, 10 avoid, 11 priority) |
| `mm`  | 6–7 | flow mode (00 end, 01 continue, 10 branch, 11 reserved) |

notes:
- neighbors are 0..5 (six edges around a hex). values 6–7 are invalid and should be dropped.
- `end` signals a hard stop at the current node.
- `continue` advances normally to the next step.
- `branch` offers a fork; clients may present a small choice ui.
- `reserved` is for future use; treat as `continue` today.

---

## semantics

- **neighbor (`nnn`)**: relative move within the current hex layer; engines resolve absolute coordinates internally.
- **direction (`d`)**: `forward` moves outward on the path; `backward` retraces (used for return-home/undo stacks).
- **pheromone (`pp`)**: ephemeral social hint for traversal/visuals:
  - `neutral`: just traveling
  - `beacon`: meaningful / worth attention
  - `avoid`: caution / de-prioritize
  - `priority`: deeply valuable / boost attention
- **mode (`mm`)**:
  - `end`: terminate playback immediately
  - `continue`: proceed as normal
  - `branch`: signal a fork; next chosen child still emits normal `continue` steps
  - `reserved`: ignore differences and treat as `continue`

---

## encoding helpers (typescript)

```ts
// pack fields into a single byte
export const packByte = (nnn: number, d: 0|1, pp: 0|1|2|3, mm: 0|1|2|3): number => {
  // validation: neighbors 0..5 only
  if (nnn < 0 || nnn > 5) throw new Error('invalid neighbor');
  return ((mm & 0b11) << 6) | ((pp & 0b11) << 4) | ((d & 0b1) << 3) | (nnn & 0b111);
};

// unpack a single byte into fields
export const unpackByte = (b: number) => ({
  mm:  (b >> 6) & 0b11,
  pp:  (b >> 4) & 0b11,
  d:   (b >> 3) & 0b1,
  nnn:  b       & 0b111
});
comments:

keep comments lowercase to match project style.

ui should silently drop bytes with invalid neighbors (6..7).

examples
continue + forward → neighbor 2, neutral

mm=01 pp=00 d=1 nnn=010 → binary 0100 1010 → hex 0x4a

branch + forward → neighbor 5, beacon

mm=10 pp=01 d=1 nnn=101 → binary 1001 1101 → hex 0x9d

end + backward → neighbor 0, avoid

mm=00 pp=10 d=0 nnn=000 → binary 0010 0000 → hex 0x20

rendering guidance (ui)
neutral: minimal accent

beacon: soft highlight / glow

avoid: desaturate / caution outline

priority: stronger highlight (tasteful; avoid gamified scoring)

pheromones are hints, not ratings.

error handling
unknown mm=11: treat as continue.

invalid neighbors 6..7: drop the step.

repeated identical steps with dt≈0: debounce to avoid jitter spirals.

compatibility & versioning
this document defines v1 behavior. future expansion should bump the transport version (see session/transport docs) while keeping the 1-byte payload stable to preserve minimalism.

related
live security (nonce): session nonce

local memory: meadow log

optional publishing: dna