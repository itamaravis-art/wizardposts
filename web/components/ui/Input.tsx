'use client';
import * as React from 'react';
import { cn } from '@/lib/cn';

export interface InputProps extends React.ComponentPropsWithoutRef<'input'> {
  label?: string;
  helperText?: string;
  error?: string | boolean;
  startIcon?: React.ReactNode;
  endIcon?: React.ReactNode;
  /** @deprecated alias for `startIcon` */
  icon?: React.ReactNode;
  containerClassName?: string;
}

let _id = 0;
const useFieldId = (provided?: string) => {
  const ref = React.useRef<string | null>(null);
  if (!ref.current) ref.current = provided ?? `fld_${++_id}`;
  return ref.current;
};

export const Input = React.forwardRef<HTMLInputElement, InputProps>(function Input(
  {
    label,
    helperText,
    error,
    startIcon,
    endIcon,
    icon,
    containerClassName,
    className,
    id,
    disabled,
    ...rest
  },
  ref
) {
  const fid = useFieldId(id);
  const leading = startIcon ?? icon;
  const errMsg = typeof error === 'string' ? error : undefined;
  const hasError = !!error;
  const helpId = helperText || errMsg ? `${fid}-help` : undefined;

  return (
    <div className={cn('flex flex-col gap-1.5', containerClassName)}>
      {label && (
        <label
          htmlFor={fid}
          className="text-sm font-medium text-slate-700 dark:text-foreground"
        >
          {label}
        </label>
      )}
      <div className="relative">
        {leading && (
          <span className="pointer-events-none absolute inset-y-0 start-3 flex items-center text-slate-400">
            {leading}
          </span>
        )}
        <input
          ref={ref}
          id={fid}
          disabled={disabled}
          aria-invalid={hasError || undefined}
          aria-describedby={helpId}
          className={cn(
            'w-full h-10 rounded-lg border bg-white text-sm text-slate-900',
            'placeholder:text-slate-400',
            'transition-shadow duration-150',
            'focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:border-brand-500',
            'disabled:bg-slate-50 disabled:text-slate-400 disabled:cursor-not-allowed',
            'dark:bg-surface dark:text-foreground dark:placeholder:text-muted-foreground',
            leading ? 'ps-9' : 'ps-3',
            endIcon ? 'pe-9' : 'pe-3',
            hasError
              ? 'border-danger-500 focus:ring-danger-500/30 focus:border-danger-500'
              : 'border-slate-200 dark:border-border',
            className
          )}
          {...rest}
        />
        {endIcon && (
          <span className="pointer-events-none absolute inset-y-0 end-3 flex items-center text-slate-400">
            {endIcon}
          </span>
        )}
      </div>
      {(errMsg || helperText) && (
        <p
          id={helpId}
          className={cn(
            'text-xs',
            hasError ? 'text-danger-600' : 'text-slate-500 dark:text-muted-foreground'
          )}
        >
          {errMsg || helperText}
        </p>
      )}
    </div>
  );
});

export default Input;
