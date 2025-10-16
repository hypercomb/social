export interface OpenGraphImage {
  height: string
  url: string
  width: string
  type: string
}

export interface OpenGraphVideo {
  height: string
  url: string
  width: string
  type: string
}

export interface TwitterImage {
  url: string
}

export interface TwitterPlayer {
  height: string
  url: string
  width: string
}

export interface OpenGraphResult {
  success: boolean
  ogSiteName?: string
  ogUrl?: string
  ogTitle?: string
  ogDescription?: string
  ogType?: string
  ogVideoSecureURL?: string
  ogVideoTag?: string
  ogImage?: OpenGraphImage[]
  ogVideo?: OpenGraphVideo[]
  ogLocale?: string
  ogDate?: string

  alIosAppStoreId?: string
  alIosAppName?: string
  alIosUrl?: string
  alAndroidUrl?: string
  alWebUrl?: string
  alAndroidAppName?: string
  alAndroidPackage?: string

  fbAppId?: string

  twitterCard?: string
  twitterSite?: string
  twitterUrl?: string
  twitterTitle?: string
  twitterDescription?: string
  twitterAppNameiPhone?: string
  twitterAppIdiPhone?: string
  twitterAppNameiPad?: string
  twitterAppIdiPad?: string
  twitterAppUrliPhone?: string
  twitterAppUrliPad?: string
  twitterAppNameGooglePlay?: string
  twitterAppIdGooglePlay?: string
  twitterAppUrlGooglePlay?: string
  twitterImage?: TwitterImage[]
  twitterPlayer?: TwitterPlayer[]

  favicon?: string
  charset?: string
  requestUrl?: string
}


