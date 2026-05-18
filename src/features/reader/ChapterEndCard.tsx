import { Button } from '../../ui/Button';

interface ChapterEndCardProps {
  hasNext: boolean;
  onNext: () => void;
  onSeries: () => void;
  onHome: () => void;
}

export function ChapterEndCard({ hasNext, onNext, onSeries, onHome }: ChapterEndCardProps) {
  return (
    <div className="chapter-end-card">
      <div className="type-section-label" style={{ color: 'var(--color-gold)' }}>
        End of chapter
      </div>
      {hasNext ? (
        <Button onClick={onNext}>Next chapter</Button>
      ) : (
        <>
          <div className="type-body">You have reached the latest chapter.</div>
          <div className="chapter-end-card__actions">
            <Button onClick={onSeries}>Back to series</Button>
            <Button variant="ghost" onClick={onHome}>Home</Button>
          </div>
        </>
      )}
    </div>
  );
}
