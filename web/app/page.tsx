import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';

export default async function HomePage() {
  const session = await auth();
  if (session?.user) {
    redirect('/dashboard');
  }

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="px-6 py-5 flex items-center justify-between max-w-6xl mx-auto w-full">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl gradient-brand grid place-items-center shadow-glow text-white font-bold text-sm">
            W
          </div>
          <div className="font-bold text-lg tracking-tight">WizardPosts</div>
        </div>
        <Link
          href="/auth/signin"
          className="text-sm font-medium text-brand-700 hover:text-brand-800"
        >
          התחברות
        </Link>
      </header>

      {/* Hero */}
      <main className="flex-1 flex items-center justify-center px-6">
        <div className="max-w-3xl text-center space-y-8 py-16">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-brand-50 text-brand-700 text-xs font-medium border border-brand-100">
            <span className="w-1.5 h-1.5 rounded-full bg-brand-500 animate-pulse-soft" />
            עכשיו בגרסת בטא
          </div>
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight leading-tight">
            פרסום אוטומטי <span className="gradient-text">בעשרות קבוצות פייסבוק</span> —
            בלי עבודה ידנית.
          </h1>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed">
            בנו קמפיין, חברו את הקבוצות שלכם, והמערכת תתזמן ותפרסם בצורה חכמה — עם
            הגנות אבטחה, שעות פעילות, וקצב אנושי. הכל בעברית, ב-RTL, וקל לתפעול.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link
              href="/auth/signin"
              className="inline-flex items-center justify-center gap-2 h-11 px-6 rounded-lg bg-brand-600 text-white font-medium hover:bg-brand-700 shadow-glow transition-colors"
            >
              <GoogleMark />
              התחברות עם Google
            </Link>
            <Link
              href="#features"
              className="inline-flex items-center justify-center h-11 px-5 rounded-lg border border-border bg-surface hover:bg-surface-2 text-sm font-medium transition-colors"
            >
              איך זה עובד
            </Link>
          </div>

          {/* Feature badges */}
          <div
            id="features"
            className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-12 text-sm"
          >
            <Feature title="ניהול חכם של קבוצות" body="ייבוא בכמות, סינון, ובדיקת הצלחה לכל קבוצה." />
            <Feature title="קצב אנושי" body="הקלדה רגילה, הפסקות, שעות פעילות — בלי לעורר חשד." />
            <Feature title="ריבוי משתמשים" body="כל משתמש עם הסוכן שלו ב-PC. בלי שיתוף סיסמאות." />
          </div>
        </div>
      </main>

      <footer className="px-6 py-6 text-center text-xs text-muted-foreground">
        © {new Date().getFullYear()} WizardPosts
      </footer>
    </div>
  );
}

function Feature({ title, body }: { title: string; body: string }) {
  return (
    <div className="surface p-4 text-start">
      <div className="font-semibold mb-1">{title}</div>
      <div className="text-muted-foreground text-[13px] leading-relaxed">{body}</div>
    </div>
  );
}

function GoogleMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="#fff"
        d="M21.35 11.1H12v2.96h5.36c-.23 1.5-1.62 4.4-5.36 4.4-3.23 0-5.86-2.66-5.86-5.96s2.63-5.96 5.86-5.96c1.84 0 3.07.78 3.78 1.46l2.58-2.5C16.84 3.93 14.64 3 12 3 6.93 3 2.83 7.04 2.83 12s4.1 9 9.17 9c5.3 0 8.81-3.72 8.81-8.95 0-.6-.07-1.06-.16-1.49z"
      />
    </svg>
  );
}
