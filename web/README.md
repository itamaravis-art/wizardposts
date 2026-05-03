# WizardPosts — Web

Multi-tenant SaaS dashboard + API for the Facebook auto-posting worker.

Stack: **Next.js 15 (App Router) · React 19 · NextAuth v5 · Drizzle ORM · Postgres (Supabase) · Supabase Storage · Tailwind**.

The Cloudflare Worker that drives the actual browser automation lives in a sibling directory and talks to this app over the `/api/worker/*` routes using a bcrypt-hashed bearer token.

---

## Quick start

### 1. Prerequisites

- Node.js 20+
- A Supabase project (free tier is fine) with the `pgcrypto` extension enabled (Supabase enables it by default)
- An OAuth app for at least one auth provider (Google is the default)

### 2. Clone and install

```bash
git clone <repo-url> facebookpost-cloud
cd facebookpost-cloud/web
npm install
```

### 3. Configure environment

Create `.env.local` in `web/` with the following keys:

```bash
# Postgres connection — use the Supabase "Connection Pooling" URL (port 6543)
# for serverless, or the direct URL (5432) for migrations.
DATABASE_URL=postgres://postgres:<pw>@<host>:6543/postgres?sslmode=require

# Supabase — Project Settings → API
NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon-key>
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>   # server-only, never ship to client

# NextAuth
AUTH_SECRET=<openssl rand -base64 32>
AUTH_URL=http://localhost:3000

# Google OAuth (Console → APIs & Services → Credentials)
AUTH_GOOGLE_ID=<client-id>
AUTH_GOOGLE_SECRET=<client-secret>
```

### 4. Push the database schema

```bash
npm run db:push
```

This runs `drizzle-kit push` against `DATABASE_URL` and creates every table in `lib/db/schema.ts`.

### 5. Bootstrap Supabase Storage

```bash
npx tsx scripts/setup-supabase.ts
```

Creates the `images` (public) and `screenshots` (private) buckets and applies the per-user folder policies. Idempotent — safe to re-run.

### 6. Run the dev server

```bash
npm run dev
```

App boots at <http://localhost:3000>. Sign in with Google to create your first user row, then visit `/dashboard`.

---

## Useful scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Next.js dev server on `:3000` |
| `npm run build` | Production build |
| `npm run start` | Run the production build |
| `npm run typecheck` | `tsc --noEmit` over the whole project |
| `npm run db:generate` | Generate a SQL migration from schema diff |
| `npm run db:push` | Apply schema directly (dev only) |
| `npm run db:studio` | Open Drizzle Studio against `DATABASE_URL` |
| `npx tsx scripts/setup-supabase.ts` | Bootstrap Storage buckets + policies |

---

## Layout

```
web/
  app/                    # Next.js App Router
    api/
      _lib/               # shared route helpers (auth, error funnel, lifecycle)
      auth/               # NextAuth handlers
      campaigns/          # campaign CRUD
      groups/             # group CRUD + bulk import
      posts/              # post CRUD
      settings/           # GET/PATCH user safety defaults
      worker/             # token-authenticated routes the Worker calls
        heartbeat/
        next-job/
        jobs/
        upload-screenshot/
        connection-status/
      worker-tokens/      # mint / revoke worker tokens
      health/             # liveness probe
  components/             # shared React components
  lib/
    auth/                 # NextAuth config + requireUser + worker auth
    db/
      index.ts            # Drizzle client singleton
      schema.ts           # all tables (users, campaigns, jobs, …)
      queries/            # typed query helpers grouped by entity
      zod.ts              # shared zod schemas
    storage.ts            # Supabase Storage helpers (uploadImage / Screenshot / signed URLs)
  scripts/
    setup-supabase.ts     # one-time storage bootstrap
  drizzle.config.ts
  middleware.ts           # NextAuth route protection
```

---

## How the worker auth works

1. User visits `/settings` and clicks **Generate worker token**.
2. The server returns a one-time plain token; only its bcrypt hash is stored in `worker_tokens.token`.
3. The user pastes the token into the desktop/CF worker config.
4. The worker sends `Authorization: Bearer <token>` to `/api/worker/*`.
5. `lib/auth/worker-auth.ts` looks up active tokens for the request, bcrypt-compares, and resolves a `(userId, tokenId)`.

---

## Storage layout

| Bucket | Visibility | Path | Used by |
| --- | --- | --- | --- |
| `images` | public-read | `<userId>/<timestamp>-<name>` | Post images embedded in FB posts |
| `screenshots` | private | `<userId>/<timestamp>-<name>` | Worker proof-of-success / captcha frames; surfaced via signed URL (1h) |

All uploads from the API server use the **service-role** client and bypass RLS. The folder policies in `setup-supabase.ts` only affect direct client uploads, which today aren't used.

---

## Troubleshooting

- **`DATABASE_URL is not set`** when running scripts — make sure your shell loads `.env.local`. With `tsx`, prepend `node --env-file=.env.local`.
- **`storage.foldername` policy errors** — your project's auth schema might be older than expected. Apply the policy SQL from `scripts/setup-supabase.ts` manually via the Supabase SQL editor.
- **`relation "users" already exists`** on `db:push` — you previously ran a migration that conflicts. Either reset the dev database or use `db:generate` + manual review.
