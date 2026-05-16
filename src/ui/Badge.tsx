import './Badge.css';

interface BadgeProps {
  children: React.ReactNode;
  variant?: 'gold' | 'outline';
}

export function Badge({ children, variant = 'gold' }: BadgeProps) {
  return <span className={`vrx-badge vrx-badge--${variant} type-badge`}>{children}</span>;
}
