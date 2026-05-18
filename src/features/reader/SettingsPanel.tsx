import { useReaderStore } from './reader.store';
import { useEscape } from '../../lib/useEscape';
import './SettingsPanel.css';

interface SettingsPanelProps {
  onClose: () => void;
}

const THEME_KEY = 'verreaux:theme';

function getTheme(): 'dark' | 'light' {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

function applyTheme(t: 'dark' | 'light'): void {
  try {
    localStorage.setItem(THEME_KEY, t);
  } catch {
    // ignore
  }
  document.documentElement.setAttribute('data-theme', t);
}

export function ReaderSettingsPanel({ onClose }: SettingsPanelProps) {
  const settings = useReaderStore((s) => s.settings);
  const updateSettings = useReaderStore((s) => s.updateSettings);

  useEscape(onClose);

  const theme = getTheme();

  function handleTheme() {
    const next = theme === 'light' ? 'dark' : 'light';
    applyTheme(next);
    // Force re-render by toggling a settings key that doesn't matter,
    // or we can just rely on CSS. Nothing to write to reader store.
    // We trigger a tiny no-op update so the panel re-renders with the current theme.
    updateSettings({});
  }

  return (
    <div className="reader-settings-panel" role="dialog" aria-label="Reader settings">
      <div className="reader-settings-panel__header">
        <span className="type-section-label">Settings</span>
        <button className="reader-settings-panel__close type-button" onClick={onClose}>
          Close
        </button>
      </div>

      {/* Reading Mode */}
      <div className="reader-settings-section">
        <div className="type-nav-label reader-settings-label">Reading Mode</div>
        <div className="reader-settings-mode-row">
          <button
            className="reader-settings-mode-btn reader-settings-mode-btn--active type-button"
            aria-pressed={true}
          >
            Webtoon
          </button>
          <button
            className="reader-settings-mode-btn reader-settings-mode-btn--disabled type-button"
            aria-disabled="true"
            aria-pressed={false}
            title="Coming soon"
            style={{ opacity: 0.4, pointerEvents: 'none' }}
          >
            Page
          </button>
        </div>
      </div>

      {/* Page Gap */}
      <div className="reader-settings-section">
        <div className="reader-settings-row">
          <span className="type-body">Page Gap</span>
          <span className="type-nav-label reader-settings-value">{settings.pageGap}px</span>
        </div>
        <input
          type="range"
          min={0}
          max={24}
          step={1}
          value={settings.pageGap}
          onChange={(e) => updateSettings({ pageGap: Number(e.target.value) })}
          className="reader-settings-slider"
          aria-label="Page gap in pixels"
        />
      </div>

      {/* Auto Next Chapter */}
      <div className="reader-settings-section">
        <div className="reader-settings-row">
          <span className="type-body">Auto Next Chapter</span>
          <button
            className={`reader-settings-toggle type-button${settings.autoNextChapter ? ' reader-settings-toggle--on' : ''}`}
            onClick={() => updateSettings({ autoNextChapter: !settings.autoNextChapter })}
            aria-pressed={settings.autoNextChapter}
          >
            {settings.autoNextChapter ? 'On' : 'Off'}
          </button>
        </div>
      </div>

      {/* Progress Bar */}
      <div className="reader-settings-section">
        <div className="reader-settings-row">
          <span className="type-body">Progress Bar</span>
          <button
            className={`reader-settings-toggle type-button${settings.progressBarEnabled ? ' reader-settings-toggle--on' : ''}`}
            onClick={() => updateSettings({ progressBarEnabled: !settings.progressBarEnabled })}
            aria-pressed={settings.progressBarEnabled}
          >
            {settings.progressBarEnabled ? 'On' : 'Off'}
          </button>
        </div>
        {settings.progressBarEnabled && (
          <div className="reader-settings-mode-row" style={{ marginTop: 10 }}>
            {(['top', 'left', 'right'] as const).map((pos) => (
              <button
                key={pos}
                className={`reader-settings-mode-btn type-button${settings.progressBarPosition === pos ? ' reader-settings-mode-btn--active' : ''}`}
                onClick={() => updateSettings({ progressBarPosition: pos })}
                aria-pressed={settings.progressBarPosition === pos}
              >
                {pos.charAt(0).toUpperCase() + pos.slice(1)}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Brightness */}
      <div className="reader-settings-section">
        <div className="reader-settings-row">
          <span className="type-body">Brightness</span>
          <span className="type-nav-label reader-settings-value">
            {Math.round(settings.brightness * 100)}%
          </span>
        </div>
        <input
          type="range"
          min={0}
          max={60}
          step={1}
          value={Math.round(settings.brightness * 100)}
          onChange={(e) => updateSettings({ brightness: Number(e.target.value) / 100 })}
          className="reader-settings-slider"
          aria-label="Screen brightness overlay"
        />
      </div>

      {/* Theme */}
      <div className="reader-settings-section">
        <div className="reader-settings-row">
          <span className="type-body">Theme</span>
          <div className="reader-settings-mode-row">
            <button
              className={`reader-settings-mode-btn type-button${theme === 'dark' ? ' reader-settings-mode-btn--active' : ''}`}
              onClick={() => { if (theme !== 'dark') handleTheme(); }}
              aria-pressed={theme === 'dark'}
            >
              Dark
            </button>
            <button
              className={`reader-settings-mode-btn type-button${theme === 'light' ? ' reader-settings-mode-btn--active' : ''}`}
              onClick={() => { if (theme !== 'light') handleTheme(); }}
              aria-pressed={theme === 'light'}
            >
              Light
            </button>
          </div>
        </div>
      </div>

      {/* Quality — not wired. No server-side image pipeline available;
          client-side resize at render time deferred to v2.
      <div className="reader-settings-section">
        <div className="reader-settings-row">
          <span className="type-body">Quality</span>
          <div className="reader-settings-mode-row">
            <button className="reader-settings-mode-btn type-button">Low</button>
            <button className="reader-settings-mode-btn type-button">Mid</button>
            <button className="reader-settings-mode-btn type-button">High</button>
          </div>
        </div>
      </div>
      */}
    </div>
  );
}
