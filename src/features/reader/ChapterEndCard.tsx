import { Button } from '../../ui/Button';

interface ChapterEndCardProps {
  hasNext: boolean;
  onNext: () => void;
}

export function ChapterEndCard({ hasNext, onNext }: ChapterEndCardProps) {
  return (
    <div className="chapter-end-card">
      <div className="type-section-label" style={{ color: 'var(--color-gold)' }}>
        End of chapter
      </div>
      {hasNext ? (
        <Button onClick={onNext}>Next chapter</Button>
      ) : (
        <div className="type-body">You have reached the latest chapter.</div>
      )}
    </div>
  );
}
