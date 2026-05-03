'use client';
import * as React from 'react';
import { cn } from '@/lib/cn';
import { Check, AlertCircle, X, Loader } from '@/lib/icons';
import { toast as toastApi, type ToastItem, type ToastVariant } from '@/lib/toast';

const ICONS: Record<ToastVariant, React.ReactNode> = {
  success: <Check size={16} className="text-success-600" />,
  error: <AlertCircle size={16} className="text-danger-600" />,
  info: <AlertCircle size={16} className="text-info-600" />,
  loading: <Loader size={16} className="animate-spin-slow text-brand-600" />,
};

const TINTS: Record<ToastVariant, string> = {
  success:
    'border-success-100 dark:border-success-700/30 bg-white dark:bg-surface',
  error: 'border-danger-100 dark:border-danger-700/30 bg-white dark:bg-surface',
  info: 'border-info-100 dark:border-info-700/30 bg-white dark:bg-surface',
  loading: 'border-slate-200 dark:border-border bg-white dark:bg-surface',
};

export interface ToastProps {
  item: ToastItem;
  onDismiss: (id: string) => void;
}

export function Toast({ item, onDismiss }: ToastProps) {
  return (
    <div
      role={item.variant === 'error' ? 'alert' : 'status'}
      aria-live={item.variant === 'error' ? 'assertive' : 'polite'}
      className={cn(
        'pointer-events-auto flex items-start gap-3 min-w-[280px] max-w-md',
        'rounded-xl border shadow-elevated px-4 py-3',
        'animate-slide-up',
        TINTS[item.variant]
      )}
    >
      <span className="mt-0.5 shrink-0">{ICONS[item.variant]}</span>
      <div className="flex-1 min-w-0">
        {item.title && (
          <div className="text-sm font-medium text-slate-900 dark:text-foreground truncate">
            {item.title}
          </div>
        )}
        {item.description && (
          <div className="text-xs text-slate-500 dark:text-muted-foreground mt-0.5">
            {item.description}
          </div>
        )}
      </div>
      {item.variant !== 'loading' && (
        <button
          type="button"
          aria-label="סגור התראה"
          onClick={() => onDismiss(item.id)}
          className="shrink-0 p-1 -m-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:bg-surface-2 transition-colors"
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
}

// Re-export the api for convenience
export { toastApi as toast };
export default Toast;
