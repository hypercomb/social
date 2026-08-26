// trust-prompt.i18n.ts — the activation trust gate's strings, all locales.
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

export const TRUST_PROMPT_TRANSLATIONS: Record<string, Record<string, string>> = {
  "ar": {
    "trust-prompt.additional": "و{count} مصدر(مصادر) أخرى.",
    "trust-prompt.allow-always": "السماح دائماً لهذا المصدر",
    "trust-prompt.allow-once": "السماح هذه المرة",
    "trust-prompt.deny": "رفض",
    "trust-prompt.summary": "أنت على وشك تفعيل كود من {domain}، وهو لا يستوفي معايير الثقة لديك.",
    "trust-prompt.title": "السماح بكود من هذا المصدر؟",
    "trust-prompt.warning": "الكود من مصادر غير موثوقة يعمل بنفس صلاحيات الكود الذي كتبته. اسمح فقط إذا كنت تثق بهذا المصدر.",
  },
  "de": {
    "trust-prompt.additional": "und {count} weitere Quelle(n).",
    "trust-prompt.allow-always": "diese Quelle immer erlauben",
    "trust-prompt.allow-once": "dieses Mal erlauben",
    "trust-prompt.deny": "ablehnen",
    "trust-prompt.summary": "Sie sind dabei, Code von {domain} zu aktivieren, der Ihre Vertrauenskriterien nicht erfüllt.",
    "trust-prompt.title": "Code von dieser Quelle erlauben?",
    "trust-prompt.warning": "Code aus nicht vertrauenswürdigen Quellen läuft mit denselben Rechten wie Ihr eigener Code. Nur erlauben, wenn Sie dieser Quelle vertrauen.",
  },
  "en": {
    "trust-prompt.additional": "and {count} other source(s).",
    "trust-prompt.allow-always": "always allow this source",
    "trust-prompt.allow-once": "allow this time",
    "trust-prompt.deny": "deny",
    "trust-prompt.summary": "you're about to activate code from {domain}, which doesn't meet your trusted criteria.",
    "trust-prompt.title": "allow code from this source?",
    "trust-prompt.warning": "code from untrusted sources runs with the same access as code you wrote. only allow if you trust this source.",
  },
  "es": {
    "trust-prompt.additional": "y {count} otra(s) fuente(s).",
    "trust-prompt.allow-always": "siempre permitir esta fuente",
    "trust-prompt.allow-once": "permitir esta vez",
    "trust-prompt.deny": "denegar",
    "trust-prompt.summary": "estás a punto de activar código de {domain}, que no cumple tus criterios de confianza.",
    "trust-prompt.title": "¿permitir código de esta fuente?",
    "trust-prompt.warning": "el código de fuentes no confiables se ejecuta con el mismo acceso que el código que tú escribiste. solo permite si confías en esta fuente.",
  },
  "fr": {
    "trust-prompt.additional": "et {count} autre(s) source(s).",
    "trust-prompt.allow-always": "toujours autoriser cette source",
    "trust-prompt.allow-once": "autoriser cette fois",
    "trust-prompt.deny": "refuser",
    "trust-prompt.summary": "vous êtes sur le point d'activer du code de {domain}, qui ne répond pas à vos critères de confiance.",
    "trust-prompt.title": "autoriser le code de cette source ?",
    "trust-prompt.warning": "le code de sources non fiables s'exécute avec le même accès que le code que vous avez écrit. n'autorisez que si vous faites confiance à cette source.",
  },
  "hi": {
    "trust-prompt.additional": "और {count} अन्य स्रोत।",
    "trust-prompt.allow-always": "इस स्रोत को हमेशा अनुमति दें",
    "trust-prompt.allow-once": "इस बार अनुमति दें",
    "trust-prompt.deny": "अस्वीकार करें",
    "trust-prompt.summary": "आप {domain} से कोड सक्रिय करने वाले हैं, जो आपके विश्वसनीय मानदंडों को पूरा नहीं करता।",
    "trust-prompt.title": "इस स्रोत से कोड अनुमति दें?",
    "trust-prompt.warning": "अविश्वसनीय स्रोतों का कोड उसी एक्सेस से चलता है जैसे आपका लिखा कोड। केवल तभी अनुमति दें जब आप इस स्रोत पर भरोसा करते हैं।",
  },
  "id": {
    "trust-prompt.additional": "dan {count} sumber lainnya.",
    "trust-prompt.allow-always": "selalu izinkan sumber ini",
    "trust-prompt.allow-once": "izinkan kali ini",
    "trust-prompt.deny": "tolak",
    "trust-prompt.summary": "Anda akan mengaktifkan kode dari {domain}, yang tidak memenuhi kriteria tepercaya Anda.",
    "trust-prompt.title": "izinkan kode dari sumber ini?",
    "trust-prompt.warning": "kode dari sumber tidak tepercaya berjalan dengan akses yang sama seperti kode yang Anda tulis. izinkan hanya jika Anda mempercayai sumber ini.",
  },
  "it": {
    "trust-prompt.additional": "e {count} altra/e fonte/i.",
    "trust-prompt.allow-always": "consenti sempre questa fonte",
    "trust-prompt.allow-once": "consenti questa volta",
    "trust-prompt.deny": "nega",
    "trust-prompt.summary": "stai per attivare codice da {domain}, che non soddisfa i tuoi criteri di attendibilità.",
    "trust-prompt.title": "consentire codice da questa fonte?",
    "trust-prompt.warning": "il codice da fonti non attendibili ha lo stesso accesso del codice che hai scritto tu. consenti solo se ti fidi della fonte.",
  },
  "ja": {
    "trust-prompt.additional": "他に{count}件のソースがあります。",
    "trust-prompt.allow-always": "常にこのソースを許可",
    "trust-prompt.allow-once": "今回のみ許可",
    "trust-prompt.deny": "拒否",
    "trust-prompt.summary": "{domain} からのコードを有効化しようとしていますが、信頼基準を満たしていません。",
    "trust-prompt.title": "このソースからのコードを許可しますか？",
    "trust-prompt.warning": "信頼できないソースからのコードは、あなたが書いたコードと同じ権限で実行されます。信頼できるソースの場合のみ許可してください。",
  },
  "ko": {
    "trust-prompt.additional": "그리고 {count}개의 다른 소스.",
    "trust-prompt.allow-always": "항상 이 소스 허용",
    "trust-prompt.allow-once": "이번만 허용",
    "trust-prompt.deny": "거부",
    "trust-prompt.summary": "{domain}의 코드를 활성화하려고 합니다. 이 소스는 신뢰 기준을 충족하지 않습니다.",
    "trust-prompt.title": "이 소스의 코드를 허용하시겠습니까?",
    "trust-prompt.warning": "신뢰할 수 없는 소스의 코드는 직접 작성한 코드와 동일한 접근 권한으로 실행됩니다. 이 소스를 신뢰하는 경우에만 허용하세요.",
  },
  "pt": {
    "trust-prompt.additional": "e {count} outra(s) fonte(s).",
    "trust-prompt.allow-always": "sempre permitir esta fonte",
    "trust-prompt.allow-once": "permitir desta vez",
    "trust-prompt.deny": "negar",
    "trust-prompt.summary": "você está prestes a ativar código de {domain}, que não atende aos seus critérios de confiança.",
    "trust-prompt.title": "permitir código desta fonte?",
    "trust-prompt.warning": "código de fontes não confiáveis tem o mesmo acesso que código escrito por você. permita apenas se confiar na fonte.",
  },
  "ru": {
    "trust-prompt.additional": "и ещё {count} источник(ов).",
    "trust-prompt.allow-always": "всегда разрешать этот источник",
    "trust-prompt.allow-once": "разрешить один раз",
    "trust-prompt.deny": "отклонить",
    "trust-prompt.summary": "вы собираетесь активировать код из {domain}, который не соответствует вашим критериям доверия.",
    "trust-prompt.title": "разрешить код из этого источника?",
    "trust-prompt.warning": "код из недоверенных источников работает с теми же правами, что и ваш собственный код. разрешайте только если доверяете этому источнику.",
  },
  "tr": {
    "trust-prompt.additional": "ve {count} diğer kaynak.",
    "trust-prompt.allow-always": "bu kaynağa her zaman izin ver",
    "trust-prompt.allow-once": "bu sefer izin ver",
    "trust-prompt.deny": "reddet",
    "trust-prompt.summary": "{domain} kaynağından gelen kodu etkinleştirmek üzeresiniz, bu kaynak güven kriterlerinizi karşılamıyor.",
    "trust-prompt.title": "bu kaynaktan gelen koda izin verilsin mi?",
    "trust-prompt.warning": "güvenilmeyen kaynaklardan gelen kod, sizin yazdığınız kodla aynı erişime sahip olur. yalnızca bu kaynağa güveniyorsanız izin verin.",
  },
  "zh": {
    "trust-prompt.additional": "以及其他 {count} 个来源。",
    "trust-prompt.allow-always": "始终允许此来源",
    "trust-prompt.allow-once": "本次允许",
    "trust-prompt.deny": "拒绝",
    "trust-prompt.summary": "您即将激活来自 {domain} 的代码，它不符合您的信任标准。",
    "trust-prompt.title": "允许来自此来源的代码？",
    "trust-prompt.warning": "来自不受信任来源的代码与您自己编写的代码具有相同的访问权限。请仅在信任此来源时才允许。",
  },
}
