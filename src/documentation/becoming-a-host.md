# Becoming a host

Status: **design, for review** (2026-10-07). Nothing here is built yet beyond
what "Today" describes.

> "We need a clear path for people to become hosts. Currently it is hard to
> understand or express what is needed. If people are to adopt it has to be
> easy." — jwize, 2026-10-05

## The principles this follows

1. **The public install names one host: hypercomb.com.** No participant's
   domain is a default anywhere — not a relay, not a content host, not a
   publish target, not an example.
2. **Hosts are the participant's to add.** The swarm's host field is empty
   until the participant fills it; nothing is filled in on their behalf.
3. **Follow from your client, adopt from a location.** A participant follows
   a host from their own client and adopts content from where it lives. An
   update is taken on the following side, and only when the participant has
   turned updates on for that host.
4. **A host is a directory of static files answered over HTTP**
   ([hosting-from-a-machine.md](hosting-from-a-machine.md)). Becoming one
   asks for nothing more than that, and the path should never make it sound
   like more.

## Today, and where it loses people

To host today a participant has to:

1. Pick one of three ways to run a host (Cloudflare Pages via
   `npm run host:deploy`, `node host/serve.mjs`, or the desktop app's
   *Hive ▸ Serve This Hive*), the last of which also needs a shim build staged
   first.
2. Claim a domain with `/domain claim example.org`, which quietly asks a
   personal domain's host for the nameservers to set.
3. Find the swarm settings' **host** field and change it — until 2026-10-05 it
   was already filled in, so nothing suggested it should be.
4. Turn on publishing (`HostSyncService.enable()` / `/use-live-relay`), and
   get their key onto a relay's writers list, which only that relay's
   operator can change.
5. Learn `/hosts list <meaning> [@host]` to see what is served.

What goes wrong:

- **Seven words for nearby things:** host (the field), hosts (the
  directory), public host, self-domain, zone, door, the `content.` face.
- **No single place to start.** There is deliberately no `/host` behaviour
  (`host-gesture.ts`: hosting infrastructure and publishing a branch are
  different acts), so nothing walks a newcomer through it.
- **Hidden prerequisites:** nameserver delegation, a writers allow-list,
  Cloudflare and desktop staging steps — none of them stated where the
  participant is.
- **No answer to "did it work?"** The 12-point check in the `host-deploy`
  skill exists, but a participant never sees it.

## A host is a domain you own

A **host** is a domain you own, and you change it through its **host API**
(jwize, 2026-10-07: "The host means you own the domain and you need to use
your host api to make changes, ie deploy to the server side your latest
build. So these are your hosts."). Through that API you deploy your latest
build to it, change its settings, and choose what it shares. Whose machine
answers for the domain does not change whose host it is:

- **your own machine** — the desktop app serving the hive live;
- **a provider** — Cloudflare, or any server you rent;
- **someone else's machine** — a friend, or hypercomb.com, serving it for
  you. Their machine answers; the domain, and the host, are still yours.

Serving a domain for someone else is safe for its owner: every byte a reader
takes is checked against its signature, and only the owner's key signs the
content, so whoever serves it cannot change it — at worst they fail to serve
it. The owner trusts the server to stay up, never to be honest.

**The host API's credentials are secrets** (a Cloudflare token, a server
login). They stay on the device that configures the host — the desktop —
and never go into a shared record. Your phone sees your hosts and their
state; it does not hold the keys to change them.

## The path: four steps, one place

The path lives in the **hosts window**, the place a participant already goes
to see who they follow. It opens with one plain sentence and one button:

> **Host your hive.** Other people can follow what you publish, from your own
> domain. You need a domain and somewhere to serve it from.
> **[ Become a host ]**

The button walks four steps. Each step says what it needs, does it, and says
what happened. A participant can stop after any step and come back; the
window remembers where they were.

### 1. Choose where your hive is served from

Three choices, each one line, recommended first:

| Choice | One line the participant reads | What runs |
|---|---|---|
| **This computer** | Your hive is served live from the desktop app while it is open. | `hypercomb-serve` / *Serve This Hive*, shim staged by the app itself |
| **Cloudflare (free)** | A copy of what you publish is served from Cloudflare's network. | `host:deploy` (the `host-deploy` skill's steps), run for them |
| **My own server** | You already run a web server; we give you the folder to serve. | a published folder + `check-host` |

No build commands are shown. Anything that must be staged or built first is
done by the step, with progress in words.

### 2. Name your domain

One field: **Your domain**, placeholder `example.org`. The step then:

- fills the swarm **host** field with it — the only time anything fills it,
  and only because the participant just typed it;
- claims the domain against **hypercomb.com**, never a personal host, and
  shows the two nameservers to set at the registrar as a copyable block with
  one sentence of why;
- waits for the domain to answer, saying so, rather than failing.

A participant who already pointed their domain somewhere can skip the
nameserver part: the step checks the domain first and only asks for what is
missing.

### 3. Check it

The host contract is checked from the participant's own client — the same
points `check-host.mjs` and the `host-deploy` skill check — and each result is
a sentence, not a code:

- ✓ Your domain answers.
- ✓ It serves your hive's pin.
- ✗ Pictures don't load from other sites yet — your server needs to allow
  them (*how*).

Every failure links to the one fix that clears it. The check can be run again
any time from the hosts window, so "is my host still working?" has an answer.

### 4. Be found

The last step publishes the host's listing and says, in one line, how others
follow it ("anyone can follow you by typing your domain into their hosts
window"). It adds the host to the participant's own hosts list, so they see
themselves as others will.

Being found never changes anyone else's install. A follower adds the host
themselves; updates from it reach them only once they turn updates on for it
— the follow/adopt rule above, unchanged.

## The words

One word for the act, kept for the act:

Two words, one each way (jwize, 2026-10-07: "we say follow though"):

- **follow** — the domains you read from. Inbound. **Built**
  (`sharing/follow.queen.ts`, 2026-10-07): `follow` alone says who you
  follow and who in the swarm you could; `follow <domain>` follows any domain
  at any time, and as you type it offers the hosts participants in the swarm
  advertise as their own (each from an event their key signed) that you do
  not follow yet; `follow off <domain>` stops. Following changes only your
  own install, and an update from someone you follow is taken only when you
  turn updates on for them.
- **host** — the domains you *own*, changed through their host API.
  Outbound. `host` alone lists your hosts; `host <domain>` opens that host's
  management (jwize, 2026-10-07: "host jwize.com is my manage hosts list") —
  deploy your latest build, set up the key that may upload to it, change its
  settings, and choose what it shares. The swarm field is labelled **Your
  host** with the hint "the domain you serve from — leave empty if you don't
  host".

### Desktop and phone

The desktop is where hosts are **configured** — the `host` side: keys,
settings, what you share. On a phone, "your hosts" means the domains you
**follow**. They are the same records, shared across your devices
(jwize, 2026-10-07): your phone, your desktop and any host you run recognise
each other through a common key — your participant key — and the follow list
and host settings are records that key signs, so every place holding it reads
the same ones.

**Public keys are enough** (jwize, 2026-10-07: "I suppose a public key would
be sufficient"). Recognising a record as yours, and a host deciding whose
uploads it accepts, both need only your public key — a signature checks
against it, and a host's allow-list holds public keys, never private ones.
Writing needs signing, so each device holds a private key — its own, made on
that device. Your public keys are tied together by one short record listing
them, signed by a key already on it; a host that trusts one of your keys
accepts the others. No private key ever travels between your devices or to a
host, and a lost phone is one public key taken off the record, not a new
identity.

**A share hash names the group** (jwize, 2026-10-07: "or a computed share
hash of some sort"). The signature of your sorted public keys is one address
for "you, across your devices" — a group signature — so your follow list and
host settings can live in a pool named by it, and every device and host
computes the same name from the same keys. It names; it does not admit:
anyone who knows your public keys can compute it, so a write is accepted
only when one of the listed keys signed it. And never a hash of a secret (a
passphrase): that is a password, and whoever learns it is you.

Open question: the `hosts` word exists today for the followed list
(`hosts.queen.ts`). With `follow` as the word, `hosts` either stays as a
second spelling or retires (a retired word still answers, saying the new one).

"Self-domain", "zone", "door" and "content. face" stay internal and leave the
participant-facing text.

Open question: the path is opened from the hosts window. Every act in
Hypercomb has a word on the command line, so it may also want one — `host`
itself is free, since the old reason against it was that *publishing* is not
hosting, and this path is hosting. Decide before building step 1.

## What this needs that does not exist

- **A walkthrough surface in the hosts window** (a registry-fed shell surface
  or a drone's custom element — never an `app.html` tag).
- **Claims against hypercomb.com.** `/domain claim` must stop asking a
  personal host; hypercomb.com has to answer claims, or the step is held
  until it does.
- **A client-side host check** — the host contract's points, run from the
  browser and worded for a person.
- **A host listing a follower can discover by domain** (likely the existing
  `community:hosts` directory, published by the host).
- **Writes without an operator's allow-list,** or a stated reason why a
  newcomer's host does not need relay writes at all (a static host publishes
  bytes over HTTP and needs none).

## Decisions this depends on

These are the defaults that still name personal domains (audit, 2026-10-05);
the path is only as clean as they are:

| Default | Today | For the path |
|---|---|---|
| Live relay, on for every public visitor | `wss://jwize.com` | hypercomb.com, or off until one exists |
| Default content host, publish target, publications directory, claims, AI host | `pluginthematrix.com` | hypercomb.com where it serves that role, else unset |
| Byte fallbacks; example hives | `jwize.com`, `pluginthematrix.io`, `content.jwize.com` | hypercomb.com, or none |

## Order of work

1. Settle the defaults above, so no step points a newcomer at a personal host.
2. Words: relabel the swarm field and hint; take the internal words out of
   participant-facing text.
3. Step 3 (the check) first — it is useful on its own, today, to anyone who
   already hosts.
4. Step 2 (domain), against hypercomb.com claims.
5. Step 1 (where to serve), *This computer* first.
6. Step 4 (be found), and the hosts-window entry point.

Each step ships on its own and is judged the same way: could a newcomer who
has never heard of a relay finish it without asking anyone.
