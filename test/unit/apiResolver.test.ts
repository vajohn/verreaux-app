import { describe, it, expect, vi, afterEach } from 'vitest';
import { probeLocal, refreshApiTarget } from '../../src/features/sync/apiResolver';
import { setPiApiMode, setPiApiUrl, getAutoResolvedTarget, setAutoResolvedTarget } from '../../src/features/sync/piClient';

afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); });

it('probeLocal: reachable (any response) → local', async () => {
  setPiApiUrl('local', 'http://l:8443');
  vi.stubGlobal('fetch', vi.fn(async () => new Response('x', { status: 404 })));
  expect(await probeLocal()).toBe('local');
});
it('probeLocal: fetch error → remote', async () => {
  setPiApiUrl('local', 'http://l:8443');
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('blocked'); }));
  expect(await probeLocal()).toBe('remote');
});
it('probeLocal: no local url → remote', async () => {
  expect(await probeLocal()).toBe('remote');
});
it('refreshApiTarget sets the cached target in auto mode', async () => {
  setPiApiMode('auto'); setPiApiUrl('local', 'http://l:8443');
  vi.stubGlobal('fetch', vi.fn(async () => new Response('x', { status: 404 })));
  await refreshApiTarget();
  expect(getAutoResolvedTarget()).toBe('local');
});
it('refreshApiTarget is a no-op when mode is not auto', async () => {
  setPiApiMode('remote'); setAutoResolvedTarget('remote'); setPiApiUrl('local', 'http://l:8443');
  vi.stubGlobal('fetch', vi.fn(async () => new Response('x', { status: 404 })));
  await refreshApiTarget();
  expect(getAutoResolvedTarget()).toBe('remote');
});
