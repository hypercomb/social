# The living presentation — a plan to review

**Status: plan, for review. Third revision, 2026-10-30. Nothing here is
built.** This page gathers the whole plan for an interactive presentation of
how Hypercomb works. It is written to be listened to: plain sentences, no
tables, and every file reference kept in the last section so it can be
skipped when read aloud.

What this revision settles. There is one cube for each domain of each
participant, served from that participant's own hosts. A participant builds
their cube by replicating other people's packages and creating their own.
What they have published is the public cube, and the root of their domain is
where that public cube is shown. Every publicly deployed item is a place in
that cube. Your workbench is hypercomb.io, or your own host's root domain: private to
your machine, and able to share publicly once your host is registered for
publishing. Trial subdomains are the isolated, public debugging
environments. Natural
language is both the scripting language and the debugging language. The cube
draws three axes, but nothing limits it to three. And the cubes join into one
tapestry through the signatures they share.

---

## 1. What this is, and the one point that matters most

This is a presentation in five stages, three slides each, fifteen slides in
all. It is not a slide deck in the usual sense. It is an interactive diagram
you can move through in more than one direction, and every piece of it lives
in the hive.

The most important point the presentation has to make is this: **the
hexagons are the program.** Every tile in the hive is an automaton. It is
where the code and the content live. Anyone can copy it, change it, and make
it their own, and the original stays exactly as it was. The presentation
proves this by being made of the same tiles it describes.

That is why it is a living document. It is never finished. Anyone can open
any piece of it, read how it works, copy it, improve it, and publish their
version. The people who follow it get a small notice, and they can take the
new version, take just one piece of it, or leave it.

### Where the story is going

The story builds toward one picture: a cube of points.

Every point is a tile, one automaton at one version. Each participant has a
cube for each domain they own, served from their own hosts. They fill it two
ways: by replicating packages from the people they follow, and by creating
packages of their own.

The points a participant has published make up their public cube. That is
the cube everyone else sees of their domain, and the cube everyone debugs
against. The root of each public domain is where its public cube is shown,
and every publicly deployed item has its own place in that cube.

Turning a cube shows the same points divided different ways: by where each
point came from, by the word of the language it answers, and by version.
Those are the three axes a screen can draw, but there can be as many
dimensions as anyone wants to add.

Finally, the cubes are connected. Wherever two cubes hold the same point, a
thread joins them. Starting from the root and running outward, those threads
weave every participant's cube into one tapestry of connected domains. Every
cube has the same shape and is read the same way, and a signature means the
same thing in every cube that holds it. That symmetry is what lets people
share in each other's work, and it is what the presentation ends on.

Everything before the cube is there so the viewer understands what each point
is, where it lives, and how it got there.

## 2. Every piece of the presentation is a tile

Every element you see on screen is its own tile in the hive. A server is a
tile. A domain is a tile. Each subdomain, each package, each revision, each
cube, each face of a cube, and each word of a sentence is a tile.

Each tile carries its own page. When you click an element in a diagram, you
go into its tile, one level down, and its page opens. That page explains the
element in more detail, and it has its own children that go deeper still. So
the presentation is only the top layer. Underneath it, the same tiles become
a complete technical description of the whole system, one layer at a time.

This works with what the hive already has:

- A tile's page lives in its own website slot, and the path of tiles is the
  route. A link to a child tile moves one level down and opens that tile's
  page.
- A slide is any tile marked as a slide. The presentation itself is a website
  artifact that sits beside its slides, not a box that holds them. The slides
  are joined to it with the enroll word, and the present word plays them.
- An object that appears in several stages, like a server or a package, is
  one tile reused by its signature. Improve its explanation once and every
  slide that uses it shows the improvement.
- A tile with no page yet is still a real place you can stand. So the whole
  tree can exist before every page is written.
- When many pages change in one pass, one build record names them all, so the
  whole presentation can be undone and restored as a single step.

### The same four levels everywhere

Every object follows the same four levels of depth, so anyone diving in knows
what they will find:

1. **The slide.** The object as it appears in the diagram, in a few words.
2. **The object.** What it is and what it does, with its own small diagram.
3. **The mechanism.** The records, formats, and flows behind it. For example
   the signed index, the derivation record, or the install pointer.
4. **The source.** The document and the code it comes from, read by
   signature.

This also answers the question of audience. The slide level is plain
language for anyone. One level down is for people who want to know how it
works. The bottom level is for developers.

## 3. The opening move: hexagons lift into their pages

Every scene opens the same way, and this is the visual that carries the main
point.

First, the stage shows the real hive, with the tiles for this scene as
hexagons on the grid. Then those hexagons rise off the plane into three
dimensions. They tilt toward the viewer and show their depth. While they are
in the air, each hexagon's outline reshapes into a panel, and its page fades
in, right where its tile was. Finally the pages settle into the scene's
layout, already connected by lines where they relate to each other.

When you leave a scene, it plays in reverse. The pages fold back into
hexagons and settle onto the grid. The viewer always sees that a page and a
tile are the same thing.

### How the lift is built

The hive draws its hexagons in two dimensions, with Pixi. Moving the whole
renderer to three.js is only a proposal, and this effect does not need it. A
tile's page is placed directly into the live page, not into a separate frame.
That means a small module, a transition bee, can do the whole effect:

- read where each hexagon sits on screen from the grid;
- place a hexagon-shaped element exactly over it;
- lift it and reshape it with the browser's own three-dimensional transforms;
- hand over to the real page the moment the page arrives.

The transition bee is a module like any other: signed, replaceable, and
itself a tile in the presentation.

### Copy it, change it

Every page that lifts out shows that it is a tile. It shows its signature,
who made it, and two actions: **copy into my hive**, and **change it**. A copy
gets its own signature, and the original is untouched. When you publish your
version, the people who follow you see the update notice described in stage
three, and they decide whether to take it.

A change written by a model never goes live on its own. It waits in the hive
until a person accepts it. A model may put a change on a trial subdomain for
review, but promoting it, taking it, and accepting it are human acts.

## 4. Choosing your way through: the octopus

The presentation branches like a many-armed octopus with arms on every
level. The same rule applies on every page, at every depth.

At the end of every page there are two ways forward. **Explore** takes you
into any object on the page, one level down. **Next** continues the main
story at the same level. When you explore an object, its page ends the same
way, with its own objects to explore and its own next. So every arm has arms
of its own.

Two more moves are always available. **Back** returns you to exactly the page
and view you came from. It never works out a destination from the route; the
hive already behaves this way when you step into a view. **Where am I** folds
the page you are on back into hexagons, so the hive itself becomes the map of
where you are.

These match the three directions the hive's viewers already use. Moving
within a viewer is next. Moving between viewers is explore. Moving across is
stepping sideways to the next object at the same level.

## 5. Domains and subdomains: the foundation

This section is the explanation that stage two's slides, the eight
participants, and the cubes all draw on. It is told here in full, once.

### Your workbench is your root, private to your machine

Your workbench is hypercomb.io, or the root domain of your own host. When you
open it, the hive runs in your browser and keeps everything in your browser's
own storage, on your machine. It is private: nothing you make there leaves
your machine unless you publish it.

It is also the place you publish from. To share your work publicly, you
register your host for publishing. Sharing requires hosting: anyone can
watch and bring things in without a host, but only a registered host can
make your work available to others. Once it is registered, the same
workbench can publish to your domain, open trials, and promote them.

### A domain is yours, served from your own hosts

A participant claims a domain with one sentence: domain claim, followed by the
domain name. The hive answers with two nameservers. The participant sets them
at their registrar, and that change is the proof that they control the
domain. Nothing else is asked.

From then on, nobody else can publish there. The key that claimed the domain
is the key that publishes to it. Each participant's domain is served from
their own hosts, and that domain, with all its names and all its versions, is
one participant's cube. Their subdomains, trials included, are inside their
cube, not cubes of their own.

### The root domain: your workbench, and everyone else's view of your public cube

The bare domain, the root, plays two parts at once. To you, on your own
machine, it is your workbench, with everything you keep there private to your
browser. To everyone else it is your front door, and in this plan it is where
your public cube is shown. Open the root of any public domain from another
machine and you see the cube made of everything that domain has published,
every version of it, from every source. The same address gives two views,
because what a browser stores belongs to that browser alone.

The same holds one level down. **Every publicly deployed item is a place in
that public cube.** A promoted site, a published package, a deployed page:
each has a root signature, and that root signature is its position in the
cube. Open a deployed item from its root and the cube appears centred on it,
with its versions running down beneath it and the pieces it is made of
reaching out to the points they came from.

Today the root of a domain shows its showcase: the tiles of what it
publishes. The public cube is a second way of seeing exactly the same
published points. It needs no new storage, because it is a view of what the
root already holds.

### One folder, many names

A domain has one folder: its root. Every name under the domain is only a way
of reaching that folder. No subdomain owns any files. A subdomain is
resolution, never storage.

The root holds only three kinds of thing. Atoms: the bytes of everything
published, each file named by the hash of its own bytes. Histories: the
ordered markers of each branch, where the highest marker is the current
head. And pools of meaning: the signed indexes, packages, listings, and every
other grouping. The start-up files for the shell sit in the root too, the same
for every name, so any name can be opened from cold.

### Publishing is bytes first, then a pointer

Publishing to a name happens in two steps, always in this order. First, the
bytes go into the root, each file under its own signature. Identical content
is one file, however many names or people point at it. Then the pointer moves:
the publisher's signed index is updated so that name now opens on the new
head.

A new version is a new head. The old heads keep resolving, so older versions
keep working. Taking a name down is the same act in reverse: the pointer is
removed. No file is deleted.

### The trial subdomain is the debugging environment

Every change starts on your workbench, privately. When you want others to
try it, it goes to a trial subdomain. Its name is the word "try", a dash, and
the name of the site it will become. A trial for the cards site
lives at try-cards, on the same domain, and when it is promoted it becomes
the cards site itself.

A trial subdomain is completely isolated:

- **It has its own origin.** The browser gives it its own storage, so nothing
  it does can touch anyone's hive. The origin is the sandbox.
- **It writes nothing.** The host refuses every write that comes from a trial
  address.
- **It holds no keys.** At a trial address the shell stores no AI key, signs
  nothing, and keeps any signing extension out of reach. A bar across the top
  says plainly that you are at a trial.
- **It cannot reach your machine.** Its page policy blocks it from talking to
  anything on the visitor's own computer.
- **It opens in its own tab,** never inside another page.

Inside that bubble, a trial runs readable source that has not been minified.
Anyone can open it, try it, and read exactly what changed, file by file. The
host's AI reads it, people read it, and signed reviews gather beside it.

The what-changed panel always shows where a change stands, in four steps:
draft, trial, reviewed, and your choice. At the last step, anyone can take
the change into their own hive, where it is held until they accept it. Only
the publisher can promote it or withdraw it.

A trial is not part of the public cube. It floats at the edge, in its own
bubble, until it is promoted.

### Promotion is one pointer move

When a trial is ready, promoting it moves one pointer. The site now opens on
exactly the files the trial ran. Nothing is rebuilt and nothing is uploaded
again. From that moment the promoted version is a point in the public cube,
and it stays there for good.

Withdrawing a trial removes its pointer; the trial address then says there is
nothing here, and its files stay in the root under their signatures,
unreachable but never deleted.

### Why everyone's files stay stable

Put these together and every person can work at their own level on files that
do not move under them.

**No version is removed.** Bytes are never deleted. A new version is a new
head, and every old head still resolves. If you stand on revision one, it
keeps working for as long as any host serves it. The public cube only grows.

**Nobody else can change what you run.** Updates are taken on the following
side, only when you have turned updates on, and only when you choose. A
version you hold stays until you upgrade.

**Trials cannot leak.** Each trial is sealed in its own origin and writes
nothing, so a broken draft breaks only its own bubble. Ten people can debug
ten changes to the same package at the same time, and none of them can
disturb the others or the live site.

**Every publisher's path to their running code stays whole.** Follow the
chain for any publisher: their domain, then their signed index, then the
head it names, then every file in that head's tree. Each step is signed or
hashed, and each file is checked against its own name when it arrives. A
host cannot change a byte without being caught. Another publisher's broken
change cannot enter that chain, because it can only arrive by being taken and
then accepted by hand. So every publisher keeps a clean path from their
domain to the code that runs.

### The honest limits

The presentation should state these plainly, one level down from the slides.

- **Control is a signed word, not enforcement.** Withdrawing a name is
  followed by honest hosts and readers, but nothing can make another host
  forget bytes it already holds. Private content is encrypted before it
  leaves the device.
- **Publishing a branch's history is a choice.** The bytes of every published
  version stay in the root, but sharing the full step-by-step history of a
  branch is switched on per branch, because it carries every earlier state.
- **The one mutable file.** The shell's start-up pointer, the pin, is the one
  file a compromised host could swap. Today the loader checks that the bytes
  match the pin and falls back to the last pin that worked. Choosing the pin
  from the publisher's signed pointer, so that a compromised host can cost
  you at most a missing page, is designed but not built.
- **A recycled name must start empty.** Today the hive's trust in code is
  keyed by domain alone. It should be keyed by domain and publisher key
  together, so a name given to someone new inherits nothing. This is a known
  gap.
- **A separate address is not trust in its host.** Whoever runs a host
  decides what it serves. Your own domain on your own host is the only place
  where that someone is you. Several hosts, each serving different things,
  keep a breach at one from reaching the rest.

## 6. Natural language: the scripting language and the debugging language

This section is the explanation that stage five draws on.

### A sentence is the program

In Hypercomb, natural language is the scripting language. A sentence typed on
the command line is the program. Each word is declared by the behaviour that
owns it, with the shape of what it takes. Before a sentence runs, the hive
works out how far it reaches: which tiles it touches, whether it leaves the
machine, and which of its steps would change something. Every step that would
change something waits for a person's approval. A model speaks the same
sentences a person does, under the same rules, and a capability with no word
is treated as a gap in the language to be filled, not hidden behind a
private shortcut.

### The same grammar, run by different automatons

A word means one thing everywhere. The implementation behind it is a mark on
the tile. So one sentence can be answered by different automatons: the same
words, run through a participant's own implementation, or through one they
replicated from someone else, or through an older version they still hold.
This is what makes the cube useful. Changing which point answers a word
changes the program without changing the sentence.

### Debugging is spoken too

Debugging uses the same language. Every step of finding and fixing a problem
is a sentence a person or a model can say, read back, and repeat. These words
already exist:

- **module trials** lists every open trial on a domain: whose it is, what it
  changes, and how the host's AI read it.
- **module changes**, followed by a trial's name, opens that trial file by
  file, before and after, with the reviews beside it.
- **module audit** reads a trial's changed files by signature, from your own
  hive, and compares them with what you run. It runs nothing.
- **module review** asks the host's AI to read the change again.
- **module assess** signs your own reading of a trial: accept, refuse, or
  unclear, with a note.
- **module take** brings a trial's changed layer into your own hive as a pick,
  held until you accept it with brood accept.
- **module drop**, followed by a path, puts your own trunk back at that path.
- **read** and **find** say what a tile holds and where a word appears.

Because every debugging step is a sentence, a debugging session is itself a
record: the sentences you said, and the slice of the cube you said them
against. That record is a set of signatures. Hand it to someone else and they
can replay exactly what you saw.

### What is not built yet

Two pieces of this are proposed, not built. First, a word that steps one
point of a slice up or down its versions, so that halving the range to find
the version that broke something is one sentence at a time. Second, one
sentence calling modules that live in other participants' cubes, on their own
hosts, and bringing the results back. The spoken-programs document still
marks that second piece as a hypothesis.

## 7. The five stages

The stages share one picture. A strip of servers runs across the top of the
screen. It starts as a single server in stage one, opens up to show its
domain and subdomains in stage two, splits into eight participants in stage
three, and in stage four each participant's domain becomes its own cube. The
cubes stay for stage five.

### Stage one: one server, one host, one client

**Slide one, the three roles.** These are easy to blur, so they are separated
first. A server is the machine that answers: your desktop app, a provider
like Cloudflare, or a friend's machine. A server is simply a folder of files
answered over the web. A host is a domain you own, which you change through
its host interface. Whoever's machine answers for it, the host is still
yours. A client is the browser running the Hypercomb core, with its own
private storage holding files named by their signatures, the history of each
tile, and pools of meaning. You can hover over each role to see what it
holds.

**Slide two, inside a server.** Open the server and you see files named by
their signatures, the publisher's signed index, which says which version each
name opens on, and install pointers, which name the current package. A server
only shares what the current hive reaches; nothing else leaves. Click a file
and you see that its name is the hash of its own bytes.

**Slide three, one request from start to finish.** A visitor types an
address. The core reads which publisher and which tile that name is bound to,
reads the publisher's signed index, finds the current root signature, and
then fetches each file by its signature. Every file is checked as it arrives.
A tamper button corrupts one file on the server, and the visitor refuses it.
This is why a stranger's server is safe to use: the worst it can do is fail
to answer. It cannot change what you get.

### Stage two: domains, subdomains, and the workbench

**Slide one, your workbench, a domain, and its names.** The stage opens on
the viewer's own workbench: hypercomb.io, or their own host's root, drawn
inside their machine with a lock on it, because everything there is private.
A switch labelled register for publishing connects it to their host. Then
the server opens to show one domain,
using the real Plugin the Matrix publications page with its subdomains for
Revolución, Meetup, Arkanoid, and others. All the names lead to one root
folder. Click a subdomain and you see that it holds no files, only a pointer
in the signed index. Press publish and the viewer watches the two steps: the
bytes drop into the root, then the pointer moves. The old pointer's files are
still there, and the old version still opens. A small cube icon sits on the
root: this is where the public cube will be shown, once the viewer knows what
a cube is.

**Slide two, the trial subdomain.** A trial appears beside the cards site,
drawn inside its own bubble: try-cards. The bubble shows its walls: its own
storage, no writes, no keys, no reach into your machine. The viewer edits one
line of the draft and watches its signature change. Then three more trial
bubbles appear, other people working on the same package at once, and none of
them touches the others or the live site. The four steps of the what-changed
panel run along the bottom: draft, trial, reviewed, your choice. Signed
reviews from the host's AI and from people gather on the bubble. Along the
bottom, the sentences that drive it are shown as they are said: module
commit, module changes, module assess.

**Slide three, promote, and the visitor's exact version.** The publisher says
module promote. The bubble's pointer slides over to the cards site; no file
moves. The visitor's copy then goes through the minify step and comes out
smaller, with its own tree of signatures that still names the readable source
it came from. A slider moves between the readable and minified versions and
shows the real numbers: the package went from about nine megabytes to about
six. A visitor gets that exact version, pinned to its root signature, and it
never changes underneath them. A re-derive button runs the minify step again
on the readable source and arrives at the same root, which is how anyone can
check that the minified code is exactly what it claims to be.

Stage two ends with the lifecycle as a loop: say it, draft on your private
workbench, trial subdomain, review, promote, deployed, visitors pinned, and
back to the next sentence.
This loop becomes a small icon that every participant carries from stage
three on.

### Stage three: eight participants, revisions, and checking in

**Slide one, the split.** The single server rises and splits into eight. On a
phone they form two rows of four. Each one is a participant serving their own
domain from their own hosts. Each shows its root, its live subdomains as solid
lanes, and its trial subdomains as small bubbles at the edge.

Each participant has their own colour, and every colour also has a pattern,
so colour is never the only signal. A filled chip is a package this
participant created. A hatched chip, in another participant's colour, is a
package this participant replicated from someone they follow; it keeps its
original signature and colour. A chip inside a bubble is a trial, not yet
promoted. Stacked rings on a chip are the revisions it holds.

There are six packages: a shared core, cards, journal, calendar, chat, and
theme. Each participant holds two to four of them, so every package sits with
at least three participants, and cards sits with five. That overlap is what
the rest of the story depends on. Click a package and every participant
holding the same signature lights up. Each holds the same bytes, and every
copy is identical and checkable, so it does not matter whose host answers.

**Slide two, someone changes a shared package.** The third participant works
on cards in a trial bubble, then promotes it. The new bytes have a new
signature, so this is revision two. A small notification badge appears on the
participants who follow the third participant and have updates turned on.
Nothing moves on its own; a version you hold stays until you choose.
Participants who do not follow them stay on revision one, and revision one
still works, because nothing is ever deleted. A visitor pinned to revision
one is not affected at all.

At the same time, the sixth participant also starts from revision one, in
their own trial bubble, and makes their own revision two. Both versions exist
side by side, with different signatures and their own histories. Neither
overwrites the other, and anyone can build on either one. A trace line runs
from each participant's domain through their signed index to their running
code, and every line stays whole through all of this. That is the picture of
every publisher keeping a clean path.

**Slide three, take it whole, or take a piece.** Open a badge and you have
three choices. **Upgrade** takes the revision as it is. **Skip** leaves it.
**Take a piece** takes only one layer of it into your own hive, at its own
path, and leaves the rest of your build exactly as it was. The piece is held
until you accept it, and when you commit, it is laid into your build where it
belongs. The viewer drags one layer from revision two into their own build
and watches everything else stay put. Each choice is also shown as the
sentence that does it.

This is what makes so many flavours possible. Everyone can mix the pieces
that suit their own build or machine, plug them in, and pass their mix on.

### Stage four: the cube

Each of the eight participants' domains rises into its own cube, and the view
moves into one of them. **There is one cube per domain per participant.**

**You build your cube by replicating other people's work and creating your
own packages.** Every package you take from someone you follow is replicated
onto your own hosts, under its original signature, and becomes points in
your cube. Every package you make becomes points of your own.

A cube is a cloud of points, and **each point is one tile**: a specific
automaton, one implementation at one version. Every point sits on three
axes. Across is the **source**: where the point's implementation comes from.
The participant's own packages sit at the centre, and the domains they
replicated from spread out on either side, so the cube grows from its own
root outward. Into the page is the **language**: the word of the grammar the
point answers. Down is the **version**, newest at the top.

Not every position has a point. An empty spot means this domain has no
implementation of that word at that version from that source. One spot can
also hold more than one point: the two separate revision twos from stage three
sit side by side.

**Slide one, the points and the public cube.** The cube fills in point by
point, each glowing in the colour of the participant it came from. You can
turn the cube freely, and clicking a point opens its tile.

Then the cube divides in two. **The published points are the public cube.**
Everything this participant has published, every version of it, stays in the
lattice. That is the cube everyone else sees of this domain, and it is the
cube the public debugs against. Drafts and trials move out to the edge, each
in its own small bubble, because they are not part of anything that runs
until they are promoted. When one is promoted, it drops into place and stays
there for good. So the public cube only grows, and never shifts under
anyone.

Finally the view pulls back to the participant's root domain, and the cube
icon from stage two opens: the root is where this public cube is shown.
Click any deployed item, a site or a package, and the cube turns to centre on
it, with its versions running down beneath it.

**Slide two, three faces, three views of the same points, and more.** Turning
the cube to a face flattens one axis away, and the points slide into the
groups that face shows. The points never change. Only the way they are
divided changes.

- **The top face** flattens the versions. It shows sources against words:
  what this domain runs right now, and whose work each piece is. Picking a
  row draws a line through one word across every source.
- **The front face** flattens the words. It shows sources against versions:
  how the participant's own work, and each piece they replicated, has changed
  over time.
- **The side face** flattens the sources. It shows words against versions.
  This is the language view: every implementation of every word in this
  domain, and how it changed, wherever it came from.

The cube shows three axes because a screen can show three at once, not
because Hypercomb stops at three. Nothing prevents adding more. In the hive,
a new dimension is just another mark a tile can wear, and filtering by a mark
is a view, so a new axis costs nothing to keep in step: no copy is made and
nothing has to be synchronised. Some dimensions already exist in the hive as
marks or pools: **platform**, such as web, desktop, or phone; **locale**, the
community's translations of each word; **audience**, which projection of a
domain a given group is shown; and **reviews**, the signed reviews and checks
gathered on each point. A dimension picker on this slide lets the viewer
choose any three to draw as the cube's axes. The points stay the same. Every
face is still a flattening of one chosen axis, so the same way of reading
works however many dimensions there are.

**Slide three, slices.** A slice is one point chosen for each word. Every
slice whose choices fit together is a working build. A slice is not a flat
plane through the cube. It is a bent surface that dips to different depths
and crosses between sources. You can grab a point and drag the slice up or
down to a different version, or across to another participant's
implementation; dependency lines show whether it still fits.

The cube is drawn from demo data at first. A later step can draw it from the
real history of the package tiles, so that changing a tile in the hive adds a
new point to the cube.

### Stage five: working in the cube

**Slide one, the sentence is a path.** Turn the cube to the side face, the
language view. A sentence runs across it, for example: module take cards from
the third participant's domain, into journal, publish.

A sentence is a path through the points, one point for each word. On the
language face it reads as a straight line of words. Turn the cube, and the
same path zigzags across sources and depths, because each word may be
answered by a point from a different participant at a different version. A
word can also reach out of this cube, to a point in another participant's
public cube, served from their own hosts. That path is the call, crossing the
cube, and across cubes, to run modules wherever they live.

Keep the words and choose different points, and the same sentence runs
through different automatons. Press run and each word lights up as its point
runs, and the results travel back along the path. Before anything runs, the
path shows which domains the sentence will touch, and every step that would
change something waits for your approval.

**Slide two, debugging in natural language.** A sentence fails. On the
language face, the break shows on one word's point, so you know which
implementation, from whose domain, at which version.

From here, the debugging is spoken. The viewer says module trials and sees
who else is already working on that word. They say module changes on the
nearest trial and read it, file by file. They open a trial subdomain of their
own domain, and say module take to bring in the piece they want to try. Each
sentence appears along the bottom as it is said, and each one draws its own
short path through the cube.

The trial is sealed, so nothing done there can disturb the live site or
anyone else's trial. Every other point the sentence uses stays exactly where
it was, because no version has been removed. The viewer steps the failing
point up or down its versions, halving the range each time, until the
sentence runs again. Other people can open their own trials on the same word
at the same time.

Everyone debugs against the same thing: the public cubes. A stranger debugging
your word sees exactly the points you published, at every version, served
from your own hosts. The failing sentence, its slice, and the sentences that
found the fault are just a set of signatures, so you can hand them to the
owner of that point and they replay exactly what you saw. When the fix is
promoted, it becomes a new point in the public cube, and everyone debugging
against it can now choose it.

**Slide three, flavours, plug and play, and the tapestry.** Zoom out to many
slices through one cube. Each slice is a different flavour of the same
program, and anyone can make a new one by moving a single point. The viewer
can shuffle through working slices; each one says how many points changed and
from whose domain.

Then the view pulls back out of the one cube, and all eight participants'
public cubes come into sight, each shown at its own root domain and served
from its owner's own hosts. Every thread lights up at once: wherever two cubes
hold the same point, a line joins them. These are the packages replicated
from one domain into another, the follows between domains, and the sentence
paths that cross from cube to cube. Starting from the root and running
outward, the threads weave the cubes into a tapestry of connected domains.
The cubes turn together to show their symmetry: every cube has the same shape
and is read the same way, and the same signature sits at the same word in
every cube that holds it.

The stage closes on the development process in one loop. You say what you
want in a sentence. It is drafted in a trial subdomain, debugged in sentences
against the public cubes, reviewed in public, and promoted with one pointer
move into your own public cube. The people who follow you get a badge, and
they replicate it whole or in pieces, on their own time, on files that never
move under them. Anyone can add a cube of their own, join it to the others by
taking a piece, and share in what everyone else has made. The closing line
comes from the repository itself: the hive is the sum of what we bring to
it.

## 8. Images from the hive

The presentation uses real pictures from the hive wherever it can:

- the empty hive, for the opening;
- the hive with the behaviours panel open, showing the slides behaviour;
- the Plugin the Matrix publications page, with its subdomains, for stage
  two;
- the existing diagrams of the runtime lifecycle, the website pipeline, and
  the participant loop.

Screenshots from the live hive, such as real tiles, the packages window, the
what-changed panel, the trial bar, a real update notice, and a domain's
showcase at its root, would be better than anything drawn, and can replace
the drawings as they arrive.

## 9. The tile tree

This is the draft tree. The names become the routes, so they should be agreed
before phase one.

The root tile is called how-hypercomb-works. It is the website artifact, and
it plays with the present word. It has five stage tiles.

The first stage is one-server. It holds a server tile, with signed-index,
sig-named-files, and install-pointers under it; a host tile, with host-api
under it; a client tile, with core and opfs under it; and a request tile, with
verify-on-arrival under it.

The second stage is domains-and-subdomains. It holds a workbench tile, with
private-to-your-machine and register-for-publishing under it; a domain tile,
with claim, root-folder, root-shows-the-public-cube, and names-are-pointers under
it; a publish tile, with bytes-first and pointer-moves under it; a
trial-subdomain tile, with isolation, what-changed, and reviews under it; a
promote tile; a minify tile; a visitor-pin tile; and a stable-files tile, with
no-version-removed, clean-paths, and honest-limits under it.

The third stage is eight-participants. It holds a participants tile with
participant-1 through participant-8; a packages tile with core, cards,
journal, calendar, chat, and theme; and the update-notice and take-a-piece
tiles.

The fourth stage is the-cube. It holds points; replicate-and-create;
public-cube; deployed-items; a faces tile with top-face, front-face, and
side-face under it; more-dimensions; and slice.

The fifth stage is the-sentence. It holds a sentence tile with one tile per
word, each pointing at the behaviour that owns that word; then automatons; a
debugging tile, with one tile per debugging word under it; flavours; and
tapestry.

The transition bee also gets its own tile, so its code can be read and copied
like everything else.

The participants, domains, and packages are tiles in their own right. The
eight-participant strip, the cubes, and the sentence paths all draw from those
same tiles rather than keeping their own copies.

## 10. The phases

The work starts small and grows. Each phase leaves something usable.

**Phase one: get the tiles into the hive.** Create the whole tree, with names
only and empty pages. That includes the five stages, the shared objects, and
the transition bee's tile. At the end of this phase the presentation already
exists as hexagons anyone can walk.

**Phase two: lay down the work.** On each tile, leave a note saying what it
must show, which document it explains, and which code it points to. The to-do
list then lives on the tiles themselves, so anyone, a person or a model, can
pick up a piece.

**Phase three: build each object.** Each tile gets its own page, and each
page works on its own. The shared objects come first, the participant, the
domain, the package, and the revision, because several stages reuse them. The
trial bubble, the cube, the public cube at the root, and the sentence path are
objects too, so they can be worked on in parallel without waiting for each
other.

**Phase four: tie it together.** The stage pages arrange the objects. The
links get their explore and next. The transition bee does the lift and the
reshaping, and the objects animate into place.

### One layer at a time, and the documentation moves with it

The tree is built one layer at a time, always the first layer under a tile
that already exists, and each layer is reviewed before the next one goes in.
The tile at the top is called hypercomb.

The tree also restructures all of the documentation. Every document is
assigned to exactly one tile, the tile whose part of the story explains it.
When a tile is planted, it carries a note naming what it is and the documents
it gathers. When that tile's own children are planted later, its documents
are divided among them, one level further down. In the first layer, all two
hundred and forty-two documents are already assigned to one of the stage
tiles. That first assignment was made from each document's title, so it is
a starting point to review, not a final placement.

The tree, with each tile's note and documents, lives in one file. A small
script plants one layer from it by speaking to the hive: it says go, then
create for each new tile, then files the note on each one. It sends no raw
operations. A dry run prints the sentences without saying them, and they can
also be typed by hand on the command line.

There is also an existing narrated video presentation of Hypercomb, built
from scenes with recorded narration. Its scenes and narration are material
this presentation can draw on, and its own tile can sit in the tree like any
other piece.

### Who does what

This follows the pattern the proposal sites already use: a tree file, the
pages, a local preview, and a stamp step that writes the tiles and pages into
the hive. A cloud session can write the tree, the notes, and the pages, and
check them in a headless browser. The stamp runs on the owner's machine,
because the hive and its bridge are not reachable from the cloud. After that,
the tiles are edited in the hive like any others. The transition bee is real
module code and is built in phase four, once there are pages for it to hand
over to.

The presentation then goes through the very lifecycle it describes. It is
drafted on a trial subdomain, debugged in sentences, reviewed, and promoted
with one pointer move into its publisher's public cube, and its followers get
the update badge.

## 11. What is built, and what is not

The slides should be honest about this.

**Already built:** the hive as a private workbench in your browser; hosting
your hive from your own computer, from the desktop app; claiming a domain
with one sentence, live once its host
pieces are deployed; a domain's showcase at its root; publishing as bytes
first, then a pointer; trial subdomains with their isolation, the
what-changed panel, signed reviews, and the rule that every draft waits for a
human, all proven on the owner's machine; promotion and withdrawal as pointer
moves; the debugging words, module trials, changes, audit, review, assess,
take, and drop, with brood accept; update notices with upgrade and skip;
taking one piece of a trial into your own build and committing it; the
minified package and its re-derive check; sentences as the command line, with
their reach worked out and changes held for approval; a tile's own page; the
slides behaviour and the enroll relation; and returning to exactly where you
came from.

**Proposed, not built:** the public cube as a view at the root domain; one
sentence running modules in other participants' cubes and bringing the
results back, still a hypothesis in the spoken-programs document; a word for
stepping one point of a slice through its versions; choosing the start-up pin
from the publisher's signed pointer; keying code trust by publisher as well
as domain; the transition bee; the dimension picker; and the cube reading
real tile history.

**To confirm before the slides say it:** whether the trial host is deployed on
the public domains today, or still only proven locally.

**A picture, not the data model:** the cube's version axis. Real versions are
signatures for each tile, not shared numbered layers. Revision two in one
domain and revision two in another are different things. The cube lines them
up so the eye can compare them; the first slide of stage four says this once.

**A framing to confirm:** a slice, and a debugging session, as a set of
signatures you can hand to someone. It matches how a build record or a commit
names a whole set of files, but there is no slice object today.

## 12. Where the story and the documents differ

1. **Where the workbench is.** The workbench is hypercomb.io, or your own
   host's root domain, private to your machine. A trial subdomain is not the
   workbench: it is the public door where others try and review a change. It
   lives at try, dash, and the site's name, and promotion makes it the site
   itself. Earlier drafts of this plan called the trial the workbench; that
   was wrong.
2. **Which version is the truth.** For a visitor, the deployment is the
   minified package. But the documents treat the readable package as the
   truth, and the minified one as derived from it. The slides keep that link
   visible, because it is what keeps minified code checkable.
3. **Keeping every version.** Nothing is ever deleted, and old heads keep
   resolving. But a host only holds what was sent to it, and sharing a
   branch's full history is a per-branch choice. Versions last because they
   are replicated, which is exactly what the overlap in stage three shows. No
   single host keeps everything.
4. **Merging.** Two developers' changes are not merged into one. They exist
   side by side, and anyone can build on either. Taking a piece and laying it
   into your own build is the built way to combine work.
5. **What the root shows.** Today a domain's root shows its showcase. The
   public cube is a new view of the same published points, not a replacement
   for the showcase.

## 13. Open decisions

1. **Participant names.** The hosts already carry six real domains:
   hypercomb.com, pluginthematrix.com, realones.online, cafesociety.buzz,
   jwize.com, and pointblanksolutions.ca. Use these six plus two generic
   participants, or keep all eight generic?
2. **Sentences across cubes.** Label the slides that run one sentence across
   several participants' cubes as where this is going, or present them as
   working?
3. **Tile names.** Accept the draft tree as it is, or rename first?
4. **The language axis.** This plan takes each word as one position on the
   axis, with its different implementations as separate points at that
   position. The other reading is one position per dialect, with a word
   spanning several. Which is right?
5. **Turning the cube.** This plan has the points slide into their groups as
   a face comes forward. The alternative keeps the points fixed and shows the
   flattening as a shadow on the face. Which is right?
6. **The extra dimensions.** Which ones should the dimension picker offer
   first: platform, locale, audience, reviews, or others?
7. **The root view.** Should the public cube become a choice beside the
   showcase at the root, or what the root shows by default?
8. **Order of the slides.** Confirm where playback order is kept once slides
   are joined with the enroll word.
9. **Links from the slides view.** Confirm whether a page's link can open a
   child tile from inside the slides view, or only from the website view.

---

## References

Kept apart so they can be skipped when listening.

- Domains and names: [domain-claim.md](domain-claim.md),
  [domain-folder-sharing.md](domain-folder-sharing.md),
  [swarm-pools.md](swarm-pools.md), [hosted-tenants.md](hosted-tenants.md),
  [showcase.md](showcase.md)
- Hosting and hosts: [becoming-a-host.md](becoming-a-host.md),
  [hosting-from-a-machine.md](hosting-from-a-machine.md),
  [read-only-deployment.md](read-only-deployment.md)
- Trial subdomains, isolation, review, promote, take a piece, and the
  debugging words: [module-sandbox.md](module-sandbox.md),
  `hypercomb-essentials/src/assistant/module.queen.ts`
- Minify and re-derive: [derivations.md](derivations.md)
- Publishing a revision: [publishing-a-revision.md](publishing-a-revision.md)
- Stages of a creation: [deployment-stages.md](deployment-stages.md)
- Update notices, upgrade and skip: [using-a-creation.md](using-a-creation.md)
- Build records: [build-revisions.md](build-revisions.md)
- Tile pages: [embedded-sites.md](embedded-sites.md)
- Slides and the enroll relation: [website-artifact-paradigm.md](website-artifact-paradigm.md),
  `hypercomb-essentials/src/commands/present.queen.ts`,
  `hypercomb-essentials/src/presentation/tiles/slides-view.drone.ts`
- Pieces reused by signature: [piece-protocol.md](piece-protocol.md)
- One address, many implementations, and marks as views:
  [superimposition.md](superimposition.md)
- Sentences as programs: [spoken-programs.md](spoken-programs.md),
  [speak-dont-bridge.md](speak-dont-bridge.md),
  [every-act-has-a-word.md](every-act-has-a-word.md)
- Translations as a dimension: [community-translations.md](community-translations.md)
- Navigation: [orthogonal-viewer-navigation.md](orthogonal-viewer-navigation.md),
  [stepping-into-a-view.md](stepping-into-a-view.md)
- Three dimensions: [three-js-migration-plan.md](three-js-migration-plan.md)
- The stamp pattern: [proposal-sites.md](proposal-sites.md)
- The tree and the planting script: `scripts/bridge/living-presentation/tree.cjs`,
  `scripts/bridge/living-presentation/plant.cjs`, `npm run living:plant`
- The narrated video presentation: `scripts/presentation/`
- Images: `src/01-hive.png`, `src/04-inside.png`, `src/shot-publications.png`,
  `src/documentation/assets/diagrams/`
