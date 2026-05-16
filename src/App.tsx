import { useEffect } from 'react';
import { useRoute } from './app/router';
import { useLibraryStore } from './features/library/library.store';
import { LibraryScreen } from './features/library/LibraryScreen';
import { SeriesScreen } from './features/series/SeriesScreen';
import { ReaderScreen } from './features/reader/ReaderScreen';
import { UpdatePrompt } from './ui/UpdatePrompt';

export function App() {
  const route = useRoute();
  const loadLibrary = useLibraryStore((s) => s.loadLibrary);

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
      <UpdatePrompt />
    </>
  );
}
