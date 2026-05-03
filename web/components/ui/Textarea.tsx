'use client';
import * as React from 'react';
import { cn } from '@/lib/cn';

export interface TextareaProps extends React.ComponentPropsWithoutRef<'textarea'> {
  label?: string;
  helperText?: string;
  error?: string | boolean;
  containerClassName?: string;
}

let _id = 0;
const useFieldId = (provided?: string) => {
  const ref = React.useRef<string | null>(null);
  if (!ref.current) ref.current = provided ?? `ta_${++_id}`;
  return ref.current;
};

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  function Textarea(
    { label, helperText, error, containerClassName, className, id, rows = 4, ...rest },
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
        <textarea
          ref={ref}
          id={fid}
          rows={rows}
          aria-invalid={hasError || undefined}
          aria-describedby={helpId}
          className={cn(
            'w-full rounded-lg border bg-white text-sm text-slate-900 px-3 py-2.5',
            'placeholder:text-slate-400 resize-y min-h-[80px]',
            'transition-shadow duration-150',
            'focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:border-brand-500',
            'disabled:bg-slate-50 disabled:text-slate-400 disabled:cursor-not-allowed',
            'dark:bg-surface dark:text-foreground dark:placeholder:text-muted-foreground',
            hasError
              ? 'border-danger-500 focus:ring-danger-500/30 focus:border-danger-500'
              : 'border-slate-200 dark:border-border',
            className
          )}
          {...rest}
        />
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
  }
);

export default Textarea;
