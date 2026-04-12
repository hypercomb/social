# Cell-Level Localization

Tile labels on the hex grid are localized through the same `I18nProvider` infrastructure that powers UI chrome. When the user switches locale, every visible tile re-renders with its translated label instantly.

## How It Works

### Resolution Order (most specific wins)

1. **Override translations** (`registerOverrides`) -- user or community module registrations
2. **Catalog translations** (`registerTranslations`) -- bee-provided label catalogs
3. **Raw directory name** -- the OPFS folder name, used as-is

`resolveCell(directoryName)` walks this chain and returns the first match for `cell.{directoryName}` in the current locale, falling back through the English catalog, then the directory name itself.

### Key Convention

Cell label keys follow the pattern `cell.{directoryName}`:

```
cell.welcome    -> "welcome" (en), "ようこそ" (ja), "bienvenida" (es)
cell.settings   -> "settings" (en), "設定" (ja), "ajustes" (es)
cell.music      -> "music" (en), "音楽" (ja), "música" (es)
```

### Default Translations

30 common cell names ship pre-translated across all 14 supported locales (en, ja, zh, es, ar, pt, fr, de, ko, ru, hi, id, tr, it). When a user creates a tile called "music" and switches to Japanese, it immediately shows "音楽".

## Usage

### Bees: Register Cell Translations at Load Time

```typescript
import { I18N_IOC_KEY } from '@hypercomb/core'
import type { I18nProvider } from '@hypercomb/core'

window.ioc.whenReady(I18N_IOC_KEY, (i18n: I18nProvider) => {
  i18n.registerTranslations('my-module.com', 'en', {
    'cell.my-feature': 'My Feature',
    'cell.dashboard': 'Dashboard',
  })
  i18n.registerTranslations('my-module.com', 'ja', {
    'cell.my-feature': 'マイ機能',
    'cell.dashboard': 'ダッシュボード',
  })
})
```

### Users/Community: Override Any Label

Overrides take priority over catalog translations, so users and community modules can shadow bee-provided labels:

```typescript
const i18n = window.ioc.get('@hypercomb.social/I18n')

// Override "home" to show a custom label in Japanese
i18n.registerOverrides('app', 'ja', {
  'cell.home': 'わたしの家',
})
```

### Programmatic Resolution

```typescript
const i18n = window.ioc.get('@hypercomb.social/I18n')

// Returns translated label or raw directory name
const label = i18n.resolveCell('music')  // "音楽" when locale is "ja"
```

## Render Pipeline

The hex grid rendering pipeline is locale-aware:

1. **HexLabelAtlas** accepts a label resolver function via `setLabelResolver()`
2. **ShowCellDrone** sets the resolver to `i18n.resolveCell()` when the atlas is created
3. On `locale:changed` effect, the atlas label cache is flushed (`invalidateLabels()`)
4. The next render pass re-resolves all labels through i18n and re-rasterizes them into the GPU texture atlas

This means locale switches update all tile labels in a single render pass with no OPFS reads or AI calls.

## Adding New Languages

Add `cell.*` keys to the locale catalog in `hypercomb-shared/i18n/{locale}.json`:

```json
{
  "cell.welcome": "translated-welcome",
  "cell.home": "translated-home",
  "cell.settings": "translated-settings"
}
```

The keys are loaded at runtime startup by `initializeRuntime()` and are immediately available to `resolveCell()`.

## Relationship to AI Translation

The `TranslationService` handles AI-powered translation of arbitrary tile content via Claude Haiku. Cell-level localization is a complementary, non-AI path:

- **Cell localization** (this system): instant, deterministic, catalog-based label resolution for known cell names
- **AI translation** (`TranslationService`): on-demand translation of arbitrary content, cached as signature-addressed resources

Both systems respond to `locale:changed`. Cell localization resolves immediately; AI translation starts an async workflow with heat-glow feedback.
