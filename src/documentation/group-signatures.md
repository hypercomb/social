# Group Signatures

**Group identity as a first-class citizen.** A group is any set of things that
were made together and must therefore be added and deleted together: a
tutorial course's lessons, a collection's members, an island of launcher tiles,
the tiles a mirror script mints.

Before this, every consumer invented its own grouping token — `'g0'`, a parent
name, a run of render order. None of them could answer *"what else belongs to
this?"*, and a group could only be removed by walking the code that made it.

## The primitive

`hypercomb-core/src/core/group-signature.ts`

```ts
const sig = await groupSignature('tutorial:course:beginner')
// sig === sha256('group:tutorial:course:beginner')
```

A group is named by a **meaning**; its identity is `sign('group:<meaning>')` —
the same content-addressed primitive everything else uses. Two hives that mint
the same meaning agree on the group without exchanging a message.

The `group:` prefix is load-bearing. Pool addresses and lineage sigbags share
the flat OPFS root namespace, and `lineageKey` folds every non-letter/number to
`-`, so a preimage carrying a colon can never be produced by a location (see
`known-location-pools.md`). A group signature is therefore collision-proof
against both bags and pools by construction. **Meanings should themselves be
scoped** (`tutorial:course:beginner`, `help:tier:basics`) so two features cannot
mint the same group by accident.

Signatures are permanent: `sign()` of a new spelling is a different group
forever. Renaming a group's meaning is a data migration, never a rename.

## How members carry it

| Carrier | Where the signature goes |
|---|---|
| A tile | a `group` decoration: `{ kind: 'group', appliesTo: [], payload: { sig, meaning } }` |
| A launcher member | `GroupMember.groupSig`, written into its `launch:target` decoration payload |
| A provenance record | the record's `groupSig` + `groupMeaning` fields |

Membership is therefore **data**, readable by anyone holding the signature, and
add / delete are set operations over the mark — not a function that happens to
remember what it created.

`group` is a decoration like any other, so a group mark commits as one layer,
undoes like anything else, and travels when the tile is shared or adopted.

## Not to be confused with

- **`GroupMember.group`** — a layout ordinal (`'g0'`, `'g1'`) the renderer sorts
  islands by. It encodes ORDER. `groupSig` encodes IDENTITY and never order;
  the two are deliberately separate fields.
- **Pheromones** — a mark says what a tile *is*, and anything wearing it belongs
  together *wherever it lives and whenever it was made*. A group signature says
  these specific things were made together as one unit. A tile usually carries
  both: its pheromones for meaning, its group signature for provenance.

## Who uses it today

- **Tutorial courses** (`tutorial-lesson.ts`): `tutorial:course:<level>`. Every
  artifact a run mints is stamped with its course's signature, and the hive
  mirror paints the same signature on every tile of that course — the runtime
  and the mirror agree because they derive from the same preimage.
- **Help islands** (`help-group.ts`): `help:island:reference`,
  `help:island:tours`, `help:tier:<name>`, `help:island:more`.

## Adding a group

1. Choose a scoped meaning with a colon.
2. Derive `groupSignature(meaning)` — never hardcode the hex.
3. Write the signature onto every member as it is created.
4. To remove the group, remove what wears the signature. There is no list.
