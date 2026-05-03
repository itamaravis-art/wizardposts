'use client';
import * as React from 'react';
import { cn } from '@/lib/cn';
import { Loader } from '@/lib/icons';

export type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'ghost'
  | 'danger'
  | 'outline';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends React.ComponentPropsWithoutRef<'button'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: React.ReactNode;
  iconPosition?: 'start' | 'end';
  fullWidth?: boolean;
}

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-brand-600 text-white shadow-card hover:bg-brand-700 active:bg-brand-800 disabled:bg-slate-300 disabled:text-slate-500 disabled:shadow-none disabled:cursor-not-allowed',
  secondary:
    'bg-white border border-slate-200 text-slate-800 hover:bg-slate-50 hover:border-slate-300 active:bg-slate-100 dark:bg-surface dark:border-border dark:text-foreground dark:hover:bg-surface-2 disabled:opacity-60 disabled:cursor-not-allowed',
  ghost:
    'text-slate-700 hover:bg-slate-100 active:bg-slate-200 dark:text-foreground dark:hover:bg-surface-2 disabled:opacity-60 disabled:cursor-not-allowed',
  danger:
    'bg-danger-600 text-white shadow-card hover:bg-danger-700 active:bg-danger-700 disabled:opacity-60 disabled:cursor-not-allowed',
  outline:
    'border border-brand-600 text-brand-700 hover:bg-brand-50 active:bg-brand-100 dark:text-brand-300 dark:hover:bg-brand-950/40 disabled:opacity-60 disabled:cursor-not-allowed',
};

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-xs gap-1.5 rounded-md',
  md: 'h-10 px-4 text-sm gap-2 rounded-lg',
  lg: 'h-11 px-5 text-[0.95rem] gap-2 rounded-lg',
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      variant = 'primary',
      size = 'md',
      loading = false,
      icon,
      iconPosition = 'start',
      fullWidth = false,
      className,
      children,
      disabled,
      type = 'button',
      ...rest
    },
    ref
  ) {
    const isDisabled = disabled || loading;
    return (
      <button
        ref={ref}
        type={type}
        disabled={isDisabled}
        aria-busy={loading || undefined}
        data-loading={loading || undefined}
        className={cn(
          'inline-flex items-center justify-center font-medium select-none',
          'transition-[background-color,border-color,color,box-shadow,transform] duration-150 ease-out',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 focus-visible:ring-offset-1 focus-visible:ring-offset-bg',
          'active:scale-[0.98]',
          VARIANTS[variant],
          SIZES[size],
          fullWidth && 'w-full',
          className
        )}
        {...rest}
      >
        {loading ? (
          <Loader size={16} className="animate-spin-slow" />
        ) : (
          icon && iconPosition === 'start' && <span className="shrink-0">{icon}</span>
        )}
        {children && <span className="truncate">{children}</span>}
        {!loading && icon && iconPosition === 'end' && (
          <span className="shrink-0">{icon}</span>
        )}
      </button>
    );
  }
);

export default Button;
