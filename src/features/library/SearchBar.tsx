import { useLibraryStore } from './library.store';
import './SearchBar.css';

export function SearchBar() {
  const value = useLibraryStore((s) => s.searchQuery);
  const setValue = useLibraryStore((s) => s.setSearchQuery);
  return (
    <div className="search-wrap">
      <input
        className="search-input type-body"
        placeholder="Search your library…"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        aria-label="Search your library"
      />
    </div>
  );
}
