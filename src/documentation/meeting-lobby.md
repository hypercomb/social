# The meeting lobby — check yourself, then walk in

**Status: built 2026-11-01.**

The way into a meeting is the lobby. Before you are on camera to anyone, the
lobby shows you yourself exactly as the hive will cut you, lets you pick your
camera, microphone and picture, and tells you who else is here. You join from
it, or leave it without joining. Why meetings are seven people and start only
when the circle is full is in [meetings-and-quorum.md](meetings-and-quorum.md);
this page is how to use the way in.

## Opening it

- **Say it.** Select a tile and type `/meeting`. The first time, this tags the
  tile `cascade`: a meeting of seven, one at the centre and six around it.
  `/meeting cascade:19` makes a two-ring meeting of nineteen instead. The
  lobby opens for that tile.
- **Or press the tile's meeting icon.** A tile tagged for a meeting wears it.
  If you are already in that tile's meeting, the icon takes you out instead.

## What it shows

- **One hexagon in the middle:** your camera, cut to the shape the hive will
  draw it in. What you see is what is sent.
- **Camera** and **Microphone:** choose the device. The microphone has a level
  meter, so you can see it hears you. Plugging a device in or out updates the
  lists.
- **Picture:** how sharp you are sent.

  | Choice | Picture | For |
  |---|---|---|
  | **Saver** | 640×360, 24 fps | a weak connection |
  | **Auto** | 1280×720, 30 fps | most of the time |
  | **Sharp** | 1920×1080, 30 fps | a strong connection |

  The line beneath says what it costs (up to so many Mbps to each person) and,
  once the camera answers, what it is actually sending.
- **The circle underneath** fills as others arrive: "No one else is here yet",
  "2 of 7 here", "Your seat completes the circle". The meeting starts when the
  circle is full (the quorum).

If the camera cannot start, the lobby says why and offers **try again**:
access blocked (allow it in the address bar), no camera found, another app is
using it, or it failed to start.

## Joining, or not

- **Join** (or Enter, when no button or list has the focus) walks you in. The
  camera you were checking is handed straight to the meeting: no second
  permission prompt, and no moment where the picture drops out. Joining is what
  makes you available: your hive starts saying so on the tile's room, and you
  count toward the circle.
- **Cancel**, the close button, or going back leaves the lobby without joining,
  and the camera is let go.

## Leaving a meeting

`/meeting leave`. No tile is needed: you are in one meeting at a time. Your
camera and microphone are released, and the others' side of the connection
closes at once.

## Meeting someone else

A meeting is the tile's room: everyone in it has the same tile, under the same
name and with the same meeting tag, and their hives reach the mesh relay.
Sharing the tile from your domain is the easy way to give someone the room.

## Files

- `hypercomb-essentials/src/meeting/meeting-lobby.drone.ts`: hears the wish to
  join (`meeting:lobby-open`), registers the lobby's surface, loads the view
- `hypercomb-essentials/src/meeting/lobby/meeting-lobby.view.ts`: the lobby
  itself
- `hypercomb-essentials/src/meeting/lobby/lobby-media.ts`: the camera and
  device decisions that need no browser
- `hypercomb-essentials/src/meeting/meeting-quality.ts`: the numbers behind
  Saver, Auto and Sharp
- `hypercomb-essentials/src/meeting/hive-meeting.drone.ts`: takes the camera
  on `meeting:join`, announces `meeting:presence` (here, needed) to the lobby

## Related

- [meetings-and-quorum.md](meetings-and-quorum.md): the 1+6 cascade, quorum,
  signaling, slots
- [slash-behaviour-reference.md](slash-behaviour-reference.md): the `/meeting`
  word
