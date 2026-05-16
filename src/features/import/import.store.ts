import { create } from 'zustand';

export type ImportState =
  | { status: 'idle' }
  | { status: 'detecting' }
  | { status: 'quota-warning'; estimatedBytes: number; availableBytes: number }
  | {
      status: 'running';
      seriesName: string;
      chapterIndex: number;
      chapterTotal: number;
      pct: number;
      eta: number | null;
    }
  | { status: 'success'; seriesCount: number }
  | { status: 'error'; message: string }
  | { status: 'cancelled' };

export interface ImportStore {
  state: ImportState;
  setState: (s: ImportState) => void;
  reset: () => void;
  // pendingArgs holds the StartArgs that were deferred while the user
  // decides whether to continue past the quota warning.
  pendingArgs: import('./importController').StartArgs | null;
  setPendingArgs: (args: import('./importController').StartArgs | null) => void;
}

export const useImportStore = create<ImportStore>((set) => ({
  state: { status: 'idle' },
  setState: (s) => set({ state: s }),
  reset: () => set({ state: { status: 'idle' }, pendingArgs: null }),
  pendingArgs: null,
  setPendingArgs: (args) => set({ pendingArgs: args }),
}));
