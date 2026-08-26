// confirm-dialog.i18n.ts — the confirm dialog's default button labels's strings, all locales.
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

export const CONFIRM_DIALOG_TRANSLATIONS: Record<string, Record<string, string>> = {
  "ar": {
    "confirm.cancel": "إلغاء",
    "confirm.delete": "حذف",
  },
  "de": {
    "confirm.cancel": "Abbrechen",
    "confirm.delete": "Löschen",
  },
  "en": {
    "confirm.cancel": "Cancel",
    "confirm.delete": "Delete",
  },
  "es": {
    "confirm.cancel": "Cancelar",
    "confirm.delete": "Eliminar",
  },
  "fr": {
    "confirm.cancel": "Annuler",
    "confirm.delete": "Supprimer",
  },
  "hi": {
    "confirm.cancel": "रद्द करें",
    "confirm.delete": "हटाएं",
  },
  "id": {
    "confirm.cancel": "Batal",
    "confirm.delete": "Hapus",
  },
  "it": {
    "confirm.cancel": "Annulla",
    "confirm.delete": "Elimina",
  },
  "ja": {
    "confirm.cancel": "キャンセル",
    "confirm.delete": "削除",
  },
  "ko": {
    "confirm.cancel": "취소",
    "confirm.delete": "삭제",
  },
  "pt": {
    "confirm.cancel": "Cancelar",
    "confirm.delete": "Excluir",
  },
  "ru": {
    "confirm.cancel": "Отмена",
    "confirm.delete": "Удалить",
  },
  "tr": {
    "confirm.cancel": "İptal",
    "confirm.delete": "Sil",
  },
  "zh": {
    "confirm.cancel": "取消",
    "confirm.delete": "删除",
  },
}
