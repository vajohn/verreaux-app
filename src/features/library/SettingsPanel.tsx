import { useCallback, useEffect, useState } from 'react';
import { useLibraryStore } from './library.store';
import { getAllProfiles, createProfile, renameProfile, deleteProfile } from '../../db/repos/profiles.repo';
import { exportLibrary } from './exportLibrary';
import { getApiBase, getPiApiUrl, setPiApiUrl, getPiApiMode, setPiApiMode, getAutoResolvedTarget, type PiApiMode } from '../sync/piClient';
import { refreshApiTarget } from '../sync/apiResolver';
import { getDownloadBatchSize, setDownloadBatchSize } from '../sync/chunking';
import { enroll } from '../sync/syncClient';
import { getSyncCreds, setSyncCreds, clearSyncCreds, isEnrolled } from '../sync/syncCreds';
import { pullAndReconcile } from '../sync/positionSync';
import { runDownload, enqueueLiveDownloads } from '../sync/defaultCatchUp';
import type { CatchUpCandidate } from '../sync/catchUp';
import { useBackgroundStore } from '../background/background.store';
import { useEscape } from '../../lib/useEscape';
import { ClearProgressSheet } from './ClearProgressSheet';
import { OptimizeStorageSheet } from './OptimizeStorageSheet';
import { DebugViewer } from '../debug/DebugViewer';
import type { Profile, AvatarColor, Theme, LibrarySort } from '../../db/types';
import './SettingsPanel.css';

const THEME_KEY = 'verreaux:theme';

function getTheme(): Theme {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

function setThemeAttr(t: Theme): void {
  try {
    localStorage.setItem(THEME_KEY, t);
  } catch {
    // ignore
  }
  document.documentElement.setAttribute('data-theme', t);
}

const SORT_OPTIONS: { value: LibrarySort; label: string }[] = [
  { value: 'lastRead', label: 'Last Read' },
  { value: 'title', label: 'Title' },
  { value: 'custom', label: 'Custom' },
];

const AVATAR_COLORS: { value: AvatarColor; label: string }[] = [
  { value: 'gold', label: 'Gold' },
  { value: 'steel', label: 'Steel' },
  { value: 'ivory', label: 'Ivory' },
];

function avatarBg(c: AvatarColor): string {
  if (c === 'gold') return 'var(--color-gold)';
  if (c === 'steel') return 'var(--color-steel)';
  return 'var(--color-bone)';
}

export function SettingsPanel() {
  const [theme, setTheme] = useState<Theme>(() => getTheme());
  const librarySort = useLibraryStore((s) => s.librarySort);
  const setLibrarySort = useLibraryStore((s) => s.setLibrarySort);
  const activeProfileId = useLibraryStore((s) => s.activeProfileId);
  const switchProfile = useLibraryStore((s) => s.switchProfile);
  const loadLibrary = useLibraryStore((s) => s.loadLibrary);

  const [compressOnImport, setCompressOnImport] = useState<boolean>(() => {
    try { return localStorage.getItem('verreaux:compress-on-import') === '1'; } catch { return false; }
  });
  const [exportStatus, setExportStatus] = useState<'idle' | 'exporting' | 'done'>('idle');
  const [localUrl, setLocalUrl] = useState<string>(() => getPiApiUrl('local'));
  const [remoteUrl, setRemoteUrl] = useState<string>(() => getPiApiUrl('remote'));
  const [apiMode, setApiMode] = useState<PiApiMode>(() => getPiApiMode());
  const [resolved, setResolved] = useState<'local' | 'remote'>(() => getAutoResolvedTarget());
  const [batchSize, setBatchSize] = useState<number>(() => getDownloadBatchSize());
  const [enrolled, setEnrolled] = useState<boolean>(() => isEnrolled());
  const [syncAccountId, setSyncAccountId] = useState<string>(() => getSyncCreds()?.accountId ?? '');
  const [syncUsername, setSyncUsername] = useState('');
  const [syncPasscode, setSyncPasscode] = useState('');
  const [syncOtp, setSyncOtp] = useState('');
  const [syncDeviceName, setSyncDeviceName] = useState('this device');
  const [syncError, setSyncError] = useState('');
  const [syncSubmitting, setSyncSubmitting] = useState(false);
  const [syncBusy, setSyncBusy] = useState(false);
  const [syncNowMsg, setSyncNowMsg] = useState('');
  const [catchUps, setCatchUps] = useState<CatchUpCandidate[]>([]);
  const bgBusy = useBackgroundStore((s) => s.current !== null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [profilesOpen, setProfilesOpen] = useState(false);
  const [newProfileName, setNewProfileName] = useState('');
  const [newProfileColor, setNewProfileColor] = useState<AvatarColor>('gold');
  const [newProfileSheet, setNewProfileSheet] = useState(false);
  const [renameTarget, setRenameTarget] = useState<Profile | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<Profile | null>(null);
  const [clearProgressOpen, setClearProgressOpen] = useState(false);
  const [optimizeOpen, setOptimizeOpen] = useState(false);
  const [debugOpen, setDebugOpen] = useState(false);

  const handleEscape = useCallback(() => {
    if (debugOpen) { setDebugOpen(false); return; }
    if (optimizeOpen) { setOptimizeOpen(false); return; }
    if (clearProgressOpen) { setClearProgressOpen(false); return; }
    if (deleteTarget) { setDeleteTarget(null); return; }
    if (renameTarget) { setRenameTarget(null); return; }
    if (newProfileSheet) { setNewProfileSheet(false); return; }
    if (profilesOpen) { setProfilesOpen(false); }
  }, [debugOpen, optimizeOpen, clearProgressOpen, deleteTarget, renameTarget, newProfileSheet, profilesOpen]);

  useEscape(handleEscape);

  useEffect(() => {
    setThemeAttr(theme);
  }, [theme]);

  // Keep the Device-sync view in sync if creds change in another tab.
  useEffect(() => {
    function onStorage(e: StorageEvent): void {
      if (e.key === 'verreaux:syncCreds') {
        setEnrolled(isEnrolled());
        setSyncAccountId(getSyncCreds()?.accountId ?? '');
      }
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  useEffect(() => {
    if (apiMode === 'auto') void refreshApiTarget().then(() => setResolved(getAutoResolvedTarget()));
  }, [apiMode]);

  async function loadProfiles(): Promise<void> {
    const ps = await getAllProfiles();
    setProfiles(ps);
  }

  useEffect(() => {
    if (profilesOpen) {
      void loadProfiles();
    }
  }, [profilesOpen]);

  const activeProfile = profiles.find((p) => p.id === activeProfileId);

  async function handleCreateProfile(): Promise<void> {
    const name = newProfileName.trim();
    if (!name) return;
    await createProfile(name, newProfileColor);
    setNewProfileName('');
    setNewProfileColor('gold');
    setNewProfileSheet(false);
    await loadProfiles();
  }

  async function handleRenameProfile(): Promise<void> {
    if (!renameTarget) return;
    const name = renameValue.trim();
    if (!name) return;
    await renameProfile(renameTarget.id, name);
    setRenameTarget(null);
    await loadProfiles();
  }

  async function handleDeleteProfile(p: Profile): Promise<void> {
    if (profiles.length <= 1) return; // Cannot delete last profile
    await deleteProfile(p.id);
    if (p.id === activeProfileId) {
      const remaining = profiles.filter((x) => x.id !== p.id);
      if (remaining[0]) {
        await switchProfile(remaining[0].id);
      }
    }
    setDeleteTarget(null);
    await loadProfiles();
  }

  async function handleEnroll(): Promise<void> {
    const username = syncUsername.trim();
    const passcode = syncPasscode;
    const otp = syncOtp; // already digit-stripped on input
    const deviceName = syncDeviceName.trim() || 'this device';
    if (!username || !passcode) {
      setSyncError('Username and passcode are required.');
      return;
    }
    if (!/^\d{6}$/.test(otp)) {
      setSyncError('Enter the 6-digit authenticator code.');
      return;
    }
    setSyncError('');
    setSyncSubmitting(true);
    try {
      const r = await enroll({ username, passcode, otp, deviceName });
      setSyncCreds(r);
      setSyncAccountId(r.accountId);
      setEnrolled(true);
      setSyncUsername('');
      setSyncPasscode('');
      setSyncOtp('');
      void handleSyncNow(); // pull this account's positions right after enrolling
    } catch (e) {
      setSyncError(e instanceof Error ? e.message : 'Enrollment failed.');
    } finally {
      setSyncSubmitting(false);
    }
  }

  async function handleSyncNow(): Promise<void> {
    setSyncError('');
    setSyncBusy(true);
    setSyncNowMsg('Syncing…');
    try {
      const candidates = await pullAndReconcile(activeProfileId);
      setCatchUps(candidates);
      await loadLibrary();
      setSyncNowMsg('Synced just now');
    } catch {
      setSyncNowMsg('Sync failed — check the Pi API URL.');
    } finally {
      setSyncBusy(false);
    }
  }

  const handleFetchOne = async (c: CatchUpCandidate) => {
    setSyncError('');
    try {
      await runDownload(c, activeProfileId);
      setCatchUps((prev) => prev.filter((x) => x.sourceUrl !== c.sourceUrl));
      await loadLibrary();
    } catch (e) {
      setSyncError(e instanceof Error ? e.message : 'Download failed.');
    }
  };

  const handleFetchAll = () => {
    const batch = [...catchUps];
    setCatchUps([]); // optimistic; next "Sync now" re-derives from a full pull
    void enqueueLiveDownloads(batch, activeProfileId);
    void loadLibrary(); // refresh now to show the freshly-created shells
  };

  function handleSyncSignOut(): void {
    clearSyncCreds();
    setEnrolled(false);
    setSyncAccountId('');
    setSyncError('');
    setSyncNowMsg('');
  }

  return (
    <section className="settings-panel">
      {/* Theme */}
      <div className="type-section-label">Appearance</div>
      <div className="settings-row">
        <span className="type-body">Light Mode</span>
        <button
          className={`settings-toggle type-button${theme === 'light' ? ' settings-toggle--on' : ''}`}
          onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
          aria-pressed={theme === 'light'}
        >
          {theme === 'light' ? 'ON' : 'OFF'}
        </button>
      </div>

      {/* Library Sort */}
      <div className="type-section-label settings-section">Library</div>
      <div className="settings-row">
        <span className="type-body">Sort Order</span>
        <div style={{ display: 'flex', gap: 6 }}>
          {SORT_OPTIONS.map((o) => (
            <button
              key={o.value}
              className={`settings-toggle type-button${librarySort === o.value ? ' settings-toggle--on' : ''}`}
              onClick={() => setLibrarySort(o.value)}
              aria-pressed={librarySort === o.value}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      {/* Profile Switcher */}
      <div className="type-section-label settings-section">Profiles</div>
      <div className="settings-row">
        <span className="type-body">
          Active: {activeProfile?.name ?? 'Unknown'}
        </span>
        <div
          className="profile-avatar-btn"
          style={{ background: avatarBg(activeProfile?.avatarColor ?? 'gold') }}
          aria-label={`Active profile: ${activeProfile?.name ?? ''}`}
        />
        <button
          className="settings-toggle type-button"
          onClick={() => setProfilesOpen(true)}
        >
          Switch
        </button>
      </div>

      {/* Import Settings */}
      <div className="type-section-label settings-section">Import</div>
      <div className="settings-row">
        <div style={{ flex: 1 }}>
          <span className="type-body">Compress images on import</span>
          <div className="type-nav-label" style={{ color: 'var(--color-text-muted)', marginTop: 2 }}>
            Resizes to max 1600px, JPEG 0.85. Slower import, less storage.
          </div>
        </div>
        <button
          className={`settings-toggle type-button${compressOnImport ? ' settings-toggle--on' : ''}`}
          onClick={() => {
            const next = !compressOnImport;
            setCompressOnImport(next);
            try { localStorage.setItem('verreaux:compress-on-import', next ? '1' : '0'); } catch { /* ignore */ }
          }}
          aria-pressed={compressOnImport}
        >
          {compressOnImport ? 'ON' : 'OFF'}
        </button>
      </div>

      {/* Sync */}
      <div className="type-section-label settings-section">Sync</div>
      <div className="settings-row">
        <div style={{ flex: 1 }}>
          <span className="type-body">Pi scraper API URL</span>
          <div className="type-nav-label" style={{ color: 'var(--color-text-muted)', marginTop: 2 }}>
            Auto uses Local when it&apos;s reachable (home), else Remote. Local/Remote force one.
          </div>
          {/* Local URL */}
          <label className="type-nav-label" style={{ display: 'block', marginTop: 8 }}>Local</label>
          <input
            className="series-title-input type-body"
            type="url"
            inputMode="url"
            placeholder="http://192.168.1.107:8080"
            value={localUrl}
            onChange={(e) => { setLocalUrl(e.target.value); setPiApiUrl('local', e.target.value); }}
            style={{ marginTop: 4, width: '100%' }}
          />
          {/* Remote URL */}
          <label className="type-nav-label" style={{ display: 'block', marginTop: 8 }}>Remote</label>
          <input
            className="series-title-input type-body"
            type="url"
            inputMode="url"
            placeholder="https://pajohn.tail8f51b4.ts.net"
            value={remoteUrl}
            onChange={(e) => { setRemoteUrl(e.target.value); setPiApiUrl('remote', e.target.value); }}
            style={{ marginTop: 4, width: '100%' }}
          />
          {/* Active mode toggle */}
          <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
            {(['auto', 'local', 'remote'] as PiApiMode[]).map((mode) => (
              <button
                key={mode}
                className={`settings-toggle type-button${apiMode === mode ? ' settings-toggle--on' : ''}`}
                onClick={() => { setApiMode(mode); setPiApiMode(mode); }}
                aria-pressed={apiMode === mode}
              >
                {mode === 'auto' ? 'Auto' : mode === 'local' ? 'Local' : 'Remote'}
              </button>
            ))}
          </div>
          {apiMode === 'auto' && (
            <div className="type-nav-label" style={{ color: 'var(--color-text-muted)', marginTop: 4 }}>
              Auto → {resolved === 'local' ? 'Local' : 'Remote'}
            </div>
          )}
        </div>
      </div>

      <div className="settings-row">
        <div style={{ flex: 1 }}>
          <span className="type-body">Download batch size (chapters)</span>
          <div className="type-nav-label" style={{ color: 'var(--color-text-muted)', marginTop: 2 }}>
            Chapters per batch when downloading a series. Smaller = more reliable on phones; larger = fewer requests.
          </div>
          <input
            className="series-title-input type-body"
            type="number"
            min={1}
            max={50}
            step={1}
            value={batchSize}
            onChange={(e) => {
              const parsed = parseInt(e.target.value, 10);
              if (!Number.isNaN(parsed)) {
                setDownloadBatchSize(parsed);
                setBatchSize(getDownloadBatchSize());
              }
            }}
            onBlur={(e) => {
              const parsed = parseInt(e.target.value, 10);
              setDownloadBatchSize(Number.isNaN(parsed) ? batchSize : parsed);
              setBatchSize(getDownloadBatchSize());
            }}
            style={{ marginTop: 8, width: '100%' }}
          />
        </div>
      </div>

      <div className="type-section-label settings-section">Device sync</div>
      {enrolled ? (
        <>
          <div className="settings-row">
            <div style={{ flex: 1 }}>
              <span className="type-body">Synced</span>
              <div className="type-nav-label" style={{ color: 'var(--color-text-muted)', marginTop: 2 }}>
                account {syncAccountId.length > 12 ? `${syncAccountId.slice(0, 8)}…` : syncAccountId}
                {syncNowMsg ? ` · ${syncNowMsg}` : ''}
              </div>
            </div>
            <button
              className="settings-toggle settings-toggle--on type-button"
              onClick={() => void handleSyncNow()}
              disabled={syncBusy}
              style={{ marginRight: 8 }}
            >
              {syncBusy ? 'Syncing…' : 'Sync now'}
            </button>
            <button
              className="settings-toggle settings-toggle--gold type-button"
              onClick={handleSyncSignOut}
              disabled={syncBusy}
            >
              Sign out
            </button>
          </div>
          {catchUps.length > 0 && (
            <div className="sync-catchups">
              <p>{catchUps.length} series can be downloaded to this device:</p>
              <ul>
                {catchUps.map((c) => (
                  <li key={c.sourceUrl}>
                    <span>{c.state === 'missing' ? 'New series' : `Behind — from ch. ${c.syncedChapter}`}</span>
                    <button disabled={bgBusy} onClick={() => void handleFetchOne(c)}>
                      {bgBusy ? 'Working…' : 'Fetch'}
                    </button>
                  </li>
                ))}
              </ul>
              <button disabled={bgBusy} onClick={() => void handleFetchAll()}>Fetch all</button>
            </div>
          )}
        </>
      ) : (
        <div className="settings-row">
          <div style={{ flex: 1 }}>
            <span className="type-body">Enroll this device</span>
            <div className="type-nav-label" style={{ color: 'var(--color-text-muted)', marginTop: 2 }}>
              Sync reading positions across devices. Requires the Pi API URL above.
            </div>
            <input
              className="series-title-input type-body"
              type="text"
              placeholder="Username"
              autoComplete="username"
              value={syncUsername}
              onChange={(e) => setSyncUsername(e.target.value)}
              style={{ marginTop: 8, width: '100%' }}
            />
            <input
              className="series-title-input type-body"
              type="password"
              placeholder="Passcode"
              autoComplete="current-password"
              value={syncPasscode}
              onChange={(e) => setSyncPasscode(e.target.value)}
              style={{ marginTop: 8, width: '100%' }}
            />
            <input
              className="series-title-input type-body"
              type="text"
              inputMode="numeric"
              placeholder="6-digit code"
              maxLength={6}
              value={syncOtp}
              onChange={(e) => setSyncOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
              style={{ marginTop: 8, width: '100%' }}
            />
            <input
              className="series-title-input type-body"
              type="text"
              placeholder="Device name"
              maxLength={40}
              value={syncDeviceName}
              onChange={(e) => setSyncDeviceName(e.target.value)}
              style={{ marginTop: 8, width: '100%' }}
            />
            {syncError && (
              <div className="type-nav-label" style={{ color: 'var(--color-gold)', marginTop: 8 }}>
                {syncError}
              </div>
            )}
            <button
              className="settings-toggle settings-toggle--on type-button"
              style={{ marginTop: 8 }}
              disabled={syncSubmitting || !getApiBase().trim()}
              onClick={() => void handleEnroll()}
            >
              {syncSubmitting ? 'Enrolling…' : 'Enroll'}
            </button>
          </div>
        </div>
      )}

      {/* Export */}
      <div className="type-section-label settings-section">Export</div>
      <div className="settings-row">
        <div style={{ flex: 1 }}>
          <span className="type-body">Export Library (with images)</span>
          <div className="type-nav-label" style={{ color: 'var(--color-text-muted)', marginTop: 2 }}>
            Can OOM on libraries &gt; 2 GB.
          </div>
        </div>
        <button
          className="settings-toggle type-button"
          disabled={exportStatus === 'exporting'}
          onClick={async () => {
            setExportStatus('exporting');
            try {
              await exportLibrary(activeProfileId);
              setExportStatus('done');
              setTimeout(() => setExportStatus('idle'), 3000);
            } catch {
              setExportStatus('idle');
            }
          }}
        >
          {exportStatus === 'exporting' ? 'Exporting…' : exportStatus === 'done' ? 'Done!' : 'Export'}
        </button>
      </div>

      {/* Reading Progress */}
      <div className="type-section-label settings-section">Reading Progress</div>
      <div className="settings-row">
        <div style={{ flex: 1 }}>
          <span className="type-body">Clear Read Chapters</span>
          <div className="type-nav-label" style={{ color: 'var(--color-text-muted)', marginTop: 2 }}>
            Reset progress, or destructively delete chapter data to free storage.
          </div>
        </div>
        <button
          className="settings-toggle settings-toggle--gold type-button"
          onClick={() => setClearProgressOpen(true)}
        >
          Manage…
        </button>
      </div>

      {/* Storage */}
      <div className="type-section-label settings-section">Storage</div>
      <div className="settings-row">
        <div style={{ flex: 1 }}>
          <span className="type-body">Optimize Storage</span>
          <div className="type-nav-label" style={{ color: 'var(--color-text-muted)', marginTop: 2 }}>
            Recompress existing pages to 1600px JPEG 0.85. Typically frees 30–60%.
          </div>
        </div>
        <button
          className="settings-toggle type-button"
          onClick={() => setOptimizeOpen(true)}
        >
          Optimize…
        </button>
      </div>

      {/* Diagnostics */}
      <div className="type-section-label settings-section">Diagnostics</div>
      <div className="settings-row">
        <div style={{ flex: 1 }}>
          <span className="type-body">View Logs</span>
          <div className="type-nav-label" style={{ color: 'var(--color-text-muted)', marginTop: 2 }}>
            Inspect, copy or export recent app/import activity to share when reporting issues.
          </div>
        </div>
        <button
          className="settings-toggle type-button"
          onClick={() => setDebugOpen(true)}
        >
          Open
        </button>
      </div>

      <div className="type-section-label settings-section">About</div>
      <div className="type-body">Verreaux PWA — offline manhwa reader.</div>

      {clearProgressOpen && (
        <ClearProgressSheet onClose={() => setClearProgressOpen(false)} />
      )}
      {optimizeOpen && (
        <OptimizeStorageSheet onClose={() => setOptimizeOpen(false)} />
      )}
      {debugOpen && <DebugViewer onClose={() => setDebugOpen(false)} />}

      {/* Profiles Sheet */}
      {profilesOpen && (
        <div className="confirm-sheet" role="dialog" aria-modal="true">
          <div className="confirm-sheet__inner">
            <div className="type-section-label" style={{ color: 'var(--color-gold)' }}>
              Profiles
            </div>
            {profiles.map((p) => (
              <div key={p.id} className="profile-list-row">
                <div
                  className="profile-avatar"
                  style={{ background: avatarBg(p.avatarColor) }}
                />
                <span className={`type-body profile-name${p.id === activeProfileId ? ' profile-name--active' : ''}`}>
                  {p.name}
                </span>
                {p.id === activeProfileId && (
                  <span className="type-nav-label" style={{ color: 'var(--color-gold)', marginLeft: 4 }}>
                    Active
                  </span>
                )}
                <div style={{ flex: 1 }} />
                {p.id !== activeProfileId && (
                  <button
                    className="settings-toggle type-button"
                    onClick={async () => {
                      await switchProfile(p.id);
                      setProfilesOpen(false);
                    }}
                  >
                    Use
                  </button>
                )}
                <button
                  className="settings-toggle type-button"
                  onClick={() => { setRenameTarget(p); setRenameValue(p.name); }}
                >
                  Rename
                </button>
                {profiles.length > 1 && (
                  <button
                    className="settings-toggle settings-toggle--gold type-button"
                    onClick={() => setDeleteTarget(p)}
                  >
                    Del
                  </button>
                )}
              </div>
            ))}
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button
                className="settings-toggle type-button"
                onClick={() => setNewProfileSheet(true)}
              >
                New Profile
              </button>
              <button
                className="settings-toggle type-button"
                onClick={() => setProfilesOpen(false)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* New Profile Sheet */}
      {newProfileSheet && (
        <div className="confirm-sheet" role="dialog" aria-modal="true">
          <div className="confirm-sheet__inner">
            <div className="type-section-label" style={{ color: 'var(--color-gold)' }}>
              New Profile
            </div>
            <input
              className="series-title-input type-body"
              placeholder="Profile name"
              value={newProfileName}
              maxLength={40}
              onChange={(e) => setNewProfileName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { void handleCreateProfile(); } }}
              autoFocus
            />
            <div style={{ display: 'flex', gap: 8 }}>
              {AVATAR_COLORS.map((c) => (
                <button
                  key={c.value}
                  className={`profile-color-swatch${newProfileColor === c.value ? ' profile-color-swatch--active' : ''}`}
                  style={{ background: avatarBg(c.value) }}
                  onClick={() => setNewProfileColor(c.value)}
                  aria-label={`Avatar color: ${c.label}`}
                  aria-pressed={newProfileColor === c.value}
                />
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="settings-toggle type-button" onClick={() => setNewProfileSheet(false)}>
                Cancel
              </button>
              <button
                className="settings-toggle settings-toggle--on type-button"
                onClick={() => void handleCreateProfile()}
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Rename Sheet */}
      {renameTarget && (
        <div className="confirm-sheet" role="dialog" aria-modal="true">
          <div className="confirm-sheet__inner">
            <div className="type-section-label" style={{ color: 'var(--color-gold)' }}>
              Rename Profile
            </div>
            <input
              className="series-title-input type-body"
              value={renameValue}
              maxLength={40}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { void handleRenameProfile(); } }}
              autoFocus
            />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="settings-toggle type-button" onClick={() => setRenameTarget(null)}>
                Cancel
              </button>
              <button
                className="settings-toggle settings-toggle--on type-button"
                onClick={() => void handleRenameProfile()}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Profile Confirm */}
      {deleteTarget && (
        <div className="confirm-sheet" role="dialog" aria-modal="true">
          <div className="confirm-sheet__inner">
            <div className="type-section-label" style={{ color: 'var(--color-gold)' }}>
              Delete Profile
            </div>
            <div className="type-body">
              Delete &ldquo;{deleteTarget.name}&rdquo; and all its data? This cannot be undone.
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="settings-toggle type-button" onClick={() => setDeleteTarget(null)}>
                Cancel
              </button>
              <button
                className="settings-toggle settings-toggle--gold type-button"
                onClick={() => void handleDeleteProfile(deleteTarget)}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
