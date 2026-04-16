// miro.com/import/miro-api.service.ts
//
// Thin client for the Miro REST API v2. Token lives in localStorage — each
// user pastes their own via `/miro-token <token>`. Nothing leaves the browser.

export interface MiroBoard {
  readonly id: string
  readonly name: string
  readonly description?: string
  readonly viewLink?: string
  readonly owner?: { name?: string; id?: string }
  readonly team?: { id?: string; name?: string }
}

export interface MiroItem {
  readonly id: string
  readonly type: string
  readonly parent?: { id?: string } | null
  readonly position?: { x: number; y: number }
  readonly geometry?: { width?: number; height?: number; rotation?: number }
  readonly data?: {
    title?: string
    content?: string
    shape?: string
    imageUrl?: string
    documentUrl?: string
    url?: string
    providerUrl?: string
    previewUrl?: string
  }
}

export interface MiroItemPage {
  readonly data: readonly MiroItem[]
  readonly cursor?: string
  readonly total?: number
}

const API_BASE = 'https://api.miro.com'
const TOKEN_KEY = 'miro.importer.token'
const LAST_BOARD_KEY = 'miro.importer.last-board'

export class MiroApiService {

  get token(): string {
    return localStorage.getItem(TOKEN_KEY) ?? ''
  }

  setToken(value: string): void {
    if (value) localStorage.setItem(TOKEN_KEY, value)
    else localStorage.removeItem(TOKEN_KEY)
  }

  get lastBoardId(): string {
    return localStorage.getItem(LAST_BOARD_KEY) ?? ''
  }

  rememberBoard(boardId: string): void {
    localStorage.setItem(LAST_BOARD_KEY, boardId)
  }

  async getBoard(boardId: string): Promise<MiroBoard> {
    return await this.#apiJson<MiroBoard>(`/v2/boards/${encodeURIComponent(boardId)}`)
  }

  async *listItems(boardId: string): AsyncGenerator<MiroItem> {
    let cursor: string | undefined
    do {
      const params = new URLSearchParams({ limit: '50' })
      if (cursor) params.set('cursor', cursor)
      const page = await this.#apiJson<MiroItemPage>(
        `/v2/boards/${encodeURIComponent(boardId)}/items?${params}`,
      )
      for (const item of page.data ?? []) yield item
      cursor = page.cursor
    } while (cursor)
  }

  async fetchAsset(url: string): Promise<Blob> {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${this.token}` },
    })
    if (!response.ok) {
      throw new Error(`asset ${response.status} ${url}`)
    }
    return await response.blob()
  }

  async #apiJson<T>(path: string): Promise<T> {
    if (!this.token) throw new Error('NO_TOKEN')
    const response = await fetch(`${API_BASE}${path}`, {
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: 'application/json',
      },
    })
    if (response.status === 401 || response.status === 403) throw new Error('UNAUTHORIZED')
    if (response.status === 404) throw new Error('NOT_FOUND')
    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      throw new Error(`miro api ${response.status}: ${detail.slice(0, 200) || response.statusText}`)
    }
    return await response.json() as T
  }
}

const _instance = new MiroApiService()
;(window as any).ioc?.register?.('@miro.com/MiroApiService', _instance)
