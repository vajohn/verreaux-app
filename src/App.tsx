import { useEffect } from 'react';
import { useRoute } from './app/router';
import { useLibraryStore } from './features/library/library.store';
import { LibraryScreen } from './features/library/LibraryScreen';
import { SeriesScreen } from './features/series/SeriesScreen';
import { ReaderScreen } from './features/reader/ReaderScreen';
import { UpdatePrompt } from './ui/UpdatePrompt';
import { BackgroundTaskBar } from './features/background/BackgroundTaskBar';
import { startImportBridge } from './features/background/importBridge';
import { resumePendingDownloads, pendingDownloadCandidates } from './features/sync/resumeDownloads';
import { enqueueLiveDownloads } from './features/sync/defaultCatchUp';
import { useBackgroundStore } from './features/background/background.store';
import { startApiResolver } from './features/sync/apiResolver';

export function App() {
  const route = useRoute();
  const loadLibrary = useLibraryStore((s) => s.loadLibrary);
  const activeProfileId = useLibraryStore((s) => s.activeProfileId);

  useEffect(() => {
    void loadLibrary();
  }, [loadLibrary]);

  useEffect(() => {
    if (navigator.storage?.persist) {
      void navigator.storage.persist().catch(() => {
        // Browser may decline; silent fallback.
      });
    }
  }, []);

  useEffect(() => startImportBridge(), []);

  useEffect(() => startApiResolver(), []);

  useEffect(() => {
    if (!activeProfileId) return;
    void resumePendingDownloads(activeProfileId, (items) => enqueueLiveDownloads(items, activeProfileId));
  }, [activeProfileId]);

  useEffect(() => {
    if (!navigator.serviceWorker) return;
    const onMsg = (e: MessageEvent) => {
      if ((e.data as { type?: string } | undefined)?.type !== 'RESUME_DOWNLOADS') return;
      if (!activeProfileId || useBackgroundStore.getState().current) return; // already downloading
      void pendingDownloadCandidates(activeProfileId).then((items) => {
        if (items.length) void enqueueLiveDownloads(items, activeProfileId);
      });
    };
    navigator.serviceWorker.addEventListener('message', onMsg);
    return () => navigator.serviceWorker.removeEventListener('message', onMsg);
  }, [activeProfileId]);

  let screen;
  switch (route.screen) {
    case 'series':
      screen = <SeriesScreen seriesId={route.seriesId} />;
      break;
    case 'reader':
      screen = <ReaderScreen seriesId={route.seriesId} chapterId={route.chapterId} />;
      break;
    case 'home':
    default:
      screen = <LibraryScreen />;
  }

  return (
    <>
      {screen}
      <BackgroundTaskBar placement={route.screen === 'reader' ? 'bottom' : 'top'} />
      <UpdatePrompt />
    </>
  );
}
