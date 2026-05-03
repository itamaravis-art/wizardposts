import type { NextAuthConfig } from 'next-auth';
import Google from 'next-auth/providers/google';

/**
 * Edge-safe NextAuth config.
 *
 * IMPORTANT: this file must NOT import the Drizzle adapter, the database, or
 * any Node-only code. Middleware imports it directly to verify JWTs at the
 * edge, where `postgres` / Node APIs are not available.
 *
 * The adapter and full config live in `lib/auth/index.ts`, which is only
 * imported from server components, route handlers, and API routes.
 */
export const authConfig = {
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      allowDangerousEmailAccountLinking: false,
    }),
  ],

  secret: process.env.AUTH_SECRET,

  session: {
    strategy: 'jwt',
    maxAge: 60 * 60 * 24 * 30, // 30 days
  },

  trustHost: true,

  pages: {
    signIn: '/auth/signin',
    error: '/auth/error',
  },

  cookies: {
    sessionToken: {
      name:
        process.env.NODE_ENV === 'production'
          ? '__Secure-authjs.session-token'
          : 'authjs.session-token',
      options: {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: process.env.NODE_ENV === 'production',
      },
    },
  },

  callbacks: {
    /**
     * `user` is only present on sign-in (when the adapter just created/loaded
     * the row). On subsequent calls we re-issue the existing token unchanged.
     */
    async jwt({ token, user }) {
      if (user?.id) {
        token.userId = user.id;
      }
      return token;
    },

    async session({ session, token }) {
      if (session.user && typeof token.userId === 'string') {
        session.user.id = token.userId;
      }
      return session;
    },

    /**
     * Edge-safe authorization gate. Returning a boolean here lets middleware
     * decide based purely on JWT presence — no DB hit. Detailed routing rules
     * (which paths are public, redirect vs 401) live in middleware.ts.
     */
    authorized({ auth }) {
      return !!auth?.user;
    },
  },
} satisfies NextAuthConfig;
