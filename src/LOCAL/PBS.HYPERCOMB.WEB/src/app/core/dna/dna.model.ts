export interface DnaNode {
  seed: string
  parent: string | null
  kind: 'file' | 'folder' | 'external'
  attributes: Record<string, unknown>
}
