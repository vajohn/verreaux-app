/** Register a one-off Background Sync so the SW can nudge the app to resume
 *  interrupted downloads when connectivity returns after the app was closed.
 *  Feature-detected + best-effort: a no-op where unsupported (e.g. iOS Safari),
 *  in which case auto-resume-on-launch covers it. */
export async function registerResumeSync(): Promise<void> {
  try {
    const reg = await navigator.serviceWorker?.ready;
    // SyncManager is not in the default TS DOM lib; guard structurally.
    if (reg && 'sync' in reg) {
      await (reg as ServiceWorkerRegistration & { sync: { register(tag: string): Promise<void> } })
        .sync.register('verreaux-resume-downloads');
    }
  } catch {
    /* unsupported / permission denied — rely on auto-resume-on-launch */
  }
}
