'use client';

import * as React from 'react';
import { usePathname } from 'next/navigation';
import Sidebar from './Sidebar';
import Header from './Header';
import { Menu, X } from '@/lib/icons';

interface ServerUserLite {
  id: string;
  name?: string | null;
  email?: string | null;
  image?: string | null;
}

interface Props {
  user: ServerUserLite;
  children: React.ReactNode;
}

export default function AppShell({ user, children }: Props) {
  const [open, setOpen] = React.useState(false);
  const pathname = usePathname();

  // Close mobile drawer on navigation
  React.useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <div className="min-h-screen bg-bg flex">
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex w-64 shrink-0 border-l border-border bg-surface">
        <Sidebar user={user} />
      </aside>

      {/* Mobile drawer */}
      {open && (
        <div className="lg:hidden fixed inset-0 z-50 flex" role="dialog" aria-modal="true">
          <div
            className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm animate-fade-in"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <aside className="relative ms-auto w-72 max-w-[80%] bg-surface border-s border-border flex flex-col animate-slide-in-end">
            <button
              onClick={() => setOpen(false)}
              className="absolute top-3 start-3 p-2 rounded-md hover:bg-surface-2"
              aria-label="סגור"
            >
              <X size={18} />
            </button>
            <Sidebar user={user} />
          </aside>
        </div>
      )}

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
        <Header onMenuClick={() => setOpen(true)} />
        <main className="flex-1 px-4 sm:px-6 lg:px-8 py-6 max-w-7xl w-full mx-auto">
          {children}
        </main>
      </div>
    </div>
  );
}

export function MobileMenuButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="lg:hidden p-2 rounded-md hover:bg-surface-2"
      aria-label="פתח תפריט"
    >
      <Menu size={20} />
    </button>
  );
}
