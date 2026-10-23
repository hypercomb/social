# The hosting pages — hosting.hypercomb.com

**Status:** PLAN, 2026-10-22. jwize: *"we really need a detailed plan on how
this works so people can pick one of those processes and go through the
steps without distraction… one main page on hosting.hypercomb.com and then
the individual types once clicked as children pages… We also have to really
up the quality and standards of our websites, they're always so dry and
inconsistent."*

The pages are a creation in the hive — a tile at `/hosting` with one child
per path — published to the door `hosting.hypercomb.com`. They are made and
kept through the hive like any creation (`documentation/website-artifact-
paradigm.md`), never as files in the shell. This document is the brief: what
each page says, in what order, and the standard every page meets.

**BUILT 2026-10-23 in jwize's hive (not yet published).** The five tiles
wear their pages and `/hosting` opens as a website. **The copy lives in the
hive, not here:** each tile's notes are its page, one part per note, and the
page texts below are the first draft they grew from. The notes were
corrected against the standard before the pages were built: second person
throughout, every *Done when* line quoting what the app really says, and the
hosted page closed (*Not open yet*) until sign-up exists, so it promises no
button that is not built. To change a page, change its note, then run:

```bash
node scripts/bridge/_hosting-site/generate.cjs --dry
node scripts/bridge/_hosting-site/generate.cjs
```

The generator (`scripts/bridge/_hosting-site/generate.cjs`) reads the notes,
renders each page through the three components, and says every changed page
back into the hive with the hive's own words (`go`, `website page`, `opens
as website`, `builds`). It never types copy or a signature, and a second run
with nothing changed says nothing. The one look is `chrome.css` beside it,
shared by signature from every page; `plans.js` is the plan card's live
price, linked only by a page that carries a price.

## The shape

```
/hosting                      Host your hive            hosting.hypercomb.com
  /hosting/try-it             Try it from this computer       free, 2 minutes
  /hosting/hosted             Hosted on Hypercomb             paid, 5 minutes
  /hosting/your-own           Your own domain or server       free, 20 minutes
  /hosting/moving             Moving between them             (from any page)
```

A reader lands on the main page, picks one path, and stays on that page
until they are done. Nothing on a path page points sideways except its last
line. The pages are the walkthrough the app already does in the hosts window
(`becoming-a-host.md`, `host-online.ts`), written for someone who has not
opened the app yet.

## The standard every page meets

jwize: *"always so dry and inconsistent."* Dry = a list of features with no
one in it. Inconsistent = every page invents its own shape. So:

**One shape.** Every path page has exactly these parts, in this order:

1. **Title** — a verb phrase: *Try it from this computer.*
2. **The promise** — one sentence saying what is true when they finish, and
   how long it takes. *Your hive is on the internet at a temporary address,
   in about two minutes.*
3. **Who this is for** — two lines, the person, not the feature.
4. **You need** — a short list; every item is something they can check now.
5. **The steps** — numbered. Each step is three short lines: *what you do*,
   *what happens*, *how you know it worked*. Never a terminal command. Never
   "configure". If the app does it, the step says the app does it.
6. **What it costs** — one line, even when the answer is nothing.
7. **When you are done** — what they can now do, and the one next page.

**One voice.** Second person, present tense, one idea per sentence. The
reader is "you"; the app is "the app"; Hypercomb never speaks of itself in
the third person. No "simply", no "just", no "easy" — the steps prove it.

**One look.** The pages use the house theme's tokens (`project_theme_system`,
`--md-*`), not their own colours. Three components, reused on every page,
each one an artifact in the hive the pages share (never copied): the **step**
(number, three lines, a check when it is done), the **callout** (one
sentence that must not be missed), and the **plan card** (name, what it
allows, price). A page with other components is a page that broke the
standard.

**One test.** A reader finishes a path without leaving the page, and when
they are done the thing the promise named is true. Each path is walked by
someone who has not done it before; where they stopped is a defect in the
page, not in them.

**One truth.** Every *Done when* line quotes what the app really shows, and
every control a step names exists in the app today. A step for a button
that is not built yet is not written; the page says *Not open yet* instead.
(Learned 2026-10-23: the first draft promised a *Signed in* message the app
never shows, and buttons sign-up has not built.)

## The main page — Host your hive

**Promise.** *Your hive, at an address anyone can open. Pick how.*

Three cards, in this order, each one sentence and one line of cost:

| Card | Sentence | Cost |
|---|---|---|
| **Try it from this computer** | Put your hive online at a temporary address while the app is open. | Free · 2 minutes |
| **Hosted on Hypercomb** | A lasting address, your own domain when you want it, always on. | From $— a month · 5 minutes |
| **Your own domain or server** | Serve it yourself, from this computer or a machine you run. | Free · 20 minutes |

Under the cards, one callout: *Whichever you pick, your hive stays yours.
Every address keeps working when you move, because nothing in it is named
after where it lives.* Then one line: *Not sure? Try it first.*

## /hosting/try-it — Try it from this computer

**Promise.** Your hive is on the internet at a temporary address, in about
two minutes.

**For.** Someone who wants to show a hive to one person today. Someone
deciding whether to host at all.

**You need.** The desktop app. An internet connection. Nothing else — no
account, no domain.

**Steps.**
1. Open the hosts window and press **Try it now**. — The app asks, in its own
   dialog, whether to put the hive online, and says what that means: anyone
   can read it. — You pressed *Put it online*.
2. Wait. — The first time, the app downloads Cloudflare's tunnel program and
   checks it against a known fingerprint; then the tunnel connects. — The
   window says *Online at https://<words>.trycloudflare.com*.
3. Press **Check it**. — The app fetches the address the way a visitor would
   and looks for your page's door. — *<address> opens your page. Anyone can
   visit it now.*
4. Send the address to someone. — They open it in any browser. — They see
   the page you were on.

**Costs.** Nothing.

**Done.** Your hive is readable at that address while the app is open. The
address changes every time the tunnel restarts, and it stops when you close
the app or press *Take it offline*. For an address that lasts: *Hosted on
Hypercomb*, or *Your own domain or server*.

## /hosting/hosted — Hosted on Hypercomb

**Promise.** Your hive has a lasting address on Hypercomb's network, and
your own domain when you want it, in about five minutes.

**For.** Someone who wants an address that stays up when their computer is
off. Someone who does not want to run anything.

**You need.** The app. A name you would like (`<name>.hypercomb.com`). A card.
Your own domain, if you have one — it can wait.

**Steps.**
1. Open the hosts window and press **Host with Hypercomb**. — The app shows
   the plans (the plan cards) and asks for the name. — The name is free, or
   the app says it is taken.
2. Press **Continue to payment**. — Your browser opens the checkout page.
   The app never sees your card. — You are back in the app with *Paid*.
3. Wait. — Hypercomb's host puts your key on the plan and binds the name to
   it. — *<name>.hypercomb.com opens your page.*
4. *(Optional)* Press **Use my domain** and type it. — For a domain nobody
   uses yet, the app shows two nameservers to set at your registrar; for a
   domain already in use, one record to add. Nothing else about the domain
   changes. — *<domain> opens your page.* (A new domain can take a while to
   answer; the app keeps checking.)

**Costs.** The plan card you chose, monthly. Cancel any time from **Manage
my plan**; your address keeps reading for thirty days after the last paid
day.

**Done.** Your hive is always on. Publish from the app as you do now; every
publish lands at your address within seconds. When you are ready to run it
yourself: *Moving between them*.

## /hosting/your-own — Your own domain or server

**Promise.** Your hive is served from something you run, at a domain you
own, in about twenty minutes.

**For.** Someone with a domain already. Someone who wants no bill and no
dependency.

**You need.** A domain you own. A free Cloudflare account with that domain
in it — or a server you already run. The app, on a computer that stays on.

**Steps (this computer, through a tunnel).**
1. Open the hosts window, type your domain under **Use my domain**, press
   it. — The app asks before putting the hive online. — You pressed *Put it
   online*.
2. Sign in. — Your browser opens Cloudflare's sign-in; pick the account your
   domain is in; come back. — The app says *Signed in*.
3. Wait. — The app creates the tunnel, points your domain at it and starts
   it. If the domain already points somewhere, the app asks before replacing
   that. — *<domain> opens your page.*

One callout here: *If your domain already runs a Cloudflare Worker, the
Worker answers before the tunnel can. The app tells you; give the tunnel a
name the Worker does not cover.* (Found live 2026-10-22.)

**Steps (your own server).** The app gives you the folder to serve and a
check that says, in sentences, what your server still needs (`check-host`).
Written when the folder path is built.

**Costs.** Nothing to Hypercomb. Your domain's registration, your machine.

**Done.** Your hive is served by you. Keep the app open on that computer, or
move to a server you run. To let others follow you by domain: the hosts
window's *Be found*.

## /hosting/moving — Moving between them

Three short sections, each two steps: try-it → hosted (the address changes,
nothing else); hosted → your own (**Move to my own server** downloads
everything your key wrote, then *Your own domain or server* takes over; your
domain follows you); your own → hosted (publish to the hosted address; the
old one keeps working until you turn it off). One callout: *Every signature
stays the same wherever it is served, so every link anyone holds keeps
working.*

## What is still owed

- **The plan card's live price at a door.** `plans.js` asks its own host's
  `GET /plans`, but the worker answers `/plans` only on a zone's write face,
  so on `hosting.hypercomb.com` it falls through to the visitor shell and the
  card keeps its words. The worker must answer `GET /plans` at site doors (as
  it does `/publications.json`). No page carries a price today — the hosted
  card returns with sign-up — so this blocks nothing yet.
- **Sign-up** (`hosted-tenants.md`, step 3): then the hosted page's notes get
  their steps and card, and the generator draws the plan list.
- **The door's title.** Without an exact `SITE_BINDINGS` entry the door reads
  *hosting*; it should read *Host your hive*.
- **A download address for the desktop app.** *Try it* and *Your own domain*
  need the app; no public page says where to get it.
- **The three components as hive artifacts on tiles.** Today they are one
  shared stylesheet and one markup function each in the generator, shared by
  signature but belonging to no tile. Filing a shared artifact on a tile has
  no word yet.

## Order of work

1. ~~Make the tiles in the hive with each page's text as its notes.~~ Done
   2026-10-22, corrected 2026-10-23.
2. ~~Make the three components once; have every page use them.~~ Done
   2026-10-23 (`chrome.css`, `generate.cjs`).
3. Open the door: `publish /hosting on hypercomb.com`, said in jwize's hive
   (it asks him first). Success is `hosting` in his signed index, then the
   address opening the main page.
4. Walk each path with someone who has not done it; fix the note where they
   stopped and run the generator.
5. When sign-up lands, give the hosted page its steps and card.
