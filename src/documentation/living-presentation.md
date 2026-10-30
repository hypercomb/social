# The living presentation — a plan to review

**Status: plan, for review (2026-10-30). Nothing here is built.** This page
gathers the whole plan for an interactive presentation of how Hypercomb works.
It is written to be listened to: plain sentences, no tables, and every file
reference kept in the last section so it can be skipped when read aloud.

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
version. The people who follow it get a small notice and can take the new
version, or just one piece of it, or nothing at all.

## 2. Every piece of the presentation is a tile

Every element you see on screen is its own tile in the hive. A server is a
tile. A host is a tile. Each package, each revision, each face of the cube,
and each word of a sentence is a tile.

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

## 5. The five stages

The stages share one picture. A strip of servers runs across the top of the
screen. It starts as a single server in stage one, splits into eight in stage
three, and tips back into a cube in stage four. The cube stays for stage five.

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
address opens on, and install pointers, which name the current package. A
server only shares what the current hive reaches; nothing else leaves. Click
a file and you see that its name is the hash of its own bytes.

**Slide three, one request from start to finish.** A visitor types an
address. The core reads which publisher and which tile that domain is bound
to, reads the publisher's signed index, finds the current root signature, and
then fetches each file by its signature. Every file is checked as it arrives.
A tamper button corrupts one file on the server, and the visitor refuses it.
This is why a stranger's server is safe to use: the worst it can do is fail
to answer. It cannot change what you get.

### Stage two: from workbench to deployment

**Slide one, the subdomain is the workbench.** This slide uses the real
publications page from Plugin the Matrix, with its subdomains for Revolución,
Meetup, Arkanoid, and others. A draft lives on its own trial subdomain, a
name that starts with "try" followed by a dash. It runs readable source that
has not been minified, and it runs on its own origin, so its storage is its
own sandbox and nothing it does touches anyone's hive. The host's AI and the
public can read it there and leave signed reviews beside it. The viewer can
edit one line of the draft and watch its signature change.

**Slide two, minify and publish.** The readable package goes through the
minify step and comes out as a smaller package with its own tree of
signatures. The minified package still names the readable source it came
from, one step back. Publishing is then a single pointer move. Nothing is
rebuilt and nothing is uploaded again; the deployment address simply starts
opening the same signed files the draft ran. A slider moves between the
readable and minified versions, and shows the real numbers: the package went
from about nine megabytes to about six.

**Slide three, the visitor gets one exact version.** A visitor to the
deployed address gets the minified package, pinned to its exact root
signature. It is faster and smaller, and it never changes underneath them. A
re-derive button runs the minify step again on the readable source and
arrives at the same root, which is how anyone can check that the minified
code is exactly what it claims to be.

Stage two ends with the lifecycle drawn as a loop: draft, workbench, review,
promote, deployed, visitors pinned, and back to the next draft. This loop
becomes a small icon that every server carries from stage three on.

### Stage three: eight servers, revisions, and checking in

**Slide one, the split.** The single server rises and splits into eight. On
a phone they form two rows of four. Each publisher has its own colour, and
every colour also has a pattern, so colour is never the only signal. A filled
chip is a package this server's owner published. A hatched chip, in another
publisher's colour, is a package this server hosts for someone else. A dashed
chip is a draft on a workbench, not yet promoted. Stacked rings on a chip are
the revisions it holds.

There are six packages: a shared core, cards, journal, calendar, chat, and
theme. Each server carries two to four of them, so every package sits on at
least three servers, and cards sits on five. That overlap is what the rest of
the story depends on. Click a package and every server holding the same
signature lights up. It is stored once on each, and every copy is identical
and checkable, so it does not matter which server answers.

**Slide two, someone changes a shared package.** The developer on server
three changes cards on their workbench and promotes it. The new bytes have a
new signature, so this is revision two. A small notification badge appears on
the servers that follow server three and have updates turned on. Nothing
moves on its own; a version you hold stays until you choose. Servers that do
not follow it stay on revision one, and revision one still works, because
nothing is ever deleted. A visitor pinned to revision one is not affected at
all.

At the same time, the developer on server six also starts from revision one
and makes their own revision two. Both versions exist side by side, with
different signatures and their own histories. Neither overwrites the other,
and anyone can build on either one.

**Slide three, take it whole, or take a piece.** Open a badge and you have
three choices. **Upgrade** takes the revision as it is. **Skip** leaves it.
**Take a piece** takes only one layer of it into your own hive, at its own
path, and leaves the rest of your build exactly as it was. When you commit,
that piece is laid into your build where it belongs. The viewer drags one
layer from revision two into their own server's build and watches everything
else stay put.

This is what makes so many flavours possible. Everyone can mix the pieces
that suit their own build or machine, plug them in, and pass their mix on.

### Stage four: the cube

The strip of eight servers tips back and becomes the top face of a cube. The
cube has three directions. Across is the servers, all eight. Into the page is
the packages, all six. Downward is the revisions, newest at the top.

**Slide one, the top is the present.** The top face is what every server runs
right now, in the colours from stage three. Each column going down is the
full revision history of one package on one server, and nothing in it is ever
deleted. You can turn the cube freely and click a column to read its
revisions.

**Slide two, shift forward: a line through one package.** Turn the front face
toward you and one row becomes a single package across all eight servers. You
can see at a glance who runs revision one, who runs revision two, and who
took only a piece. You pick which package is the front row.

**Slide three, shift up: the version layers.** Each horizontal layer is one
level of versions, and a version at one level can connect to versions at any
other level. A slice is one choice of version for every package and server.
A slice is not a flat plane. It is a bent surface that dips to different
depths, and every slice that fits together is a working build. You can grab a
cell and drag it up or down; the slice bends, and dependency lines show
whether it still fits.

The cube's depth is drawn from demo data at first. A later step can draw it
from the real history of the package tiles, so that changing a package tile
in the hive adds a new ring to the cube.

### Stage five: working in the cube

**Slide one, the third face: the sentence.** Turn the cube so its third face
comes forward. A natural-language sentence runs across it, for example:
module take cards at server three, into journal, publish.

In Hypercomb, natural language is the scripting language. A sentence typed on
the command line is the program. Each word is declared by the behaviour that
owns it, and how far a sentence reaches is worked out before it runs.

On the sentence face, a thread drops from each word to the cell that answers
it: a module, on a server, at a revision. One sentence crosses several
servers and several depths, and that line is the path of the call through
the cube.

Then comes the key idea: **the same grammar, run by different automatons.**
Keep the sentence fixed and change the slice underneath it. The threads move
to different cells. The same words are now run by different implementations.
A word means one thing everywhere, and the implementation behind it is just a
mark on the tile.

Press run and each word lights up as its module runs, and the results travel
back along the line. Before anything runs, the line shows which servers the
sentence will touch, and every step that would change something waits for
your approval.

**Slide two, debugging along the line.** A sentence fails. On the sentence
face, the break shows on one word's thread, so you know which module, on which
server, at which revision. You move only that cell up or down its revision
column, halving the range each time, until the sentence runs again. The
failing sentence and its slice are just a set of signatures, so you can hand
them to that module's owner and they get exactly the same run. Reading a
trial's changes gives the same answer whichever server you read it from.

**Slide three, flavours, plug and play.** Zoom out to many slices through one
cube. Each slice is a different flavour of the same program, and anyone can
make a new one by moving a single cell. The viewer can shuffle through
working slices; each one says how many cells changed and from whose server.

The stage closes on the development process in one loop. You say what you
want in a sentence. It is drafted on a subdomain, reviewed in public, and
promoted. The people who follow you get a badge, and they take it whole or in
pieces. The closing line comes from the repository itself: the hive is the
sum of what we bring to it.

## 6. Images from the hive

The presentation uses real pictures from the hive wherever it can:

- the empty hive, for the opening;
- the hive with the behaviours panel open, showing the slides behaviour;
- the Plugin the Matrix publications page, with its subdomains;
- the existing diagrams of the runtime lifecycle, the website pipeline, and
  the participant loop.

Screenshots from the live hive, such as real tiles, the packages window, and
a real update notice, would be better than anything drawn, and can replace
the drawings as they arrive.

## 7. The tile tree

This is the draft tree. The names become the routes, so they should be agreed
before phase one.

The root tile is called how-hypercomb-works. It is the website artifact, and
it plays with the present word. It has five stage tiles.

The first stage is one-server. It holds a server tile, with signed-index,
sig-named-files, and install-pointers under it; a host tile, with host-api and
domain under it; a client tile, with core and opfs under it; and a request
tile, with verify-on-arrival under it.

The second stage is workbench-to-deployment. It holds workbench, minify,
promote, and visitor-pin.

The third stage is eight-servers. It holds a servers tile with server-1
through server-8; a packages tile with core, cards, journal, calendar, chat,
and theme; and the update-notice and take-a-piece tiles.

The fourth stage is the-cube. It holds top-face, front-face, version-layers,
and slice.

The fifth stage is the-sentence. It holds a sentence tile with one tile per
word, each pointing at the behaviour that owns that word; then automatons,
debugging, and flavours.

The transition bee also gets its own tile, so its code can be read and copied
like everything else.

The servers and packages are tiles in their own right. The eight-server strip,
the cube, and the sentence face all draw from those same tiles rather than
keeping their own copies.

## 8. The phases

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
page works on its own. The shared objects come first, the server, the
package, and the revision, because several stages reuse them. The cube and the
sentence face are objects too, so they can be worked on in parallel without
waiting for each other.

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
drafted on a trial subdomain, reviewed, and promoted, and its followers get
the update badge.

## 9. What is built, and what is not

The slides should be honest about this.

**Already built:** update notices with upgrade and skip; taking one piece of a
trial into your own build, and committing it; trials on subdomains with
public reviews; the minified package and its re-derive check; sentences as the
command line; working out a sentence's reach and holding changes for approval;
a tile's own page; the slides behaviour and the enroll relation; and returning
to exactly where you came from.

**Proposed, not built:** one sentence running modules on several servers and
bringing the results back along the line. The spoken-programs document still
marks this as a hypothesis. The transition bee does not exist yet. The cube
reading real tile history is a later step.

**A picture, not the data model:** the cube's revision layers. Real revisions
are signatures for each package, not shared numbered layers. Revision two on
one server and revision two on another are different things. Slide three of
stage four says this once, and the picture carries the rest.

**A framing to confirm:** a slice as a signature you can hand to someone. It
matches how a build record or a commit names a whole set of files, but there
is no slice object today.

## 10. Where the story and the documents differ

Four points where the spoken story is simpler than the documents. Each needs
a decision on how the slides say it.

1. **Naming.** The simple story is that the subdomain is the workbench and the
   root is the deployment. In the documents, a draft lives at a "try" dash
   subdomain and promotion makes it live at the plain subdomain.
2. **Which version is the truth.** For a visitor, the deployment is the
   minified package. But the documents treat the readable package as the
   truth, and the minified one as derived from it. The slides keep that link
   visible, because it is what keeps minified code checkable.
3. **Keeping every revision.** Nothing is ever deleted. But a server only
   keeps what it serves. Revisions last because they are copied across
   servers, which is exactly what the overlap in stage three shows. No single
   server keeps everything.
4. **Merging.** Two developers' changes are not merged into one. They exist
   side by side, and anyone can build on either. Taking a piece and laying it
   into your own build is the built way to combine work.

## 11. Open decisions

1. **The audience.** Plain language with fewer terms, or developers, with
   signatures and install pointers on screen? The four levels of depth may
   answer this: plain at the slide, technical one level down.
2. **Server names.** Real names, such as jwize.com and the Plugin the Matrix
   subdomains, or generic publishers?
3. **Sentences across servers.** Label stage five's first slide as where this
   is going, or present it as working?
4. **Tile names.** Accept the draft tree as it is, or rename first?
5. **Naming of the workbench.** The simple story, or the "try" dash naming?
6. **Order of the slides.** Confirm where playback order is kept once slides
   are joined with the enroll word.
7. **Links from the slides view.** Confirm whether a page's link can open a
   child tile from inside the slides view, or only from the website view.

---

## References

Kept apart so they can be skipped when listening.

- Hosting and hosts: [becoming-a-host.md](becoming-a-host.md),
  [hosting-from-a-machine.md](hosting-from-a-machine.md),
  [read-only-deployment.md](read-only-deployment.md)
- Workbench, review, promote, take a piece: [module-sandbox.md](module-sandbox.md)
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
