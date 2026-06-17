import { create } from 'zustand';
import type { Series, LibrarySort } from '../../db/types';
import { getAllSeries } from '../../db/repos/series.repo';
import { ACTIVE_PROFILE_KEY } from '../../db/bootstrap';
import { pullAndReconcile } from '../sync/positionSync';

export type LibraryTab = 'library' | 'recent' | 'import' | 'settings';

interface LibraryStore {
  series: Series[];
  searchQuery: string;
  activeTab: LibraryTab;
  storageUsed: number;
  isLoading: boolean;
  librarySort: LibrarySort;
  activeProfileId: string;

  loadLibrary: () => Promise<void>;
  setSearchQuery: (q: string) => void;
  setActiveTab: (t: LibraryTab) => void;
  refreshStorageUsed: () => Promise<void>;
  setLibrarySort: (s: LibrarySort) => void;
  switchProfile: (id: string) => Promise<void>;
}

function readActiveProfileId(): string {
  try {
    return localStorage.getItem(ACTIVE_PROFILE_KEY) ?? '';
  } catch {
    return '';
  }
}

function readLibrarySort(): LibrarySort {
  try {
    const v = localStorage.getItem('verreaux:library-sort');
    if (v === 'lastRead' || v === 'title' || v === 'custom') return v;
  } catch {
    // ignore
  }
  return 'lastRead';
}

export const useLibraryStore = create<LibraryStore>((set, get) => ({
  series: [],
  searchQuery: '',
  activeTab: 'library',
  storageUsed: 0,
  isLoading: false,
  librarySort: readLibrarySort(),
  activeProfileId: readActiveProfileId(),

  async loadLibrary() {
    set({ isLoading: true });
    const profileId = get().activeProfileId || readActiveProfileId();
    // Best-effort pull+reconcile before reading so series/progress reflect any
    // server-advanced positions. Never throws.
    await pullAndReconcile(profileId); // catch-up candidates are surfaced via Settings → Sync
    const series = await getAllSeries(profileId);
    set({ series, isLoading: false, activeProfileId: profileId });
  },

  setSearchQuery(q) {
    set({ searchQuery: q });
  },

  setActiveTab(t) {
    set({ activeTab: t });
  },

  async refreshStorageUsed() {
    if (typeof navigator === 'undefined' || !navigator.storage?.estimate) {
      set({ storageUsed: 0 });
      return;
    }
    try {
      const est = await navigator.storage.estimate();
      set({ storageUsed: est.usage ?? 0 });
    } catch {
      set({ storageUsed: 0 });
    }
  },

  setLibrarySort(s) {
    try {
      localStorage.setItem('verreaux:library-sort', s);
    } catch {
      // ignore
    }
    set({ librarySort: s });
  },

  async switchProfile(id) {
    try {
      localStorage.setItem(ACTIVE_PROFILE_KEY, id);
    } catch {
      // ignore
    }
    set({ activeProfileId: id, series: [] });
    await get().loadLibrary();
  },
}));
