'use client';
import * as React from 'react';
import { cn } from '@/lib/cn';
import { X } from '@/lib/icons';
import { Button, type ButtonVariant } from './Button';

export interface DialogProps {
  open: boolean;
  /** Preferred handler. Either this or onClose must be supplied. */
  onOpenChange?: (next: boolean) => void;
  /** Convenience alias: called when the dialog requests to close. */
  onClose?: () => void;
  title?: React.ReactNode;
  description?: React.ReactNode;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl' | '2xl';
  closeOnOverlay?: boolean;
  closeOnEscape?: boolean;
  className?: string;
}

const SIZES = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-xl',
  '2xl': 'max-w-2xl',
};

export function Dialog({
  open,
  onOpenChange,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
  closeOnOverlay = true,
  closeOnEscape = true,
  className,
}: DialogProps) {
  const dialogRef = React.useRef<HTMLDivElement>(null);
  const requestClose = React.useCallback(() => {
    onOpenChange?.(false);
    onClose?.();
  }, [onOpenChange, onClose]);

  // Esc to close + simple focus trap
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (closeOnEscape && e.key === 'Escape') {
        e.preventDefault();
        requestClose();
      }
      if (e.key === 'Tab') {
        const root = dialogRef.current;
        if (!root) return;
        const focusables = root.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, closeOnEscape, requestClose]);

  // Lock body scroll while open
  React.useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // Auto-focus first focusable when opened
  React.useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      const root = dialogRef.current;
      if (!root) return;
      const first = root.querySelector<HTMLElement>(
        'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      first?.focus();
    }, 30);
    return () => clearTimeout(t);
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby={title ? 'dlg-title' : undefined}
      aria-describedby={description ? 'dlg-desc' : undefined}
    >
      <div
        className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm animate-fade-in"
        onClick={() => closeOnOverlay && requestClose()}
        aria-hidden
      />
      <div
        ref={dialogRef}
        className={cn(
          'relative w-full bg-white dark:bg-surface',
          'border border-slate-200 dark:border-border',
          'rounded-2xl shadow-elevated',
          'animate-scale-in',
          SIZES[size],
          className
        )}
      >
        <div className="flex items-start justify-between gap-4 p-5 pb-3">
          <div className="flex flex-col gap-1 flex-1 min-w-0">
            {title && (
              <h2
                id="dlg-title"
                className="text-lg font-semibold text-slate-900 dark:text-foreground"
              >
                {title}
              </h2>
            )}
            {description && (
              <p
                id="dlg-desc"
                className="text-sm text-slate-500 dark:text-muted-foreground"
              >
                {description}
              </p>
            )}
          </div>
          <button
            type="button"
            aria-label="סגור"
            onClick={requestClose}
            className="shrink-0 p-1.5 -m-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:bg-surface-2 transition-colors"
          >
            <X size={16} />
          </button>
        </div>
        {children && <div className="px-5 pb-4 text-sm">{children}</div>}
        {footer && (
          <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-slate-100 dark:border-border">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Simple imperative confirm() helper. Returns Promise<boolean>.
 * Use sparingly; prefer the controlled <Dialog> for richer UX.
 */
let confirmRoot: HTMLDivElement | null = null;
export function confirmDialog(opts: {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmVariant?: ButtonVariant;
}): Promise<boolean> {
  if (typeof window === 'undefined') return Promise.resolve(false);
  return new Promise((resolve) => {
    if (!confirmRoot) {
      confirmRoot = document.createElement('div');
      document.body.appendChild(confirmRoot);
    }
    import('react-dom/client').then(({ createRoot }) => {
      const root = createRoot(confirmRoot!);
      const close = (ok: boolean) => {
        root.unmount();
        resolve(ok);
      };
      const Wrap = () => {
        const [open, setOpen] = React.useState(true);
        return (
          <Dialog
            open={open}
            onOpenChange={(o) => {
              setOpen(o);
              if (!o) close(false);
            }}
            title={opts.title}
            description={opts.description}
            footer={
              <>
                <Button variant="ghost" onClick={() => close(false)}>
                  {opts.cancelLabel ?? 'ביטול'}
                </Button>
                <Button
                  variant={opts.confirmVariant ?? 'primary'}
                  onClick={() => close(true)}
                >
                  {opts.confirmLabel ?? 'אישור'}
                </Button>
              </>
            }
          />
        );
      };
      root.render(<Wrap />);
    });
  });
}

export default Dialog;
