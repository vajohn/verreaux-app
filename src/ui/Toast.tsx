import { useEffect, useState } from 'react';
import './Toast.css';

interface ToastProps {
  message: string;
  durationMs?: number;
  onDone?: () => void;
}

export function Toast({ message, durationMs = 1500, onDone }: ToastProps) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => {
      setVisible(false);
      onDone?.();
    }, durationMs);
    return () => clearTimeout(t);
  }, [durationMs, onDone]);

  if (!visible) return null;

  return (
    <div className="toast type-body" role="status" aria-live="polite">
      {message}
    </div>
  );
}
