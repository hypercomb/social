// landing-badge.i18n.ts — the quiet-landing badge's strings, all locales.
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

export const LANDING_BADGE_TRANSLATIONS: Record<string, Record<string, string>> = {
  "ar": {
    "landing.aria": "عرض التغييرات التي وصلت أثناء عملك",
    "landing.pending.one": "تغيير واحد في الانتظار",
    "landing.pending.other": "{count} تغييرات في الانتظار",
    "landing.show": "عرض",
    "landing.where": "في {where}",
  },
  "de": {
    "landing.aria": "Die Änderungen anzeigen, die während der Arbeit eingegangen sind",
    "landing.pending.one": "1 Änderung wartet",
    "landing.pending.other": "{count} Änderungen warten",
    "landing.show": "Anzeigen",
    "landing.where": "auf {where}",
  },
  "en": {
    "landing.aria": "Show the changes that landed while you were working",
    "landing.pending.one": "1 change is waiting",
    "landing.pending.other": "{count} changes are waiting",
    "landing.show": "Show",
    "landing.where": "on {where}",
  },
  "es": {
    "landing.aria": "Mostrar los cambios que llegaron mientras trabajabas",
    "landing.pending.one": "1 cambio en espera",
    "landing.pending.other": "{count} cambios en espera",
    "landing.show": "Mostrar",
    "landing.where": "en {where}",
  },
  "fr": {
    "landing.aria": "Afficher les modifications arrivées pendant votre travail",
    "landing.pending.one": "1 modification en attente",
    "landing.pending.other": "{count} modifications en attente",
    "landing.show": "Afficher",
    "landing.where": "sur {where}",
  },
  "hi": {
    "landing.aria": "काम के दौरान आए बदलाव दिखाएँ",
    "landing.pending.one": "1 बदलाव प्रतीक्षा में",
    "landing.pending.other": "{count} बदलाव प्रतीक्षा में",
    "landing.show": "दिखाएँ",
    "landing.where": "{where} पर",
  },
  "id": {
    "landing.aria": "Tampilkan perubahan yang masuk saat Anda bekerja",
    "landing.pending.one": "1 perubahan menunggu",
    "landing.pending.other": "{count} perubahan menunggu",
    "landing.show": "Tampilkan",
    "landing.where": "di {where}",
  },
  "it": {
    "landing.aria": "Mostra le modifiche arrivate mentre lavoravi",
    "landing.pending.one": "1 modifica in attesa",
    "landing.pending.other": "{count} modifiche in attesa",
    "landing.show": "Mostra",
    "landing.where": "su {where}",
  },
  "ja": {
    "landing.aria": "作業中に届いた変更を表示します",
    "landing.pending.one": "変更が1件届いています",
    "landing.pending.other": "変更が{count}件届いています",
    "landing.show": "表示",
    "landing.where": "{where} に",
  },
  "ko": {
    "landing.aria": "작업하는 동안 도착한 변경 사항을 봅니다",
    "landing.pending.one": "변경 1건이 기다리고 있습니다",
    "landing.pending.other": "변경 {count}건이 기다리고 있습니다",
    "landing.show": "보기",
    "landing.where": "{where}에서",
  },
  "pt": {
    "landing.aria": "Mostrar as alterações que chegaram enquanto trabalhava",
    "landing.pending.one": "1 alteração à espera",
    "landing.pending.other": "{count} alterações à espera",
    "landing.show": "Mostrar",
    "landing.where": "em {where}",
  },
  "ru": {
    "landing.aria": "Показать изменения, поступившие во время работы",
    "landing.pending.one": "1 изменение ждёт",
    "landing.pending.other": "Изменений ждёт: {count}",
    "landing.show": "Показать",
    "landing.where": "в {where}",
  },
  "tr": {
    "landing.aria": "Siz çalışırken gelen değişiklikleri göster",
    "landing.pending.one": "1 değişiklik bekliyor",
    "landing.pending.other": "{count} değişiklik bekliyor",
    "landing.show": "Göster",
    "landing.where": "{where} üzerinde",
  },
  "zh": {
    "landing.aria": "查看您工作期间到达的更改",
    "landing.pending.one": "有 1 项更改等待查看",
    "landing.pending.other": "有 {count} 项更改等待查看",
    "landing.show": "查看",
    "landing.where": "位于 {where}",
  },
}
