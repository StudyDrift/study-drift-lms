// Learning outcome
export interface Outcome {
  id: string
  outcome: string
  parentId?: string
}

export type CreateOutcomePayload = Omit<Outcome, "id">
