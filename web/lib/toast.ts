'use client';

/**
 * Tiny global toast store using useSyncExternalStore.
 * No deps. Stable API:
 *
 *   import { toast, useToasts } from '@/lib/toast';
 *
 *   toast.success('Saved');
 *   const id = toast.loading('Working…');
 *   toast.dismiss(id);
 *   toast.promise(fetch(...), { loading: '…', success: 'Done', error: 'Oops' });
 */
import { useSyncExternalStore } from 'react';

export type ToastVariant = 'success' | 'error' | 'info' | 'loading';

export interface ToastItem {
  id: string;
  variant: ToastVariant;
  title?: string;
  description?: string;
  duration?: number; // ms, 0 = sticky
  createdAt: number;
}

type Listener = (items: ToastItem[]) => void;

let items: ToastItem[] = [];
const listeners = new Set<Listener>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();

const emit = () => listeners.forEach((l) => l(items));

const subscribe = (l: Listener) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

const getSnapshot = () => items;
const getServerSnapshot = () => [] as ToastItem[];

const newId = () =>
  `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

const scheduleDismiss = (id: string, duration: number) => {
  if (duration <= 0) return;
  const t = setTimeout(() => dismiss(id), duration);
  timers.set(id, t);
};

const push = (variant: ToastVariant, msg: string | Partial<ToastItem>): string => {
  const base: ToastItem =
    typeof msg === 'string'
      ? { id: newId(), variant, title: msg, createdAt: Date.now() }
      : {
          id: msg.id ?? newId(),
          variant,
          title: msg.title,
          description: msg.description,
          duration: msg.duration,
          createdAt: Date.now(),
        };

  const duration =
    base.duration ?? (variant === 'error' ? 6000 : variant === 'loading' ? 0 : 4000);
  base.duration = duration;

  // Replace if id already exists
  const idx = items.findIndex((i) => i.id === base.id);
  if (idx >= 0) {
    items = items.map((i) => (i.id === base.id ? base : i));
    const old = timers.get(base.id);
    if (old) clearTimeout(old);
    timers.delete(base.id);
  } else {
    items = [...items, base];
  }
  scheduleDismiss(base.id, duration);
  emit();
  return base.id;
};

const dismiss = (id?: string) => {
  if (!id) {
    items.forEach((i) => {
      const t = timers.get(i.id);
      if (t) clearTimeout(t);
    });
    timers.clear();
    items = [];
  } else {
    const t = timers.get(id);
    if (t) clearTimeout(t);
    timers.delete(id);
    items = items.filter((i) => i.id !== id);
  }
  emit();
};

export const toast = {
  success: (msg: string | Partial<ToastItem>) => push('success', msg),
  error: (msg: string | Partial<ToastItem>) => push('error', msg),
  info: (msg: string | Partial<ToastItem>) => push('info', msg),
  loading: (msg: string | Partial<ToastItem>) => push('loading', msg),
  dismiss,
  promise: async <T,>(
    p: Promise<T>,
    msgs: { loading: string; success: string | ((v: T) => string); error: string | ((e: unknown) => string) }
  ): Promise<T> => {
    const id = push('loading', msgs.loading);
    try {
      const v = await p;
      const title = typeof msgs.success === 'function' ? msgs.success(v) : msgs.success;
      push('success', { id, title });
      return v;
    } catch (e) {
      const title = typeof msgs.error === 'function' ? msgs.error(e) : msgs.error;
      push('error', { id, title });
      throw e;
    }
  },
};

export function useToasts() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
