interface OrnamentProps {
  size?: number;
  color?: string;
  className?: string;
}

export function Ornament({ size = 8, color, className }: OrnamentProps) {
  const c = color ?? 'var(--color-gold)';
  return (
    <span
      className={className}
      style={{
        display: 'inline-block',
        width: size,
        height: size,
        background: c,
        transform: 'rotate(45deg)',
      }}
      aria-hidden="true"
    />
  );
}
