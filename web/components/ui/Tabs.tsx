'use client';
import * as React from 'react';
import { cn } from '@/lib/cn';

interface TabsContextValue {
  value: string;
  setValue: (v: string) => void;
  baseId: string;
}
const TabsCtx = React.createContext<TabsContextValue | null>(null);
const useTabs = () => {
  const c = React.useContext(TabsCtx);
  if (!c) throw new Error('Tabs.* must be used inside <Tabs>');
  return c;
};

export interface TabsProps extends React.HTMLAttributes<HTMLDivElement> {
  value?: string;
  defaultValue?: string;
  onValueChange?: (v: string) => void;
}

export function Tabs({
  value,
  defaultValue,
  onValueChange,
  className,
  children,
  ...rest
}: TabsProps) {
  const [internal, setInternal] = React.useState(defaultValue ?? '');
  const isControlled = value !== undefined;
  const current = isControlled ? value! : internal;
  const setValue = (v: string) => {
    if (!isControlled) setInternal(v);
    onValueChange?.(v);
  };
  const baseId = React.useId();
  return (
    <TabsCtx.Provider value={{ value: current, setValue, baseId }}>
      <div className={cn('flex flex-col gap-4', className)} {...rest}>
        {children}
      </div>
    </TabsCtx.Provider>
  );
}

export interface TabsListProps extends React.HTMLAttributes<HTMLDivElement> {}

export function TabsList({ className, children, ...rest }: TabsListProps) {
  return (
    <div
      role="tablist"
      className={cn(
        'relative inline-flex items-center gap-1 border-b border-slate-200 dark:border-border',
        className
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

export interface TabsTriggerProps extends React.ComponentPropsWithoutRef<'button'> {
  value: string;
}

export const TabsTrigger = React.forwardRef<HTMLButtonElement, TabsTriggerProps>(
  function TabsTrigger({ value, className, children, onClick, ...rest }, ref) {
    const { value: current, setValue, baseId } = useTabs();
    const active = current === value;
    return (
      <button
        ref={ref}
        type="button"
        role="tab"
        id={`${baseId}-tab-${value}`}
        aria-selected={active}
        aria-controls={`${baseId}-panel-${value}`}
        tabIndex={active ? 0 : -1}
        onClick={(e) => {
          setValue(value);
          onClick?.(e);
        }}
        className={cn(
          'relative h-10 px-4 text-sm font-medium transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 rounded-t-md',
          active
            ? 'text-brand-700 dark:text-brand-300'
            : 'text-slate-500 hover:text-slate-800 dark:text-muted-foreground dark:hover:text-foreground',
          className
        )}
        {...rest}
      >
        {children}
        <span
          aria-hidden
          className={cn(
            'absolute inset-x-2 -bottom-px h-0.5 rounded-full transition-all duration-200',
            active ? 'bg-brand-600 opacity-100' : 'bg-transparent opacity-0'
          )}
        />
      </button>
    );
  }
);

export interface TabsContentProps extends React.HTMLAttributes<HTMLDivElement> {
  value: string;
}

export function TabsContent({ value, className, children, ...rest }: TabsContentProps) {
  const { value: current, baseId } = useTabs();
  if (current !== value) return null;
  return (
    <div
      role="tabpanel"
      id={`${baseId}-panel-${value}`}
      aria-labelledby={`${baseId}-tab-${value}`}
      className={cn('animate-fade-in', className)}
      {...rest}
    >
      {children}
    </div>
  );
}

export default Tabs;
