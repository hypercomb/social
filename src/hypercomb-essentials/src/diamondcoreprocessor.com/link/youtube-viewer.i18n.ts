// youtube-viewer.i18n.ts — the video viewer's strings, all locales.
//
// EXTRACTED from hypercomb-shared/i18n/*.json in the everything-is-a-
// beehavior Phase 2 catalog split: strings move WITH their surface, and the
// panel registers them under the 'app' namespace at load, so every key
// resolves exactly as before. The spec beside this file is the drift check:
// every locale must carry en's key set.

export const YOUTUBE_VIEWER_TRANSLATIONS: Record<string, Record<string, string>> = {
  "ar": {
    "viewer.close": "إغلاق الفيديو",
    "viewer.watchOnYouTube": "المشاهدة على YouTube",
  },
  "de": {
    "viewer.close": "Video schließen",
    "viewer.watchOnYouTube": "Auf YouTube ansehen",
  },
  "en": {
    "viewer.close": "Close video",
    "viewer.watchOnYouTube": "Watch on YouTube",
  },
  "es": {
    "viewer.close": "Cerrar video",
    "viewer.watchOnYouTube": "Ver en YouTube",
  },
  "fr": {
    "viewer.close": "Fermer la vidéo",
    "viewer.watchOnYouTube": "Regarder sur YouTube",
  },
  "hi": {
    "viewer.close": "वीडियो बंद करें",
    "viewer.watchOnYouTube": "YouTube पर देखें",
  },
  "id": {
    "viewer.close": "Tutup video",
    "viewer.watchOnYouTube": "Tonton di YouTube",
  },
  "it": {
    "viewer.close": "Chiudi video",
    "viewer.watchOnYouTube": "Guarda su YouTube",
  },
  "ja": {
    "viewer.close": "動画を閉じる",
    "viewer.watchOnYouTube": "YouTube で見る",
  },
  "ko": {
    "viewer.close": "동영상 닫기",
    "viewer.watchOnYouTube": "YouTube에서 보기",
  },
  "pt": {
    "viewer.close": "Fechar vídeo",
    "viewer.watchOnYouTube": "Assistir no YouTube",
  },
  "ru": {
    "viewer.close": "Закрыть видео",
    "viewer.watchOnYouTube": "Смотреть на YouTube",
  },
  "tr": {
    "viewer.close": "Videoyu kapat",
    "viewer.watchOnYouTube": "YouTube'da izle",
  },
  "zh": {
    "viewer.close": "关闭视频",
    "viewer.watchOnYouTube": "在 YouTube 上观看",
  },
}
