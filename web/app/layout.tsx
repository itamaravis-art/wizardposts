import './globals.css';
import * as React from 'react';
import type { Metadata } from 'next';
import { Heebo } from 'next/font/google';
import { auth } from '@/lib/auth';
import AppShell from '@/components/AppShell';
import { Toaster } from '@/components/ui/Toaster';

const heebo = Heebo({
  subsets: ['hebrew', 'latin'],
  display: 'swap',
  weight: ['300', '400', '500', '600', '700', '800'],
  variable: '--font-heebo',
});

export const metadata: Metadata = {
  title: 'WizardPosts — פרסום אוטומטי בקבוצות פייסבוק',
  description: 'פלטפורמת SaaS עברית לפרסום אוטומטי בקבוצות פייסבוק.',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  const user = session?.user
    ? {
        id: session.user.id as string,
        name: session.user.name,
        email: session.user.email,
        image: session.user.image,
      }
    : null;

  return (
    <html lang="he" dir="rtl" className={heebo.variable}>
      <body className="bg-bg text-foreground antialiased font-sans">
        {user ? (
          <AppShell user={user}>{children}</AppShell>
        ) : (
          <div className="min-h-screen">{children}</div>
        )}
        <Toaster position="top-start" />
      </body>
    </html>
  );
}
