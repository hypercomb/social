# Saved pure host branch audit

Compared on 2026-09-24: `task/pure-host-install` at `61b09df02` against `development` at `6cd25821f`. Common base: `876029a5dde9c59c13e980f2c24506aa51c6fac5`. This is an inventory, not a merge decision.

The branch preserves the Shim checkpoint `9368b5260` and broader local snapshot `61b09df02`. The three earlier doctrine commits are patch-equivalent to commits already on `development`.

| Comparison | Paths |
| --- | ---: |
| Changed only on task branch since common base | 130 |
| Changed on both, now identical | 56 |
| Changed on both, still different | 8 |
| Changed only on development since common base | 10 |

A direct branch merge needs review of the eight divergent shared paths and the development-only work. The broad snapshot has not had a full legacy, native, and relay build. The Shim typecheck, 41 focused tests, and pure build passed before the broad snapshot; `git diff --check development task/pure-host-install` is clean.

The only file intentionally left out of Git was the untracked disposable `src/scripts/.zone-monitor.tmp.cjs`.

## Changed only on the task branch

### .github (1)

- `.github/workflows/build-minimal-host.yml`

### documentation (1)

- `src/documentation/tool-window-colour-roles.md`

### hypercomb-client (11)

- `src/hypercomb-client/app/Cargo.toml`
- `src/hypercomb-client/app/src/main.rs`
- `src/hypercomb-client/app/tauri.minimal.conf.json`
- `src/hypercomb-client/Cargo.lock`
- `src/hypercomb-client/crates/serve/Cargo.toml`
- `src/hypercomb-client/crates/serve/src/activation.rs`
- `src/hypercomb-client/crates/serve/src/http.rs`
- `src/hypercomb-client/crates/serve/src/lib.rs`
- `src/hypercomb-client/crates/serve/src/tests.rs`
- `src/hypercomb-client/MINIMAL-PROFILE.md`
- `src/hypercomb-client/scripts/check-minimal-native.mjs`

### hypercomb-core (12)

- `src/hypercomb-core/src/core/canonical-layer.ts`
- `src/hypercomb-core/src/core/host-offerings.spec.ts`
- `src/hypercomb-core/src/core/host-offerings.ts`
- `src/hypercomb-core/src/core/location-marker.ts`
- `src/hypercomb-core/src/core/panels/docked-panel.spec.ts`
- `src/hypercomb-core/src/core/panels/docked-panel.ts`
- `src/hypercomb-core/src/core/panels/panel-groups.ts`
- `src/hypercomb-core/src/core/panels/panel-settings.ts`
- `src/hypercomb-core/src/core/pool-kinds.ts`
- `src/hypercomb-core/src/core/pool-registry.ts`
- `src/hypercomb-core/src/index.ts`
- `src/hypercomb-core/src/install.types.ts`

### hypercomb-dev (2)

- `src/hypercomb-dev/src/index.html`
- `src/hypercomb-dev/src/styles.scss`

### hypercomb-essentials (39)

- `src/hypercomb-essentials/src/assistant/agent-panel.view.ts`
- `src/hypercomb-essentials/src/assistant/agent-tiles-rail.ts`
- `src/hypercomb-essentials/src/assistant/skills-window.view.ts`
- `src/hypercomb-essentials/src/commands/keyword-suggestions.view.ts`
- `src/hypercomb-essentials/src/commands/website-instances.ts`
- `src/hypercomb-essentials/src/editor/tile-editor.styles.ts`
- `src/hypercomb-essentials/src/editor/tile-editor.view.spec.ts`
- `src/hypercomb-essentials/src/history/canonical-layer.ts`
- `src/hypercomb-essentials/src/link/link-drop-card.view.ts`
- `src/hypercomb-essentials/src/link/youtube-metadata-queue.ts`
- `src/hypercomb-essentials/src/molecule/vocabulary.view.ts`
- `src/hypercomb-essentials/src/molecule/vocabulary-find.view.ts`
- `src/hypercomb-essentials/src/preload-effects.ts`
- `src/hypercomb-essentials/src/presentation/avatars/agent-bee.drone.ts`
- `src/hypercomb-essentials/src/presentation/tiles/document-view-curator.ts`
- `src/hypercomb-essentials/src/presentation/tiles/entrance-pin.drone.ts`
- `src/hypercomb-essentials/src/presentation/tiles/layout-targets.view.ts`
- `src/hypercomb-essentials/src/presentation/tiles/pixi-host.worker.ts`
- `src/hypercomb-essentials/src/presentation/tiles/site-view.drone.ts`
- `src/hypercomb-essentials/src/presentation/tiles/square-tile-menu-panel.ts`
- `src/hypercomb-essentials/src/presentation/tiles/view-library.drone.ts`
- `src/hypercomb-essentials/src/quickmenu/quick-menu-registry.service.ts`
- `src/hypercomb-essentials/src/quickmenu/quick-menu-registry.spec.ts`
- `src/hypercomb-essentials/src/selection/select-mode.drone.ts`
- `src/hypercomb-essentials/src/sharing/community-hosts-panel.spec.ts`
- `src/hypercomb-essentials/src/sharing/hive-link.ts`
- `src/hypercomb-essentials/src/sharing/hive-pointer.spec.ts`
- `src/hypercomb-essentials/src/sharing/host-directory.view.ts`
- `src/hypercomb-essentials/src/sharing/landing-capture.ts`
- `src/hypercomb-essentials/src/sharing/offers.view.ts`
- `src/hypercomb-essentials/src/sharing/publish-branch.spec.ts`
- `src/hypercomb-essentials/src/sharing/publish-branch.ts`
- `src/hypercomb-essentials/src/sharing/sharing.boot.drone.ts`
- `src/hypercomb-essentials/src/sharing/static-peers.drone.ts`
- `src/hypercomb-essentials/src/sharing/static-peers.spec.ts`
- `src/hypercomb-essentials/src/sharing/static-peers.ts`
- `src/hypercomb-essentials/src/sharing/text-theme-offering.spec.ts`
- `src/hypercomb-essentials/src/sharing/text-theme-offering.ts`
- `src/hypercomb-essentials/src/widgets/widget-zoom.drone.ts`

### hypercomb-relay (3)

- `src/hypercomb-relay/blossom-worker/wrangler.toml`
- `src/hypercomb-relay/enable-host-shell.ps1`
- `src/hypercomb-relay/relay.js`

### hypercomb-runtime (13)

- `src/hypercomb-runtime/src/acquire.ts`
- `src/hypercomb-runtime/src/host-activation.spec.ts`
- `src/hypercomb-runtime/src/host-activation.ts`
- `src/hypercomb-runtime/src/index.ts`
- `src/hypercomb-runtime/src/location-layer.ts`
- `src/hypercomb-runtime/src/meaning-creations.spec.ts`
- `src/hypercomb-runtime/src/meaning-creations.ts`
- `src/hypercomb-runtime/src/quick-menu-pool.spec.ts`
- `src/hypercomb-runtime/src/quick-menu-pool.ts`
- `src/hypercomb-runtime/src/runtime-initializer.ts`
- `src/hypercomb-runtime/src/site-references.spec.ts`
- `src/hypercomb-runtime/src/site-references.ts`
- `src/hypercomb-runtime/src/text-theme-pool.ts`

### hypercomb-shared (18)

- `src/hypercomb-shared/core/theme.service.spec.ts`
- `src/hypercomb-shared/core/theme.service.ts`
- `src/hypercomb-shared/styles/_material-tokens.scss`
- `src/hypercomb-shared/styles/material-tokens.spec.ts`
- `src/hypercomb-shared/ui/_panel-identity.scss`
- `src/hypercomb-shared/ui/chat-window/chat-window.component.scss`
- `src/hypercomb-shared/ui/command-shell/command-shell.component.scss`
- `src/hypercomb-shared/ui/contact-card/contact-hover.component.scss`
- `src/hypercomb-shared/ui/controls-bar/controls-bar.component.scss`
- `src/hypercomb-shared/ui/file-teaser/file-teaser-hover.component.html`
- `src/hypercomb-shared/ui/file-teaser/file-teaser-hover.component.scss`
- `src/hypercomb-shared/ui/hint-bar/hint-bar.component.scss`
- `src/hypercomb-shared/ui/landing-badge/landing-badge.component.scss`
- `src/hypercomb-shared/ui/markup-overlay/markup-overlay.component.scss`
- `src/hypercomb-shared/ui/notes-strip/notes-strip.tabs.scss`
- `src/hypercomb-shared/ui/notes-strip/notes-strip.tree.scss`
- `src/hypercomb-shared/ui/pinned-entrances/pinned-entrances.component.scss`
- `src/hypercomb-shared/ui/tags-viewer/tags-viewer.component.scss`

### hypercomb-shim (20)

- `src/hypercomb-shim/build.mjs`
- `src/hypercomb-shim/functions/[[path]].js`
- `src/hypercomb-shim/host/check-pure.mjs`
- `src/hypercomb-shim/host/cli.mjs`
- `src/hypercomb-shim/host/deploy-azure.mjs`
- `src/hypercomb-shim/host/README.md`
- `src/hypercomb-shim/host/seed-offering.mjs`
- `src/hypercomb-shim/index.html`
- `src/hypercomb-shim/package.json`
- `src/hypercomb-shim/public/_headers`
- `src/hypercomb-shim/public/_routes.json`
- `src/hypercomb-shim/README.md`
- `src/hypercomb-shim/src/bootstrap/host-panel.review.spec.ts`
- `src/hypercomb-shim/src/bootstrap/host-panel.ts`
- `src/hypercomb-shim/src/bootstrap/offerings.spec.ts`
- `src/hypercomb-shim/src/bootstrap/offerings.ts`
- `src/hypercomb-shim/src/bootstrap/pending-selections.spec.ts`
- `src/hypercomb-shim/src/bootstrap/pending-selections.ts`
- `src/hypercomb-shim/src/bootstrap/welcome.spec.ts`
- `src/hypercomb-shim/src/bootstrap/welcome.ts`

### hypercomb-web (5)

- `src/hypercomb-web/src/app/app.scss`
- `src/hypercomb-web/src/index.html`
- `src/hypercomb-web/src/index.visitor.html`
- `src/hypercomb-web/src/main.visitor.ts`
- `src/hypercomb-web/src/styles.scss`

### other (1)

- `src/package-lock.json`

### scripts (3)

- `src/scripts/bridge/_chrome-bytes.cjs`
- `src/scripts/drive-bright-themes.cjs`
- `src/scripts/drive-toolwindow-contrast.cjs`

### test-results (1)

- `src/test-results/toolwindow-contrast/contrast.json`

## Changed on both branches, still different

- `src/documentation/read-only-deployment.md`
- `src/hypercomb-essentials/src/assistant/providers-window.view.ts`
- `src/hypercomb-essentials/src/history/history.service.ts`
- `src/hypercomb-essentials/src/sharing/hive-pointer.ts`
- `src/hypercomb-essentials/src/side-effects.ts`
- `src/hypercomb-relay/blossom-worker/worker.js`
- `src/hypercomb-relay/blossom-worker/worker.spec.js`
- `src/hypercomb-relay/replicate.js`

## Changed only on development

- `src/documentation/atomic-modules-plan.md`
- `src/documentation/hypergraph-molecule-lineage.md`
- `src/documentation/pheromones.md`
- `src/documentation/publishing.md`
- `src/hypercomb-essentials/src/sharing/adopt-published-lights.spec.ts`
- `src/hypercomb-essentials/src/sharing/hive-visit.boot.drone.ts`
- `src/hypercomb-essentials/src/sharing/swarm-adopt.drone.ts`
- `src/hypercomb-essentials/src/sharing/visitor-door.spec.ts`
- `src/hypercomb-web/src/setup/ensure-install.ts`
- `src/scripts/visitor-cold-load.cjs`

## Changed on both branches, now identical

- `src/documentation/everything-is-a-beehavior.md`
- `src/documentation/host-ai.md`
- `src/documentation/hypercomb.com/index.html`
- `src/documentation/hypercomb.com/script.js`
- `src/documentation/hypercomb.com/styles.css`
- `src/documentation/hypercomb-communication-layer.md`
- `src/documentation/life-primitive.md`
- `src/documentation/module-sandbox.md`
- `src/documentation/primitive-conformance-audit.md`
- `src/documentation/resource-offload-relays.md`
- `src/documentation/windows-installer-pool.md`
- `src/hypercomb-essentials/scripts/build-module.ts`
- `src/hypercomb-essentials/src/assistant/anatomy/anatomy.generated.ts`
- `src/hypercomb-essentials/src/assistant/chat-thread.ts`
- `src/hypercomb-essentials/src/assistant/llm-dispatch.ts`
- `src/hypercomb-essentials/src/assistant/llm-routing.spec.ts`
- `src/hypercomb-essentials/src/assistant/providers/llm-provider.types.ts`
- `src/hypercomb-essentials/src/assistant/providers/local.provider.ts`
- `src/hypercomb-essentials/src/assistant/providers/openrouter.provider.ts`
- `src/hypercomb-essentials/src/commands/upgrade.queen.ts`
- `src/hypercomb-essentials/src/molecule/vocabulary-signer.ts`
- `src/hypercomb-essentials/src/pheromones/pheromone-deposits.ts`
- `src/hypercomb-essentials/src/sharing/head-claim-signer.authority-skeptic.spec.ts`
- `src/hypercomb-essentials/src/sharing/head-claim-signer.spec.ts`
- `src/hypercomb-essentials/src/sharing/head-claim-signer.ts`
- `src/hypercomb-essentials/src/sharing/host-sync.service.ts`
- `src/hypercomb-essentials/src/sharing/nostr-signer.ts`
- `src/hypercomb-essentials/src/sharing/swarm.drone.ts`
- `src/hypercomb-essentials/src/sharing/update-scout.service.ts`
- `src/hypercomb-essentials/src/sharing/upgrade-allow.spec.ts`
- `src/hypercomb-essentials/src/sharing/upgrade-allow.ts`
- `src/hypercomb-essentials/src/sharing/use-live-relay.queen.ts`
- `src/hypercomb-shared/i18n/ar.json`
- `src/hypercomb-shared/i18n/de.json`
- `src/hypercomb-shared/i18n/en.json`
- `src/hypercomb-shared/i18n/es.json`
- `src/hypercomb-shared/i18n/fr.json`
- `src/hypercomb-shared/i18n/hi.json`
- `src/hypercomb-shared/i18n/id.json`
- `src/hypercomb-shared/i18n/it.json`
- `src/hypercomb-shared/i18n/ja.json`
- `src/hypercomb-shared/i18n/ko.json`
- `src/hypercomb-shared/i18n/pt.json`
- `src/hypercomb-shared/i18n/ru.json`
- `src/hypercomb-shared/i18n/tr.json`
- `src/hypercomb-shared/i18n/zh.json`
- `src/hypercomb-shared/ui/chat-window/chat-window.component.ts`
- `src/hypercomb-shared/ui/chat-window/hypercomb-work-fence.spec.ts`
- `src/hypercomb-shared/ui/chat-window/hypercomb-work-fence.ts`
- `src/hypercomb-shared/ui/presence-banner/presence-banner.component.html`
- `src/hypercomb-shared/ui/presence-banner/presence-banner.component.scss`
- `src/hypercomb-shared/ui/presence-banner/presence-banner.component.ts`
- `src/scripts/client/publish-windows-installer.mjs`
- `src/scripts/drive-swarm-connectivity.cjs`
- `src/scripts/drive-swarm-join-order.cjs`
- `src/scripts/drive-swarm-join-word.cjs`
