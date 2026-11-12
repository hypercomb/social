// auto-generated
// sleeping lane — self-registering modules that load on demand: a queen on
// her word, a view when entered, a bee on its effect (scripts/passive-queen.ts).
// The dev shell hands this table to the preloader (useSleepers).
// do not edit manually

export type Sleeper = {
  readonly load: () => Promise<unknown>
  readonly command?: string
  readonly description?: string
  readonly renders?: readonly string[]
  readonly wakesOn?: readonly string[]
}

export const sleepers: readonly Sleeper[] = [
  { wakesOn: ["expand:layer"], load: () => import('./assistant/expand.drone') },
  { command: "inspect", description: "Drill into a tile: the behaviours that run it, their source, and every behaviour that source talks to", load: () => import('./assistant/inspect.queen') },
  { wakesOn: ["parts:distribute-visual"], load: () => import('./assistant/visual-distribution.drone') },
  { command: "arrange", description: "Toggle icon arrangement mode on the tile overlay", load: () => import('./commands/arrange.queen') },
  { command: "beehaviors", description: "Open Beehaviors: switch any behaviour, word or desk on or off", load: () => import('./commands/beehaviors.queen') },
  { command: "behavior", description: "Bind a behaviour to the tile it belongs to — it shows there and nowhere else", load: () => import('./commands/behavior.queen') },
  { command: "brood", description: "Automatons this hive is holding but will not run — read them, accept one by hand, or set what gets held", load: () => import('./commands/brood.queen') },
  { command: "builds", description: "Build revisions for this subtree — record the state after a build pass, list them, restore one", load: () => import('./commands/builds.queen') },
  { command: "collections", description: "Open the collections entrance", load: () => import('./commands/collections-view.queen') },
  { command: "context", description: "Manage the branches this tile’s AI requests read", load: () => import('./commands/context.queen') },
  { command: "debug", description: "Toggle the Pixi display-tree inspector", load: () => import('./commands/debug.queen') },
  { command: "deposit", description: "Deposit a signed pheromone — an authored interest-signal on a tile\\", load: () => import('./commands/deposit.queen') },
  { command: "enroll", description: "Relate this tile to a website — the one way artifacts belong together", load: () => import('./commands/enroll.queen') },
  { command: "genome", description: "Measure the active hive genome: current markers plus every reachable byte", load: () => import('./commands/genome.queen') },
  { command: "grant", description: "Set how far a machine may go in this hive", load: () => import('./commands/grant.queen') },
  { command: "history", description: "Toggle the history panel", load: () => import('./commands/history.queen') },
  { command: "interest", description: "Say which pheromones you watch for or never want, and see what\\", load: () => import('./commands/interest.queen') },
  { command: "lanes", description: "Toggle three centered lanes for this viewport", load: () => import('./commands/lanes.queen') },
  { command: "requires", description: "Manage the pheromones a reference demands of what it shows", load: () => import('./commands/requires.queen') },
  { command: "restore", description: "Go back to a named snapshot — its tiles and behaviours become the live hive again", load: () => import('./commands/restore.queen') },
  { command: "rewind", description: "Open the visual rewind window", load: () => import('./commands/rewind.queen') },
  { command: "slice", description: "Choose a handful of tiles as one merkle slice — an agent-or-participant-chosen set that projects as one", load: () => import('./commands/slice.queen') },
  { command: "spotlight", description: "Light a tile up until it is found", load: () => import('./commands/spotlight.queen') },
  { command: "theme", description: "Switch the UI theme (light, dark, system, or a registered theme)", load: () => import('./commands/theme.queen') },
  { command: "upgrade", description: "Open Packages — what loads, and what has an update. `upgrade allow` lets your followed publisher\\", load: () => import('./commands/upgrade.queen') },
  { command: "verify-history", description: "Walk the current location's history forward and backward; verify undo and redo render the same tile count at every position", load: () => import('./commands/verify-history.queen') },
  { command: "view-current", description: "Show the current branch as a fully-expanded object", load: () => import('./commands/view-current.queen') },
  { command: "views", description: "Show the views this layer can be drawn as", load: () => import('./commands/views.queen') },
  { wakesOn: ["hidden:refresh","hidden:reveal","hidden:delete"], load: () => import('./concealment/concealment.drone') },
  { command: "contact", description: "Enable contact cards for this location\\", load: () => import('./contact/contact.queen') },
  { renders: ["document"], load: () => import('./document/document-view.drone') },
  { command: "files", description: "Browse files attached to the selected tiles, or every tile in view", load: () => import('./files/files.queen') },
  { command: "format", description: "Copy visual formatting from the active tile", load: () => import('./format/format.queen') },
  { command: "guide", description: "The bee becomes the cursor. Stay on a tile and it dances, then the tile flies to the middle with every idea for it, as tiles or as a list. Pick what you want and accept, and an agent goes out for each", load: () => import('./guide/guide.queen') },
  { command: "consolidate-history", description: "Relocate leftover legacy history bags to the root and remove the drained folder", load: () => import('./history/consolidate-history.queen') },
  { command: "howto", description: "Lay the how-to site: one tile, how, with a page for every word the hive understands, made from what each word declares. Publish it once to give the whole language a front door", load: () => import('./howto/howto.queen') },
  { command: "keyboard", description: "Open the keyboard: see what every key does and choose your own chords", load: () => import('./keyboard-desk/keyboard.queen') },
  { command: "meeting", description: "Start or join the meeting of your swarm, and copy its link", load: () => import('./meeting/meeting.queen') },
  { command: "fit", description: "Zoom to fit all visible content", load: () => import('./navigation/zoom/fit.queen') },
  { command: "screensaver", description: "Idle screensaver: toggle on/off, pick the look (hexagon, circle, thought…) and the motion (bounce, shooting-stars…)", load: () => import('./presentation/screensaver/screensaver.queen') },
  { wakesOn: ["sprite:boot:wanted"], load: () => import('./presentation/tiles/boot-sprite.drone') },
  { renders: ["launcher"], load: () => import('./presentation/tiles/launcher-view.drone') },
  { renders: ["lift"], load: () => import('./presentation/tiles/lift-view.drone') },
  { command: "recents", description: "Show every tile this hive made, newest at the centre", load: () => import('./presentation/tiles/recents.queen') },
  { renders: ["slides","lightbox","scroller"], load: () => import('./presentation/tiles/slides-view.drone') },
  { renders: ["square-tile-view"], load: () => import('./presentation/tiles/square-tile-view.drone') },
  { command: "record", description: "Start AI-powered meeting recording with live hierarchy compilation", load: () => import('./recording/recording.queen') },
  { command: "select", description: "Pick tiles by tapping them, then act on the set", load: () => import('./selection/select.queen') },
  { command: "frame", description: "Read this branch through a fixed pattern", load: () => import('./sequence/frame.queen') },
  { command: "pattern", description: "Draw a tile shape a frame can be read through", load: () => import('./sequence/pattern.queen') },
  { command: "sequence", description: "Open Tile arrangements or edit a named drop-target sequence", load: () => import('./sequence/sequence.queen') },
  { wakesOn: ["swarm:leader-moved"], load: () => import('./sharing/follow.drone') },
  { wakesOn: ["publish:turn-off"], load: () => import('./sharing/publish-turn-off.drone') },
  { command: "repush", description: "Re-push shared content to your host and report holes", load: () => import('./sharing/repush.queen') },
  { wakesOn: ["swarm:subscribe-request-received","swarm:consent-accept","swarm:consent-decline"], load: () => import('./sharing/subscribe-consent.drone') },
  { command: "trust", description: "Say whose code may run your hive — trust a domain, withdraw it, or list them.", load: () => import('./sharing/trust.queen') },
  { command: "heal", description: "Restore participant pictures a default overwrote", load: () => import('./substrate/heal.queen') },
  { command: "reroll", description: "Reroll substrate background images on tiles", load: () => import('./substrate/reroll.queen') },
  { command: "substrate", description: "Manage substrate background image sources", load: () => import('./substrate/substrate.queen') },
  { command: "tutorial", description: "Open the tutorials window — every course and lesson, or fly one by name", load: () => import('./tutorial/tutorial.queen') },
]
