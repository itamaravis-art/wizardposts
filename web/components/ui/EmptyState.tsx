import * as React from 'react';
import { cn } from '@/lib/cn';

export interface EmptyStateProps extends React.HTMLAttributes<HTMLDivElement> {
  title: string;
  description?: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
}

const DefaultIllustration = () => (
  <svg
    viewBox="0 0 120 120"
    aria-hidden
    className="w-24 h-24 text-brand-500"
  >
    <defs>
      <linearGradient id="es-grad" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor="hsl(217 91% 60%)" stopOpacity="0.18" />
        <stop offset="100%" stopColor="hsl(199 89% 48%)" stopOpacity="0.12" />
      </linearGradient>
    </defs>
    <circle cx="60" cy="60" r="52" fill="url(#es-grad)" />
    <g
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="34" y="40" width="52" height="44" rx="6" />
      <path d="M34 52h52" />
      <circle cx="42" cy="46" r="1.5" fill="currentColor" />
      <circle cx="48" cy="46" r="1.5" fill="currentColor" />
      <path d="M44 66h32M44 74h22" />
    </g>
  </svg>
);

export function EmptyState({
  title,
  description,
  icon,
  action,
  className,
  ...rest
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center gap-3 py-12 px-6',
        'rounded-xl border border-dashed border-slate-200 dark:border-border',
        'bg-white/60 dark:bg-surface/40',
        className
      )}
      {...rest}
    >
      <div className="mb-2">{icon ?? <DefaultIllustration />}</div>
      <h3 className="text-base font-semibold text-slate-900 dark:text-foreground">
        {title}
      </h3>
      {description && (
        <p className="text-sm text-slate-500 dark:text-muted-foreground max-w-sm">
          {description}
        </p>
      )}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export default EmptyState;
