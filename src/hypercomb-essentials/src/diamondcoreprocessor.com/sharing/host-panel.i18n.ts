// host-panel.i18n.ts — the Host panel's strings, all locales.
//
// EXTRACTED from hypercomb-shared/i18n/*.json in the everything-is-a-
// beehavior Phase 2 catalog split: strings move WITH their surface, and the
// panel registers them under the 'app' namespace at load, so every key
// resolves exactly as before. The spec beside this file is the drift check.

export const HOST_PANEL_TRANSLATIONS: Record<string, Record<string, string>> = {
  "en": {
    "hosting.choose": "Choose…",
    "hosting.domain": "Domain",
    "hosting.domain-placeholder": "site.example.com",
    "hosting.folder": "Folder",
    "hosting.get-cloudflared": "Get cloudflared",
    "hosting.go-live": "Go live",
    "hosting.go-offline": "Go offline",
    "hosting.live": "live — {domain}",
    "hosting.login": "Connect Cloudflare…",
    "hosting.no-cloudflared": "cloudflared is not installed — it connects your domain to this machine.",
    "hosting.no-folder": "no published folder picked yet",
    "hosting.off": "off",
    "hosting.on-port": "on port {port}",
    "hosting.pill": "Host",
    "hosting.reading": "reading hosting state…",
    "hosting.serving": "Serving",
    "hosting.start": "Start",
    "hosting.stop": "Stop",
    "hosting.title": "Host this machine",
  },
  "ja": {
    "hosting.choose": "選択…",
    "hosting.domain": "ドメイン",
    "hosting.domain-placeholder": "site.example.com",
    "hosting.folder": "フォルダ",
    "hosting.get-cloudflared": "cloudflared を入手",
    "hosting.go-live": "公開する",
    "hosting.go-offline": "公開をやめる",
    "hosting.live": "公開中 — {domain}",
    "hosting.login": "Cloudflare に接続…",
    "hosting.no-cloudflared": "cloudflared が見つかりません — ドメインとこのマシンをつなぐために必要です。",
    "hosting.no-folder": "公開フォルダが未選択です",
    "hosting.off": "停止中",
    "hosting.on-port": "ポート {port} で配信中",
    "hosting.pill": "ホスト",
    "hosting.reading": "ホスト状態を読み込み中…",
    "hosting.serving": "配信",
    "hosting.start": "開始",
    "hosting.stop": "停止",
    "hosting.title": "このマシンでホストする",
  },
}
