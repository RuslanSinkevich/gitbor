export interface Submodule {
  name: string;
  path: string;
  url: string;
  hash: string;
  status: 'clean' | 'modified' | 'uninitialized';
  branch?: string;
}
