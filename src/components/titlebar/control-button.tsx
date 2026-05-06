import type { ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export function TitlebarControlButton({
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      tabIndex={-1}
      type="button"
      className={cn(
        'inline-flex cursor-default items-center justify-center focus:outline-none focus-visible:outline-none',
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
}
