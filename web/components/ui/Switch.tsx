'use client';
import * as React from 'react';
import { cn } from '@/lib/cn';

export interface SwitchProps {
  checked: boolean;
  onCheckedChange: (next: boolean) => void;
  disabled?: boolean;
  label?: string;
  helperText?: string;
  size?: 'sm' | 'md';
  className?: string;
  id?: string;
  'aria-label'?: string;
}

export const Switch = React.forwardRef<HTMLButtonElement, SwitchProps>(function Switch(
  {
    checked,
    onCheckedChange,
    disabled,
    label,
    helperText,
    size = 'md',
    className,
    id,
    ...rest
  },
  ref
) {
  const dims =
    size === 'sm'
      ? { track: 'h-4 w-7', thumb: 'h-3 w-3', shift: 'translate-x-3 rtl:-translate-x-3' }
      : { track: 'h-5 w-9', thumb: 'h-4 w-4', shift: 'translate-x-4 rtl:-translate-x-4' };

  const button = (
    <button
      ref={ref}
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        'relative inline-flex shrink-0 items-center rounded-full transition-colors duration-200',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 focus-visible:ring-offset-1',
        dims.track,
        checked
          ? 'bg-brand-600'
          : 'bg-slate-300 dark:bg-border',
        disabled && 'opacity-50 cursor-not-allowed',
        className
      )}
      {...rest}
    >
      <span
        className={cn(
          'inline-block rounded-full bg-white shadow ring-0 transition-transform duration-200',
          'translate-x-0.5 rtl:-translate-x-0.5',
          dims.thumb,
          checked && dims.shift
        )}
      />
    </button>
  );

  if (!label && !helperText) return button;

  return (
    <div className="flex items-start gap-3">
      {button}
      <div className="flex flex-col">
        {label && (
          <label
            htmlFor={id}
            className="text-sm font-medium text-slate-700 dark:text-foreground cursor-pointer"
            onClick={() => !disabled && onCheckedChange(!checked)}
          >
            {label}
          </label>
        )}
        {helperText && (
          <p className="text-xs text-slate-500 dark:text-muted-foreground">
            {helperText}
          </p>
        )}
      </div>
    </div>
  );
});

export default Switch;
