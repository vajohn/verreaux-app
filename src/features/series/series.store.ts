import { create } from 'zustand';
import type { Series, Chapter } from '../../db/types';
import { getSeriesById } from '../../db/repos/series.repo';
import { getChaptersBySeriesId } from '../../db/repos/chapters.repo';

interface SeriesStore {
  currentSeries: Series | null;
  chapters: Chapter[];
  newChapterIds: Set<string>;
  isLoading: boolean;
  scrollPosition: number;

  loadSeries: (seriesId: string) => Promise<void>;
  markChaptersNew: (ids: string[]) => void;
  clearNewChapters: () => void;
  saveScrollPosition: (pos: number) => void;
}

export const useSeriesStore = create<SeriesStore>((set) => ({
  currentSeries: null,
  chapters: [],
  newChapterIds: new Set<string>(),
  isLoading: false,
  scrollPosition: 0,

  async loadSeries(seriesId) {
    // Clear stale state BEFORE the await. Otherwise SeriesScreen will render
    // the previous series' data under the new seriesId until the read
    // resolves — which can take many seconds while IDB is busy with a
    // background delete, making it look like every tap "redirects" to the
    // series currently being deleted.
    set({ currentSeries: null, chapters: [], isLoading: true });
    const series = (await getSeriesById(seriesId)) ?? null;
    const chapters = series ? await getChaptersBySeriesId(seriesId) : [];
    set({ currentSeries: series, chapters, isLoading: false });
  },

  markChaptersNew(ids) {
    set({ newChapterIds: new Set(ids) });
  },

  clearNewChapters() {
    set({ newChapterIds: new Set<string>() });
  },

  saveScrollPosition(pos) {
    set({ scrollPosition: pos });
  },
}));
