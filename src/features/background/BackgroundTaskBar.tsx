import { useBackgroundStore } from './background.store';
import { ProgressBar } from '../../ui/ProgressBar';
import './BackgroundTaskBar.css';

export function BackgroundTaskBar() {
  const task = useBackgroundStore((s) => s.current);
  if (!task) return null;

  const value = task.progress ?? 0;
  const indeterminate = task.progress == null;

  return (
    <div className="bg-task-bar" role="status" aria-live="polite">
      <div className="bg-task-bar__inner">
        <div className="bg-task-bar__text">
          <span className="bg-task-bar__label type-nav-label">{task.label}</span>
          {task.subLabel && (
            <span className="bg-task-bar__sub type-nav-label">{task.subLabel}</span>
          )}
        </div>
        <div className="bg-task-bar__progress">
          <ProgressBar
            value={indeterminate ? 0 : value}
            showDot={!indeterminate}
            thickness={2}
          />
        </div>
      </div>
    </div>
  );
}
