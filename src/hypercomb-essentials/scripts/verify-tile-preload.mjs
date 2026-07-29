// Backward-compatible entry point for the original preload regression command.
// The repeat-navigation scenario supersedes the old synthetic one-tile probe:
// it creates a real branch, clicks the real canvas, revisits it repeatedly,
// and forces atlas eviction between cycles.
import './verify-repeat-navigation.mjs'
