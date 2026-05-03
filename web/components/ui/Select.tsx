'use client';
import * as React from 'react';
import { cn } from '@/lib/cn';
import { ChevronDown } from '@/lib/icons';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps extends React.ComponentPropsWithoutRef<'select'> {
  label?: string;
  helperText?: string;
  error?: string | boolean;
  options?: SelectOption[];
  containerClassName?: string;
  placeholder?: string;
}

let _id = 0;
const useFieldId = (provided?: string) => {
  const ref = React.useRef<string | null>(null);
  if (!ref.current) ref.current = provided ?? `sel_${++_id}`;
  return ref.current;
};

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(function Select(
  {
    label,
    helperText,
    error,
    options,
    containerClassName,
    className,
    id,
    placeholder,
    children,
    ...rest
  },
  ref
) {
  const fid = useFieldId(id);
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
        <select
          ref={ref}
          id={fid}
          aria-invalid={hasError || undefined}
          aria-describedby={helpId}
          className={cn(
            'w-full h-10 rounded-lg border bg-white text-sm text-slate-900',
            'pe-9 ps-3',
            'transition-shadow duration-150 appearance-none',
            'focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:border-brand-500',
            'disabled:bg-slate-50 disabled:text-slate-400 disabled:cursor-not-allowed',
            'dark:bg-surface dark:text-foreground',
            hasError
              ? 'border-danger-500 focus:ring-danger-500/30 focus:border-danger-500'
              : 'border-slate-200 dark:border-border',
            className
          )}
          {...rest}
        >
          {placeholder && (
            <option value="" disabled hidden>
              {placeholder}
            </option>
          )}
          {options
            ? options.map((o) => (
                <option key={o.value} value={o.value} disabled={o.disabled}>
                  {o.label}
                </option>
              ))
            : children}
        </select>
        <ChevronDown
          size={16}
          className="pointer-events-none absolute inset-y-0 end-3 my-auto text-slate-400"
        />
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

export default Select;
