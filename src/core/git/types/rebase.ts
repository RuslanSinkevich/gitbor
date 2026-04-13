export type RebaseAction = 'pick' | 'reword' | 'edit' | 'squash' | 'fixup' | 'drop';

export interface RebaseTodoEntry {
  action: RebaseAction;
  hash: string;
  shortHash: string;
  subject: string;
}

export interface RebaseTodoList {
  onto: string;
  entries: RebaseTodoEntry[];
}

export interface RebaseProgress {
  inProgress: boolean;
  currentStep: number;
  totalSteps: number;
  currentHash: string;
  currentAction: string;
}
