'use client';

import { signIn } from 'next-auth/react';
import { useState } from 'react';

interface GoogleButtonProps {
  callbackUrl?: string;
}

export function GoogleButton({ callbackUrl = '/onboarding' }: GoogleButtonProps) {
  const [loading, setLoading] = useState(false);

  return (
    <button
      type="button"
      disabled={loading}
      onClick={() => {
        setLoading(true);
        void signIn('google', { callbackUrl });
      }}
      className="flex w-full items-center justify-center gap-3 rounded-xl border border-gray-300 bg-white px-4 py-3 text-sm font-medium text-gray-700 shadow-sm transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
    >
      <svg className="h-5 w-5" viewBox="0 0 24 24" aria-hidden="true">
        <path
          fill="#EA4335"
          d="M12 11v3.06h7.13c-.29 1.55-1.16 2.86-2.47 3.74l3.99 3.09c2.33-2.15 3.67-5.32 3.67-9.13 0-.89-.08-1.74-.23-2.56H12z"
        />
        <path
          fill="#34A853"
          d="M5.36 14.27 4.46 14.96 1.27 17.43C3.3 21.46 7.32 24 12 24c3.24 0 5.96-1.07 7.94-2.91l-3.99-3.09c-1.1.74-2.51 1.18-3.95 1.18-3.04 0-5.62-2.05-6.54-4.81L5.36 14.27z"
        />
        <path
          fill="#4A90E2"
          d="M1.27 6.57C.46 8.18 0 9.99 0 12s.46 3.82 1.27 5.43l4.27-3.32C5.2 13.13 5 12.08 5 12s.2-1.13.54-2.11L1.27 6.57z"
        />
        <path
          fill="#FBBC05"
          d="M12 4.74c1.77 0 3.35.61 4.6 1.8l3.45-3.45C17.95 1.16 15.23 0 12 0 7.32 0 3.3 2.54 1.27 6.57l4.27 3.32C6.38 6.79 8.96 4.74 12 4.74z"
        />
      </svg>
      <span>{loading ? 'מתחבר…' : 'המשך עם Google'}</span>
    </button>
  );
}
