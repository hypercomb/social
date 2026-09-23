// commands/postit-kind.ts
//
// THE POST-IT'S NAMES — its view, its decoration kind and where its size is
// remembered. The /postit word and the view that renders it both read these,
// and a bee is never imported for a value (atomic-modules-plan.md), so they
// live here, in a dependency both import.

export const POSTIT_VIEW = 'postit'

export const POSTIT_KIND = 'visual:postit:note'

/** Where the last size a participant resized a sticky to is remembered, so
 *  it becomes the default for every note that has not been resized itself.
 *  Participant-local presentation preference — the same class of setting as
 *  `hc:world-mode`, and deliberately NOT in the layer: it is about this
 *  person's screen, not about the note, so it must not travel on adoption. */
export const POSTIT_SIZE_KEY = 'hc:postit:size'
