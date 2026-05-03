import * as React from 'react';
import { cn } from '@/lib/cn';

export type BadgeVariant =
  | 'neutral'
  | 'brand'
  | 'success'
  | 'warning'
  | 'danger'
  | 'info'
  // legacy aliases for compat with earlier agent code
  | 'primary'
  | 'secondary';
export type BadgeSize = 'sm' | 'md';

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  /** @deprecated use `variant` */
  tone?: BadgeVariant;
  size?: BadgeSize;
  dot?: boolean;
}

const VARIANTS: Record<BadgeVariant, { bg: string; text: string; dot: string }> = {
  neutral: {
    bg: 'bg-slate-100 dark:bg-surface-2',
    text: 'text-slate-700 dark:text-foreground',
    dot: 'bg-slate-400',
  },
  // legacy aliases
  primary: {
    bg: 'bg-brand-50 dark:bg-brand-950/40',
    text: 'text-brand-700 dark:text-brand-300',
    dot: 'bg-brand-500',
  },
  secondary: {
    bg: 'bg-slate-100 dark:bg-surface-2',
    text: 'text-slate-700 dark:text-foreground',
    dot: 'bg-slate-400',
  },
  brand: {
    bg: 'bg-brand-50 dark:bg-brand-950/40',
    text: 'text-brand-700 dark:text-brand-300',
    dot: 'bg-brand-500',
  },
  success: {
    bg: 'bg-success-50 dark:bg-success-700/20',
    text: 'text-success-700 dark:text-success-500',
    dot: 'bg-success-500',
  },
  warning: {
    bg: 'bg-warning-50 dark:bg-warning-700/20',
    text: 'text-warning-700 dark:text-warning-500',
    dot: 'bg-warning-500',
  },
  danger: {
    bg: 'bg-danger-50 dark:bg-danger-700/20',
    text: 'text-danger-700 dark:text-danger-500',
    dot: 'bg-danger-500',
  },
  info: {
    bg: 'bg-info-50 dark:bg-info-700/20',
    text: 'text-info-700 dark:text-info-500',
    dot: 'bg-info-500',
  },
};

const SIZES: Record<BadgeSize, string> = {
  sm: 'text-[0.7rem] h-5 px-2 gap-1 rounded-md',
  md: 'text-xs h-6 px-2.5 gap-1.5 rounded-md',
};

export const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(function Badge(
  { variant, tone, size = 'md', dot = false, className, children, ...rest },
  ref
) {
  const v = VARIANTS[(variant ?? tone ?? 'neutral') as BadgeVariant];
  return (
    <span
      ref={ref}
      className={cn(
        'inline-flex items-center font-medium border border-transparent',
        v.bg,
        v.text,
        SIZES[size],
        className
      )}
      {...rest}
    >
      {dot && <span className={cn('w-1.5 h-1.5 rounded-full', v.dot)} />}
      {children}
    </span>
  );
});

export default Badge;
