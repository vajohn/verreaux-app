import { create } from 'zustand';
import type { ReaderSettings, Bookmark } from '../../db/types';

export interface PageMeta {
  id: string;
  blobId: string;
  chapterId: string;
  pageNumber: number;
}

const SETTINGS_KEY = 'verreaux:reader-settings';

const defaultSettings: ReaderSettings = {
  readingMode: 'webtoon',
  pageGap: 0,
  autoNextChapter: true,
  brightness: 0,
};

function loadSettings(): ReaderSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return defaultSettings;
    const parsed = JSON.parse(raw) as Partial<ReaderSettings>;
    return { ...defaultSettings, ...parsed };
  } catch {
    return defaultSettings;
  }
}

function saveSettings(s: ReaderSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    // ignore
  }
}

interface ReaderStore {
  pages: PageMeta[];
  currentChapterId: string | null;
  currentPageIndex: number;
  scrollPosition: number;
  overlaysVisible: boolean;
  settings: ReaderSettings;
  bookmarks: Bookmark[];

  setPages: (pages: PageMeta[]) => void;
  setCurrentChapter: (id: string) => void;
  setCurrentPageIndex: (i: number) => void;
  setScrollPosition: (p: number) => void;
  toggleOverlays: () => void;
  showOverlays: () => void;
  hideOverlays: () => void;
  updateSettings: (partial: Partial<ReaderSettings>) => void;
  setBookmarks: (b: Bookmark[]) => void;
}

export const useReaderStore = create<ReaderStore>((set, get) => ({
  pages: [],
  currentChapterId: null,
  currentPageIndex: 0,
  scrollPosition: 0,
  overlaysVisible: false,
  settings: loadSettings(),
  bookmarks: [],

  setPages: (pages) => set({ pages }),
  setCurrentChapter: (id) => set({ currentChapterId: id }),
  setCurrentPageIndex: (i) => set({ currentPageIndex: i }),
  setScrollPosition: (p) => set({ scrollPosition: p }),
  toggleOverlays: () => set({ overlaysVisible: !get().overlaysVisible }),
  showOverlays: () => set({ overlaysVisible: true }),
  hideOverlays: () => set({ overlaysVisible: false }),
  updateSettings: (partial) => {
    const next = { ...get().settings, ...partial };
    saveSettings(next);
    set({ settings: next });
  },
  setBookmarks: (b) => set({ bookmarks: b }),
}));
