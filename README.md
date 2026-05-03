# WizardPosts (FACEBOOKPOST Cloud)

Multi-tenant SaaS version of FACEBOOKPOST — lets multiple users sign in with Google,
manage their own Facebook posting campaigns from a public web UI, and run a local
worker on their own PC that does the actual posting (using their own FB cookies +
home/office IP — never a datacenter IP, which would get banned by Facebook).

## Architecture

```
┌──────────────────────────┐
│  Vercel (free)           │
│  - Next.js UI + API      │     ← public URL, sign in with Google
│  - NextAuth              │
└──────────┬───────────────┘
           │ REST + JWT
           ↓
┌──────────────────────────┐
│  Supabase (free)         │
│  - Postgres (multi-tenant)│   ← all data scoped by user_id
│  - Storage (post images) │
└──────────┬───────────────┘
           │ Worker pulls jobs
           ↓
┌──────────────────────────┐
│  User's local Worker     │
│  - Playwright Chromium   │   ← runs at user's home/office
│  - User's FB cookies     │
│  - Posts to FB groups    │
└──────────────────────────┘
```

## Components

- **`web/`** — Next.js 15 app, deploys to Vercel. Owns UI + REST API + auth.
- **`worker/`** — TypeScript node app, runs on the user's PC. Pulls jobs, posts to FB.
- **`shared/`** — TypeScript types shared between web and worker.

## Getting started (developer)

1. Create a Supabase project (free) — copy connection string to `web/.env.local`.
2. Create a Google OAuth app — set `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET`.
3. `npm install` (root)
4. `npm run db:push` (creates schema)
5. `npm run dev:web` (UI on :3000)
6. Sign in, generate a worker token, copy to `worker/.env`
7. `npm run dev:worker` (worker connects to local API)

## Deploy to Vercel

1. Push to GitHub.
2. Import to Vercel.
3. Set env vars from `.env.example`.
4. Deploy.

End users:
1. Sign in at your Vercel URL.
2. Settings → Generate Worker Token.
3. Download the worker installer (provided as a zip).
4. Run the installer — it embeds the token, installs Playwright, starts the worker.
5. Connect Facebook (one-time manual login).
