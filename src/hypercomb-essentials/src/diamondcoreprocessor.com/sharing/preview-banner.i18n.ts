// preview-banner.i18n.ts — the adopt-for-review banner's strings, all locales.
//
// EXTRACTED from hypercomb-shared/i18n/*.json in the everything-is-a-
// beehavior Phase 2 catalog split: strings move WITH their surface. The
// panel registers these under the 'app' namespace at load, so every key
// resolves exactly as before — they simply ship with the module now.
//
// PLURAL FORMS ride along: a key used with a `count` param is backed by
// key.one / key.other in the catalogs (the service checks those first),
// so the extraction takes the declared key AND its plural variants.
//
// The spec beside this file is the drift check the split owes: every
// locale must carry en's key set.

export const PREVIEW_BANNER_TRANSLATIONS: Record<string, Record<string, string>> = {
  "ar": {
    "preview.adopt": "تبنّي",
    "preview.banner.from": "من {publisher}",
    "preview.banner.tiles.one": "{count} بلاطة",
    "preview.banner.tiles.other": "{count} بلاطات",
    "preview.banner.title": "معاينة",
    "preview.dismiss": "تجاهل",
  },
  "de": {
    "preview.adopt": "Übernehmen",
    "preview.banner.from": "von {publisher}",
    "preview.banner.tiles.one": "{count} Kachel",
    "preview.banner.tiles.other": "{count} Kacheln",
    "preview.banner.title": "Vorschau",
    "preview.dismiss": "Verwerfen",
  },
  "en": {
    "preview.adopt": "Adopt",
    "preview.banner.from": "from {publisher}",
    "preview.banner.tiles.one": "{count} tile",
    "preview.banner.tiles.other": "{count} tiles",
    "preview.banner.title": "Previewing",
    "preview.dismiss": "Dismiss",
  },
  "es": {
    "preview.adopt": "Adoptar",
    "preview.banner.from": "de {publisher}",
    "preview.banner.tiles.one": "{count} mosaico",
    "preview.banner.tiles.other": "{count} mosaicos",
    "preview.banner.title": "Previsualizando",
    "preview.dismiss": "Descartar",
  },
  "fr": {
    "preview.adopt": "Adopter",
    "preview.banner.from": "de {publisher}",
    "preview.banner.tiles.one": "{count} tuile",
    "preview.banner.tiles.other": "{count} tuiles",
    "preview.banner.title": "Aperçu",
    "preview.dismiss": "Fermer",
  },
  "hi": {
    "preview.adopt": "अपनाएँ",
    "preview.banner.from": "{publisher} से",
    "preview.banner.tiles.one": "{count} टाइल",
    "preview.banner.tiles.other": "{count} टाइलें",
    "preview.banner.title": "प्रीव्यू",
    "preview.dismiss": "खारिज करें",
  },
  "id": {
    "preview.adopt": "Adopsi",
    "preview.banner.from": "dari {publisher}",
    "preview.banner.tiles.one": "{count} ubin",
    "preview.banner.tiles.other": "{count} ubin",
    "preview.banner.title": "Mempratinjau",
    "preview.dismiss": "Abaikan",
  },
  "it": {
    "preview.adopt": "Adotta",
    "preview.banner.from": "da {publisher}",
    "preview.banner.tiles.one": "{count} tessera",
    "preview.banner.tiles.other": "{count} tessere",
    "preview.banner.title": "Anteprima",
    "preview.dismiss": "Ignora",
  },
  "ja": {
    "preview.adopt": "取り込む",
    "preview.banner.from": "{publisher} から",
    "preview.banner.tiles.one": "{count} タイル",
    "preview.banner.tiles.other": "{count} タイル",
    "preview.banner.title": "プレビュー中",
    "preview.dismiss": "閉じる",
  },
  "ko": {
    "preview.adopt": "채택",
    "preview.banner.from": "{publisher}에서",
    "preview.banner.tiles.one": "타일 {count}개",
    "preview.banner.tiles.other": "타일 {count}개",
    "preview.banner.title": "미리보기 중",
    "preview.dismiss": "닫기",
  },
  "pt": {
    "preview.adopt": "Adotar",
    "preview.banner.from": "de {publisher}",
    "preview.banner.tiles.one": "{count} bloco",
    "preview.banner.tiles.other": "{count} blocos",
    "preview.banner.title": "Pré-visualizando",
    "preview.dismiss": "Dispensar",
  },
  "ru": {
    "preview.adopt": "Принять",
    "preview.banner.from": "от {publisher}",
    "preview.banner.tiles.one": "{count} плитка",
    "preview.banner.tiles.other": "{count} плиток",
    "preview.banner.title": "Просмотр",
    "preview.dismiss": "Отклонить",
  },
  "tr": {
    "preview.adopt": "Benimse",
    "preview.banner.from": "{publisher} tarafından",
    "preview.banner.tiles.one": "{count} döşeme",
    "preview.banner.tiles.other": "{count} döşeme",
    "preview.banner.title": "Önizleniyor",
    "preview.dismiss": "Kapat",
  },
  "zh": {
    "preview.adopt": "采纳",
    "preview.banner.from": "来自 {publisher}",
    "preview.banner.tiles.one": "{count} 个磁贴",
    "preview.banner.tiles.other": "{count} 个磁贴",
    "preview.banner.title": "正在预览",
    "preview.dismiss": "关闭",
  },
}
