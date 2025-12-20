interface ReplayOperation {
  timestamp: number
  actorId: string
  operationKey: string
  lineage: string
  affectedIds: string[]
}
