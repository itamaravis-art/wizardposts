'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { signOut } from 'next-auth/react';
import {
  Home,
  Send,
  Users,
  Calendar,
  Logs,
  Settings,
  FacebookConnect,
  Link2,
} from '@/lib/icons';
import { cn } from '@/lib/cn';
import { Avatar } from '@/components/ui/Avatar';

interface ServerUserLite {
  id: string;
  name?: string | null;
  email?: string | null;
  image?: string | null;
}

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ size?: number | string }>;
}

const NAV: NavItem[] = [
  { href: '/dashboard', label: 'לוח בקרה', icon: Home },
  { href: '/posts', label: 'פוסטים', icon: Send },
  { href: '/groups', label: 'קבוצות', icon: Users },
  { href: '/campaigns', label: 'קמפיינים', icon: Calendar },
  { href: '/shortlinks', label: 'קישורים מקוצרים', icon: Link2 },
  { href: '/logs', label: 'יומן', icon: Logs },
  { href: '/settings', label: 'הגדרות', icon: Settings },
  { href: '/connect', label: 'חיבור פייסבוק', icon: FacebookConnect },
  { href: '/worker', label: 'Worker', icon: Settings },
];

export default function Sidebar({ user }: { user: ServerUserLite }) {
  const pathname = usePathname();

  return (
    <div className="flex flex-col w-full h-full">
      {/* Logo */}
      <div className="px-5 pt-6 pb-4">
        <Link href="/dashboard" className="flex items-center gap-2.5 group">
          <div className="w-9 h-9 rounded-xl gradient-brand grid place-items-center shadow-glow text-white font-bold text-sm">
            W
          </div>
          <div className="leading-tight">
            <div className="font-bold text-base tracking-tight">WizardPosts</div>
            <div className="text-[11px] text-muted-foreground">פרסום אוטומטי</div>
          </div>
        </Link>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-2 space-y-0.5 overflow-y-auto">
        {NAV.map((item) => {
          const active =
            pathname === item.href ||
            (item.href !== '/dashboard' && pathname?.startsWith(item.href + '/')) ||
            (item.href !== '/dashboard' && pathname === item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors',
                active
                  ? 'bg-brand-50 text-brand-700 font-semibold dark:bg-brand-950/50 dark:text-brand-300'
                  : 'text-foreground/80 hover:bg-surface-2 hover:text-foreground',
              )}
            >
              <Icon size={18} />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* User block */}
      <div className="border-t border-border p-3">
        <div className="flex items-center gap-2.5 px-2 py-2">
          <Avatar name={user.name || user.email || 'U'} src={user.image || undefined} size={28} />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium truncate">{user.name || 'משתמש'}</div>
            <div className="text-[11px] text-muted-foreground truncate">{user.email}</div>
          </div>
        </div>
        <button
          onClick={() => signOut({ callbackUrl: '/' })}
          className="mt-1 w-full text-start px-3 py-1.5 rounded-md text-sm text-muted-foreground hover:bg-surface-2 hover:text-foreground transition-colors"
        >
          התנתקות
        </button>
      </div>
    </div>
  );
}
