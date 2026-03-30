export type RebaseAction = 'pick' | 'reword' | 'edit' | 'squash' | 'fixup' | 'drop';

export interface RebaseTodoEntry {
  readonly action: RebaseAction;
  readonly hash: string;
  readonly shortHash: string;
  readonly subject: string;
}

export interface RebaseTodoList {
  readonly onto: string;
  readonly entries: readonly RebaseTodoEntry[];
}

export interface RebaseProgress {
  readonly inProgress: boolean;
  readonly currentStep: number;
  readonly totalSteps: number;
  readonly currentHash: string;
  readonly currentAction: string;
}
