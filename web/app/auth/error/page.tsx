import Link from 'next/link';

interface ErrorPageProps {
  searchParams: Promise<{ error?: string }>;
}

const ERROR_MESSAGES: Record<string, { title: string; body: string }> = {
  Configuration: {
    title: 'בעיית תצורה',
    body: 'יש בעיה בהגדרות השרת. צוות התמיכה כבר על זה — נסה/י שוב בעוד כמה דקות.',
  },
  AccessDenied: {
    title: 'הגישה נדחתה',
    body: 'לא ניתן להיכנס עם החשבון הזה. בדוק/י שאת/ה משתמש/ת בחשבון Google הנכון.',
  },
  Verification: {
    title: 'קישור לא תקף',
    body: 'הקישור פג או כבר נוצל. בקש/י קישור חדש מדף ההתחברות.',
  },
  OAuthAccountNotLinked: {
    title: 'החשבון לא מחובר',
    body: 'כתובת המייל הזו כבר רשומה עם דרך התחברות אחרת. השתמש/י באותה הדרך כמו בפעם הראשונה.',
  },
  Default: {
    title: 'משהו השתבש',
    body: 'לא הצלחנו להשלים את ההתחברות. נסה/י שוב, ואם הבעיה חוזרת — פנה/י לתמיכה.',
  },
};

export const metadata = {
  title: 'שגיאת התחברות | WizardPosts',
};

export default async function AuthErrorPage({ searchParams }: ErrorPageProps) {
  const { error } = await searchParams;
  const key = error && ERROR_MESSAGES[error] ? error : 'Default';
  const { title, body } = ERROR_MESSAGES[key];

  return (
    <div
      dir="rtl"
      className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 px-4 py-12"
    >
      <div className="w-full max-w-sm space-y-6 rounded-2xl bg-white p-8 text-center shadow-xl ring-1 ring-gray-200">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-50 text-2xl">
          <span aria-hidden="true">!</span>
        </div>

        <div className="space-y-2">
          <h1 className="text-xl font-bold text-gray-900">{title}</h1>
          <p className="text-sm text-gray-600">{body}</p>
        </div>

        <div className="space-y-2">
          <Link
            href="/auth/signin"
            className="inline-flex w-full items-center justify-center rounded-xl bg-gray-900 px-4 py-3 text-sm font-medium text-white transition hover:bg-gray-800"
          >
            חזרה לדף ההתחברות
          </Link>
          <Link
            href="/"
            className="inline-flex w-full items-center justify-center rounded-xl bg-white px-4 py-3 text-sm font-medium text-gray-700 ring-1 ring-gray-300 transition hover:bg-gray-50"
          >
            חזרה לדף הבית
          </Link>
        </div>
      </div>
    </div>
  );
}
