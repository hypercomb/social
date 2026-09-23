# Community translations

**Status: BUILT and proven on this machine (2026-09-23; `scripts/verify-community-translations.cjs`). jwize: "We need to have the community be responsible for the language so they can also be colon:keyed. We find by convention and maybe notify those where languages are missing to add a translation to their host. That way it can heal and replicate for subscribers."**

The shell ships fourteen catalogs (`hypercomb-shared/i18n/*.json`) and they drift: a word added in English is English in every other language until somebody edits a file in the repository. This makes the language the community's, with the hive's own primitives and no repository.

## The shape

| Piece | What it is | Where |
|---|---|---|
| A translation | a person's work under their own key, never a judgment — Jev is not asked | |
| A catalog | `{ kind: 'i18n-catalog', locale, namespace, keys: { key: text }, at }`, a resource on the host | `sharing/community-translations.ts` |
| Its claim | the translator's own signed index names it as `i18n:<locale>` — the signature on the index is the signature on the catalog, as an assessment is signed | `hive-pointer.ts` `setHiveRoot` |
| Finding it | the host lists every verified catalog for a locale at the pool's derived address `sign('i18n:<locale>')` — the one-file index every published pool uses (`published-pools.ts`) — and at `/i18n/<locale>.json` for people. No registry: a hive computes the address and asks | worker `serveTranslations` |
| Healing | `language sync` reads the hosts you follow, verifies each catalog against its signature, and fills ONLY the keys the locale lacks; a shipped string is never replaced by a stranger's, and your overrides stay on top | runtime `LocalizationService.healTranslations` |
| Replicating | what was placed is kept as one document per locale in the hive's translations pool and re-applied at boot and on every locale change, so the healing survives a reload and a lost host | `language.queen.ts` `healFromPool` |
| Notifying | `language missing` lists the keys the locale could not answer this session and, with a host, publishes them under your key as `i18n-missing:<locale>`; the host lists who is missing what, so a translator sees the demand | `LocalizationService.missingKeys`, worker `missing` |

## The words

- `language` — the current locale; `language <locale>` switches.
- `language offer [<locale>] [@<host>]` — your own translations for the locale (the override layer `i18n-override` writes) become a signed catalog on the host.
- `language sync [<locale>] [@<host>]` — heal the locale from the hosts you follow (the public host, your community hosts, and `@<host>`).
- `language missing [<locale>] [@<host>]` — what the locale lacks; published under your key when a host is named or configured.

The three publishing words are the participant's alone: a model never publishes text under somebody's key.

## What it deliberately does not do

- It does not replace a shipped string. A catalog is additive. Correcting a shipped translation is the shell's catalog's job, or the participant's own override.
- It does not judge. A catalog is a person's word under their key; the intake and provenance rules apply, and a translator you do not follow reaches you only through a host you do.
- It does not push. Nothing is placed without `language sync`; nothing is sent without `language offer` or `language missing`.

## Doctrine

- Pools of meaning, colon-scoped (`i18n:<locale>`), found by derivation — the published-pool convention, not a new mechanism.
- Signed under the author's own key; the host re-verifies every listed index when it serves the locale.
- Data never heals destructively: the shipped catalogs remain the walk-back, catalogs are additive, the placed document is replaced whole.
- The Life Primitive: a catalog is one resource; the index pointer names it, as `change:` and `assess:` name theirs.
