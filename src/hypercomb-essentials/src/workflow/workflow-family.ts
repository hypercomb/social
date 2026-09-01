// workflow/workflow-family.ts
//
// The artifact FAMILY a workflow names. A workflow that names `workflow:onboard`
// is a peer of its steps, and its face is separate from any website or gallery
// face the same tile happens to carry — open the workflow and you get its steps,
// open the website and you get its pages.
//
// Its own file so the step reader and the command that writes it can share it
// without either importing the other.

/** `visual:workflow:artifact` names `workflow:<name>`. */
export const WORKFLOW_FAMILY = 'workflow'
