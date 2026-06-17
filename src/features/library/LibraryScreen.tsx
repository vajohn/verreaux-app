import { useCallback, useEffect, useMemo, useState } from 'react';
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
import { Button } from '../../ui/Button';
import { useEscape } from '../../lib/useEscape';
import { addFromUrl } from '../sync/addFromUrl';
import { defaultRunScrape } from '../sync/defaultRunScrape';
import { startImport } from '../import/importController';
import './LibraryScreen.css';

export function LibraryScreen() {
  const activeTab = useLibraryStore((s) => s.activeTab);
  const series = useLibraryStore((s) => s.series);
  const searchQuery = useLibraryStore((s) => s.searchQuery);
  const profileId = useLibraryStore((s) => s.activeProfileId);
  const loadLibrary = useLibraryStore((s) => s.loadLibrary);
  const librarySort = useLibraryStore((s) => s.librarySort);
  const importState = useImportStore((s) => s.state);

  // Add-from-URL sheet state
  const [addUrlSheet, setAddUrlSheet] = useState(false);
  const [addUrlInput, setAddUrlInput] = useState('');
  const [addOtpInput, setAddOtpInput] = useState('');
  const [addUrlSubmitting, setAddUrlSubmitting] = useState(false);
  const [addUrlError, setAddUrlError] = useState('');
  // Optional chapter range; blank -> full series (--from 0 --to latest).
  const [addFromInput, setAddFromInput] = useState('');
  const [addToInput, setAddToInput] = useState('');

  const handleEscape = useCallback(() => {
    if (addUrlSheet && !addUrlSubmitting) setAddUrlSheet(false);
  }, [addUrlSheet, addUrlSubmitting]);
  useEscape(handleEscape);

  async function handleAddFromUrl(): Promise<void> {
    const url = addUrlInput.trim();
    const otp = addOtpInput.trim();
    if (!url) {
      setAddUrlError('Enter a series URL.');
      return;
    }
    if (!/^\d{6}$/.test(otp)) {
      setAddUrlError('Enter the 6-digit authenticator code.');
      return;
    }
    const from = addFromInput.trim();
    const to = addToInput.trim();
    if (from && !/^\d+$/.test(from)) {
      setAddUrlError('"From" must be a chapter number, or leave it blank for the start.');
      return;
    }
    if (to && to !== 'latest' && !/^\d+$/.test(to)) {
      setAddUrlError('"To" must be a number or "latest", or leave it blank.');
      return;
    }
    setAddUrlSubmitting(true);
    setAddUrlError('');
    try {
      await addFromUrl(
        { url, otp, from, to },
        {
          runScrape: defaultRunScrape(() => {}),
          startImport,
          activeProfileId: profileId,
        },
      );
      // The import-progress UI (ImportZone, driven by useImportStore) takes
      // over from here, exactly like a file import.
      setAddUrlSheet(false);
      setAddUrlInput('');
      setAddOtpInput('');
      setAddFromInput('');
      setAddToInput('');
    } catch (e) {
      setAddUrlError(e instanceof Error ? e.message : 'Failed to add from URL.');
    } finally {
      setAddUrlSubmitting(false);
    }
  }

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
            <div style={{ display: 'flex', justifyContent: 'center', marginTop: 12 }}>
              <Button variant="ghost" onClick={() => { setAddUrlError(''); setAddUrlInput(''); setAddOtpInput(''); setAddFromInput(''); setAddToInput(''); setAddUrlSheet(true); }}>
                Add from URL
              </Button>
            </div>
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
            <div style={{ display: 'flex', justifyContent: 'center', marginTop: 12 }}>
              <Button variant="ghost" onClick={() => { setAddUrlError(''); setAddUrlInput(''); setAddOtpInput(''); setAddFromInput(''); setAddToInput(''); setAddUrlSheet(true); }}>
                Add from URL
              </Button>
            </div>
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

      {addUrlSheet && (
        <div className="confirm-sheet" role="dialog" aria-modal="true">
          <div className="confirm-sheet__inner">
            <div className="type-section-label" style={{ color: 'var(--color-gold)' }}>
              Add from URL
            </div>
            <input
              className="series-title-input type-body"
              type="url"
              inputMode="url"
              placeholder="https://… (series page URL)"
              value={addUrlInput}
              onChange={(e) => setAddUrlInput(e.target.value)}
              disabled={addUrlSubmitting}
              autoFocus
            />
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                className="series-title-input type-body"
                style={{ flex: 1 }}
                type="text"
                inputMode="numeric"
                placeholder="From (0)"
                aria-label="From chapter (optional, default 0)"
                value={addFromInput}
                onChange={(e) => setAddFromInput(e.target.value.replace(/\D/g, ''))}
                disabled={addUrlSubmitting}
              />
              <input
                className="series-title-input type-body"
                style={{ flex: 1 }}
                type="text"
                placeholder="To (latest)"
                aria-label="To chapter or 'latest' (optional, default latest)"
                value={addToInput}
                onChange={(e) => setAddToInput(e.target.value.replace(/[^0-9a-z]/gi, ''))}
                disabled={addUrlSubmitting}
              />
            </div>
            <div className="type-body" style={{ opacity: 0.7, fontSize: '0.85em' }}>
              Leave the range blank to fetch the whole series.
            </div>
            <input
              className="series-title-input type-body"
              type="text"
              inputMode="numeric"
              maxLength={6}
              placeholder="6-digit code"
              value={addOtpInput}
              onChange={(e) => setAddOtpInput(e.target.value.replace(/\D/g, '').slice(0, 6))}
              onKeyDown={(e) => { if (e.key === 'Enter') { void handleAddFromUrl(); } }}
              disabled={addUrlSubmitting}
            />
            {addUrlError && (
              <div className="type-body" style={{ color: 'var(--color-gold)' }}>
                {addUrlError}
              </div>
            )}
            <div className="confirm-sheet__actions">
              <Button
                variant="ghost"
                onClick={() => setAddUrlSheet(false)}
                disabled={addUrlSubmitting}
              >
                Cancel
              </Button>
              <Button onClick={() => void handleAddFromUrl()} disabled={addUrlSubmitting}>
                {addUrlSubmitting ? 'Working…' : 'Add'}
              </Button>
            </div>
          </div>
        </div>
      )}

      <BottomNav />
    </div>
  );
}
