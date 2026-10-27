# New pictures for a name — the badge

A tile's pictures are a pool by **name**: `sign(name)`, asked of every known host
(`peer-images.ts` → `meaningPoolImageCandidates`). When a domain reports a picture
for a name that *this participant* has not been shown, the tile wears a small mint
badge. Pressing it opens the images wall with the new pictures ringed; the
participant takes one, or dismisses, and the badge clears.

```
hypercomb-essentials/src/sharing/image-updates.ts                    ← offered + seen, by name
hypercomb-essentials/src/presentation/tiles/image-update-badge.drone.ts  ← the badge and its press
hypercomb-essentials/src/sharing/image-choice.drone.ts               ← the wall: rings what is new, answers on take / Esc
hypercomb-essentials/src/sharing/tile-images.drone.ts                ← the images icon, same offered cache
```

## One answer per name

Every cache is keyed by the **name alone**, never the path. The pool is one pool
wherever the tile sits, so "howard" in two places in the hierarchy raises one
badge and is answered once.

## The seen record is private

`image:seen` is a pool in the participant's own store — one member per name,
keyed by the **signature of the name**, listing only picture signatures:

```json
{ "kind": "image:seen", "v": 1, "label": "howard", "seen": ["<previewSig>", …], "at": 1730000000000 }
```

It is never published, never counted and never sent: its only job is to let a
badge appear once and go away when answered. Replaced in place
(`keep: 'current'`), so it does not accumulate.

## First sight is a baseline

A name the participant has never been shown pictures for records everything on
offer *right now* as seen, so only pictures that arrive **later** raise a badge.
Turning the feature on does not light every tile in the hive.

## Answering

- **Take a picture** — the wall applies it (one revision, undoable) and marks every
  picture on the wall seen.
- **Esc, or an empty press** — dismisses: everything shown is marked seen.
- Leaving by navigating away, or the window losing focus, is *not* an answer; the
  badge stays.

## Cost

The badge looks at every visible tile, so it asks rarely (a name is re-asked after
five minutes) and never more than four hosts-queries in flight; the hover icon asks
for one tile and may ask after 45 seconds. Nothing here fetches picture bytes.
