import { useCallback, useEffect, useState } from 'react';
import { useLibraryStore } from './library.store';
import { getAllProfiles, createProfile, renameProfile, deleteProfile } from '../../db/repos/profiles.repo';
import { exportLibrary } from './exportLibrary';
import { useEscape } from '../../lib/useEscape';
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

  const [compressOnImport, setCompressOnImport] = useState<boolean>(() => {
    try { return localStorage.getItem('verreaux:compress-on-import') === '1'; } catch { return false; }
  });
  const [exportStatus, setExportStatus] = useState<'idle' | 'exporting' | 'done'>('idle');
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [profilesOpen, setProfilesOpen] = useState(false);
  const [newProfileName, setNewProfileName] = useState('');
  const [newProfileColor, setNewProfileColor] = useState<AvatarColor>('gold');
  const [newProfileSheet, setNewProfileSheet] = useState(false);
  const [renameTarget, setRenameTarget] = useState<Profile | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<Profile | null>(null);

  const handleEscape = useCallback(() => {
    if (deleteTarget) { setDeleteTarget(null); return; }
    if (renameTarget) { setRenameTarget(null); return; }
    if (newProfileSheet) { setNewProfileSheet(false); return; }
    if (profilesOpen) { setProfilesOpen(false); }
  }, [deleteTarget, renameTarget, newProfileSheet, profilesOpen]);

  useEscape(handleEscape);

  useEffect(() => {
    setThemeAttr(theme);
  }, [theme]);

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

      <div className="type-section-label settings-section">About</div>
      <div className="type-body">Verreaux PWA — offline manhwa reader.</div>

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
