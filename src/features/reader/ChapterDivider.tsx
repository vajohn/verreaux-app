import { Ornament } from '../../ui/Ornament';

interface ChapterDividerProps {
  label?: string;
}

export function ChapterDivider({ label }: ChapterDividerProps) {
  return (
    <div className="chapter-divider" role="separator">
      <span className="chapter-divider__line" />
      <Ornament />
      {label && <span className="type-section-label chapter-divider__label">{label}</span>}
      <Ornament />
      <span className="chapter-divider__line" />
    </div>
  );
}
