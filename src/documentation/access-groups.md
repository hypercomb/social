# Access groups — who may open which home page

jwize, 2026-10-25: *"first you create the multiple home pages and then you
give them accesses to groups of permissible people"*; *"use the same paradigm
that we share our hosting key for other domains … an easy way to give access
to different access groups"*; *"not really tiered, just grouped"*; *"both
should have walk-through bee tutorials with instructions so anyone can do
it."*

DESIGN — not built. It joins four things that are:

| Already built | Where |
|---|---|
| Several home pages: **communities**, the named pages of a showcase, swiped between | `showcase.md` § Communities (a26920054) |
| Key lists: an anchor's chain of signed lists, one-shot invites that add exactly one key, removal refused everywhere | core `key-list.ts`, worker `key-lists.js` (150f767d3, d13fd4e0e) |
| Head only, with the archive open to the host's people (owner, operators, `HOST_FRIENDS`) | `hosted-tenants.md` §4, §4b (632320b60) |
| Lessons a beeing flies, registered by any module | `tutorial-courses.md`, `walk.md` |

## The shape

1. **A home page is a community.** The public one is the showcase itself; the
   others (`team`, `family`, …) are its communities. Nothing new to make.
2. **An access group is a key list with a purpose.** Under your anchor, each
   group is its own signed chain, kind 30570, exactly as a publish list is —
   with one field added: `grants: 'read'` (a publish list says
   `grants: 'publish'`). A host never lets a read list write, and never lets
   a publish list stand in for a read group. Inviting a friend to read must
   not quietly let them publish.
3. **A community names the groups that may open it.** The signed showcase
   record's community gains `groups: [<name>, …]`. No groups = public.
4. **The host judges a read by itself.** A read tagged
   `['group', <anchor>/<name>]`, signed by a key that group's list names,
   opens that community's pages — and the archive of what they reach (the
   withdrawn versions, `hosted-tenants.md` §4). Strangers get the public page
   and its head only. `HOST_FRIENDS` stays as the host-wide group for hosts
   that keep no lists.
5. **Groups, not tiers.** Nothing is ranked above anything; a person is in the
   groups you put them in, and sees the pages those groups open.

## The easy way in — the invite

The same one-shot invite the key lists use: you say `group invite family`,
the hive makes a link; your friend opens it, their own hive answers with
their own key, and the list gains exactly that key. No secret is ever copied.
`group remove family <name>` takes them off, and every host refuses them on
their next read.

Words (one queen, `group`, rawArgs so its sub-words never run alone):

| Say | What happens |
|---|---|
| `group` | your groups and who is in each |
| `group new <name>` | a new, empty read group |
| `group invite <name>` | a one-shot invite link for that group |
| `group remove <name> <person>` | that person's key off the list |
| `community <name> open to <group>…` | the community's pages open to those groups |

## Managed from the phone

The phone's root page is where you run what others see: pick a home page
(community), see the groups it is open to, share an invite, remove someone.
Same words underneath. (The hive's phone view was set aside 2026-10-24; this
is the showcase manager, which the phone already goes to.)

## The tutorials — both acts, flown by a beeing

Two lessons, registered in `TutorialLessonRegistry` so they appear in the
Tutorials window (intermediate course) and fly on `/tutorial <lesson>`:

- **`share-hosting`** — another place publishes for you with its own key:
  open `keys`, make the invite, what the other place does with it, how to
  take it back.
- **`access-groups`** — make a group, invite someone, open a home page to the
  group, see it from their side, remove them.

Each step says exactly what to type and what you will see, so anyone can do
it without knowing the hive.

## Order of work

1. Agree the `grants` field with the key-list session (it is their chain).
2. Worker: read groups, the tagged read, a community's `groups`.
3. The `group` word and `community … open to`.
4. The two lessons.
5. The phone's manager rows.
