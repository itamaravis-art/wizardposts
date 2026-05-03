'use client';
import * as React from 'react';
import { cn } from '@/lib/cn';

export interface SliderProps
  extends Omit<React.ComponentPropsWithoutRef<'input'>, 'value' | 'defaultValue' | 'onChange'> {
  label?: string;
  helperText?: string;
  error?: string | boolean;
  value: number;
  onChange?: (value: number) => void;
  /** shadcn-style alias for onChange */
  onValueChange?: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  formatValue?: (v: number) => string;
  containerClassName?: string;
}

let _id = 0;
const useFieldId = (provided?: string) => {
  const ref = React.useRef<string | null>(null);
  if (!ref.current) ref.current = provided ?? `sl_${++_id}`;
  return ref.current;
};

export const Slider = React.forwardRef<HTMLInputElement, SliderProps>(function Slider(
  {
    label,
    helperText,
    error,
    value,
    onChange,
    onValueChange,
    min = 0,
    max = 100,
    step = 1,
    formatValue,
    containerClassName,
    className,
    id,
    disabled,
    ...rest
  },
  ref
) {
  const fid = useFieldId(id);
  const pct = ((Number(value) - min) / (max - min)) * 100;
  const errMsg = typeof error === 'string' ? error : undefined;
  const hasError = !!error;
  return (
    <div className={cn('flex flex-col gap-2', containerClassName)}>
      {(label || formatValue) && (
        <div className="flex items-center justify-between">
          {label && (
            <label
              htmlFor={fid}
              className="text-sm font-medium text-slate-700 dark:text-foreground"
            >
              {label}
            </label>
          )}
          {formatValue && (
            <span className="text-xs font-medium text-slate-500 dark:text-muted-foreground tabular-nums">
              {formatValue(Number(value))}
            </span>
          )}
        </div>
      )}
      <input
        ref={ref}
        id={fid}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => {
          const n = Number(e.target.value);
          onChange?.(n);
          onValueChange?.(n);
        }}
        style={
          {
            background: `linear-gradient(to left, hsl(217 91% 60%) 0%, hsl(217 91% 60%) ${pct}%, hsl(var(--border)) ${pct}%, hsl(var(--border)) 100%)`,
          } as React.CSSProperties
        }
        className={cn(
          'w-full h-2 rounded-full appearance-none cursor-pointer',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50',
          'disabled:opacity-50 disabled:cursor-not-allowed',
          // WebKit thumb
          '[&::-webkit-slider-thumb]:appearance-none',
          '[&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4',
          '[&::-webkit-slider-thumb]:rounded-full',
          '[&::-webkit-slider-thumb]:bg-white',
          '[&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-brand-600',
          '[&::-webkit-slider-thumb]:shadow-card',
          '[&::-webkit-slider-thumb]:transition-transform',
          '[&::-webkit-slider-thumb]:hover:scale-110',
          // Moz
          '[&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4',
          '[&::-moz-range-thumb]:rounded-full',
          '[&::-moz-range-thumb]:bg-white',
          '[&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-brand-600',
          className
        )}
        {...rest}
      />
      {(errMsg || helperText) && (
        <p
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

export default Slider;
