import { Suspense } from 'react';
import { GoogleButton } from './google-button';

interface SignInPageProps {
  searchParams: Promise<{ callbackUrl?: string }>;
}

export const metadata = {
  title: 'התחברות | WizardPosts',
  description: 'התחבר/י לחשבון WizardPosts שלך',
};

export default async function SignInPage({ searchParams }: SignInPageProps) {
  const { callbackUrl } = await searchParams;

  return (
    <div
      dir="rtl"
      className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 px-4 py-12"
    >
      <div className="w-full max-w-sm space-y-8 rounded-2xl bg-white p-8 shadow-xl ring-1 ring-gray-200">
        {/* Logo */}
        <div className="flex flex-col items-center space-y-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 text-2xl font-bold text-white shadow-md">
            W
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">
            WizardPosts
          </h1>
        </div>

        {/* Welcome */}
        <div className="space-y-2 text-center">
          <h2 className="text-lg font-semibold text-gray-900">
            ברוכים הבאים
          </h2>
          <p className="text-sm text-gray-600">
            התחבר/י כדי להתחיל לתזמן פוסטים אוטומטית
          </p>
        </div>

        {/* Sign-in */}
        <Suspense fallback={null}>
          <GoogleButton callbackUrl={callbackUrl} />
        </Suspense>

        {/* Legal */}
        <p className="text-center text-xs text-gray-500">
          בהמשך ההתחברות את/ה מאשר/ת את
          {' '}
          <a href="/terms" className="underline hover:text-gray-700">
            תנאי השימוש
          </a>
          {' '}
          ו
          <a href="/privacy" className="underline hover:text-gray-700">
            מדיניות הפרטיות
          </a>
          .
        </p>
      </div>
    </div>
  );
}
