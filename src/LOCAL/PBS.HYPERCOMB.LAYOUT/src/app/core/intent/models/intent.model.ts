export type IntentIdentifier =
  | 'add.cell'
  | 'remove.cell'
  | 'object.tile'
  | 'object.image'
  | 'unknown'

export type IntentPlane =
  | 'action'
  | 'object'
  | 'focus'
  | 'control'
  | 'safety'


export interface Intent {
  key: string
  noun?: string
  confidence: number
}
