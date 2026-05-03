'use client';
import * as React from 'react';
import { cn } from '@/lib/cn';

export interface TooltipProps {
  content: React.ReactNode;
  side?: 'top' | 'bottom' | 'start' | 'end';
  delay?: number;
  className?: string;
  children: React.ReactElement;
}

/**
 * RTL-aware lightweight tooltip. Wraps a single trigger element and shows
 * a positioned bubble on hover/focus. No portals — stays in flow with absolute positioning.
 */
export function Tooltip({
  content,
  side = 'top',
  delay = 250,
  className,
  children,
}: TooltipProps) {
  const [open, setOpen] = React.useState(false);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(true), delay);
  };
  const hide = () => {
    if (timer.current) clearTimeout(timer.current);
    setOpen(false);
  };

  React.useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const positions: Record<string, string> = {
    top: 'bottom-full start-1/2 -translate-x-1/2 rtl:translate-x-1/2 mb-2',
    bottom: 'top-full start-1/2 -translate-x-1/2 rtl:translate-x-1/2 mt-2',
    start: 'end-full top-1/2 -translate-y-1/2 me-2',
    end: 'start-full top-1/2 -translate-y-1/2 ms-2',
  };

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocusCapture={show}
      onBlurCapture={hide}
    >
      {children}
      {open && (
        <span
          role="tooltip"
          className={cn(
            'pointer-events-none absolute z-50 whitespace-nowrap',
            'rounded-md px-2 py-1 text-xs font-medium',
            'bg-slate-900 text-white shadow-elevated',
            'dark:bg-slate-100 dark:text-slate-900',
            'animate-fade-in',
            positions[side],
            className
          )}
        >
          {content}
        </span>
      )}
    </span>
  );
}

export default Tooltip;
