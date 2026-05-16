import { useLibraryStore } from './library.store';
import './BottomNav.css';

const TABS: { key: 'library' | 'recent' | 'import' | 'settings'; label: string }[] = [
  { key: 'library', label: 'Library' },
  { key: 'recent', label: 'Recent' },
  { key: 'import', label: 'Import' },
  { key: 'settings', label: 'Settings' },
];

export function BottomNav() {
  const activeTab = useLibraryStore((s) => s.activeTab);
  const setActiveTab = useLibraryStore((s) => s.setActiveTab);
  return (
    <nav className="bottom-nav" aria-label="Primary">
      {TABS.map((t) => (
        <button
          key={t.key}
          className={`bottom-nav__btn type-nav-label${
            activeTab === t.key ? ' bottom-nav__btn--active' : ''
          }`}
          aria-current={activeTab === t.key ? 'page' : undefined}
          onClick={() => setActiveTab(t.key)}
        >
          {t.label}
        </button>
      ))}
    </nav>
  );
}
