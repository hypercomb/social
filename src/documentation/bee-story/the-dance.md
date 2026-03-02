# the dance

when a forager bee finds nectar, she returns to the hive and dances. the waggle dance encodes everything the colony needs to know in the smallest possible signal: direction relative to the sun, distance by duration of the waggle run, and quality by the vigor of the dance. no words. no coordinates. no maps. one dance, one message, and the colony mobilizes.

hypercomb's byte protocol is a waggle dance compressed into eight bits.

---

## one byte

```
bits:  7 6 | 5 4 | 3 | 2 1 0
       m m | p p | d | n n n
```

| field | bits | what it encodes |
|-------|------|-----------------|
| nnn   | 0-2  | which neighbor (0-5, six hex edges) |
| d     | 3    | direction — forward (exploring) or backward (retracing) |
| pp    | 4-5  | pheromone — the scent left behind |
| mm    | 6-7  | mode — continue, end, branch, or reserved |

that is the entire protocol. one byte per step. a forager bee compresses sun-angle and distance into a body movement. a hypercomb drone compresses neighbor, direction, intent, and flow control into eight bits.

---

## the neighbors

a hex cell has exactly six neighbors. the nnn bits select which one:

| nnn | direction | axial delta (q, r, s) |
|-----|-----------|----------------------|
| 0   | northeast | (+1, -1, 0) |
| 1   | east      | (+1, 0, -1) |
| 2   | southeast | (0, +1, -1) |
| 3   | southwest | (-1, +1, 0) |
| 4   | west      | (-1, 0, +1) |
| 5   | northwest | (0, -1, +1) |

values 6 and 7 are invalid. a bee cannot fly to a seventh neighbor that does not exist. the step is silently dropped.

---

## the scent

the pheromone bits (pp) encode what the waggle dance's vigor encodes in real life — quality and intent:

| pp | scent    | meaning |
|----|----------|---------|
| 00 | neutral  | just traveling |
| 01 | beacon   | something worth attention here |
| 10 | avoid    | caution — proceed with care |
| 11 | priority | deeply valuable — the richest nectar |

these are hints, not ratings. a bee's waggle dance does not assign a score to a flower. it says *this is worth visiting.* pheromones are the same — ephemeral suggestions that fade when the session ends.

---

## the flow

the mode bits (mm) control what happens next:

| mm | mode     | what it means |
|----|----------|---------------|
| 00 | end      | stop here. the path is complete. |
| 01 | continue | keep going. next step follows. |
| 10 | branch   | a fork. the colony may split attention. |
| 11 | reserved | treat as continue for now. |

a waggle dance has a clear start and end. it may loop (continue) or describe multiple food sources (branch). the mode bits give the same expressiveness.

---

## encoding

```ts
export const packByte = (
  nnn: number, d: 0|1, pp: 0|1|2|3, mm: 0|1|2|3
): number => {
  if (nnn < 0 || nnn > 5) throw new Error('invalid neighbor');
  return ((mm & 0b11) << 6)
       | ((pp & 0b11) << 4)
       | ((d  & 0b1)  << 3)
       | (nnn & 0b111);
};

export const unpackByte = (b: number) => ({
  mm:  (b >> 6) & 0b11,
  pp:  (b >> 4) & 0b11,
  d:   (b >> 3) & 0b1,
  nnn:  b       & 0b111,
});
```

---

## why one byte

a waggle dance lasts seconds. it uses the bee's entire body. and yet it transmits enough information for dozens of foragers to find a flower patch kilometers away.

the byte protocol achieves the same compression. one byte is small enough to send thousands per second over any connection. it is small enough to store a complete path in a few hundred bytes. it is small enough that any device, any network, any bandwidth can carry it.

minimalism is not a constraint. it is the design.

---

*a bee dances. the colony understands. no words were needed.*
