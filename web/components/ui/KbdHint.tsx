import * as React from 'react';
import { cn } from '@/lib/cn';

export interface KbdHintProps extends React.HTMLAttributes<HTMLElement> {}

export function KbdHint({ className, children, ...rest }: KbdHintProps) {
  return (
    <kbd
      className={cn(
        'inline-flex items-center justify-center min-w-[1.5rem] h-5 px-1.5',
        'rounded-md border border-slate-200 bg-slate-50 text-slate-600',
        'dark:border-border dark:bg-surface-2 dark:text-muted-foreground',
        'text-[0.7rem] font-mono leading-none',
        'shadow-[inset_0_-1px_0_0_hsl(220_14%_88%)] dark:shadow-none',
        className
      )}
      {...rest}
    >
      {children}
    </kbd>
  );
}

export default KbdHint;
