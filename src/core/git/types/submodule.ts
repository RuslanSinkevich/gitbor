export interface Submodule {
  readonly name: string;
  readonly path: string;
  readonly url: string;
  readonly hash: string;
  readonly status: 'clean' | 'modified' | 'uninitialized';
  readonly branch?: string;
}
