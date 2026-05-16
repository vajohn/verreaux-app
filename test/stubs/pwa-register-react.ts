// Stub for the `virtual:pwa-register/react` module so unit tests don't need
// the vite-plugin-pwa virtual module to resolve. Individual tests can
// `vi.mock('virtual:pwa-register/react', ...)` to override behavior.
export function useRegisterSW() {
  const noop = () => {};
  return {
    needRefresh: [false, noop] as [boolean, (v: boolean) => void],
    offlineReady: [false, noop] as [boolean, (v: boolean) => void],
    updateServiceWorker: async () => {},
  };
}
