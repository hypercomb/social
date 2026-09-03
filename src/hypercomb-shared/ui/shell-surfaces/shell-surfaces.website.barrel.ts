// Intentionally empty.
//
// A published creation is an application, not a Hypercomb management shell.
// The visitor build replaces the normal shell-surface barrel with this file so
// no authoring, installer, publishing, mesh, history, or settings chrome is
// registered. Creation-owned views still mount through their signed modules.

// A dynamic import requires the replacement to be an ES module even though it
// intentionally registers nothing.
export {}
