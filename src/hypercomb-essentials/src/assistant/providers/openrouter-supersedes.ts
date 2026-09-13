// assistant/providers/openrouter-supersedes.ts
//
// OPENROUTER IS THE WAY IN, FOR NOW (Jaime, 2026-09-13). One OpenRouter key
// reaches every model these vendors sell, and a model added through the
// console's search appears by its EXACT name ("DeepSeek V4 Flash 0731"),
// never as a vendor row ("DeepSeek"). So the direct single-vendor rows are
// folded away: off the console list AND out of automatic routing — a key
// left on one (an OpenRouter key pasted on the DeepSeek row answered 401 on
// every chat) must not keep answering unseen.
//
// Nothing is deleted: the descriptors stay registered, so a call that names
// one explicitly (the legacy `llm-api.ts` shim's `anthropic`) still works,
// and a key saved on one stays in storage. Another way to add direct
// providers will come later; until then this is the rule.
//
// ONE list, read by the console and the mediator — never a second copy.

export const OPENROUTER_SUPERSEDES: ReadonlySet<string> =
  new Set(['openai', 'xai', 'anthropic', 'google', 'mistral', 'deepseek'])

export const foldedIntoOpenRouter = (providerId: string): boolean =>
  OPENROUTER_SUPERSEDES.has(String(providerId ?? '').trim().toLowerCase())
