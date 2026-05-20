import { useImportStore } from '../import/import.store';
import { useBackgroundStore } from './background.store';

const IMPORT_TASK_ID = 'import:active';

/**
 * Mirrors the import store's `running` state into the background task bar so
 * progress remains visible after the user navigates away from the library
 * screen. The import store owns the truth; this bridge only reflects it.
 *
 * Reset transitions (success / error / cancelled / idle) finish the task. If
 * `start` is rejected because another background task holds the slot, we
 * skip the mirror — the import UI on the library screen still works as
 * before; the task just won't appear globally for that one run.
 */
export function startImportBridge(): () => void {
  let mirrored = false;
  return useImportStore.subscribe((store, prev) => {
    const s = store.state;
    if (s.status === 'running') {
      if (!mirrored) {
        const ok = useBackgroundStore.getState().start({
          id: IMPORT_TASK_ID,
          kind: 'import',
          label: `Importing ${s.seriesName}`,
          subLabel: `Chapter ${s.chapterIndex} / ${s.chapterTotal}`,
          progress: s.pct,
        });
        mirrored = ok;
      } else {
        useBackgroundStore.getState().update({
          label: `Importing ${s.seriesName}`,
          subLabel: `Chapter ${s.chapterIndex} / ${s.chapterTotal}`,
          progress: s.pct,
        });
      }
      return;
    }
    if (mirrored && prev.state.status === 'running') {
      useBackgroundStore.getState().finish(IMPORT_TASK_ID);
      mirrored = false;
    }
  });
}
