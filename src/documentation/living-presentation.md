# The living presentation — a plan to review

**Status: plan, for review. Second revision, 2026-10-30. Nothing here is
built.** This page gathers the whole plan for an interactive presentation of
how Hypercomb works. It is written to be listened to: plain sentences, no
tables, and every file reference kept in the last section so it can be
skipped when read aloud.

What changed in this revision: the cube is now a cloud of points, one point
for each tile, and each face of the cube is a different view of the same
points. Domains and subdomains have their own section, and the subdomain is
now described as the debugging environment: fully isolated, working on
stable files, with every publisher's path to their running code kept intact.
There is one cube for each domain of each participant, served from their own
hosts. Each participant builds their cube by replicating other people's
packages and creating their own, and the cubes join into a tapestry through
the signatures they share.
The published points of a domain make up the public cube that everyone
debugs against. All of this is tied into the stages where it fits.

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

The story builds toward one picture. A cube of points, where every point is a
tile, and where turning the cube shows the same tiles divided three ways: by
the server that hosts them, by the words of the language they answer, and by
version. Everything before the cube is there so the viewer understands what
each point is, where it lives, and how it got there.

There is a cube for each domain of each participant. A participant's domain
is served from their own hosts, and it is their cube. No one else's cube
contains it. The cubes connect through the signatures they share: when two
cubes hold the same point, a thread joins them. Starting from the root and
running outward, those threads weave the cubes into a tapestry of connected
domains. Every cube has the same shape and is read the same way, and a
signature means the same thing in every cube that holds it. That symmetry is
what lets people share in each other's work, and it is what the presentation
ends on.

## 2. Every piece of the presentation is a tile

Every element you see on screen is its own tile in the hive. A server is a
tile. A domain is a tile. Each subdomain, each package, each revision, each
face of the cube, and each word of a sentence is a tile.

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

This section is the explanation that stage two's slides, the eight servers,
and the cube all draw on. It is told here in full, once.

### A domain is yours

A participant claims a domain with one sentence: domain claim, followed by the
domain name. The hive answers with two nameservers. The participant sets them
at their registrar, and that change is the proof that they control the
domain. Nothing else is asked.

From then on, the bare domain is their front door, and every name under it,
every subdomain, is a place they can switch on. Nobody else can publish
there. The key that claimed the domain is the key that publishes to it.

Each participant's domain is served from their own hosts. That domain, with
all its names and all its versions, is one participant's cube in the
pictures that follow. Their subdomains, trials included, are inside their
cube, not cubes of their own.

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

Every change starts life on a trial subdomain. Its name is the word "try",
a dash, and the name of the site it will become. A trial for the cards site
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
Auditing a trial from your own hive runs nothing at all: it fetches the
changed files by signature and compares them with what you run.

The what-changed panel always shows where a change stands, in four steps:
draft, trial, reviewed, and your choice. At the last step, anyone can take
the change into their own hive, where it is held until they accept it. Only
the publisher can promote it or withdraw it.

### Promotion is one pointer move

When a trial is ready, promoting it moves one pointer. The site now opens on
exactly the files the trial ran. Nothing is rebuilt and nothing is uploaded
again. Withdrawing a trial removes its pointer; the trial address then says
there is nothing here, and its files stay in the root under their signatures,
unreachable but never deleted.

### Why everyone's files stay stable

Put these together and every person can work at their own level on files that
do not move under them.

**No version is removed.** Bytes are never deleted. A new version is a new
head, and every old head still resolves. If you stand on revision one, it
keeps working for as long as any host serves it.

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

## 6. The five stages

The stages share one picture. A strip of servers runs across the top of the
screen. It starts as a single server in stage one, opens up to show its
domain and subdomains in stage two, splits into eight in stage three, and
becomes a cube of points in stage four. The cube stays for stage five.

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

**Slide one, a domain and its names.** The server opens to show one domain,
using the real Plugin the Matrix publications page with its subdomains for
Revolución, Meetup, Arkanoid, and others. All the names lead to one root
folder. Click a subdomain and you see that it holds no files, only a pointer
in the signed index. Press publish and the viewer watches the two steps: the
bytes drop into the root, then the pointer moves. The old pointer's files are
still there, and the old version still opens.

**Slide two, the trial subdomain.** A trial appears beside the cards site,
drawn inside its own bubble: try-cards. The bubble shows its walls: its own
storage, no writes, no keys, no reach into your machine. The viewer edits one
line of the draft and watches its signature change. Then three more trial
bubbles appear, other people working on the same package at once, and none of
them touches the others or the live site. The four steps of the what-changed
panel run along the bottom: draft, trial, reviewed, your choice. Signed
reviews from the host's AI and from people gather on the bubble.

**Slide three, promote, and the visitor's exact version.** The publisher
promotes. The bubble's pointer slides over to the cards site; no file moves.
The visitor's copy then goes through the minify step and comes out smaller,
with its own tree of signatures that still names the readable source it came
from. A slider moves between the readable and minified versions and shows
the real numbers: the package went from about nine megabytes to about six. A
visitor gets that exact version, pinned to its root signature, and it never
changes underneath them. A re-derive button runs the minify step again on the
readable source and arrives at the same root, which is how anyone can check
that the minified code is exactly what it claims to be.

Stage two ends with the lifecycle as a loop: draft, trial subdomain, review,
promote, deployed, visitors pinned, and back to the next draft. This loop
becomes a small icon that every server carries from stage three on.

### Stage three: eight servers, revisions, and checking in

**Slide one, the split.** The single server rises and splits into eight. On a
phone they form two rows of four. Each one is a participant serving their own
domain from their own hosts, and each shows its live subdomains as solid
lanes and its trial subdomains as small bubbles at the edge.

Each participant has their own colour, and every colour also has a pattern,
so colour is never the only signal. A filled chip is a package this
participant published. A hatched chip, in another participant's colour, is a
package this participant replicated from someone they follow; it keeps its
original signature and colour. A chip inside a bubble is a trial, not yet
promoted. Stacked rings on a chip are the revisions it holds.

There are six packages: a shared core, cards, journal, calendar, chat, and
theme. Each server carries two to four of them, so every package sits on at
least three servers, and cards sits on five. That overlap is what the rest of
the story depends on. Click a package and every server holding the same
signature lights up. It is stored once on each, and every copy is identical
and checkable, so it does not matter which server answers.

**Slide two, someone changes a shared package.** The developer on server
three works on cards in a trial bubble, then promotes it. The new bytes have
a new signature, so this is revision two. A small notification badge appears
on the servers that follow server three and have updates turned on. Nothing
moves on its own; a version you hold stays until you choose. Servers that do
not follow it stay on revision one, and revision one still works, because
nothing is ever deleted. A visitor pinned to revision one is not affected at
all.

At the same time, the developer on server six also starts from revision one,
in their own trial bubble, and makes their own revision two. Both versions
exist side by side, with different signatures and their own histories.
Neither overwrites the other, and anyone can build on either one. A trace
line runs from each server's domain through its signed index to its running
code, and every line stays whole through all of this. That is the picture of
every publisher keeping a clean path.

**Slide three, take it whole, or take a piece.** Open a badge and you have
three choices. **Upgrade** takes the revision as it is. **Skip** leaves it.
**Take a piece** takes only one layer of it into your own hive, at its own
path, and leaves the rest of your build exactly as it was. The piece is held
until you accept it, and when you commit, it is laid into your build where it
belongs. The viewer drags one layer from revision two into their own server's
build and watches everything else stay put.

This is what makes so many flavours possible. Everyone can mix the pieces
that suit their own build or machine, plug them in, and pass their mix on.

### Stage four: the cube of points

Each of the eight participants' domains rises into its own cube, and the view
moves into one of them. **There is one cube per domain per participant.** A
cube is a cloud of points, and **each point is one tile**: a specific
automaton, one implementation at one version.

**You build your cube by replicating other people's work and creating your
own packages.** Every package you take from someone you follow is replicated
onto your own hosts, under its original signature, and becomes points in your
cube. Every package you make becomes points of your own.

Every point sits on three axes. Across is the **source**: where the point's
implementation comes from. The participant's own packages sit at the centre,
and the domains they replicated from spread out on either side, so the cube
grows from its own root outward. Into the page is the **language**, the word
of the grammar the point answers. Down is the **version**, newest at the top.

Not every position has a point. An empty spot means this domain has no
implementation of that word at that version from that source. One spot can also hold more than one point: the
two separate revision twos from stage three sit side by side. Trial points
float just outside the lattice, each in its own small bubble, because they are
not part of anything that runs until they are promoted. When one is
promoted, it drops into place.

**The published points are the public's cube.** What a participant has
published, every version of it, is the cube everyone else sees of their
domain. It is the cube the public debugs against. Their drafts and trials are
not in it: those stay in bubbles at the edge until they are promoted, and
then they join the public cube for good, because a published version is never
removed. So the public always debugs against a cube that only grows and never
shifts under them.

**Slide one, the points.** The cube fills in point by point. Each point
glows in the colour of the participant it came from. You can turn the cube freely, and clicking a
point opens its tile.

**Slide two, three faces, three views of the same points.** Turning the cube
to a face flattens one axis away, and the points slide into the groups that
face shows. The points never change. Only the way they are divided changes.

- **The top face** flattens the versions. It shows sources against words:
  what this domain runs right now, and whose work each piece is. Picking a
  row draws a line through one word across every source.
- **The front face** flattens the words. It shows sources against versions:
  how the participant's own work, and each piece they took, has changed over
  time.
- **The side face** flattens the sources. It shows words against versions.
  This is the language view: every implementation of every word in this
  domain, and how it changed, wherever it came from.

**Slide three, slices.** A slice is one point chosen for each word. Every
slice whose choices fit together is a working build. A slice is not a flat
plane through the cube. It is a bent surface that dips to different depths and
crosses between sources. You can grab a point and drag the slice up or down
to a different version, or across to another participant's implementation;
dependency lines show whether it still fits.

The cube is drawn from demo data at first. A later step can draw it from the
real history of the package tiles, so that changing a tile in the hive adds a
new point to the cube.

### Stage five: working in the cube

**Slide one, the sentence is a path.** Turn the cube to the side face, the
language view. A natural-language sentence runs across it, for example:
module take cards from the third participant's domain, into journal,
publish.

In Hypercomb, natural language is the scripting language. A sentence typed on
the command line is the program. Each word is declared by the behaviour that
owns it, and how far a sentence reaches is worked out before it runs.

A sentence is a path through the points, one point for each word. On the
language face it reads as a straight line of words. Turn the cube, and the
same path zigzags across sources and depths, because each word may be
answered by a point from a different participant at a different version. A
word can also reach out of this cube, to a point in another participant's
cube, served from their own hosts. That path is the call, crossing the cube,
and across cubes, to run modules wherever they live.

Then comes the key idea: **the same grammar, run by different automatons.**
Keep the words and choose different points, and the same sentence runs
through different implementations. A word means one thing everywhere. The
implementation behind it is a mark on the tile.

Press run and each word lights up as its point runs, and the results travel
back along the path. Before anything runs, the path shows which domains the
sentence will touch, and every step that would change something waits for
your approval.

**Slide two, debugging across domains and subdomains.** A sentence fails. On
the language face the break shows on one word's point, so you know which
implementation, from whose domain, at which version. You open a trial
subdomain of your own domain to work on it. The trial is sealed, so nothing you do there can
disturb the live site or anyone else's trial, and every other point the
sentence uses stays exactly where it was, because no version has been
removed. You step that one point up or down its versions, halving the range
each time, until the sentence runs again. Other people can open their own
trials on the same word at the same time.

Everyone debugs against the same thing: the published cubes. A stranger
debugging your word sees exactly the points you published, at every version,
served from your own hosts. Once your fix is promoted, it becomes a new point
in your public cube, and every person debugging against it can now choose
it.

The failing sentence and its slice are just a set of signatures, so you can
hand them to the owner of that point and they get exactly the same run.
Reading a trial's changes gives the same answer whichever host you read it
from.

**Slide three, flavours, plug and play, and the tapestry.** Zoom out to many
slices through one cube. Each slice is a different flavour of the same
program, and anyone can make a new one by moving a single point. The viewer
can shuffle through working slices; each one says how many points changed and
from whose domain.

Then the view pulls back out of the one cube, and all eight participants'
cubes come into sight, each served from its owner's own hosts. Every thread
lights up at once: wherever two cubes hold the same point, a line joins them.
These are the pieces taken from one domain into another, the follows between
domains, and the sentence paths that cross from cube to cube. Starting from
the root and running outward, the threads weave the cubes into a tapestry of
connected domains. The cubes turn together to show their symmetry: every
cube has the same shape and is read the same way, and the same signature sits
at the same word in every cube that holds it. Anyone can add a cube of their
own, join it to the others by taking a piece, and share in what everyone else
has made.

The stage closes on the development process in one loop. You say what you
want in a sentence. It is drafted in a trial subdomain, reviewed in public,
and promoted with one pointer move. The people who follow you get a badge,
and they take it whole or in pieces, on their own time, on files that never
move under them. The closing line comes from the repository itself: the hive
is the sum of what we bring to it.

## 7. Images from the hive

The presentation uses real pictures from the hive wherever it can:

- the empty hive, for the opening;
- the hive with the behaviours panel open, showing the slides behaviour;
- the Plugin the Matrix publications page, with its subdomains, for stage
  two;
- the existing diagrams of the runtime lifecycle, the website pipeline, and
  the participant loop.

Screenshots from the live hive, such as real tiles, the packages window, the
what-changed panel, the trial bar, and a real update notice, would be better
than anything drawn, and can replace the drawings as they arrive.

## 8. The tile tree

This is the draft tree. The names become the routes, so they should be agreed
before phase one.

The root tile is called how-hypercomb-works. It is the website artifact, and
it plays with the present word. It has five stage tiles.

The first stage is one-server. It holds a server tile, with signed-index,
sig-named-files, and install-pointers under it; a host tile, with host-api
under it; a client tile, with core and opfs under it; and a request tile, with
verify-on-arrival under it.

The second stage is domains-and-subdomains. It holds a domain tile, with
claim, root-folder, and names-are-pointers under it; a publish tile, with
bytes-first and pointer-moves under it; a trial-subdomain tile, with
isolation, what-changed, and reviews under it; a promote tile; a minify tile;
a visitor-pin tile; and a stable-files tile, with no-version-removed,
clean-paths, and honest-limits under it.

The third stage is eight-servers. It holds a servers tile with server-1
through server-8; a packages tile with core, cards, journal, calendar, chat,
and theme; and the update-notice and take-a-piece tiles.

The fourth stage is the-cube. It holds points; public-cube; a faces tile with
top-face, front-face, and side-face under it; and slice.

The fifth stage is the-sentence. It holds a sentence tile with one tile per
word, each pointing at the behaviour that owns that word; then automatons,
debugging, flavours, and tapestry.

The transition bee also gets its own tile, so its code can be read and copied
like everything else.

The servers, domains, and packages are tiles in their own right. The
eight-server strip, the cube, and the sentence path all draw from those same
tiles rather than keeping their own copies.

## 9. The phases

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
page works on its own. The shared objects come first, the server, the domain,
the package, and the revision, because several stages reuse them. The trial
bubble, the cube, and the sentence path are objects too, so they can be
worked on in parallel without waiting for each other.

**Phase four: tie it together.** The stage pages arrange the objects. The
links get their explore and next. The transition bee does the lift and the
reshaping, and the objects animate into place.

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
drafted on a trial subdomain, reviewed, and promoted with one pointer move,
and its followers get the update badge.

## 10. What is built, and what is not

The slides should be honest about this.

**Already built:** claiming a domain with one sentence, live once its host
pieces are deployed; publishing as bytes first, then a pointer; trial
subdomains with their isolation, the what-changed panel, signed reviews, and
the rule that every draft waits for a human, all proven on the owner's
machine; promotion and withdrawal as pointer moves; update notices with
upgrade and skip; taking one piece of a trial into your own build and
committing it; the minified package and its re-derive check; sentences as the
command line, with their reach worked out and changes held for approval; a
tile's own page; the slides behaviour and the enroll relation; and returning
to exactly where you came from.

**Proposed, not built:** one sentence running modules on several servers and
bringing the results back along the path. The spoken-programs document still
marks this as a hypothesis. Choosing the start-up pin from the publisher's
signed pointer. Keying code trust by publisher as well as domain. The
transition bee. The cube reading real tile history.

**To confirm before the slides say it:** whether the trial host is deployed
on the public zones today, or still only proven locally.

**A picture, not the data model:** the cube's version axis. Real versions are
signatures for each tile, not shared numbered layers. Revision two in one
domain and revision two in another are different things. The cube lines them
up so the eye can compare them; the first slide of stage four says this once.

**A framing to confirm:** a slice as a signature you can hand to someone. It
matches how a build record or a commit names a whole set of files, but there
is no slice object today.

## 11. Where the story and the documents differ

1. **Workbench naming.** The story now uses the real naming: a trial lives at
   try, dash, and the site's name, and promotion makes it the site itself. If
   a simpler phrase is wanted on the top-level slides, the level below should
   still show the real names.
2. **Which version is the truth.** For a visitor, the deployment is the
   minified package. But the documents treat the readable package as the
   truth, and the minified one as derived from it. The slides keep that link
   visible, because it is what keeps minified code checkable.
3. **Keeping every version.** Nothing is ever deleted, and old heads keep
   resolving. But a server only holds what was sent to it, and sharing a
   branch's full history is a per-branch choice. Versions last because they
   are copied across servers, which is exactly what the overlap in stage
   three shows. No single server keeps everything.
4. **Merging.** Two developers' changes are not merged into one. They exist
   side by side, and anyone can build on either. Taking a piece and laying it
   into your own build is the built way to combine work.

## 12. Open decisions

1. **Server names.** The hosts already carry six real zones: hypercomb.com,
   pluginthematrix.com, realones.online, cafesociety.buzz, jwize.com, and
   pointblanksolutions.ca. Use these six plus two generic servers, or keep
   all eight generic?
2. **Sentences across domains.** Label stage five's first slide as where this
   is going, or present it as working?
3. **Tile names.** Accept the draft tree as it is, or rename first?
4. **The language axis.** This plan takes each word as one position on the
   axis, with its different implementations as separate points at that
   position. The other reading is one position per dialect, with a word
   spanning several. Which is right?
5. **Turning the cube.** This plan has the points slide into their groups as
   a face comes forward. The alternative keeps the points fixed and shows the
   flattening as a shadow on the face. Which is right?
6. **Order of the slides.** Confirm where playback order is kept once slides
   are joined with the enroll word.
7. **Links from the slides view.** Confirm whether a page's link can open a
   child tile from inside the slides view, or only from the website view.

---

## References

Kept apart so they can be skipped when listening.

- Domains and names: [domain-claim.md](domain-claim.md),
  [domain-folder-sharing.md](domain-folder-sharing.md),
  [swarm-pools.md](swarm-pools.md), [hosted-tenants.md](hosted-tenants.md)
- Hosting and hosts: [becoming-a-host.md](becoming-a-host.md),
  [hosting-from-a-machine.md](hosting-from-a-machine.md),
  [read-only-deployment.md](read-only-deployment.md)
- Trial subdomains, isolation, review, promote, take a piece:
  [module-sandbox.md](module-sandbox.md)
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
- One address, many implementations: [superimposition.md](superimposition.md)
- Sentences as programs: [spoken-programs.md](spoken-programs.md),
  [speak-dont-bridge.md](speak-dont-bridge.md),
  [every-act-has-a-word.md](every-act-has-a-word.md)
- Navigation: [orthogonal-viewer-navigation.md](orthogonal-viewer-navigation.md),
  [stepping-into-a-view.md](stepping-into-a-view.md)
- Three dimensions: [three-js-migration-plan.md](three-js-migration-plan.md)
- The stamp pattern: [proposal-sites.md](proposal-sites.md)
- Images: `src/01-hive.png`, `src/04-inside.png`, `src/shot-publications.png`,
  `src/documentation/assets/diagrams/`
