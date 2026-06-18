import { create } from 'zustand';

export type BackgroundTaskKind =
  | 'import'
  | 'delete-series'
  | 'delete-read-chapters'
  | 'clear-progress'
  | 'sync-download';

export interface BackgroundTask {
  id: string;
  kind: BackgroundTaskKind;
  /** Short title shown in the bar, e.g. "Deleting Solo Leveling". */
  label: string;
  /** Optional second line, e.g. "12 / 34 pages". */
  subLabel?: string;
  /** 0..1; null when the task is preparing and has no measurable progress yet. */
  progress: number | null;
  startedAt: number;
}

interface BackgroundStore {
  current: BackgroundTask | null;
  start: (task: Omit<BackgroundTask, 'startedAt'>) => boolean;
  update: (
    patch: Partial<Pick<BackgroundTask, 'label' | 'subLabel' | 'progress'>>,
  ) => void;
  finish: (id: string) => void;
}

/**
 * Single-slot tracker for long-running operations that the user has dismissed
 * to the background. Only one task runs at a time so IndexedDB writes stay
 * serialized — `start` returns false when something is already running so
 * callers can guard their triggers.
 */
export const useBackgroundStore = create<BackgroundStore>((set, get) => ({
  current: null,
  start: (task) => {
    if (get().current) return false;
    set({ current: { ...task, startedAt: Date.now() } });
    return true;
  },
  update: (patch) => {
    const cur = get().current;
    if (!cur) return;
    set({ current: { ...cur, ...patch } });
  },
  finish: (id) => {
    const cur = get().current;
    // Guard against a stale finish() racing with a newer task assignment.
    if (!cur || cur.id !== id) return;
    set({ current: null });
  },
}));
