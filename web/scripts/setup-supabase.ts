import { config as loadEnv } from 'dotenv';
loadEnv({ path: '.env.local' });
loadEnv({ path: '.env' });

/**
 * One-time Supabase Storage bootstrap.
 *
 * Creates the two buckets the app expects and applies minimum policies.
 * Idempotent: safe to re-run (existing buckets are left alone).
 *
 * Usage:
 *   tsx scripts/setup-supabase.ts
 *
 * Requires `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in env.
 * The service-role key bypasses RLS, which is needed to create buckets and
 * write storage policies.
 */
import { supabaseAdmin } from '../lib/storage';

interface BucketSpec {
  name: string;
  public: boolean;
  description: string;
}

const BUCKETS: BucketSpec[] = [
  {
    name: 'images',
    public: true,
    description: 'Post images. Public-read so they embed in FB posts.',
  },
  {
    name: 'screenshots',
    public: false,
    description:
      'Worker-uploaded screenshots (success / captcha / error frames). Private; served via signed URLs.',
  },
];

/**
 * SQL policies applied to `storage.objects`. Two rules:
 *
 *  1. Anyone (anon + authenticated) can SELECT from `images` — public bucket.
 *  2. Authenticated users can INSERT/SELECT/UPDATE/DELETE only inside their
 *     own folder (path prefix matches their auth uid) in either bucket.
 *
 * Server-side uploads from the API route use the service-role client which
 * bypasses these policies entirely; the policies exist for any direct client
 * uploads (none today, but future settings-page avatar upload etc).
 */
const POLICY_SQL = `
-- Drop+recreate so the script is idempotent.
drop policy if exists "Public read of images bucket" on storage.objects;
drop policy if exists "Users manage own images folder" on storage.objects;
drop policy if exists "Users manage own screenshots folder" on storage.objects;

create policy "Public read of images bucket"
  on storage.objects for select
  using (bucket_id = 'images');

create policy "Users manage own images folder"
  on storage.objects for all
  to authenticated
  using (
    bucket_id = 'images'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Users manage own screenshots folder"
  on storage.objects for all
  to authenticated
  using (
    bucket_id = 'screenshots'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'screenshots'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
`;

async function ensureBucket(spec: BucketSpec): Promise<void> {
  // listBuckets is the cheapest existence check the JS SDK exposes.
  const { data: existing, error: listErr } =
    await supabaseAdmin.storage.listBuckets();
  if (listErr) {
    throw new Error(`listBuckets failed: ${listErr.message}`);
  }
  const found = existing?.find((b: { name: string; public: boolean }) => b.name === spec.name);
  if (found) {
    // eslint-disable-next-line no-console
    console.log(
      `  - bucket "${spec.name}" already exists (public=${found.public}); skipping`,
    );
    return;
  }
  const { error } = await supabaseAdmin.storage.createBucket(spec.name, {
    public: spec.public,
  });
  if (error) {
    throw new Error(`createBucket(${spec.name}) failed: ${error.message}`);
  }
  // eslint-disable-next-line no-console
  console.log(
    `  + created bucket "${spec.name}" (public=${spec.public}) — ${spec.description}`,
  );
}

async function applyPolicies(): Promise<void> {
  // The supabase-js client doesn't expose raw SQL, but the postgres connection
  // we already use for Drizzle does. We import lazily so this script doesn't
  // pull in the DB pool unless it gets this far.
  const { db } = await import('../lib/db');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sqlExec = (db as any).execute as
    | ((q: unknown) => Promise<unknown>)
    | undefined;
  if (!sqlExec) {
    // eslint-disable-next-line no-console
    console.warn(
      '  ! Drizzle client does not expose .execute(); skipping policy SQL. ' +
        'Apply scripts/setup-supabase.ts policies manually in the Supabase SQL editor.',
    );
    return;
  }
  const { sql } = await import('drizzle-orm');
  await sqlExec(sql.raw(POLICY_SQL));
  // eslint-disable-next-line no-console
  console.log('  + storage.objects policies applied');
}

async function main(): Promise<void> {
  // eslint-disable-next-line no-console
  console.log('Setting up Supabase Storage…');

  // eslint-disable-next-line no-console
  console.log('Buckets:');
  for (const spec of BUCKETS) {
    await ensureBucket(spec);
  }

  // eslint-disable-next-line no-console
  console.log('Policies:');
  try {
    await applyPolicies();
  } catch (err) {
    // Policies are best-effort; bucket creation is the critical path.
    // eslint-disable-next-line no-console
    console.warn(
      `  ! Failed to apply policies: ${err instanceof Error ? err.message : String(err)}`,
    );
    // eslint-disable-next-line no-console
    console.warn(
      '    The app will still work via the service-role client; ' +
        'apply storage.objects policies manually if you need direct client uploads.',
    );
  }

  // eslint-disable-next-line no-console
  console.log('Done.');
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('setup-supabase failed:', err);
  process.exit(1);
});
