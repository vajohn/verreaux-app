/// <reference lib="webworker" />
import { precacheAndRoute, cleanupOutdatedCaches, createHandlerBoundToURL } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: Array<{ url: string; revision: string | null }> };

// Must stay in sync with `base` in vite.config.ts (the SW is compiled separately).
const BASE = '/verreaux-app/';

cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

// SPA navigation fallback — parity with the old generateSW navigateFallback.
registerRoute(
  new NavigationRoute(createHandlerBoundToURL(`${BASE}index.html`), {
    denylist: [/^\/api/],
  }),
);

// Support the prompt-update flow (UpdatePrompt posts SKIP_WAITING).
self.addEventListener('message', (event: ExtendableMessageEvent) => {
  if ((event.data as { type?: string } | undefined)?.type === 'SKIP_WAITING') {
    void self.skipWaiting();
  }
});

// Background Sync handler — nudge a window client to resume interrupted downloads.
// SyncEvent is not in the standard WebWorker lib; declare it locally.
interface SyncEvent extends ExtendableEvent { readonly tag: string; }

(self as ServiceWorkerGlobalScope).addEventListener('sync' as unknown as keyof ServiceWorkerGlobalScopeEventMap, ((event: SyncEvent) => {
  if (event.tag !== 'verreaux-resume-downloads') return;
  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const client = clients[0];
    if (client) {
      await client.focus().catch(() => undefined);
      client.postMessage({ type: 'RESUME_DOWNLOADS' });
    }
  })());
}) as EventListener);

// Push notification handler — payload: { type: 'new-series', sourceUrl }.
(self as ServiceWorkerGlobalScope).addEventListener('push', ((event: PushEvent) => {
  let sourceUrl = '';
  try {
    const data = event.data?.json() as { type?: string; sourceUrl?: string } | undefined;
    sourceUrl = data?.sourceUrl ?? '';
  } catch { /* non-JSON payload — ignore */ }
  const slug = sourceUrl.split('/').filter(Boolean).pop()?.replace(/[-_]+/g, ' ') ?? '';
  event.waitUntil(
    (self as ServiceWorkerGlobalScope).registration.showNotification('New series available', {
      body: slug ? `Tap to download "${slug}"` : 'A new series is ready to sync.',
      tag: 'verreaux-new-series',
      data: { sourceUrl },
    }),
  );
}) as EventListener);

// Notification click handler — focus an existing app window or open one.
(self as ServiceWorkerGlobalScope).addEventListener('notificationclick', ((event: NotificationEvent) => {
  event.notification.close();
  event.waitUntil((async () => {
    const sw = self as ServiceWorkerGlobalScope;
    const all = await sw.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = all.find((c) => 'focus' in c) as WindowClient | undefined;
    if (existing) { await existing.focus(); } else { await sw.clients.openWindow('/'); }
  })());
}) as EventListener);
