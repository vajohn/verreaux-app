import './ProgressBar.css';

interface ProgressBarProps {
  value: number; // 0..1
  showDot?: boolean;
  thickness?: number;
}

export function ProgressBar({ value, showDot = true, thickness = 2 }: ProgressBarProps) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div className="progress-track" style={{ height: thickness }}>
      <div className="progress-fill" style={{ width: `${pct}%` }} />
      {showDot && value > 0 && value < 1 && (
        <span className="progress-dot" style={{ left: `calc(${pct}% - 3px)` }} />
      )}
    </div>
  );
}
