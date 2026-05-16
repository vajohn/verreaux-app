import type { ButtonHTMLAttributes } from 'react';
import './Button.css';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'ghost';
  block?: boolean;
}

export function Button({
  variant = 'primary',
  block = false,
  className = '',
  ...rest
}: ButtonProps) {
  const cls = `vrx-btn vrx-btn--${variant} type-button${block ? ' vrx-btn--block' : ''} ${className}`;
  return <button className={cls.trim()} {...rest} />;
}
