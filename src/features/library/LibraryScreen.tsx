import { useEffect, useMemo, useState } from 'react';
import { useLibraryStore } from './library.store';
import { useImportStore } from '../import/import.store';
import { LibraryGrid } from './LibraryGrid';
import { StoragePill } from './StoragePill';
import { SearchBar } from './SearchBar';
import { BottomNav } from './BottomNav';
import { ContinueCard } from './ContinueCard';
import { ImportZone } from './ImportZone';
import { useLibraryProgress } from './useLibraryProgress';
import { SettingsPanel } from './SettingsPanel';
import './LibraryScreen.css';

export function LibraryScreen() {
  const activeTab = useLibraryStore((s) => s.activeTab);
  const series = useLibraryStore((s) => s.series);
  const searchQuery = useLibraryStore((s) => s.searchQuery);
  const profileId = useLibraryStore((s) => s.activeProfileId);
  const loadLibrary = useLibraryStore((s) => s.loadLibrary);
  const librarySort = useLibraryStore((s) => s.librarySort);
  const importState = useImportStore((s) => s.state);

  useEffect(() => {
    document.title = 'Verreaux — Library';
  }, []);

  // Re-fetch progress widgets whenever an import success happens.
  const [progressRevision, setProgressRevision] = useState(0);
  useEffect(() => {
    if (importState.status === 'success') {
      setProgressRevision((r) => r + 1);
    }
  }, [importState.status]);

  useEffect(() => {
    void loadLibrary();
  }, [loadLibrary]);

  const sortedSeries = useMemo(() => {
    const arr = [...series];
    if (librarySort === 'title') {
      return arr.sort((a, b) => a.title.localeCompare(b.title));
    }
    if (librarySort === 'custom') {
      return arr.sort((a, b) => a.sortOrder - b.sortOrder);
    }
    // lastRead: most recent first
    return arr.sort((a, b) => (b.lastReadAt ?? 0) - (a.lastReadAt ?? 0));
  }, [series, librarySort]);

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return q ? sortedSeries.filter((s) => s.title.toLowerCase().includes(q)) : sortedSeries;
  }, [sortedSeries, searchQuery]);

  const recentSeries = useMemo(
    () =>
      [...series]
        .filter((s) => s.lastReadAt)
        .sort((a, b) => (b.lastReadAt ?? 0) - (a.lastReadAt ?? 0)),
    [series],
  );

  const libProgress = useLibraryProgress(profileId, progressRevision);

  return (
    <div className="screen-root">
      <header className="screen-header">
        <div className="type-wordmark wordmark">
          VERREAUX
        </div>
        <StoragePill />
      </header>

      <main className="screen-main">
        {activeTab === 'library' && (
          <>
            <SearchBar />
            <ContinueCard profileId={profileId} revision={progressRevision} />
            <div className="section-head">
              <span className="type-section-label">Your Library</span>
              <span className="type-progress-count library-count">
                {libProgress.readChapters} / {libProgress.totalChapters}
              </span>
              <span className="section-line" />
            </div>
            <LibraryGrid series={filtered} profileId={profileId} />
            <div style={{ height: 24 }} />
            <ImportZone context="home" />
          </>
        )}

        {activeTab === 'recent' && (
          <>
            <div className="section-head">
              <span className="type-section-label">Recent</span>
              <span className="section-line" />
            </div>
            <LibraryGrid
              series={recentSeries}
              profileId={profileId}
              showTimestamps
              emptyText="No reading history yet."
            />
          </>
        )}

        {activeTab === 'import' && (
          <>
            <div className="section-head">
              <span className="type-section-label">Import</span>
              <span className="section-line" />
            </div>
            <ImportZone context="home" />
          </>
        )}

        {activeTab === 'settings' && (
          <>
            <div className="section-head">
              <span className="type-section-label">Settings</span>
              <span className="section-line" />
            </div>
            <SettingsPanel />
          </>
        )}
      </main>

      <BottomNav />
    </div>
  );
}
