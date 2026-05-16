import { useEffect } from 'react';
import { useLibraryStore } from './library.store';
import { formatBytes } from '../../lib/formatBytes';
import './StoragePill.css';

export function StoragePill() {
  const storageUsed = useLibraryStore((s) => s.storageUsed);
  const refresh = useLibraryStore((s) => s.refreshStorageUsed);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  return (
    <div className="storage-pill type-nav-label" aria-live="polite">
      {formatBytes(storageUsed)}
    </div>
  );
}
