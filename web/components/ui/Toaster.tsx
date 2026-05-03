'use client';
import * as React from 'react';
import { useToasts, toast } from '@/lib/toast';
import { Toast } from './Toast';

export interface ToasterProps {
  /**
   * RTL default: top-start (top-right). Override with `position` if needed.
   */
  position?:
    | 'top-start'
    | 'top-end'
    | 'bottom-start'
    | 'bottom-end'
    | 'top-center'
    | 'bottom-center';
}

const POSITIONS: Record<NonNullable<ToasterProps['position']>, string> = {
  'top-start': 'top-4 start-4 items-start',
  'top-end': 'top-4 end-4 items-end',
  'bottom-start': 'bottom-4 start-4 items-start',
  'bottom-end': 'bottom-4 end-4 items-end',
  'top-center': 'top-4 start-1/2 -translate-x-1/2 rtl:translate-x-1/2 items-center',
  'bottom-center':
    'bottom-4 start-1/2 -translate-x-1/2 rtl:translate-x-1/2 items-center',
};

export function Toaster({ position = 'top-start' }: ToasterProps) {
  const items = useToasts();
  return (
    <div
      aria-live="polite"
      aria-atomic="true"
      className={`pointer-events-none fixed z-[100] flex flex-col gap-2 ${POSITIONS[position]}`}
    >
      {items.map((i) => (
        <Toast key={i.id} item={i} onDismiss={toast.dismiss} />
      ))}
    </div>
  );
}

export default Toaster;
