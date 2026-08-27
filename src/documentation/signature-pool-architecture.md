# Signature pools and canonical portal roots

Status: implemented standard, 2026-08-25.

## The invariant

A fixed **identity name** identifies one canonical root lineage:

```text
people  ->  /people  ->  sign(lineageKey(['people']))
```

How the item was discovered is provenance, not identity. An item found at
`/research/contacts/people`, adopted from a swarm, loaded from a package, or
selected from a Portal is promoted to the same `/people` root. New references
never retain the discovery route.

The identity name is the raw lineage address/pool key. It is not necessarily
the text painted on the tile. Edit mode's name field writes a localized
`title` decoration; one participant may therefore see `/people` as “People”,
another as “Collaborators”, and a Japanese reader as “人々”. They still share
the single `people` identity pool and stack by that fixed key. Editing display
text never moves a lineage, renames a bag, splits a pool, or rewrites a peer.

Every lineage appearance is therefore a leaf pointing to the matching root.
The leaf also pins the complete top-level details selected when it was added:

```text
/people                 canonical pool + current default
/sets/people            reference -> /people + selected detail signatures
/project-a/people       reference -> /people + selected detail signatures
/project-b/people       reference -> /people + selected detail signatures
```

All three leaves resolve the same root **pool address**. They need not select
the same atomic meaning. The participant's root head is the default used to
seed a future activation; it is not a live style object that repaints existing
leaves. Detail slots are copied by immutable content signature, never by
duplicating resource bytes. There is no second pool minted from a discovery
route.

## Identity, variants, resources, and appearances are different axes

The fixed name answers **which pool?** It does not force every contributor,
lineage, or historical revision to have identical content:

```text
/<name> hybrid signature bag
  00000000, 00000001, ...       participant history; max = chosen head
  canonical:variant(layer A)    immutable candidate meaning
  canonical:variant(layer B)    immutable candidate meaning
  canonical:variant(layer C)    immutable candidate meaning

/project-a/<name>               root reference + pinned variant details
/project-b/<name>               root reference + pinned variant details
```

Each `canonical:variant` record names one immutable layer signature and carries
that signature in `refs`, so ordinary merkle closure/sharing can move the whole
candidate. The record itself is a signature-named additive member of the hybrid
root bag. Identical content found through several routes dedupes to one atomic
member; genuinely different content survives beside it. Discovery lineage is
provenance, never identity.

The layer signature is deliberately the unit—not an image signature and not a
selected subset of fields. Two variants under one identity may differ in every
property and slot: image, index, background, border, tags, links, display-title
decorations, notes, files, children, behaviors, and future content. The live
swarm carries a sanitized property/title projection for immediate rendering;
`layerSig` remains the complete atomic candidate and merkle-closure handle.

This is the precise reading of **Pool of Meaning**:

- fixed identity name = one pool address (never the editable display title);
- layer signature = one atomic candidate meaning;
- max history marker = this participant's current choice/default;
- resource signatures = immutable bytes used by candidates;
- lineage leaf = an activation/reference into the pool plus its selected
  detail signatures;
- requirements/pheromones = which meanings are relevant in that appearance.

“Existing root wins” therefore means **do not silently replace the chosen
head**. It never means “throw away a later same-name import.” The canonical
reference service now retains both the chosen head and every later discovered
same-name layer as pool candidates.

## Root is the full complement; lineages are activation

Promoting an item does two things in one serialized layer operation:

1. Re-home its complete subtree to `/<fixed-name>` using existing content
   signatures. Resource bytes are not copied; descendants receive matching
   root lineages so later edits stay live.
2. Link that canonical item into `/`.

The hive root is consequently the complete canonical inventory. A child
reference under another lineage is an activation/appearance of an inventory
item in that scope. Portals can explore the inventory, let the participant
turn desired items on, and finish with those reference leaves committed to the
participant's chosen hive/lineage.

The active set is ordinary layer truth. It is not a parallel database or a
second pool format: a name is active in a lineage exactly when that lineage's
children contain its reference leaf. Creating that leaf snapshots the current
root detail slots (properties, decorations, notes, files, behaviors, and any
future non-structural slot) by signature. Its children stay behind the root
reference, so entering the tile still navigates the canonical lineage.

This is the anti-stomp rule: `/friends/jaime` and `/team/jaime` both belong to
the `jaime` pool, but each keeps the image and complete atomic variant selected
for that appearance. Adding or editing one can never repaint the other.

## A Portal edit chooses the participant's root default

A Portal is deliberately more than a read-only reference browser. Opening edit
mode on a Portal item resolves its canonical target **before** any details are
read. The editor therefore starts with the selected root candidate's original
properties and localized title, not with an empty reference leaf. Saving an
override writes one new, undoable revision at `/<fixed-name>` and makes that
revision the participant's default for future uses.

The original candidate is not mutated or discarded: its immutable `layerSig`
remains in the name pool and history. A new root default seeds only activations
created after that choice. Existing lineage appearances keep their pinned
details. The Portal inventory row itself remains a slim, explicitly marked
default-authoring pointer. Portal placement details remain appearance-scoped:
slot index, hide state, gate/filter requirements, and the fact that the
reference is active in that lineage never leak into the root.

This routing applies to the complete content edit surface: image, transforms,
background, border, link, hide-text state, resource attachment, format paint,
and localized display title. It applies only to the marked Portal inventory
row. Editing an ordinary activation changes that appearance; editing the
Portal row means “use this as my default next time.”

## Images and other shared resources

Images are ordinary immutable resource signatures, so the byte pool remains
singular and globally deduplicated. A name pool does not copy image bytes. It
collects candidate layers whose property records refer to those bytes.

The Image Hive follows the same address rule from every appearance:

```text
click /project-a/people
  -> resolve fixed name "people"
  -> probe the swarm's ROOT layer
  -> gather every participant variant named "people"
  -> dedupe equal image-pointer sets
  -> show the candidates with publisher provenance
  -> explicit pick writes /project-a/people's local override

click the Portal inventory row for people
  -> the same pool/candidates
  -> explicit pick writes the participant's /people root default
```

The probe is forced on the explicit gesture, so the candidate set does not
depend on whether the participant happened to visit `/` earlier. Image bytes
are fetched only for preview/selection and verified by signature. Choosing an
image is one normal, undoable root revision. Existing appearances retain their
selected image; the new root image is offered to, and seeds, later activations.
An Image Hive pick through a Portal/root surface writes that root default. A
pick through an ordinary reference writes only the clicked appearance's local
override; the reference still points at the same root and every sibling
appearance remains unchanged.

Pasting or adopting a same-identity item is **arrival, not selection**. In a
live swarm it adds the participant's local head to the existing participant
stack; every peer head, complete sanitized property projection, localized
display titles, `imageSig`, and backing `layerSig` remain independently
addressable. Rolling a stack chooses one participant's coherent variant; it
must never combine their image with somebody else's border, tags, link, title,
or other properties. The current-lineage peer projection is also unioned into
the Image Hive as a
compatibility witness while older participants migrate to canonical roots.
Nothing on paste writes another participant's head, and nothing automatically
changes an existing local root default. Only an explicit root-default gesture
does: choosing an Image Hive candidate or saving overrides from Portal edit
mode.

A lineage may need a special face because its contextual meaning differs. An
ordinary activation is already the **appearance-local selection**: it pins the
root's current detail signatures on creation, and its normal editor may replace
them locally. This must not change the root default, add a second image pool,
or mutate another lineage merely because the participant viewed through a
portal. Resolution order is:

```text
appearance selection -> root default at activation time -> no image
```

The same separation applies to notes, files, galleries, and future resources:
pool membership preserves candidates; a participant choice selects a future
default; an appearance pins or edits a selection without forking identity.

## Gates

Portals gate semantics: `requiredMarks` and `requiredBouquet` select the
relevant candidate/meaning for an appearance. Participant/entrance policy
gates authorization: who may witness, enter, import, or mutate. The effective
result requires both, but the gates stay separate and neither changes the root
pool's identity or inventory.

## Homonyms

The stable identity spelling intentionally selects one name pool while variants are plausibly
different contextual readings of the same named thing. Truly unrelated
homonyms must be disambiguated at identity/import time (a more specific fixed
identity name or an explicit namespace). Editable display labels do not choose
or merge pools: two unrelated identities may display the same text, and two
variants in one pool may display different text. A portal must resolve the
stable identity key, never guess from what happens to be painted today.

## Hiding is appearance-scoped

Hide/unhide is addressed by `(lineage, name)`, not by canonical item identity.
Hiding `/people` at the hive root changes only that root appearance. It does
not hide `/project-a/people`, and hiding the project appearance does not hide
the root. A future operation may deliberately offer a global hide, but it must
be a distinct act.

## One directory may be both bag and pool

OPFS has one flat signature namespace. For a bare word, these may be the same
address:

```text
sign('clipboard') == sign(lineageKey(['clipboard']))
```

This is a supported hybrid, not a reason to reject the root item. The directory
grammar is already disjoint:

- eight-digit filenames are lineage history markers;
- signature/meaning filenames are pool members.

Readers select the facet by filename grammar. Destructive history operations
remain conservative: if an address has a pool facet, flatten/prune refuses to
delete or recursively rewrite that directory.

## Reference record grammar

New reference records are built only by
`hypercomb-core/src/core/canonical-reference.ts` and placed only through
`CanonicalReferenceService`:

```json
{
  "kind": "reference",
  "appliesTo": [],
  "payload": {
    "targetSegments": ["people"],
    "targetSig": "<lineage signature of /people>"
  }
}
```

`targetSegments` is always the one-segment compatibility spelling of the fixed
name. `targetSig` is the root lineage/bag address, never a content signature.
Requirements (`requiredMarks`, `requiredBouquet`) scope what the doorway shows;
they do not change which canonical item it names.

Only the Portal inventory's default-authoring row adds
`"editsRootDefault": true`. Ordinary references omit it and carry the selected
non-structural detail signatures on their own leaf. Readers must never infer
root-write authority merely from `kind: "reference"`. For compatibility,
pre-marker references already stored directly under the reserved `/sets`
Portal inventory receive the same behavior until their next rewrite.

Legacy arbitrary-path references remain readable. The first rewrite through
`/requires` lazily promotes their target and rewrites them into canonical-root
form. All new writers are mechanically prevented from hand-assembling a
reference record by the doctrine test.

## Write transaction

For `add people from /research/contacts into /project-a`:

```text
resolve source subtree
  -> if /people is absent, import subtree at /people and link it into /
  -> retain the discovered layer as a canonical:variant member of /people
  -> if /people exists, keep its current head (selection is not overwritten)
  -> mint reference payload for /people
  -> copy the current root's non-structural detail signatures onto the leaf
  -> commit /project-a/people reference leaf + pinned selection
  -> append that leaf to /project-a
```

The root promotion and lineage placement ride the existing serialized
`LayerCommitter`; no eager byte duplication, new storage primitive, or
lineage-to-lineage pointer grammar is introduced.
