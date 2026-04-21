import type { Gen3Intermediate } from './target.js';

export type RefusalReason =
  | 'UNDISCOVERED_EGG_GROUP'
  | 'UNBREEDABLE_PREVO'
  | 'LEGENDARY'
  | 'UNKNOWN_SPECIES';

export interface Refusal {
  readonly kind: 'refusal';
  readonly reason: RefusalReason;
  readonly speciesGen2Id: number;
  readonly speciesName: string;
  readonly message: string;
}

export function isRefusal(x: Gen3Intermediate | Refusal): x is Refusal {
  return (x as { kind?: string }).kind === 'refusal';
}
