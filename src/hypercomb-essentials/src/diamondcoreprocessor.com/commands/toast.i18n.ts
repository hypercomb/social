// toast.i18n.ts — the toast stack's strings, all locales.
//
// EXTRACTED from hypercomb-shared/i18n/*.json in the everything-is-a-
// beehavior Phase 2 catalog split: strings move WITH their surface, and
// the panel registers them under the 'app' namespace at load, so every
// key resolves exactly as before.
//
// OWNERSHIP, NOT PREFIX: only the keys THIS surface renders move. A key
// its callers hand it in a payload belongs to those callers and stays
// where they are — the spec beside this file pins that boundary, and the
// drift check that every locale carries en's key set.

export const TOAST_TRANSLATIONS: Record<string, Record<string, string>> = {
  "ar": {
    "toast.dismiss": "إغلاق",
  },
  "de": {
    "toast.dismiss": "Schließen",
  },
  "en": {
    "toast.dismiss": "Dismiss",
  },
  "es": {
    "toast.dismiss": "Cerrar",
  },
  "fr": {
    "toast.dismiss": "Fermer",
  },
  "hi": {
    "toast.dismiss": "बंद करें",
  },
  "id": {
    "toast.dismiss": "Tutup",
  },
  "it": {
    "toast.dismiss": "Chiudi",
  },
  "ja": {
    "toast.dismiss": "閉じる",
  },
  "ko": {
    "toast.dismiss": "닫기",
  },
  "pt": {
    "toast.dismiss": "Fechar",
  },
  "ru": {
    "toast.dismiss": "Закрыть",
  },
  "tr": {
    "toast.dismiss": "Kapat",
  },
  "zh": {
    "toast.dismiss": "关闭",
  },
}
