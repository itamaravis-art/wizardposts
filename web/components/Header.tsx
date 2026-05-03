'use client';

import * as React from 'react';
import Link from 'next/link';
import { Menu, FacebookConnect, AlertCircle, Check } from '@/lib/icons';
import { apiGet } from '@/lib/api';
import type { MeResponse } from '@/lib/types';

interface Props {
  onMenuClick?: () => void;
}

export default function Header({ onMenuClick }: Props) {
  const [me, setMe] = React.useState<MeResponse | null>(null);

  React.useEffect(() => {
    apiGet<MeResponse>('/api/me')
      .then(setMe)
      .catch(() => setMe(null));
  }, []);

  const fbConnected = !!me?.fb_connected;
  const workerOnline = !!me?.worker_online;

  return (
    <header className="sticky top-0 z-30 h-14 bg-surface/80 backdrop-blur border-b border-border">
      <div className="h-full flex items-center justify-between px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto">
        <div className="flex items-center gap-2">
          <button
            onClick={onMenuClick}
            className="lg:hidden p-2 rounded-md hover:bg-surface-2"
            aria-label="פתח תפריט"
          >
            <Menu size={20} />
          </button>
        </div>

        <div className="flex items-center gap-2">
          {/* Worker pill */}
          <span
            className={
              'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium border ' +
              (workerOnline
                ? 'bg-success-50 text-success-700 border-success-100'
                : 'bg-slate-50 text-slate-600 border-slate-200')
            }
            title={workerOnline ? 'הסוכן מחובר' : 'הסוכן לא מחובר'}
          >
            <span
              className={
                'w-1.5 h-1.5 rounded-full ' +
                (workerOnline ? 'bg-success-500 animate-pulse-soft' : 'bg-slate-400')
              }
            />
            Worker
          </span>

          {/* FB connection pill */}
          <Link
            href="/connect"
            className={
              'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors ' +
              (fbConnected
                ? 'bg-brand-50 text-brand-700 border-brand-100 hover:bg-brand-100'
                : 'bg-warning-50 text-warning-700 border-warning-100 hover:bg-warning-100')
            }
          >
            {fbConnected ? <Check size={12} /> : <AlertCircle size={12} />}
            <FacebookConnect size={12} />
            {fbConnected ? me?.fb_user_name || 'מחובר' : 'לא מחובר'}
          </Link>
        </div>
      </div>
    </header>
  );
}
