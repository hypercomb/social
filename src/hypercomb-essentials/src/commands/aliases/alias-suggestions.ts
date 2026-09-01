// commands/aliases/alias-suggestions.ts
//
// THE PICKER'S INVENTORY — names a behaviour could go by, offered, never given.
//
// When every code-declared alias was removed (45afe8c9f), the names
// themselves did not stop being good names — `breakout` for arkanoid,
// `slides` for present, `folder` for folder-sync. What was wrong was WHO was
// giving them: code put every spelling into autocomplete, the common tongue
// and the help surfaces at once, three names for one verb, chosen for
// everyone. So the lists live on here as INVENTORY: the aliases window shows
// them as candidates beside each behaviour, and only a participant's pick
// makes one live (ParticipantAliases.set — into the `commands:aliases` pool,
// onto the queen seam).
//
// NOTHING READS THIS INTO THE CENSUS. That is the whole contract, and it is
// why this file does not trip the "no behaviour declares an alias in code"
// ratchet in spirit or in letter — no `aliases` field is assigned anywhere;
// a suggestion that is never picked has no effect on any surface. A
// suggestion that collides with a live canonical command (solomon's old
// `game`) is filtered at render time by the drone, not here — the catalogue
// is history, the census is now.
//
// Keys are canonical commands. A behaviour absent here simply offers no
// candidates; the free-text field in the window covers it.

export const ALIAS_SUGGESTIONS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  'arkanoid': ['breakout', 'bricks'],
  'atlas': ['evidence', 'evidence-atlas'],
  'behavior': ['behaviour', 'beehaviour'],
  'block-peer': ['blockpeer', 'block-pubkey', 'kick-peer'],
  'brief': ['document', 'living-brief'],
  'bubble': ['bobble'],
  'builds': ['build'],
  'clear-mesh': ['clearmesh', 'clear-relay', 'wipe-mesh'],
  'collapse-history': ['collapse-histories', 'squash-history'],
  'collections': ['sets'],
  'comfy': ['comfyui'],
  'consolidate-content': ['retire-content-pools', 'migrate-content'],
  'consolidate-history': ['retire-history-folder', 'migrate-history'],
  'create': ['make'],
  'domain': ['relay'],
  'download': ['export'],
  'dropbox': ['dropzone'],
  'enroll': ['enrol', 'join'],
  'files': ['resources'],
  'folder-sync': ['folder', 'backup-folder', 'offline-backup'],
  'game': ['play'],
  'genome': ['weight'],
  'hive': ['branch', 'mark', 'label'],
  'hosts': ['community', 'domains'],
  'into': ['file'],
  'invite': ['meetlink', 'meeting-link', 'share-meeting'],
  'keywords': ['keyphrases'],
  'lanes': ['three', 'three-lanes'],
  'lightbox': ['gallery', 'images'],
  'lounge': ['room'],
  'menu': ['ring'],
  'postit': ['sticky', 'note-view'],
  'present': ['slides', 'slideshow'],
  'publish': ['published', 'live', 'publish-status'],
  'reference': ['ref'],
  'requires': ['require'],
  'roper': ['worms', 'rope'],
  'save-session': ['session-save', 'save'],
  'screensaver': ['bounce', 'bubbles'],
  'select': ['pick'],
  'sequence': ['seq'],
  'snapshot': ['snapshots'],
  'solomon': ['game', 'dana'],
  'square-tile-view': ['welcome', 'threshold'],
  'studio': ['knowledge-studio'],
  'theme': ['themes'],
  'translate-sweep': ['translate'],
  'tree': ['mindmap', 'branches'],
  'tutor': ['study'],
  'tutorial': ['tour', 'tutorials'],
  'verify-history': ['vh', 'check-history'],
  'view': ['mode', 'surface'],
  'view-current': ['view-layer', 'current'],
  'views': ['view-library'],
  'workflow': ['flow', 'skill'],
})
