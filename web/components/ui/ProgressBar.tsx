import * as React from 'react';
import { cn } from '@/lib/cn';

export interface ProgressBarProps extends React.HTMLAttributes<HTMLDivElement> {
  value: number; // 0-100 (if max not provided) or 0-max
  max?: number;
  variant?: 'brand' | 'success' | 'warning' | 'danger' | 'info';
  size?: 'sm' | 'md' | 'lg';
  showLabel?: boolean;
  indeterminate?: boolean;
  animated?: boolean;
}

const COLORS = {
  brand: 'bg-brand-600',
  success: 'bg-success-500',
  warning: 'bg-warning-500',
  danger: 'bg-danger-500',
  info: 'bg-info-500',
};

const HEIGHTS = {
  sm: 'h-1',
  md: 'h-2',
  lg: 'h-3',
};

export function ProgressBar({
  value,
  max = 100,
  variant = 'brand',
  size = 'md',
  showLabel = false,
  indeterminate = false,
  animated = true,
  className,
  ...rest
}: ProgressBarProps) {
  const pct = indeterminate
    ? 40
    : Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className={cn('w-full', className)} {...rest}>
      <div
        role="progressbar"
        aria-valuenow={indeterminate ? undefined : Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-busy={indeterminate || undefined}
        className={cn(
          'relative w-full overflow-hidden rounded-full bg-slate-100 dark:bg-surface-2',
          HEIGHTS[size]
        )}
      >
        <div
          className={cn(
            'h-full rounded-full',
            COLORS[variant],
            animated && 'transition-[width] duration-500 ease-out',
            indeterminate && 'absolute inset-y-0 animate-progress-indeterminate'
          )}
          style={
            indeterminate
              ? { width: '40%' }
              : { width: `${pct}%` }
          }
        />
      </div>
      {showLabel && !indeterminate && (
        <div className="mt-1 flex justify-between text-xs text-slate-500 dark:text-muted-foreground tabular-nums">
          <span>{Math.round(pct)}%</span>
          <span>
            {value} / {max}
          </span>
        </div>
      )}
    </div>
  );
}

export default ProgressBar;
