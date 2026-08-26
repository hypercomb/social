// layer-cycle-strip.i18n.ts — the peer layer-cycle strip's strings, all locales.
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

export const LAYER_CYCLE_TRANSLATIONS: Record<string, Record<string, string>> = {
  "ar": {
    "layer-cycle.active": "الطبقة النشطة (انقر للإخفاء)",
    "layer-cycle.dismiss": "انقر للإخفاء",
    "layer-cycle.spotlight": "تسليط الضوء على هذه الطبقة",
  },
  "de": {
    "layer-cycle.active": "Aktive Schicht (klicken zum Schließen)",
    "layer-cycle.dismiss": "klicken zum Schließen",
    "layer-cycle.spotlight": "Diese Schicht hervorheben",
  },
  "en": {
    "layer-cycle.active": "Active layer (click to dismiss)",
    "layer-cycle.dismiss": "click to dismiss",
    "layer-cycle.spotlight": "Spotlight this layer",
  },
  "es": {
    "layer-cycle.active": "Capa activa (clic para descartar)",
    "layer-cycle.dismiss": "clic para descartar",
    "layer-cycle.spotlight": "Destacar esta capa",
  },
  "fr": {
    "layer-cycle.active": "Couche active (cliquez pour fermer)",
    "layer-cycle.dismiss": "cliquez pour fermer",
    "layer-cycle.spotlight": "Mettre en avant cette couche",
  },
  "hi": {
    "layer-cycle.active": "सक्रिय लेयर (हटाने के लिए क्लिक करें)",
    "layer-cycle.dismiss": "हटाने के लिए क्लिक करें",
    "layer-cycle.spotlight": "इस लेयर को स्पॉटलाइट करें",
  },
  "id": {
    "layer-cycle.active": "Layer aktif (klik untuk menutup)",
    "layer-cycle.dismiss": "klik untuk menutup",
    "layer-cycle.spotlight": "Sorot layer ini",
  },
  "it": {
    "layer-cycle.active": "Livello attivo (clicca per chiudere)",
    "layer-cycle.dismiss": "clicca per chiudere",
    "layer-cycle.spotlight": "Evidenzia questo livello",
  },
  "ja": {
    "layer-cycle.active": "アクティブレイヤー（クリックで解除）",
    "layer-cycle.dismiss": "クリックで解除",
    "layer-cycle.spotlight": "このレイヤーを注目",
  },
  "ko": {
    "layer-cycle.active": "활성 레이어 (클릭하여 닫기)",
    "layer-cycle.dismiss": "클릭하여 닫기",
    "layer-cycle.spotlight": "이 레이어 스포트라이트",
  },
  "pt": {
    "layer-cycle.active": "Camada ativa (clique para dispensar)",
    "layer-cycle.dismiss": "clique para dispensar",
    "layer-cycle.spotlight": "Destacar esta camada",
  },
  "ru": {
    "layer-cycle.active": "Активный слой (нажмите, чтобы скрыть)",
    "layer-cycle.dismiss": "нажмите, чтобы скрыть",
    "layer-cycle.spotlight": "Подсветить этот слой",
  },
  "tr": {
    "layer-cycle.active": "Etkin katman (kapatmak için tıklayın)",
    "layer-cycle.dismiss": "kapatmak için tıklayın",
    "layer-cycle.spotlight": "Bu katmanı öne çıkar",
  },
  "zh": {
    "layer-cycle.active": "活动层（点击取消）",
    "layer-cycle.dismiss": "点击取消",
    "layer-cycle.spotlight": "聚焦此层",
  },
}
