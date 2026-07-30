# Tile arrangements

Tile target arrangements are called **sequences**. A sequence is an ordered
list of hex-grid slots. It controls both the arrangement of tiles already on
the page and the slots filled by tiles created, dropped, or pasted afterward.

Run `/sequence` to open the Tile arrangements tool window. It lists the
built-in Three lanes, Rectangle, and Flowers arrangements followed by every
named sequence in the participant's palette. Selecting a row applies it at
the current location and makes it the active drop-target sequence.

`/sequence <name>` opens the canvas editor directly. The window's **New named
arrangement** action opens the same editor, so command and window authoring
share one path.

The window is slash-first: it contributes no enabled UI icon on a new
profile. Its settings gear offers **Add to controls**, which enables a Tile
arrangements launcher in the participant's controls rail. The preference is
participant-local and sticky; **Remove from controls** in the same gear
reverses it without removing the tool window or any saved arrangements.

This is the standard for optional tool-window launchers: the slash behaviour
is always the bootstrap path, the common settings gear owns add/remove
launcher configuration, and the choice persists through the shared controls
preference map. A window opts in by declaring `launcherControlId` on
`hcDockedPanel`. 
