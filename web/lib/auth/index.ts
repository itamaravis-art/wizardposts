import NextAuth from 'next-auth';
import { DrizzleAdapter } from '@auth/drizzle-adapter';
import { db } from '@/lib/db';
import {
  users,
  accounts,
  sessions,
  verificationTokens,
} from '@/lib/db/schema';
import { authConfig } from './config';

/**
 * NextAuth v5 entrypoint — Node runtime only.
 *
 * The adapter is attached here (not in `config.ts`) because the Drizzle adapter
 * pulls in `postgres`, which is not edge-compatible. Middleware imports
 * `authConfig` directly and skips the adapter entirely; the adapter only runs
 * inside the Next.js Node runtime where it's needed for OAuth user creation.
 *
 * Returns the four primitives every server-side caller needs:
 *
 *   - `auth`      → read the current session (server components, route handlers)
 *   - `handlers`  → mounted at app/api/auth/[...nextauth]/route.ts
 *   - `signIn`    → server action / API helper to start an OAuth flow
 *   - `signOut`   → server action / API helper to end the session
 */
export const { auth, handlers, signIn, signOut } = NextAuth({
  ...authConfig,
  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),
});
