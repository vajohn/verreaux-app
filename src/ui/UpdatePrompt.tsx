import { useRegisterSW } from 'virtual:pwa-register/react';
import './UpdatePrompt.css';

const HOUR_MS = 60 * 60 * 1000;

export function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    offlineReady: [offlineReady, setOfflineReady],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return;
      const checkForUpdate = () => {
        if (registration.installing || !navigator.onLine) return;
        void registration.update();
      };
      setInterval(checkForUpdate, HOUR_MS);
    },
  });

  if (!needRefresh && !offlineReady) return null;

  const message = needRefresh ? 'New version available.' : 'Ready to use offline.';
  const dismiss = () => {
    setNeedRefresh(false);
    setOfflineReady(false);
  };

  return (
    <div className="update-prompt" role="status" aria-live="polite">
      <span className="update-prompt__msg type-body">{message}</span>
      <div className="update-prompt__actions">
        {needRefresh && (
          <button
            type="button"
            className="update-prompt__btn update-prompt__btn--primary type-button"
            onClick={() => void updateServiceWorker(true)}
          >
            Reload
          </button>
        )}
        <button
          type="button"
          className="update-prompt__btn type-button"
          onClick={dismiss}
        >
          {needRefresh ? 'Later' : 'Dismiss'}
        </button>
      </div>
    </div>
  );
}
