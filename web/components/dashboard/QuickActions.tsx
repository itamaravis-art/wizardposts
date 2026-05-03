'use client';
import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/Card';
import { Send, Users, Calendar, Logs as LogsIcon, Plus } from '@/lib/icons';
import { cn } from '@/lib/cn';

export interface QuickActionsProps {
  className?: string;
}

interface Action {
  href: string;
  icon: React.ReactNode;
  title: string;
  description: string;
  tone: string;
}

const ACTIONS: Action[] = [
  {
    href: '/posts/new',
    icon: <Plus size={18} />,
    title: 'פוסט חדש',
    description: 'כתוב טקסט וצרף תמונה',
    tone: 'bg-brand-50 text-brand-700 ring-brand-200 hover:bg-brand-100',
  },
  {
    href: '/groups',
    icon: <Users size={18} />,
    title: 'הוסף קבוצות',
    description: 'הדבק קישורים לקבוצות פייסבוק',
    tone: 'bg-emerald-50 text-emerald-700 ring-emerald-200 hover:bg-emerald-100',
  },
  {
    href: '/campaigns/new',
    icon: <Calendar size={18} />,
    title: 'קמפיין חדש',
    description: 'תזמן פרסום אוטומטי',
    tone: 'bg-amber-50 text-amber-700 ring-amber-200 hover:bg-amber-100',
  },
  {
    href: '/logs',
    icon: <LogsIcon size={18} />,
    title: 'יומן פעילות',
    description: 'בדוק מה קרה לאחרונה',
    tone: 'bg-slate-100 text-slate-700 ring-slate-200 hover:bg-slate-200',
  },
];

export default function QuickActions({ className }: QuickActionsProps) {
  return (
    <Card className={className}>
      <CardContent className="p-4">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {ACTIONS.map((a) => (
            <Link
              key={a.href}
              href={a.href}
              className={cn(
                'group relative flex flex-col gap-1.5 rounded-lg ring-1 p-3 transition-all duration-200',
                'focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2',
                a.tone,
              )}
            >
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center justify-center w-8 h-8 rounded-md bg-white/60">
                  {a.icon}
                </span>
                <span className="font-semibold text-sm">{a.title}</span>
              </div>
              <p className="text-xs opacity-80 leading-snug">{a.description}</p>
            </Link>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
